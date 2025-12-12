import {
  anonymousNbt,
  boolean,
  buffer,
  byte,
  createArray,
  createContainer,
  createOptional,
  double,
  float,
  int,
  long,
  position,
  raw,
  restBuffer,
  short,
  slot,
  spawnInfo,
  string,
  unsignedShort,
  uuid,
  varInt,
  vec2f,
  when,
} from '@/encoding/data-buffer';
import { definePacket } from '@/network/defined-packet';

export const handshakePacket = definePacket({
  id: 0x00,
  fields: {
    protocolVersion: varInt,
    serverHost: string,
    serverPort: unsignedShort,
    nextState: varInt,
  },
});

export const statusRequestPacket = definePacket({
  id: 0x00,
  fields: {},
});

export const statusResponsePacket = definePacket({
  id: 0x00,
  fields: {
    response: string,
  },
});

export const pingRequestPacket = definePacket({
  id: 0x01,
  fields: {
    time: long,
  },
});

export const pingResponsePacket = definePacket({
  id: 0x01,
  fields: {
    time: long,
  },
});

export const loginDisconnectPacket = definePacket({
  id: 0x00,
  fields: {
    reason: string,
  },
});

export const encryptionRequestPacket = definePacket({
  id: 0x01,
  fields: {
    serverId: string,
    publicKey: buffer,
    verifyToken: buffer,
    shouldAuthenticate: boolean,
  },
});

export const encryptionResponsePacket = definePacket({
  id: 0x01,
  fields: {
    sharedSecret: buffer,
    verifyToken: buffer,
  },
});

export const loginStartPacket = definePacket({
  id: 0x00,
  fields: {
    username: string,
    playerUUID: uuid,
  },
});

export const chatCommandPacket = definePacket({
  id: 0x06,
  fields: {
    command: string,
  },
});

export const chatCommandSignedPacket = definePacket({
  id: 0x07,
  fields: {
    command: string,
    timestamp: long,
    salt: long,
    argumentSignatures: createArray(createContainer({ argumentName: string, signature: buffer })),
    messageCount: varInt,
    acknowledged: buffer,
    checksum: byte,
  },
});

export const chatMessagePacket = definePacket({
  id: 0x08,
  fields: {
    message: string,
    timestamp: long,
    salt: long,
    signature: createOptional(buffer),
    offset: varInt,
    acknowledged: buffer,
    checksum: byte,
  },
});

export const systemChatPacket = definePacket({
  id: 0x77,
  fields: {
    content: anonymousNbt,
    isActionBar: boolean,
  },
});

export const playerPositionPacket = definePacket({
  id: 0x1d,
  fields: {
    x: double,
    y: double,
    z: double,
    flags: byte,
  },
});

export const playerPositionLookPacket = definePacket({
  id: 0x1e,
  fields: {
    x: double,
    y: double,
    z: double,
    yaw: float,
    pitch: float,
    flags: byte,
  },
});

export const playerBlockDigPacket = definePacket({
  id: 0x28,
  fields: {
    status: varInt,
    location: position,
    face: byte,
    sequence: varInt,
  },
});

export const playerBlockPlacePacket = definePacket({
  id: 0x3f,
  fields: {
    hand: varInt,
    location: position,
    direction: varInt,
    cursorX: float,
    cursorY: float,
    cursorZ: float,
    insideBlock: boolean,
    worldBorderHit: boolean,
    sequence: varInt,
  },
});

export const playerUseItemPacket = definePacket({
  id: 0x40,
  fields: {
    hand: varInt,
    sequence: varInt,
    rotation: vec2f,
  },
});

export const respawnPacket = definePacket({
  id: 0x50,
  fields: {
    worldState: spawnInfo,
    copyMetadata: byte,
  },
});

export const joinGamePacket = definePacket({
  id: 0x30,
  fields: {
    entityId: int,
    isHardcore: boolean,
    worldNames: createArray(string),
    maxPlayers: varInt,
    viewDistance: varInt,
    simulationDistance: varInt,
    reducedDebugInfo: boolean,
    enableRespawnScreen: boolean,
    doLimitedCrafting: boolean,
    worldState: spawnInfo,
    enforcesSecureChat: boolean,
  },
});

export const tabListHeaderFooterPacket = definePacket({
  id: 0x78,
  fields: {
    header: anonymousNbt,
    footer: anonymousNbt,
  },
});

export const setSlotPacket = definePacket({
  id: 0x14,
  fields: {
    windowId: varInt,
    stateId: varInt,
    slot: short,
    item: slot,
  },
});

