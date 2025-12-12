import { playerRemovePacket, tabListHeaderFooterPacket } from '@/defined-packets.gen';
import { anonymousNbt, string as stringHandler, uuid as uuidHandler, varInt as varIntHandler } from '@/encoding/data-buffer';
import { executeHook, FeatureHook, registerHook } from '@/feature-api/manager';
import { playerInfoUpdatePacket } from '@/manual-packets';
import { defineModule } from '@/module-api/module';
import OnlinePlayersModule from '@/modules/OnlinePlayersModule';
import { writePacket } from '@/network/defined-packet';
import { onServerToClientPacket, onServerToClientTransform } from '@/network/packet-handlers';

export const profilePropertiesMap = new Map<string, any[]>();

const stringEncoder = stringHandler;
const varIntEncoder = varIntHandler;
const readVarIntAt = (buffer: Buffer, offset: number) => {
  const result = varIntHandler.readWithBytesCount(buffer.subarray(offset));
  return { value: result.value, offset: offset + result.bytesRead };
};

const FLAGS = {
  ADD_PLAYER: 0x01,
  INITIALIZE_CHAT: 0x02,
  UPDATE_GAME_MODE: 0x04,
  UPDATE_LISTED: 0x08,
  UPDATE_LATENCY: 0x10,
  UPDATE_DISPLAY_NAME: 0x20,
  UPDATE_HAT: 0x40,
  UPDATE_LIST_ORDER: 0x80,
};

interface PlayerTabInfo {
  uuid: string;
  name?: string;
  properties?: Buffer[];
  gamemode?: number;
  latency?: number;
  displayName?: Buffer;
  listed?: boolean;
  order?: number;
  chatSession?: {
    sessionId: Buffer;
    expiry: Buffer;
    publicKey: Buffer;
    signature: Buffer;
  };
}

const globalTabList = new Map<string, PlayerTabInfo>();

function removePlayerFromTabList(uuid: string): void {
  if (globalTabList.delete(uuid)) {
    console.log(`[TabList] Manually removed player from globalTabList: ${uuid}`);
  }
}

function handlePlayerRemovePacket(packetData: Buffer): void {
  try {
    let offset = 0;
    const numPlayersResult = varIntHandler.readWithBytesCount(packetData);
    const numPlayers = numPlayersResult.value;
    offset += numPlayersResult.bytesRead;

    for (let i = 0; i < numPlayers; i++) {
      if (offset + 16 > packetData.length) return;
      const uuid = uuidHandler.read(packetData.subarray(offset));
      offset += 16;

      if (globalTabList.delete(uuid)) {
        console.log(`[TabList] Removed player from globalTabList: ${uuid}`);
      }
    }
    console.log(`[TabList] After removal, globalTabList.size=${globalTabList.size}`);
  } catch (error) {
    console.error('[TabList] Error handling player_remove:', error);
  }
}

