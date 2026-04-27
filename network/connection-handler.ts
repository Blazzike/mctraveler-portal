import net from 'node:net';
import { kIsOnlineMode, kProtocolVersion, kSecondaryPort } from '@/config';
import { gameStateChangePacket, handshakePacket, joinGamePacket, respawnPacket, systemChatPacket, useEntityPacket } from '@/defined-packets.gen';
import { anonymousNbt, byte, string, varInt } from '@/encoding/data-buffer';
import { executeHook, executeHookFirst, FeatureHook } from '@/feature-api/manager';
import p from '@/feature-api/paint';
import { log } from '@/logging';
import PersistenceModule from '@/modules/PersistenceModule';
import SyncModule from '@/modules/SyncModule';
import { createSetCompressionPacket, DEFAULT_COMPRESSION_THRESHOLD, enableCompression } from '@/network/compression';
import { ConnectionState } from '@/network/connection-state';
import { readPacketFields, writePacket } from '@/network/defined-packet';
import { enableEncryption, rsaDecrypt, type ServerKeyPair } from '@/network/encryption';
import { handleProxyQuery } from '@/network/handle-proxy-query';
import { formatUuidWithDashes, parseLoginStart, parseLoginSuccess, resolvePort } from '@/network/login';
import { createEncryptionRequest, createLoginDisconnect, encryptionResponsePacket } from '@/network/login-packets';
import { generateServerId, generateVerifyToken, verifyMojangSession } from '@/network/mojang-session';
import { handleClientToServerPacket, handleServerToClientPacket, type ProxyPlayer, transformServerToClientPacket } from '@/network/packet-handlers';
import {
  CHAT_SESSION_UPDATE,
  CLIENT_SETTINGS,
  EDIT_BOOK,
  ENCRYPTION_RESPONSE,
  FINISH_CONFIGURATION,
  HANDSHAKE_LOGIN,
  HANDSHAKE_STATUS,
  INTERACT_RATE_LIMIT_MS,
  INVENTORY_CLICK,
  KEEP_ALIVE_CONFIG,
  KNOWN_PACKS,
  LOGIN_ACKNOWLEDGED,
  LOGIN_DISCONNECT,
  LOGIN_START,
  LOGIN_SUCCESS,
  SERVER_SWITCH_DISCONNECT_DELAY,
  SET_COMPRESSION,
  TAB_LIST_SEND_DELAY,
} from '@/network/packet-ids';
import { createPacketQueue, type PacketQueue } from '@/network/packet-queue';
import { parsePlayerInteraction, parsePlayerMessage, parsePlayerMovement, shouldFilterInteractAt } from '@/network/packet-routing';
import {
  broadcastJoinMessage,
  broadcastPlayerJoin,
  deletePlayerSocket,
  deleteServerSocket,
  flushPendingJoinMessages,
  generateOfflineUUID,
  type OnlinePlayer,
  sendGlobalTabList,
  sendTabListHeaderFooter,
  setPlayerDimensionByName,
  trackConnectionClose,
  trackPlayerLogin,
  trackServerSocket,
} from '@/network/player-tracking';
import type { StatusResponse } from '@/network/types';
import { forwardPacket, safeWrite } from '@/network/util';

function getPlayerLastServerName(uuid: string): 'primary' | 'secondary' | undefined {
  return PersistenceModule.api.getPlayerLastServerName(uuid);
}

function setPlayerLastServerName(uuid: string, server: 'primary' | 'secondary'): void {
  PersistenceModule.api.setPlayerLastServerName(uuid, server);
}

async function syncPlayerData(uuid: string, fromPort: number, toPort: number): Promise<void> {
  await SyncModule.api.syncPlayerData(uuid, fromPort, toPort);
}

/** Manages a single client connection through its lifecycle phases. */
export class ConnectionHandler {
  private state: ConnectionState = ConnectionState.Login;
  private isSwitching = false;
  private trackedPlayer: OnlinePlayer | null = null;
  private currentBackendPort: number;
  private serverSocket!: net.Socket;
  private serverPacketQueue!: PacketQueue;
  private cachedProxyPlayer: ProxyPlayer | null = null;

  private handshake: any = null;
  private pendingLogin: { username: string; verifyToken: Buffer } | null = null;
  private pendingClientLogin: { username: string; uuid: string; sharedSecret: Buffer; profile: any; isRemapped: boolean } | null = null;

  private readonly clientIp: string | undefined;
  private readonly playerSwitcher: Map<string, (port: number) => Promise<void>>;

