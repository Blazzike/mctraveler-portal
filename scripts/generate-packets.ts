#!/usr/bin/env bun

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type PacketDefinition = {
  state: string;
  direction: 'toClient' | 'toServer';
  name: string;
  exportName: string;
};

type ProtocolData = {
  [state: string]: {
    toClient?: {
      types: {
        packet?: [string, any[]];
        [key: string]: any;
      };
    };
    toServer?: {
      types: {
        packet?: [string, any[]];
        [key: string]: any;
      };
    };
  };
};

const TYPE_MAPPING: Record<string, string> = {
  varint: 'varInt',
  string: 'string',
  bool: 'boolean',
  UUID: 'uuid',
  u8: 'byte',
  u16: 'unsignedShort',
  i8: 'byte',
  i16: 'short',
  i32: 'int',
  i64: 'long',
  f32: 'float',
  f64: 'double',
  position: 'position',
  vec2f: 'vec2f',
  vec3f: 'vec3f',
  vec3f64: 'vec3f64',
  anonymousNbt: 'anonymousNbt',
  anonOptionalNbt: 'optionalNbt',
  restBuffer: 'restBuffer',
  Slot: 'slot',
  SpawnInfo: 'spawnInfo',
  ContainerID: 'varInt',
  game_profile: 'restBuffer',
  player_chat_message: 'restBuffer',
  signature: 'restBuffer',
  MovementFlags: 'byte',
  HashedSlot: 'restBuffer',
  Slot_NBT: 'slot',
  command_node: 'restBuffer',
};

function mapType(type: any, fieldName: string, packetName: string): string {
  if (typeof type === 'string') {
    const mapped = TYPE_MAPPING[type];
    if (!mapped) {
      throw new Error(`Unknown type '${type}' for field '${fieldName}' in packet '${packetName}'`);
    }
    return mapped;
  }

  if (Array.isArray(type)) {
    const [baseType, config] = type;

    if (baseType === 'buffer') {
      return 'buffer';
    }

    if (baseType === 'option') {
      const innerType = mapType(config, fieldName, packetName);
      return `createOptional(${innerType})`;
    }

    if (baseType === 'array') {
      if (config.countType === 'varint') {
        const itemType = mapType(config.type, fieldName, packetName);
        return `createArray(${itemType})`;
      }
      throw new Error(`Unsupported array countType '${config.countType}' for field '${fieldName}' in packet '${packetName}'`);
    }

    if (baseType === 'container') {
      const containerFields = config as Array<{ name: string; type: any }>;
      const fieldMappings = containerFields.map((f) => `${f.name}: ${mapType(f.type, f.name, packetName)}`).join(', ');
      return `createContainer({ ${fieldMappings} })`;
    }

    if (baseType === 'switch') {
      const switchConfig = config as { compareTo: string; fields: Record<string, any>; default?: any };
      if (switchConfig.compareTo && switchConfig.fields) {
        const cases = Object.entries(switchConfig.fields);
        const firstCase = cases[0];
        if (firstCase) {
          const innerType = mapType(firstCase[1], fieldName, packetName);
          const values = cases
            .map(([k]) => {
              const num = Number(k);
              return Number.isNaN(num) ? JSON.stringify(k) : num;
            })
            .join(', ');
          return `when('${switchConfig.compareTo}', [${values}], ${innerType})`;
        }
      }
      return 'restBuffer';
    }

    if (baseType === 'bitfield' || baseType === 'bitflags') {
      return 'byte';
    }

    if (baseType === 'mapper') {
      // Mapper wraps an underlying type - extract and use that
      const mapperConfig = config as { type: string; mappings: Record<string, string> };
      return mapType(mapperConfig.type, fieldName, packetName);
    }

    throw new Error(`Unsupported complex type '${baseType}' for field '${fieldName}' in packet '${packetName}'`);
  }

  throw new Error(`Unknown type format for field '${fieldName}' in packet '${packetName}': ${JSON.stringify(type)}`);
}

function findPacketId(state: string, direction: 'toClient' | 'toServer', packetName: string, protocol: ProtocolData): string | null {
  const stateData = protocol[state]?.[direction];
  if (!stateData) return null;

  const packetContainer = stateData.types.packet;
  if (!packetContainer || !Array.isArray(packetContainer)) return null;

  const [, fields] = packetContainer;
  if (!Array.isArray(fields)) return null;

  const nameField = fields.find((f: any) => f.name === 'name');
  if (!nameField || !Array.isArray(nameField.type)) return null;

  const [, mapperConfig] = nameField.type;
  const mappings = mapperConfig?.mappings;

  if (!mappings) return null;

  for (const [id, name] of Object.entries(mappings)) {
    if (name === packetName) {
      return id;
    }
  }

  return null;
}