function handlePlayerInfoPacket(packetData: Buffer, propsMap: Map<string, any>, _sourcePlayerUuid?: string): Buffer | null {
  console.log(`[TabList] handlePlayerInfoPacket called, packetData.length=${packetData.length}, hex=${packetData.toString('hex').slice(0, 100)}`);
  try {
    let offset = 0;

    if (offset >= packetData.length) return null;
    const flags = packetData[offset];
    if (flags === undefined) return null;
    offset++;

    const numPlayersResult = varIntHandler.readWithBytesCount(packetData.subarray(offset));
    const numPlayers = numPlayersResult.value;
    offset += numPlayersResult.bytesRead;

    const outputFlags = FLAGS.ADD_PLAYER | FLAGS.UPDATE_GAME_MODE | FLAGS.UPDATE_LISTED | FLAGS.UPDATE_LATENCY;

    const newPacketParts: Buffer[] = [];
    newPacketParts.push(Buffer.from([outputFlags]));
    newPacketParts.push(varIntEncoder(numPlayers));

    const updatedEntries: PlayerTabInfo[] = [];

    for (let i = 0; i < numPlayers; i++) {
      if (offset + 16 > packetData.length) return null;
      const offlineUUID = uuidHandler.read(packetData.subarray(offset));
      const player = OnlinePlayersModule.api.getPlayerByOfflineUuid(offlineUUID);
      const onlineUUID = player?.uuid;
      offset += 16;

      const finalUUID = onlineUUID || offlineUUID;
      newPacketParts.push(uuidHandler(finalUUID));

      let entry = globalTabList.get(finalUUID);
      if (!entry) {
        entry = { uuid: finalUUID };
        globalTabList.set(finalUUID, entry);
      }

      if (flags & FLAGS.ADD_PLAYER) {
        const nameLenResult = readVarIntAt(packetData, offset);
        const nameLen = nameLenResult.value;
        offset = nameLenResult.offset;
        const nameBytes = packetData.subarray(offset, offset + nameLen);
        const name = nameBytes.toString('utf-8');
        offset += nameLen;

        entry.name = name;
        newPacketParts.push(varIntEncoder(nameLen));
        newPacketParts.push(nameBytes);

        const oldPropsResult = readVarIntAt(packetData, offset);
        const oldPropsCount = oldPropsResult.value;
        offset = oldPropsResult.offset;

        for (let p = 0; p < oldPropsCount; p++) {
          const propNameLenResult = readVarIntAt(packetData, offset);
          offset = propNameLenResult.offset + propNameLenResult.value;

          const propValueLenResult = readVarIntAt(packetData, offset);
          offset = propValueLenResult.offset + propValueLenResult.value;

          if (offset >= packetData.length) return null;
          const hasSig = packetData[offset];
          if (hasSig === undefined) return null;
          offset++;

          if (hasSig) {
            const sigLenResult = readVarIntAt(packetData, offset);
            offset = sigLenResult.offset + sigLenResult.value;
          }
        }

        const mojangProps = onlineUUID ? propsMap.get(onlineUUID) : null;
        console.log(
          `[Skin] offlineUUID=${offlineUUID}, onlineUUID=${onlineUUID}, props=${mojangProps ? mojangProps.length : 0}, mapKeys=[${Array.from(propsMap.keys()).join(', ')}]`
        );
        const propsBuffer: Buffer[] = [];
        entry.properties = [];

        if (mojangProps && mojangProps.length > 0) {
          propsBuffer.push(varIntEncoder(mojangProps.length));
          for (const prop of mojangProps) {
            const nameBuf = stringEncoder(prop.name);
            const valueBuf = stringEncoder(prop.value);
            const parts = [nameBuf, valueBuf];

            propsBuffer.push(nameBuf);
            propsBuffer.push(valueBuf);

            if (prop.signature) {
              const hasSig = Buffer.from([0x01]);
              const sigBuf = stringEncoder(prop.signature);
              parts.push(hasSig);
              parts.push(sigBuf);

              propsBuffer.push(hasSig);
              propsBuffer.push(sigBuf);
            } else {
              const noSig = Buffer.from([0x00]);
              parts.push(noSig);

              propsBuffer.push(noSig);
            }
            entry.properties.push(Buffer.concat(parts));
          }
        } else {
          propsBuffer.push(varIntEncoder(0));
        }

        const propsData = Buffer.concat(propsBuffer);
        newPacketParts.push(propsData);
      }

      if (flags & FLAGS.INITIALIZE_CHAT) {
        if (offset >= packetData.length) return null;
        const hasSession = packetData[offset];
        offset++;

        if (hasSession) {
          offset += 16;
          offset += 8;
          const keyLenResult = readVarIntAt(packetData, offset);
          offset = keyLenResult.offset + keyLenResult.value;
          const sigLenResult = readVarIntAt(packetData, offset);
          offset = sigLenResult.offset + sigLenResult.value;
        }
      }

      if (flags & FLAGS.UPDATE_GAME_MODE) {
        const gamemodeResult = readVarIntAt(packetData, offset);
        entry.gamemode = gamemodeResult.value;
        offset = gamemodeResult.offset;
      }
      newPacketParts.push(varIntEncoder(entry.gamemode ?? 0));

      if (flags & FLAGS.UPDATE_LISTED) {
        const listed = packetData[offset];
        if (listed !== undefined) {
          entry.listed = listed !== 0;
          offset++;
        }
      }
      newPacketParts.push(Buffer.from([entry.listed ? 0x01 : 0x00]));

      if (flags & FLAGS.UPDATE_LATENCY) {
        const pingResult = readVarIntAt(packetData, offset);
        entry.latency = pingResult.value;
        offset = pingResult.offset;
      }
      newPacketParts.push(varIntEncoder(entry.latency ?? 0));

      if (flags & FLAGS.UPDATE_DISPLAY_NAME) {
        if (offset >= packetData.length) return null;
        const hasDisplayName = packetData[offset];
        offset++;
        if (hasDisplayName) {
          const nbtResult = anonymousNbt.readWithBytesCount(packetData.subarray(offset));
          offset += nbtResult.bytesRead;
        }
      }

      if (flags & FLAGS.UPDATE_HAT) {
        if (offset >= packetData.length) return null;
        offset++;
      }

      if (flags & FLAGS.UPDATE_LIST_ORDER) {
        const orderResult = readVarIntAt(packetData, offset);
        offset = orderResult.offset;
      }

      updatedEntries.push(entry);
      console.log(`[TabList] Processed entry: uuid=${entry.uuid}, name=${entry.name}`);
    }

    console.log(`[TabList] Successfully processed ${updatedEntries.length} entries, globalTabList.size=${globalTabList.size}`);
    const reconstructedPacket = Buffer.concat(newPacketParts);
    console.log(`[TabList] Reconstructed packet length=${reconstructedPacket.length}, hex=${reconstructedPacket.toString('hex').slice(0, 100)}`);

    return reconstructedPacket;
  } catch (error) {
    console.error('[TabList] Error handling packet:', error);
    return null;
  }
}