  constructor(
    private readonly clientSocket: net.Socket,
    private readonly clientPacketQueue: PacketQueue,
    private readonly serverKeyPair: ServerKeyPair | null,
    private readonly targetPort: number,
    private readonly onStatusRequest: () => StatusResponse,
    playerSwitcher: Map<string, (port: number) => Promise<void>>
  ) {
    this.currentBackendPort = targetPort;
    this.clientIp = clientSocket.remoteAddress?.replace('::ffff:', '');
    this.playerSwitcher = playerSwitcher;
  }

  /** Run the connection handler to completion. */
  async run(handshake: any): Promise<void> {
    this.handshake = handshake;
    if (handshake.nextState === HANDSHAKE_STATUS) {
      await handleProxyQuery(this.clientSocket, this.clientPacketQueue, this.onStatusRequest);
      return;
    }

    this.state = handshake.nextState === HANDSHAKE_LOGIN ? ConnectionState.Login : ConnectionState.Play;

    // Set up client packet handler
    this.clientPacketQueue.onPacket(async (packet) => {
      await this.handleClientPacket(packet);
    });

    // Set up connection lifecycle
    this.clientSocket.on('close', () => {
      if (this.trackedPlayer) {
        trackConnectionClose(this.trackedPlayer.uuid);
        this.playerSwitcher.delete(this.trackedPlayer.uuid);
      }
      if (this.serverSocket) {
        this.serverSocket.end();
      }
    });

    this.clientSocket.on('error', () => {
      if (this.serverSocket) {
        this.serverSocket.end();
      }
    });

    // Initial connection to backend
    // The first client packet (Login Start) will trigger connectToBackend
  }

  // ─── Client→Server Packet Handling ──────────────────────────────────

  private async handleClientPacket(packet: { packetId: number; packetData: Buffer }): Promise<void> {
    if (this.isSwitching) return;

    if (this.state === ConnectionState.Login) {
      const handled = await this.handleClientLoginPacket(packet);
      if (handled) return;
    }

    // Configuration state - forward all packets (settings contains view distance)
    if (this.state === ConnectionState.Configuration) {
      if (packet.packetId === CLIENT_SETTINGS && this.trackedPlayer) this.trackedPlayer.cachedClientSettings = packet.packetData;
      if (packet.packetId === KNOWN_PACKS && this.trackedPlayer) this.trackedPlayer.cachedKnownPacks = packet.packetData;
    }

    if (this.state === ConnectionState.Play && this.trackedPlayer && kIsOnlineMode) {
      if (packet.packetId === CHAT_SESSION_UPDATE) return;
    }

    if (this.state === ConnectionState.Play && this.trackedPlayer) {
      const handled = this.handleClientPlayPacket(packet);
      if (handled) return;
    }

    if (this.serverSocket) {
      forwardPacket(this.serverSocket, packet);
    }
  }

  private async handleClientLoginPacket(packet: { packetId: number; packetData: Buffer }): Promise<boolean> {
    const loginData = parseLoginStart(packet.packetData);
    if (loginData && !this.pendingLogin) {
      if (kIsOnlineMode && this.serverKeyPair) {
        // Generate verify token and send Encryption Request
        const verifyToken = generateVerifyToken();
        this.pendingLogin = { username: loginData.username, verifyToken };

        const encryptionRequest = createEncryptionRequest(this.serverKeyPair.publicKey, verifyToken);
        safeWrite(this.clientSocket, encryptionRequest);
        return true;
      } else {
        // Offline Mode - Connect to backend now
        const offlineUuid = generateOfflineUUID(loginData.username);
        const formattedOfflineUuid = formatUuidWithDashes(offlineUuid);
        const savedPort = resolvePort(getPlayerLastServerName(formattedOfflineUuid));
        const initialPort = savedPort || this.targetPort;
        this.currentBackendPort = initialPort;

        try {
          await this.connectToBackend(initialPort);
          if (this.serverSocket) {
            // Construct Login Start packet with offline UUID for backend
            const loginStartPacketId = varInt(LOGIN_START);
            const loginStartUsername = string(loginData.username);
            const loginStartUuid = Buffer.from(formattedOfflineUuid.replace(/-/g, ''), 'hex');
            const loginStartContent = Buffer.concat([loginStartPacketId, loginStartUsername, loginStartUuid]);
            const backendLoginStart = Buffer.concat([varInt(loginStartContent.length), loginStartContent]);
            safeWrite(this.serverSocket, backendLoginStart);
          }
        } catch {
          // Connection error already handled in connectToBackend
        }
        return true;
      }
    }

    // Handle Encryption Response in login state
    if (this.pendingLogin && packet.packetId === ENCRYPTION_RESPONSE && this.serverKeyPair) {
      await this.handleEncryptionResponse(packet.packetData);
      return true;
    }

    return false;
  }

