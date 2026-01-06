import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { registerCommand, syntax } from '@/feature-api/command';
import { defineFeature } from '@/feature-api/manager';
import p from '@/feature-api/paint';
import OnlinePlayersModule from '@/modules/OnlinePlayersModule';
import PersistenceModule from '@/modules/PersistenceModule';

const { getUsernameFromUuid } = PersistenceModule.api;

const BALANCES_FILE = join(process.cwd(), 'data', 'balances.json');
const CURRENCY_SYMBOL = '$';
const STARTING_BALANCE = 100;

type BalancesData = Record<string, number>;

let balancesCache: BalancesData = {};

function loadBalances(): void {
  try {
    if (existsSync(BALANCES_FILE)) {
      balancesCache = JSON.parse(readFileSync(BALANCES_FILE, 'utf8'));
      console.log(`[Economy] Loaded ${Object.keys(balancesCache).length} player balances`);
    }
  } catch (e) {
    console.error('[Economy] Failed to load balances:', e);
  }
}

function saveBalances(): void {
  try {
    const dir = BALANCES_FILE.substring(0, BALANCES_FILE.lastIndexOf('/'));
    if (!existsSync(dir)) {
      require('node:fs').mkdirSync(dir, { recursive: true });
    }
    writeFileSync(BALANCES_FILE, JSON.stringify(balancesCache, null, 2));
  } catch (e) {
    console.error('[Economy] Failed to save balances:', e);
  }
}

function getBalance(uuid: string): number {
  if (balancesCache[uuid] === undefined) {
    balancesCache[uuid] = STARTING_BALANCE;
    saveBalances();
  }
  return balancesCache[uuid];
}

function setBalance(uuid: string, amount: number): void {
  balancesCache[uuid] = Math.max(0, amount);
  saveBalances();
}

function addBalance(uuid: string, amount: number): void {
  setBalance(uuid, getBalance(uuid) + amount);
}

function removeBalance(uuid: string, amount: number): boolean {
  const current = getBalance(uuid);
  if (current < amount) return false;
  setBalance(uuid, current - amount);
  return true;
}

function formatCurrency(amount: number): string {
  return `${CURRENCY_SYMBOL}${amount.toLocaleString()}`;
}

export default defineFeature({
  name: 'Economy',
  onEnable: () => {
    loadBalances();

    registerCommand(syntax`balance`, ({ sender }) => {
      const balance = getBalance(sender.uuid);
      return p`Your balance: ${p.green(formatCurrency(balance))}`;
    });

    registerCommand(syntax`bal`, ({ sender }) => {
      const balance = getBalance(sender.uuid);
      return p`Your balance: ${p.green(formatCurrency(balance))}`;
    });

    registerCommand(syntax`balance ${syntax.onlinePlayer('target')}`, ({ sender, args }) => {
      const target = args.target;
      const balance = getBalance(target.uuid);
      return p`${p.green(target.username)}'s balance: ${p.green(formatCurrency(balance))}`;
    });

    registerCommand(syntax`pay ${syntax.onlinePlayer('target')} ${syntax.integer('amount')}`, ({ sender, args }) => {
      const target = args.target;
      const amount = Math.floor(args.amount);

      if (amount <= 0) {
        return p.error`Amount must be positive.`;
      }

      if (target.uuid === sender.uuid) {
        return p.error`You cannot pay yourself.`;
      }

      const senderBalance = getBalance(sender.uuid);
      if (senderBalance < amount) {
        return p.error`Insufficient funds. You have ${p.red(formatCurrency(senderBalance))}.`;
      }

      removeBalance(sender.uuid, amount);
      addBalance(target.uuid, amount);

      target.sendMessage(p`${p.green(sender.username)} paid you ${p.green(formatCurrency(amount))}`);
      return p.success`Paid ${p.green(formatCurrency(amount))} to ${p.green(target.username)}`;
    });

    registerCommand(syntax`baltop`, ({ sender }) => {
      const sorted = Object.entries(balancesCache)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10);

      if (sorted.length === 0) {
        return p.gray`No players have balances yet.`;
      }

      const lines = sorted.map(([uuid, balance], index) => {
        const username = getUsernameFromUuid(uuid) || OnlinePlayersModule.api.getOnlinePlayer(uuid)?.username || 'Unknown';
        return p`  ${p.gray(`${index + 1}.`)} ${p.green(username)} - ${p.yellow(formatCurrency(balance))}`;
      });

      return p`${p.yellow('Top Balances:')}\n${lines.map((l) => l.toLegacyString()).join('\n')}`;
    });
  },
});
