import { declareCommandsPacket } from '@/defined-packets.gen';
import { string as stringHandler, varInt as varIntHandler } from '@/encoding/data-buffer';
import { getRegisteredCommands, getSuggestionsForCommand } from '@/feature-api/command';
import { defineModule } from '@/module-api/module';
import OnlinePlayersModule from '@/modules/OnlinePlayersModule';
import { onClientToServerPacket, onServerToClientTransform } from '@/network/packet-handlers';
import { getParserPropertySize } from '@/network/packet-parser-properties';

interface CommandNode {
  flags: number;
  children: number[];
  redirectNode?: number;
  name?: string;
  parserID?: number;
  properties?: Buffer;
  suggestionsType?: string;
}

const PARSER_IDS = {
  BOOL: 0,
  FLOAT: 1,
  DOUBLE: 2,
  INTEGER: 3,
  LONG: 4,
  STRING: 5,
  ENTITY: 6,
};

const STRING_TYPES = {
  SINGLE_WORD: 0,
  QUOTABLE_PHRASE: 1,
  GREEDY_PHRASE: 2,
};

function buildCommandTrees(pattern: string): CommandNode[][] {
  const parts = pattern.split(' ');

  const commandName = parts[0];
  if (!commandName) return [];

  let commandNames: string[] = [];
  if (commandName.includes('|')) {
    const match = commandName.match(/<[^:]+:([^>]+)>/);
    if (match?.[1]) {
      commandNames = match[1].split('|');
    }
  } else {
    commandNames = [commandName];
  }

  const trees: CommandNode[][] = [];

  for (const cmdName of commandNames) {
    const tree = buildSingleCommandTree(cmdName, parts.slice(1));
    if (tree.length > 0) {
      trees.push(tree);
    }
  }

  return trees;
}

function buildSingleCommandTree(commandName: string, argParts: string[]): CommandNode[] {
  const nodes: CommandNode[] = [];

  let currentNodeIndex = 0;
  nodes.push({
    flags: 0x01,
    children: [],
    name: commandName,
  });

  for (let i = 0; i < argParts.length; i++) {
    const part = argParts[i];
    if (!part) continue;

    const argMatch = part.match(/<([^:]+):([^>]+)>/);

    let newNode: CommandNode | null = null;

    if (argMatch) {
      const argName = argMatch[1];
      const argType = argMatch[2];
      if (argName && argType) {
        newNode = createArgumentNode(argName, argType);
      }
    } else {
      newNode = {
        flags: 0x01,
        children: [],
        name: part,
      };
    }

    if (newNode) {
      const newNodeIndex = nodes.length;
      nodes.push(newNode);

      const currentNode = nodes[currentNodeIndex];
      if (currentNode) {
        currentNode.children.push(newNodeIndex);
      }

      currentNodeIndex = newNodeIndex;
    }
  }

  if (nodes.length > 0) {
    const lastNode = nodes[currentNodeIndex];
    if (lastNode) {
      lastNode.flags |= 0x04;
    }
  }

  return nodes;
}

function createArgumentNode(name: string, type: string): CommandNode | null {
  if (type === 'player' || type.includes('player') || name.toLowerCase() === 'player') {
    return {
      flags: 0x02 | 0x10,
      children: [],
      name,
      parserID: PARSER_IDS.STRING,
      properties: Buffer.from([0x00]),
      suggestionsType: 'minecraft:ask_server',
    };
  }

  if (type === 'integer') {
    return {
      flags: 0x02,
      children: [],
      name,
      parserID: PARSER_IDS.INTEGER,
      properties: Buffer.from([0x00]),
    };
  }

  if (type.includes('string')) {
    let stringType = STRING_TYPES.SINGLE_WORD;

    if (type.includes('...')) {
      stringType = STRING_TYPES.GREEDY_PHRASE;
    } else if (type.includes('quotable')) {
      stringType = STRING_TYPES.QUOTABLE_PHRASE;
    }

    return {
      flags: 0x02,
      children: [],
      name,
      parserID: PARSER_IDS.STRING,
      properties: varIntHandler(stringType),
    };
  }

  console.warn(`[CommandTree] Unknown argument type: ${type}`);
  return null;
}