  private async handleEncryptionResponse(packetData: Buffer): Promise<void> {
    try {
      const encResponse = readPacketFields(encryptionResponsePacket.fields, packetData);

      const sharedSecret = rsaDecrypt(this.serverKeyPair!.privateKey, encResponse.sharedSecret);
      const decryptedToken = rsaDecrypt(this.serverKeyPair!.privateKey, encResponse.verifyToken);

      if (!decryptedToken.equals(this.pendingLogin!.verifyToken)) {
        const disconnectPacket = createLoginDisconnect(p.error`Encryption error!`);
        safeWrite(this.clientSocket, disconnectPacket);
        this.clientSocket.end();
        return;
      }

      const serverId = generateServerId(sharedSecret, this.serverKeyPair!.publicKey);

      const isLocalIp =
        this.clientIp === '127.0.0.1' || this.clientIp === '::1' || this.clientIp?.startsWith('192.168.') || this.clientIp?.startsWith('10.');
      const profile = await verifyMojangSession(this.pendingLogin!.username, serverId, isLocalIp ? undefined : this.clientIp);

      if (!profile) {
        const disconnectPacket = createLoginDisconnect(
          p.error`Failed to verify username!\n\n${p.gray`Your Minecraft session could not be verified.\nPlease restart your client and try again.`}`
        );
        safeWrite(this.clientSocket, disconnectPacket);
        this.clientSocket.end();
        return;
      }

      enableEncryption(this.clientSocket, sharedSecret);

      const formattedUuid = formatUuidWithDashes(profile.id);

      const remap = executeHookFirst<{ newUsername: string; newUuid: string }>(FeatureHook.GetRemappedProfile, {
        username: this.pendingLogin!.username,
      });
      const backendUsername = remap?.newUsername ?? this.pendingLogin!.username;
      const backendUuid = remap?.newUuid ?? formattedUuid;

      this.pendingClientLogin = {
        username: backendUsername,
        uuid: backendUuid,
        sharedSecret,
        profile,
        isRemapped: remap !== null,
      };

      if (remap) {
        log.for('TravelPatch').info('Remapping %s -> %s', this.pendingLogin!.username, backendUsername);
      }

      const savedPort = resolvePort(getPlayerLastServerName(backendUuid));
      const initialPort = savedPort || this.targetPort;
      this.currentBackendPort = initialPort;

      await this.connectToBackend(initialPort);

      const loginStartPacketId = varInt(LOGIN_START);
      const loginStartUsername = string(backendUsername);
      const loginStartUuid = Buffer.from(backendUuid.replace(/-/g, ''), 'hex');
      const loginStartContent = Buffer.concat([loginStartPacketId, loginStartUsername, loginStartUuid]);
      const backendLoginStart = Buffer.concat([varInt(loginStartContent.length), loginStartContent]);
      safeWrite(this.serverSocket, backendLoginStart);

      this.pendingLogin = null;
    } catch (error) {
      log.for('Auth').error('Encryption handshake error: %s', error);
      const disconnectPacket = createLoginDisconnect(p.error`Authentication failed`);
      safeWrite(this.clientSocket, disconnectPacket);
      this.clientSocket.end();
    }
  }

  private getProxyPlayer(): ProxyPlayer {
    const trackedPlayer = this.trackedPlayer!;
    if (this.cachedProxyPlayer && this.cachedProxyPlayer.serverSocket === this.serverSocket) {
      return this.cachedProxyPlayer;
    }
    this.cachedProxyPlayer = {
      uuid: trackedPlayer.uuid,
      username: trackedPlayer.username,
      clientSocket: this.clientSocket,
      serverSocket: this.serverSocket,
      serverPort: this.currentBackendPort,
      isPremium: trackedPlayer.isOnline,
      offlineUuid: trackedPlayer.offlineUuid,
    };
    return this.cachedProxyPlayer;
  }