export const editBookPacket = definePacket({
  id: 0x17,
  fields: {
    hand: varInt,
    pages: createArray(string),
    title: createOptional(string),
  },
});

export const closeWindowPacket = definePacket({
  id: 0x12,
  fields: {
    windowId: varInt,
  },
});

export const windowClickPacket = definePacket({
  id: 0x11,
  fields: {
    windowId: varInt,
    stateId: varInt,
    slot: short,
    mouseButton: byte,
    mode: varInt,
    changedSlots: createArray(createContainer({ location: short, item: createOptional(restBuffer) })),
    cursorItem: createOptional(restBuffer),
  },
});

export const openBookPacket = definePacket({
  id: 0x38,
  fields: {
    hand: varInt,
  },
});

export const scoreboardObjectivePacket = definePacket({
  id: 0x68,
  fields: {
    name: string,
    action: byte,
    displayText: when('action', [0, 2], anonymousNbt),
    type: when('action', [0, 2], varInt),
    number_format: when('action', [0, 2], createOptional(varInt)),
    styling: when('action', [0, 2], when('number_format', [1, 2], anonymousNbt)),
  },
});

export const scoreboardDisplayObjectivePacket = definePacket({
  id: 0x60,
  fields: {
    position: varInt,
    name: string,
  },
});

export const scoreboardScorePacket = definePacket({
  id: 0x6c,
  fields: {
    itemName: string,
    scoreName: string,
    value: varInt,
    display_name: createOptional(anonymousNbt),
    number_format: createOptional(varInt),
    styling: when('number_format', [1, 2], anonymousNbt),
  },
});

export const resetScorePacket = definePacket({
  id: 0x4d,
  fields: {
    entity_name: string,
    objective_name: createOptional(string),
  },
});

export const useEntityPacket = definePacket({
  id: 0x19,
  fields: {
    target: varInt,
    mouse: varInt,
    x: when('mouse', [2], float),
    y: when('mouse', [2], float),
    z: when('mouse', [2], float),
    hand: when('mouse', [0, 2], varInt),
    sneaking: boolean,
  },
});

export const updateSignPacket = definePacket({
  id: 0x3b,
  fields: {
    location: position,
    isFrontText: boolean,
    text1: string,
    text2: string,
    text3: string,
    text4: string,
  },
});

export const blockChangePacket = definePacket({
  id: 0x08,
  fields: {
    location: position,
    type: varInt,
  },
});

export const gameStateChangePacket = definePacket({
  id: 0x26,
  fields: {
    reason: byte,
    gameMode: float,
  },
});

export const heldItemChangePacket = definePacket({
  id: 0x34,
  fields: {
    slotId: short,
  },
});

export const playerRemovePacket = definePacket({
  id: 0x43,
  fields: {
    players: createArray(uuid),
  },
});

export const openWindowPacket = definePacket({
  id: 0x39,
  fields: {
    windowId: varInt,
    inventoryType: varInt,
    windowTitle: anonymousNbt,
  },
});

export const closeWindowClientPacket = definePacket({
  id: 0x11,
  fields: {
    windowId: varInt,
  },
});

export const windowItemsPacket = definePacket({
  id: 0x12,
  fields: {
    windowId: varInt,
    stateId: varInt,
    items: createArray(slot),
    carriedItem: slot,
  },
});

export const declareCommandsPacket = definePacket({
  id: 0x10,
  fields: {
    nodes: createArray(restBuffer),
    rootIndex: varInt,
  },
});

export const keepAliveClientPacket = definePacket({
  id: 0x2b,
  fields: {
    keepAliveId: long,
  },
});

export const keepAliveServerPacket = definePacket({
  id: 0x1b,
  fields: {
    keepAliveId: long,
  },
});

export const tabCompleteRequestPacket = definePacket({
  id: 0x0e,
  fields: {
    transactionId: varInt,
    text: string,
  },
});

export const tabCompleteResponsePacket = definePacket({
  id: 0x0f,
  fields: {
    transactionId: varInt,
    start: varInt,
    length: varInt,
    matches: createArray(createContainer({ match: string, tooltip: createOptional(anonymousNbt) })),
  },
});

export const acknowledgePlayerDiggingPacket = definePacket({
  id: 0x04,
  fields: {
    sequenceId: varInt,
  },
});

export const forwardRawPacket = definePacket({
  id: -1,
  fields: {
    raw,
  },
});