function getPacketFields(state: string, direction: 'toClient' | 'toServer', packetName: string, protocol: ProtocolData): Record<string, string> {
  const stateData = protocol[state]?.[direction];
  if (!stateData) return {};

  const packetTypeName = `packet_${packetName}`;
  const packetType = stateData.types[packetTypeName];

  if (!packetType || !Array.isArray(packetType)) return {};

  const [containerType, fields] = packetType;
  if (containerType !== 'container' || !Array.isArray(fields)) return {};

  const result: Record<string, string> = {};

  for (const field of fields) {
    if (field.name && field.type) {
      result[field.name] = mapType(field.type, field.name, packetName);
    }
  }

  return result;
}

function generatePacketCode(packet: PacketDefinition, protocol: ProtocolData): string {
  const packetId = findPacketId(packet.state, packet.direction, packet.name, protocol);
  if (!packetId) {
    console.warn(`Warning: Could not find packet ID for ${packet.state}/${packet.direction}/${packet.name}`);
    return '';
  }

  const fields = getPacketFields(packet.state, packet.direction, packet.name, protocol);

  const fieldEntries = Object.entries(fields);

  const fieldsCode = fieldEntries.length > 0 ? `{\n    ${fieldEntries.map(([name, type]) => `${name}: ${type},`).join('\n    ')}\n  }` : '{}';

  return `export const ${packet.exportName} = definePacket({
  id: ${packetId},
  fields: ${fieldsCode},
});`;
}

async function main() {
  const projectRoot = join(import.meta.dir, '..');
  const definedPacketsPath = join(projectRoot, 'defined-packets.json');
  const outputPath = join(projectRoot, 'defined-packets.gen.ts');
  const protocolPath = join(projectRoot, 'docs', 'protocol.json');

  console.log('Loading protocol.json from docs/protocol.json...');
  const protocol: ProtocolData = JSON.parse(readFileSync(protocolPath, 'utf-8'));

  console.log('Loading defined-packets.json...');
  const packets: PacketDefinition[] = JSON.parse(readFileSync(definedPacketsPath, 'utf-8'));

  console.log(`Generating TypeScript for ${packets.length} packets...`);

  const imports = new Set<string>();
  const packetCodes: string[] = [];

  function extractImports(typeStr: string): string[] {
    const result: string[] = [];
    if (typeStr.startsWith('createOptional(') || typeStr.startsWith('createArray(')) {
      const match = typeStr.match(/^(createOptional|createArray)\((.+)\)$/);
      if (match?.[1] && match[2]) {
        result.push(match[1]);
        result.push(...extractImports(match[2]));
      }
    } else if (typeStr.startsWith('createContainer(')) {
      result.push('createContainer');
      const innerMatch = typeStr.match(/createContainer\(\{ (.+) \}\)$/);
      if (innerMatch?.[1]) {
        const fieldPairs = innerMatch[1].split(', ');
        for (const pair of fieldPairs) {
          const colonIdx = pair.indexOf(': ');
          if (colonIdx > 0) {
            const fieldType = pair.substring(colonIdx + 2);
            result.push(...extractImports(fieldType));
          }
        }
      }
    } else if (typeStr.startsWith('when(')) {
      result.push('when');
      const innerMatch = typeStr.match(/when\('[^']+', \[[^\]]+\], (.+)\)$/);
      if (innerMatch?.[1]) {
        result.push(...extractImports(innerMatch[1]));
      }
    } else {
      result.push(typeStr);
    }
    return result;
  }

  for (const packet of packets) {
    const code = generatePacketCode(packet, protocol);
    if (code) {
      packetCodes.push(code);

      const fields = getPacketFields(packet.state, packet.direction, packet.name, protocol);
      for (const type of Object.values(fields)) {
        for (const imp of extractImports(type)) {
          imports.add(imp);
        }
      }
    }
  }

  imports.add('raw');

  const importsList = Array.from(imports).sort();
  const importsCode = `import { ${importsList.join(', ')} } from '@/encoding/data-buffer';`;

  const output = `${importsCode}
import { definePacket } from '@/network/defined-packet';

${packetCodes.join('\n\n')}

export const forwardRawPacket = definePacket({
  id: -1,
  fields: {
    raw,
  },
});
`;

  console.log(`Writing to ${outputPath}...`);
  writeFileSync(outputPath, output, 'utf-8');

  console.log('✅ Successfully generated defined-packets.ts');
}

main().catch((error) => {
  console.error('Error generating packets:', error);
  process.exit(1);
});