  private handleClientPlayPacket(packet: { packetId: number; packetData: Buffer }): boolean {
    const trackedPlayer = this.trackedPlayer!;
    const proxyPlayer = this.getProxyPlayer();

    if (handleClientToServerPacket(proxyPlayer, packet.packetId, packet.packetData)) {
      return true;
    }

    if (packet.packetId === EDIT_BOOK) {
      const results = executeHook(FeatureHook.EditBook, { player: trackedPlayer, packetData: packet.packetData });
      if (results.some((r) => r === true)) return true;
    }

    if (packet.packetId === INVENTORY_CLICK) {
      executeHook(FeatureHook.InventoryClick, { player: trackedPlayer, packetData: packet.packetData });
    }

    if (parsePlayerMessage(trackedPlayer, packet.packetId, packet.packetData)) return true;

    parsePlayerMovement(trackedPlayer, packet.packetId, packet.packetData);
    parsePlayerInteraction(trackedPlayer, packet.packetId, packet.packetData);

    if (shouldFilterInteractAt(trackedPlayer, packet.packetId, packet.packetData)) return true;

    // Rate limit interact packets
    if (packet.packetId === useEntityPacket.id) {
      const now = Date.now();
      if (!trackedPlayer._lastInteractTime) trackedPlayer._lastInteractTime = 0;
      if (now - trackedPlayer._lastInteractTime < INTERACT_RATE_LIMIT_MS) return true;
      trackedPlayer._lastInteractTime = now;
    }

    return false;
  }

  // ─── Server→Client Packet Handling ──────────────────────────────────

  private handleServerPacket(packet: { packetId: number; packetData: Buffer }): void {
    // Handle Switch Logic
    if (this.isSwitching) {
      this.handleSwitchPacket(packet);
      return;
    }

    // Filter Backend Join/Leave Messages
    if (packet.packetId === systemChatPacket.id && this.state === ConnectionState.Play) {
      try {
        const nbtData = packet.packetData.subarray(0, -1);
        const decoded = anonymousNbt.read(nbtData);
        if (decoded.translate === 'multiplayer.player.joined' || decoded.translate === 'multiplayer.player.left') {
          log.for('Chat').debug('Suppressing backend join/leave message: %s', decoded.translate);
          return;
        }
      } catch (e) {
        log.for('Chat').debug('Failed to parse system chat: %s', e);
      }
    }

    // Login state
    if (this.state === ConnectionState.Login) {
      this.handleServerLoginPacket(packet);
      return;
    }

    // Configuration state
    if (this.state === ConnectionState.Configuration) {
      if (packet.packetId === FINISH_CONFIGURATION) {
        this.state = ConnectionState.Play;
        forwardPacket(this.clientSocket, packet);
        return;
      }
    }

    // Play state
    if (this.state === ConnectionState.Play && this.trackedPlayer) {
      const handled = this.handleServerPlayPacket(packet);
      if (handled) return;
    }

    forwardPacket(this.clientSocket, packet);
  }