function buildPlayerInfoPacket(uuid: string, username: string, properties: any[]): Buffer {
  const FLAGS_ADD = 0x01 | 0x04 | 0x08 | 0x10;
  const parts: Buffer[] = [];

  parts.push(Buffer.from([FLAGS_ADD]));
  parts.push(varIntEncoder(1));
  parts.push(uuidHandler(uuid));
  parts.push(stringEncoder(username));

  if (properties.length > 0) {
    parts.push(varIntEncoder(properties.length));
    for (const prop of properties) {
      parts.push(stringEncoder(prop.name));
      parts.push(stringEncoder(prop.value));
      if (prop.signature) {
        parts.push(Buffer.from([0x01]));
        parts.push(stringEncoder(prop.signature));
      } else {
        parts.push(Buffer.from([0x00]));
      }
    }
  } else {
    parts.push(varIntEncoder(0));
  }

  parts.push(varIntEncoder(0));
  parts.push(Buffer.from([0x01]));
  parts.push(varIntEncoder(0));

  const content = Buffer.concat(parts);
  const packetIdBuf = varIntHandler(playerInfoUpdatePacket.id);
  const packetContent = Buffer.concat([packetIdBuf, content]);
  return Buffer.concat([varIntHandler(packetContent.length), packetContent]);
}

function buildPlayerRemovePacket(uuid: string): Buffer {
  const parts: Buffer[] = [];
  parts.push(varIntEncoder(1));
  parts.push(uuidHandler(uuid));

  const content = Buffer.concat(parts);
  const packetIdBuf = varIntHandler(0x3d);
  const packetContent = Buffer.concat([packetIdBuf, content]);
  return Buffer.concat([varIntHandler(packetContent.length), packetContent]);
}

function handleTabListHeaderFooter(packetData: Buffer): Buffer {
  const headers = executeHook(FeatureHook.TabListHeaderRequest, {});
  const footers = executeHook(FeatureHook.TabListFooterRequest, {});

  const headerPaint = headers.length > 0 ? headers[headers.length - 1] : null;
  const footerPaint = footers.length > 0 ? footers[footers.length - 1] : null;

  if (headerPaint || footerPaint) {
    const h = headerPaint ? anonymousNbt(headerPaint.toNbtObject()) : anonymousNbt({ text: '' });
    const f = footerPaint ? anonymousNbt(footerPaint.toNbtObject()) : anonymousNbt({ text: '' });
    return Buffer.concat([h, f]);
  }
  return packetData;
}

function buildTabListHeaderFooterPacket(): Buffer | null {
  const headers = executeHook(FeatureHook.TabListHeaderRequest, {});
  const footers = executeHook(FeatureHook.TabListFooterRequest, {});

  const headerPaint = headers.length > 0 ? headers[headers.length - 1] : null;
  const footerPaint = footers.length > 0 ? footers[footers.length - 1] : null;

  if (headerPaint || footerPaint) {
    const h = headerPaint ? headerPaint.toNbtObject() : { text: '' };
    const f = footerPaint ? footerPaint.toNbtObject() : { text: '' };

    return writePacket(tabListHeaderFooterPacket, {
      header: h,
      footer: f,
    });
  }
  return null;
}

export default defineModule({
  name: 'TabList',
  api: {
    getProfileProperties(uuid: string): any[] {
      return profilePropertiesMap.get(uuid) || [];
    },

    setProfileProperties(uuid: string, props: any[]): void {
      profilePropertiesMap.set(uuid, props);
    },

    clearProfileProperties(uuid: string): void {
      profilePropertiesMap.delete(uuid);
    },

    removePlayerFromTabList,
    handlePlayerRemovePacket,
    handlePlayerInfoPacket,
    handleTabListHeaderFooter,
    buildPlayerInfoPacket,
    buildPlayerRemovePacket,
    buildTabListHeaderFooterPacket,

    getGlobalTabList(): Map<string, PlayerTabInfo> {
      return globalTabList;
    },

    clearForTesting(): void {
      profilePropertiesMap.clear();
      globalTabList.clear();
    },
  },
  onEnable: () => {
    onServerToClientPacket((_player, packetId, packetData) => {
      if (packetId === playerRemovePacket.id) {
        handlePlayerRemovePacket(packetData);
      }
      return false;
    });

    onServerToClientTransform(tabListHeaderFooterPacket.id, (_player, _packetId, packetData) => {
      return handleTabListHeaderFooter(packetData);
    });

    // Register hooks for proxy to use
    registerHook(FeatureHook.BuildPlayerInfoPacket, ({ uuid, username, props }) => {
      return buildPlayerInfoPacket(uuid, username, props);
    });

    registerHook(FeatureHook.BuildPlayerRemovePacket, ({ uuid }) => {
      return buildPlayerRemovePacket(uuid);
    });

    registerHook(FeatureHook.BuildTabListHeaderFooterPacket, () => {
      return buildTabListHeaderFooterPacket();
    });

    registerHook(FeatureHook.RemovePlayerFromTabList, ({ uuid }) => {
      removePlayerFromTabList(uuid);
    });

    registerHook(FeatureHook.SetProfileProperties, ({ uuid, props }) => {
      profilePropertiesMap.set(uuid, props);
    });

    registerHook(FeatureHook.GetProfileProperties, ({ uuid }) => {
      return profilePropertiesMap.get(uuid) || [];
    });
  },
});
