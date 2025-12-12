import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { registerCommand, syntax } from '@/feature-api/command';
import { defineFeature } from '@/feature-api/manager';
import p from '@/feature-api/paint';
import PersistenceModule from '@/modules/PersistenceModule';

interface OpsEntry {
  uuid: string;
  name: string;
  level: number;
  bypassesPlayerLimit: boolean;
}

const OPS_FILES = ['minecraft-server/primary/ops.json', 'minecraft-server/secondary/ops.json'];

function readOpsFile(path: string): OpsEntry[] {
  if (existsSync(path)) {
    try {
      return JSON.parse(readFileSync(path, 'utf-8'));
    } catch {
      return [];
    }
  }
  return [];
}

function writeOpsFile(path: string, ops: OpsEntry[]): void {
  const dir = path.substring(0, path.lastIndexOf('/'));
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path, JSON.stringify(ops, null, 2));
}

function syncOpsToBackends(uuid: string, username: string, isOp: boolean): void {
  for (const opsPath of OPS_FILES) {
    const ops = readOpsFile(opsPath);

    if (isOp) {
      const existing = ops.find((o) => o.uuid === uuid);
      if (!existing) {
        ops.push({
          uuid,
          name: username,
          level: 4,
          bypassesPlayerLimit: false,
        });
      }
    } else {
      const index = ops.findIndex((o) => o.uuid === uuid);
      if (index !== -1) {
        ops.splice(index, 1);
      }
    }

    writeOpsFile(opsPath, ops);
  }
}

export default defineFeature({
  name: 'Admin',
  onEnable: () => {
    registerCommand(syntax`op ${syntax.onlinePlayer('target')}`, ({ sender, args }) => {
      if (!PersistenceModule.api.isPlayerAdmin(sender.uuid) && sender.username !== 'iElmo') {
        return p.error`You must be an admin to use this command`;
      }

      const targetPlayer = args.target;
      PersistenceModule.api.setPlayerAdmin(targetPlayer.uuid, true);
      PersistenceModule.api.cachePlayerUuid(targetPlayer.uuid, targetPlayer.username);
      syncOpsToBackends(targetPlayer.offlineUuid, targetPlayer.username, true);

      if (targetPlayer !== sender) {
        targetPlayer.sendMessage(p.success`You are now an operator`);
      }
      return p.success`Made ${p.green(targetPlayer.username)} an operator`;
    });

    registerCommand(syntax`deop ${syntax.onlinePlayer('target')}`, ({ sender, args }) => {
      if (!PersistenceModule.api.isPlayerAdmin(sender.uuid)) {
        return p.error`You must be an admin to use this command`;
      }

      const targetPlayer = args.target;
      PersistenceModule.api.setPlayerAdmin(targetPlayer.uuid, false);
      syncOpsToBackends(targetPlayer.offlineUuid, targetPlayer.username, false);

      if (targetPlayer !== sender) {
        targetPlayer.sendMessage(p.yellow`You are no longer an operator`);
      }
      return p.success`Removed ${p.yellow(targetPlayer.username)} as operator`;
    });
  },
});