function decodeCommandPacket(data: Buffer): {
  nodes: CommandNode[];
  rootIndex: number;
} {
  let offset = 0;
  const nodes: CommandNode[] = [];

  let nodeCount = 0;
  let shift = 0;
  let b: number;
  do {
    b = data[offset++] || 0;
    nodeCount |= (b & 0x7f) << shift;
    shift += 7;
  } while ((b & 0x80) !== 0);

  for (let i = 0; i < nodeCount; i++) {
    const node: CommandNode = { flags: 0, children: [] };

    node.flags = data[offset++] || 0;
    const nodeType = node.flags & 0x03;
    const hasRedirect = (node.flags & 0x08) !== 0;
    const hasSuggestions = (node.flags & 0x10) !== 0;

    let childCount = 0;
    shift = 0;
    do {
      b = data[offset++] || 0;
      childCount |= (b & 0x7f) << shift;
      shift += 7;
    } while ((b & 0x80) !== 0);

    for (let j = 0; j < childCount; j++) {
      let childIdx = 0;
      shift = 0;
      do {
        b = data[offset++] || 0;
        childIdx |= (b & 0x7f) << shift;
        shift += 7;
      } while ((b & 0x80) !== 0);
      node.children.push(childIdx);
    }

    if (hasRedirect) {
      let redirectIdx = 0;
      shift = 0;
      do {
        b = data[offset++] || 0;
        redirectIdx |= (b & 0x7f) << shift;
        shift += 7;
      } while ((b & 0x80) !== 0);
      node.redirectNode = redirectIdx;
    }

    if (nodeType === 1 || nodeType === 2) {
      let nameLen = 0;
      shift = 0;
      do {
        b = data[offset++] || 0;
        nameLen |= (b & 0x7f) << shift;
        shift += 7;
      } while ((b & 0x80) !== 0);

      node.name = data.toString('utf8', offset, offset + nameLen);
      offset += nameLen;

      if (nodeType === 2) {
        let parserID = 0;
        shift = 0;
        do {
          b = data[offset++] || 0;
          parserID |= (b & 0x7f) << shift;
          shift += 7;
        } while ((b & 0x80) !== 0);
        node.parserID = parserID;

        const propSize = getParserPropertySize(parserID, data, offset);
        if (propSize > 0) {
          node.properties = data.slice(offset, offset + propSize);
          offset += propSize;
        }
      }
    }

    if (hasSuggestions) {
      let sugLen = 0;
      shift = 0;
      do {
        b = data[offset++] || 0;
        sugLen |= (b & 0x7f) << shift;
        shift += 7;
      } while ((b & 0x80) !== 0);

      node.suggestionsType = data.toString('utf8', offset, offset + sugLen);
      offset += sugLen;
    }

    nodes.push(node);
  }

  let rootIndex = 0;
  shift = 0;
  do {
    b = data[offset++] || 0;
    rootIndex |= (b & 0x7f) << shift;
    shift += 7;
  } while ((b & 0x80) !== 0);

  return { nodes, rootIndex };
}

function addCustomCommands(nodes: CommandNode[], rootIndex: number): void {
  const registeredCommands = getRegisteredCommands();

  const rootNode = nodes[rootIndex];
  if (!rootNode) return;

  const customCommandNames = new Set<string>();
  for (const cmd of registeredCommands) {
    const pattern = cmd.pattern.toString();
    const firstPart = pattern.split(' ')[0];
    if (firstPart) {
      if (firstPart.includes('|')) {
        const match = firstPart.match(/<[^:]+:([^>]+)>/);
        if (match?.[1]) {
          for (const name of match[1].split('|')) {
            customCommandNames.add(name);
          }
        }
      } else {
        customCommandNames.add(firstPart);
      }
    }
  }

  const vanillaAliases: Record<string, string[]> = {
    msg: ['tell', 'w'],
  };

  for (const [command, aliases] of Object.entries(vanillaAliases)) {
    if (customCommandNames.has(command)) {
      for (const alias of aliases) {
        customCommandNames.add(alias);
      }
    }
  }

  rootNode.children = rootNode.children.filter((childIdx) => {
    const childNode = nodes[childIdx];
    return !(childNode?.name && customCommandNames.has(childNode.name));
  });

  for (const cmd of registeredCommands) {
    const pattern = cmd.pattern.toString();
    const commandTrees = buildCommandTrees(pattern);

    for (const commandTree of commandTrees) {
      if (commandTree.length > 0) {
        const treeStartIdx = nodes.length;

        for (const node of commandTree) {
          const adjustedNode = {
            ...node,
            children: node.children.map((childIdx: number) => childIdx + treeStartIdx),
          };
          nodes.push(adjustedNode);
        }

        rootNode.children.push(treeStartIdx);
      }
    }
  }
}

function findReachableNodes(nodes: CommandNode[], rootIndex: number): Set<number> {
  const reachable = new Set<number>();
  const queue: number[] = [rootIndex];

  while (queue.length > 0) {
    const nodeIdx = queue.shift();
    if (nodeIdx === undefined || reachable.has(nodeIdx)) continue;

    reachable.add(nodeIdx);

    const node = nodes[nodeIdx];
    if (node) {
      queue.push(...node.children);

      if (node.redirectNode !== undefined) {
        queue.push(node.redirectNode);
      }
    }
  }

  return reachable;
}

function removeOrphanedNodes(nodes: CommandNode[], rootIndex: number): { nodes: CommandNode[]; rootIndex: number } {
  const reachable = findReachableNodes(nodes, rootIndex);

  const indexMap = new Map<number, number>();
  let newIndex = 0;

  for (let oldIndex = 0; oldIndex < nodes.length; oldIndex++) {
    if (reachable.has(oldIndex)) {
      indexMap.set(oldIndex, newIndex);
      newIndex++;
    }
  }

  const newNodes: CommandNode[] = [];

  for (let oldIndex = 0; oldIndex < nodes.length; oldIndex++) {
    if (reachable.has(oldIndex)) {
      const node = nodes[oldIndex];
      if (node) {
        const newNode = {
          ...node,
          children: node.children.map((childIdx) => indexMap.get(childIdx) ?? childIdx).filter((idx) => idx !== undefined),
          redirectNode: node.redirectNode !== undefined ? indexMap.get(node.redirectNode) : undefined,
        };
        newNodes.push(newNode);
      }
    }
  }

  const newRootIndex = indexMap.get(rootIndex) ?? 0;

  return { nodes: newNodes, rootIndex: newRootIndex };
}