  private handleServerLoginPacket(packet: { packetId: number; packetData: Buffer }): void {
    if (packet.packetId === SET_COMPRESSION) {
      const threshold = varInt.read(packet.packetData);
      enableCompression(this.serverSocket, threshold);
      forwardPacket(this.clientSocket, packet);
      return;
    }

    const loginData = parseLoginSuccess(packet.packetData);
    if (!loginData) return;

    if (kIsOnlineMode && this.pendingClientLogin) {
      const props = this.pendingClientLogin.profile.properties || [];
      log.for('Skin').info('Storing %d properties for UUID %s', props.length, this.pendingClientLogin.uuid);
      executeHook(FeatureHook.SetProfileProperties, { uuid: this.pendingClientLogin.uuid, props });

      this.trackedPlayer = trackPlayerLogin(
        this.pendingClientLogin.uuid,
        this.pendingClientLogin.username,
        this.clientSocket,
        this.currentBackendPort,
        true,
        undefined,
        this.playerSwitcher
      );
      trackServerSocket(this.trackedPlayer, this.serverSocket);
      setPlayerLastServerName(this.trackedPlayer.uuid, this.currentBackendPort === kSecondaryPort ? 'secondary' : 'primary');
      this.playerSwitcher.set(this.pendingClientLogin.uuid, (port) => this.connectToBackend(port, true));

      const packetId = varInt(LOGIN_SUCCESS);
      const uuidBytes = Buffer.from(this.pendingClientLogin.uuid.replace(/-/g, ''), 'hex');
      const usernameBytes = string(this.pendingClientLogin.username);

      const properties = this.pendingClientLogin.profile.properties || [];
      const propertiesCount = varInt(properties.length);
      const propertiesBuffers = properties.map((prop: any) => {
        const nameBuffer = string(prop.name);
        const valueBuffer = string(prop.value);
        if (prop.signature) {
          const hasSignature = Buffer.from([0x01]);
          const signatureBuffer = string(prop.signature);
          return Buffer.concat([nameBuffer, valueBuffer, hasSignature, signatureBuffer]);
        } else {
          const hasSignature = Buffer.from([0x00]);
          return Buffer.concat([nameBuffer, valueBuffer, hasSignature]);
        }
      });
      const propertiesData = propertiesBuffers.length > 0 ? Buffer.concat(propertiesBuffers) : Buffer.alloc(0);
      const packetContent = Buffer.concat([packetId, uuidBytes, usernameBytes, propertiesCount, propertiesData]);
      const loginSuccess = Buffer.concat([varInt(packetContent.length), packetContent]);

      const setCompressionPacket = createSetCompressionPacket(DEFAULT_COMPRESSION_THRESHOLD);
      safeWrite(this.clientSocket, setCompressionPacket);
      enableCompression(this.clientSocket, DEFAULT_COMPRESSION_THRESHOLD);
      safeWrite(this.clientSocket, loginSuccess);

      this.state = ConnectionState.Configuration;
      this.pendingClientLogin = null;
      broadcastJoinMessage(this.trackedPlayer, true);
      return;
    } else {
      // Offline mode
      this.trackedPlayer = trackPlayerLogin(
        loginData.uuid,
        loginData.username,
        this.clientSocket,
        this.currentBackendPort,
        false,
        undefined,
        this.playerSwitcher
      );
      trackServerSocket(this.trackedPlayer, this.serverSocket);
      setPlayerLastServerName(this.trackedPlayer.uuid, this.currentBackendPort === kSecondaryPort ? 'secondary' : 'primary');
      this.playerSwitcher.set(loginData.uuid, (port) => this.connectToBackend(port, true));

      const setCompressionPacket = createSetCompressionPacket(DEFAULT_COMPRESSION_THRESHOLD);
      safeWrite(this.clientSocket, setCompressionPacket);
      enableCompression(this.clientSocket, DEFAULT_COMPRESSION_THRESHOLD);

      this.state = ConnectionState.Configuration;
      forwardPacket(this.clientSocket, packet);
      broadcastJoinMessage(this.trackedPlayer, true);
      return;
    }
  }

  private handleServerPlayPacket(packet: { packetId: number; packetData: Buffer }): boolean {
    const trackedPlayer = this.trackedPlayer!;
    const proxyPlayer = this.getProxyPlayer();

    // Run handlers first (may intercept and block)
    if (handleServerToClientPacket(proxyPlayer, packet.packetId, packet.packetData)) return true;

    // Run transforms (may modify packet data)
    const transformedData = transformServerToClientPacket(proxyPlayer, packet.packetId, packet.packetData);
    if (transformedData === null) return true;
    if (transformedData !== packet.packetData) {
      const packetIdBuf = varInt(packet.packetId);
      const packetContent = Buffer.concat([packetIdBuf, transformedData]);
      const fullPacket = Buffer.concat([varInt(packetContent.length), packetContent]);
      safeWrite(this.clientSocket, fullPacket);
      return true;
    }

    // System chat hook
    if (packet.packetId === systemChatPacket.id) {
      const nbtData = packet.packetData.subarray(0, -1);
      const isActionBar = packet.packetData[packet.packetData.length - 1];

      const hookResults = executeHook(FeatureHook.SystemChat, { nbt: nbtData, isActionBar });
      const paintResult = hookResults.find((r) => r != null && r !== true);

      if (paintResult === false) return true;

      if (paintResult && typeof paintResult === 'object' && 'toNbtObject' in paintResult) {
        const nbtObject = paintResult.toNbtObject();
        const formattedNBT = anonymousNbt(nbtObject);
        const packetId = varInt(systemChatPacket.id);
        const actionBarByte = Buffer.from([isActionBar ?? 0]);
        const packetContent = Buffer.concat([packetId, formattedNBT, actionBarByte]);
        const fullPacket = Buffer.concat([varInt(packetContent.length), packetContent]);
        safeWrite(this.clientSocket, fullPacket);
        return true;
      }
    }

    // After Join Game packet, send tab list
    if (packet.packetId === joinGamePacket.id) {
      forwardPacket(this.clientSocket, packet);

      const playerForTabList = trackedPlayer;
      const socketForTabList = this.clientSocket;
      setTimeout(() => {
        if (!playerForTabList || socketForTabList.destroyed) return;

        const selfProps = executeHookFirst(FeatureHook.GetProfileProperties, { uuid: playerForTabList.uuid }) || [];
        const selfPacket = executeHookFirst<Buffer>(FeatureHook.BuildPlayerInfoPacket, {
          uuid: playerForTabList.uuid,
          username: playerForTabList.username,
          props: selfProps,
        });
        if (selfPacket) safeWrite(socketForTabList, selfPacket);

        sendGlobalTabList(playerForTabList);
        sendTabListHeaderFooter(playerForTabList);
        broadcastPlayerJoin(playerForTabList.uuid, playerForTabList.username, playerForTabList.uuid);
        flushPendingJoinMessages();
      }, TAB_LIST_SEND_DELAY);
      return true;
    }

    // Track dimension changes from Respawn packets
    if (packet.packetId === respawnPacket.id) {
      try {
        const data = packet.packetData;
        let offset = 0;
        let b = 0;
        do {
          b = data[offset++] ?? 0;
        } while ((b & 0x80) !== 0);

        let nameLen = 0;
        let shift = 0;
        do {
          b = data[offset++] ?? 0;
          nameLen |= (b & 0x7f) << shift;
          shift += 7;
        } while ((b & 0x80) !== 0);

        const dimensionName = data.subarray(offset, offset + nameLen).toString('utf8');
        setPlayerDimensionByName(trackedPlayer, dimensionName);
        offset += nameLen;

        offset += 8; // Skip hashedSeed
        const gameMode = data.readInt8(offset);
        executeHook(FeatureHook.PlayerGameModeChange, { player: trackedPlayer, gameMode });
      } catch (e) {
        log.for('Dimension').error('Failed to parse dimension: %s', e);
      }
    }

    // Track gamemode changes from server
    if (packet.packetId === gameStateChangePacket.id) {
      try {
        const data = packet.packetData;
        const reason = data[0];
        if (reason === 3) {
          const gameMode = data.readFloatBE(1);
          executeHook(FeatureHook.PlayerGameModeChange, { player: trackedPlayer, gameMode: Math.floor(gameMode) });
        }
      } catch {
        // Ignore parse errors
      }
    }

    return false;
  }

  // ─── Server Switch Handling ─────────────────────────────────────────

  private handleSwitchPacket(packet: { packetId: number; packetData: Buffer }): void {
    if (packet.packetId === LOGIN_SUCCESS) {
      const loginData = parseLoginSuccess(packet.packetData);
      if (loginData && this.trackedPlayer) {
        const existingUuid = this.trackedPlayer.uuid;
        const existingUsername = this.trackedPlayer.username;
        const oldPlayer = this.trackedPlayer;

        deletePlayerSocket(oldPlayer);
        deleteServerSocket(oldPlayer);

        this.trackedPlayer = trackPlayerLogin(
          existingUuid,
          existingUsername,
          this.clientSocket,
          this.currentBackendPort,
          true,
          undefined,
          this.playerSwitcher
        );
        trackServerSocket(this.trackedPlayer, this.serverSocket);
        setPlayerLastServerName(this.trackedPlayer.uuid, this.currentBackendPort === kSecondaryPort ? 'secondary' : 'primary');

        this.trackedPlayer.cachedClientSettings = oldPlayer.cachedClientSettings;
        this.trackedPlayer.cachedKnownPacks = oldPlayer.cachedKnownPacks;
        this.cachedProxyPlayer = null;

        this.playerSwitcher.set(existingUuid, (port) => this.connectToBackend(port, true));

        const loginAckId = varInt(LOGIN_ACKNOWLEDGED);
        const loginAckPacket = Buffer.concat([varInt(loginAckId.length), loginAckId]);
        safeWrite(this.serverSocket, loginAckPacket);

        if (this.trackedPlayer.cachedClientSettings) {
          const pid = varInt(CLIENT_SETTINGS);
          const pcontent = Buffer.concat([pid, this.trackedPlayer.cachedClientSettings]);
          safeWrite(this.serverSocket, Buffer.concat([varInt(pcontent.length), pcontent]));
        }
        if (this.trackedPlayer.cachedKnownPacks) {
          const pid = varInt(KNOWN_PACKS);
          const pcontent = Buffer.concat([pid, this.trackedPlayer.cachedKnownPacks]);
          safeWrite(this.serverSocket, Buffer.concat([varInt(pcontent.length), pcontent]));
        }
      }
      return;
    }

    if (packet.packetId === LOGIN_DISCONNECT) {
      log.for('Switch').info('Received Disconnect (LOGIN_DISCONNECT)');
      return;
    }

    if (packet.packetId === FINISH_CONFIGURATION) {
      const finishConfigId = varInt(FINISH_CONFIGURATION);
      const finishConfigPacket = Buffer.concat([varInt(finishConfigId.length), finishConfigId]);
      safeWrite(this.serverSocket, finishConfigPacket);
      return;
    }

    if (packet.packetId === KEEP_ALIVE_CONFIG) {
      const keepAliveId = packet.packetData;
      const packetId = varInt(KEEP_ALIVE_CONFIG);
      const packetContent = Buffer.concat([packetId, keepAliveId]);
      const fullPacket = Buffer.concat([varInt(packetContent.length), packetContent]);
      safeWrite(this.serverSocket, fullPacket);
      return;
    }

    if (packet.packetId === joinGamePacket.id) {
      this.handleSwitchJoinGame(packet.packetData);
      return;
    }
  }