function encodeCommandPacket(nodes: CommandNode[], rootIndex: number): Buffer {
  const parts: Buffer[] = [];

  parts.push(varIntHandler(nodes.length));

  for (const node of nodes) {
    parts.push(Buffer.from([node.flags]));

    parts.push(varIntHandler(node.children.length));
    for (const child of node.children) {
      parts.push(varIntHandler(child));
    }

    if (node.redirectNode !== undefined) {
      parts.push(varIntHandler(node.redirectNode));
    }

    const nodeType = node.flags & 0x03;
    if ((nodeType === 1 || nodeType === 2) && node.name) {
      parts.push(stringHandler(node.name));

      if (nodeType === 2) {
        if (node.parserID !== undefined) {
          parts.push(varIntHandler(node.parserID));
        }
        if (node.properties) {
          parts.push(node.properties);
        }
      }
    }

    if (node.suggestionsType) {
      parts.push(stringHandler(node.suggestionsType));
    }
  }

  parts.push(varIntHandler(rootIndex));

  return Buffer.concat(parts);
}

function mergeCommandsData(serverPacketData: Buffer): Buffer {
  const { nodes, rootIndex } = decodeCommandPacket(serverPacketData);
  addCustomCommands(nodes, rootIndex);
  const cleaned = removeOrphanedNodes(nodes, rootIndex);
  return encodeCommandPacket(cleaned.nodes, cleaned.rootIndex);
}

function mergeCommandsFull(serverPacketData: Buffer): Buffer {
  try {
    const mergedData = mergeCommandsData(serverPacketData);

    const packetId = Buffer.from([0x10]);
    const packetLength = varIntHandler(packetId.length + mergedData.length);
    const finalPacket = Buffer.concat([packetLength, packetId, mergedData]);

    return finalPacket;
  } catch (error) {
    console.error('[Merge] Error:', error);
    throw error;
  }
}

function handleTabCompleteRequest(packetData: Buffer, player?: any): Buffer | null {
  try {
    let offset = 0;

    let transactionId = 0;
    let shift = 0;
    let b: number;
    do {
      b = packetData[offset++] || 0;
      transactionId |= (b & 0x7f) << shift;
      shift += 7;
    } while ((b & 0x80) !== 0);

    let textLen = 0;
    shift = 0;
    do {
      b = packetData[offset++] || 0;
      textLen |= (b & 0x7f) << shift;
      shift += 7;
    } while ((b & 0x80) !== 0);

    const text = packetData.toString('utf8', offset, offset + textLen);

    const parts = text.split(' ');
    const command = parts[0]?.replace('/', '');

    const ourCommands = ['msg', 'tell', 'w', 'rg', 'region', 'op', 'deop'];
    if (!command || !ourCommands.includes(command)) {
      return null;
    }

    const partialName = parts[parts.length - 1]?.toLowerCase() || '';

    const customSuggestions = player ? getSuggestionsForCommand(text, player) : null;
    let matches: string[] = customSuggestions || [];

    if (matches.length === 0) {
      const players = OnlinePlayersModule.api.getOnlinePlayers();
      matches = players.filter((p) => p.username.toLowerCase().startsWith(partialName)).map((p) => p.username);
    }

    const responseParts: Buffer[] = [];

    responseParts.push(varIntHandler(transactionId));

    const startPos = text.lastIndexOf(' ') + 1;
    responseParts.push(varIntHandler(startPos));

    responseParts.push(varIntHandler(partialName.length));

    responseParts.push(varIntHandler(matches.length));

    for (const match of matches) {
      responseParts.push(stringHandler(match));
      responseParts.push(Buffer.from([0x00]));
    }

    const responseData = Buffer.concat(responseParts);
    const packetId = varIntHandler(0x0f);
    const fullPacket = Buffer.concat([varIntHandler(packetId.length + responseData.length), packetId, responseData]);

    return fullPacket;
  } catch (error) {
    console.error('[TabComplete] Error:', error);
    return null;
  }
}

export default defineModule({
  name: 'CommandsInjection',
  api: {
    buildCommandTrees,
    mergeCommandsFull,
    handleTabCompleteRequest,
  },
  onEnable: () => {
    onServerToClientTransform(declareCommandsPacket.id, (_player, _packetId, packetData) => {
      try {
        return mergeCommandsData(packetData);
      } catch (error) {
        console.error('[Commands] Merge failed:', error);
        return packetData;
      }
    });

    onClientToServerPacket((player, packetId, packetData) => {
      if (packetId === 0x0e) {
        const response = handleTabCompleteRequest(packetData, player);
        if (response) {
          player.clientSocket.write(response);
          return true;
        }
      }
      return false;
    });
  },
});