  private handleSwitchJoinGame(packetData: Buffer): void {
    try {
      let offset = 0;
      const data = packetData;

      offset += 4; // Skip entityId
      offset += 1; // Skip isHardcore

      // Skip worldNames array
      let arrayCount = 0;
      let shift = 0;
      let b = 0;
      do {
        b = data[offset++] ?? 0;
        arrayCount |= (b & 0x7f) << shift;
        shift += 7;
      } while ((b & 0x80) !== 0);

      for (let i = 0; i < arrayCount; i++) {
        let strLen = 0;
        shift = 0;
        do {
          b = data[offset++] ?? 0;
          strLen |= (b & 0x7f) << shift;
          shift += 7;
        } while ((b & 0x80) !== 0);
        offset += strLen;
      }

      for (let i = 0; i < 3; i++) {
        do {
          b = data[offset++] ?? 0;
        } while ((b & 0x80) !== 0);
      }
      offset += 3; // Skip 3 bools

      const worldStateStart = offset;

      let dimensionId = 0;
      shift = 0;
      const dimStart = offset;
      do {
        b = data[offset++] ?? 0;
        dimensionId |= (b & 0x7f) << shift;
        shift += 7;
      } while ((b & 0x80) !== 0);
      const dimEnd = offset;

      const worldStateBuffer = data.subarray(worldStateStart, data.length - 1);
      const alternateDimensionId = dimensionId === 0 ? 1 : 0;

      const alternateDimensionVarInt = varInt(alternateDimensionId);
      const restOfWorldState = worldStateBuffer.subarray(dimEnd - dimStart);
      const alternateWorldState = Buffer.concat([alternateDimensionVarInt, restOfWorldState]);

      const preSpawnInfo = data.subarray(0, worldStateStart);
      const postSpawnInfo = data.subarray(data.length - 1);
      const newJoinGameData = Buffer.concat([preSpawnInfo, alternateWorldState, postSpawnInfo]);

      const joinGameId = varInt(joinGamePacket.id);
      const joinGameFullPacket = Buffer.concat([varInt(joinGameId.length + newJoinGameData.length), joinGameId, newJoinGameData]);

      const respawnPacketData = writePacket(respawnPacket, {
        worldState: worldStateBuffer,
        copyMetadata: byte(0x00),
      });

      log.for('Switch').info('Applied dimension trick: Join(Alt %d) -> Respawn(Original %d)', alternateDimensionId, dimensionId);

      safeWrite(this.clientSocket, joinGameFullPacket);
      safeWrite(this.clientSocket, respawnPacketData);

      if (this.trackedPlayer) {
        let dimNameOffset = dimEnd - worldStateStart;
        let dimNameLen = 0;
        let dimShift = 0;
        let dimB = 0;
        do {
          dimB = worldStateBuffer[dimNameOffset++] ?? 0;
          dimNameLen |= (dimB & 0x7f) << dimShift;
          dimShift += 7;
        } while ((dimB & 0x80) !== 0);
        const dimensionName = worldStateBuffer.subarray(dimNameOffset, dimNameOffset + dimNameLen).toString('utf8');
        setPlayerDimensionByName(this.trackedPlayer, dimensionName);

        const gameModeOffset = dimNameOffset + dimNameLen + 8;
        if (gameModeOffset < worldStateBuffer.length) {
          const gameMode = worldStateBuffer.readInt8(gameModeOffset);
          executeHook(FeatureHook.PlayerGameModeChange, { player: this.trackedPlayer, gameMode });
        }
      }

      if (this.trackedPlayer) {
        const playerForTabList = this.trackedPlayer;
        const socketForTabList = this.clientSocket;
        setTimeout(() => {
          if (!playerForTabList || socketForTabList.destroyed) return;

          const selfProps = executeHookFirst(FeatureHook.GetProfileProperties, { uuid: playerForTabList.uuid }) || [];
          const selfPacket = executeHookFirst<Buffer>(FeatureHook.BuildPlayerInfoPacket, {
            uuid: playerForTabList.uuid,
            username: playerForTabList.username,
            props: selfProps,
          });
          if (selfPacket) safeWrite(socketForTabList, selfPacket);

          sendGlobalTabList(playerForTabList);
          sendTabListHeaderFooter(playerForTabList);
          broadcastPlayerJoin(playerForTabList.uuid, playerForTabList.username, playerForTabList.uuid);
        }, TAB_LIST_SEND_DELAY);
      }

      this.isSwitching = false;
    } catch (error) {
      log.for('Switch').error('Failed to apply dimension trick: %s', error);
      forwardPacket(this.clientSocket, { packetId: joinGamePacket.id, packetData });
      this.isSwitching = false;
    }
  }

  // ─── Backend Connection ─────────────────────────────────────────────

  async connectToBackend(targetPort: number, isSwitch: boolean = false): Promise<void> {
    if (isSwitch && this.trackedPlayer) {
      executeHook(FeatureHook.RemovePlayerFromTabList, { uuid: this.trackedPlayer.uuid });
      executeHook(FeatureHook.ClearPlayerProtection, { player: this.trackedPlayer });

      if (this.serverSocket) {
        this.serverSocket.removeAllListeners();
        this.serverSocket.end();
        await new Promise((resolve) => setTimeout(resolve, SERVER_SWITCH_DISCONNECT_DELAY));
      }
      await syncPlayerData(this.trackedPlayer.offlineUuid, this.currentBackendPort, targetPort);
    } else {
      if (this.serverSocket) {
        this.serverSocket.removeAllListeners();
        this.serverSocket.end();
      }
    }

    if (isSwitch) {
      this.isSwitching = true;
      this.currentBackendPort = targetPort;
    }

    return new Promise<void>((resolve, reject) => {
      this.serverSocket = net.connect(targetPort, 'localhost');

      this.serverSocket.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'ECONNREFUSED') {
          log.for('Proxy').info('Backend server on port %d not available', targetPort);
          const disconnectPacket = createLoginDisconnect(p.error`Server is starting up. Please try again in a moment.`);
          safeWrite(this.clientSocket, disconnectPacket);
          this.clientSocket.end();
          reject(err);
          return;
        }
        log.for('Proxy').error('Connection error: %s', err.message);
        this.clientSocket.end();
        reject(err);
      });

      this.serverSocket.once('connect', () => {
        this.serverPacketQueue = createPacketQueue(this.serverSocket);

        if (isSwitch) {
          const handshakeData = {
            protocolVersion: kProtocolVersion,
            serverHost: 'localhost',
            serverPort: targetPort,
            nextState: HANDSHAKE_LOGIN,
          };
          safeWrite(this.serverSocket, writePacket(handshakePacket, handshakeData));

          if (this.trackedPlayer) {
            const loginStartPacketId = varInt(LOGIN_START);
            const loginStartUsername = string(this.trackedPlayer.username);
            const loginStartUuid = Buffer.from(this.trackedPlayer.uuid.replace(/-/g, ''), 'hex');
            const loginStartContent = Buffer.concat([loginStartPacketId, loginStartUsername, loginStartUuid]);
            const backendLoginStart = Buffer.concat([varInt(loginStartContent.length), loginStartContent]);
            safeWrite(this.serverSocket, backendLoginStart);
          }
        } else {
          safeWrite(this.serverSocket, writePacket(handshakePacket, this.handshake));
        }

        this.serverPacketQueue.onPacket((packet) => {
          this.handleServerPacket(packet);
        });

        this.serverSocket.on('error', (e) => {
          log.for('Proxy').error('server socket error: %s', e.message);
          if (!this.isSwitching) this.clientSocket.end();
        });

        this.serverSocket.on('close', () => {
          if (!this.isSwitching) this.clientSocket.end();
        });

        resolve();
      });
    });
  }
}
