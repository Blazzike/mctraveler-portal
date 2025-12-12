import { registerCommand, syntax } from '@/feature-api/command';
import { defineFeature, FeatureHook, registerHook } from '@/feature-api/manager';
import p from '@/feature-api/paint';
import MessageModule from '@/modules/MessageModule';
import OnlinePlayersModule, { type OnlinePlayer } from '@/modules/OnlinePlayersModule';

const lastInteractions = new WeakMap<OnlinePlayer, number>();
const awayPlayers = new Map<OnlinePlayer, boolean>();
const lastAway = new Map<OnlinePlayer, number>();

const kAwayTimeout = 5 * 60 * 1000;
const kAwayCommandCooldown = 3 * 1000;
const kAwayCheckInterval = 5000;

function recordInteraction(player: OnlinePlayer): void {
  lastInteractions.set(player, Date.now());
  if (awayPlayers.get(player) === true) {
    setAway(player, false);
  }
}

function setAway(player: OnlinePlayer, away: boolean): void {
  const message = away ? p.gray`${p.green(player.username)} is now away` : p.gray`${p.green(player.username)} is no longer away`;

  awayPlayers.set(player, away);

  if (!away) {
    lastAway.set(player, Date.now());
  }

  MessageModule.api.broadcast(message);
}

function checkAwayStatus(): void {
  const now = Date.now();
  const onlinePlayers = OnlinePlayersModule.api.getOnlinePlayers();

  for (const player of onlinePlayers) {
    if (awayPlayers.get(player) === true) {
      continue;
    }

    if (!lastInteractions.has(player)) {
      lastInteractions.set(player, now);
      continue;
    }

    const lastInteraction = lastInteractions.get(player)!;
    if (now - lastInteraction > kAwayTimeout) {
      setAway(player, true);
    }
  }
}

export default defineFeature({
  name: 'AwayProvider',
  onEnable: () => {
    registerHook(FeatureHook.PlayerJoin, (e) => recordInteraction(e.player));
    registerHook(FeatureHook.PlayerChat, (e) => recordInteraction(e.player));
    registerHook(FeatureHook.PlayerCommand, (e) => recordInteraction(e.player));
    registerHook(FeatureHook.PlayerBlockBreak, (e) => recordInteraction(e.player));
    registerHook(FeatureHook.PlayerBlockPlace, (e) => recordInteraction(e.player));
    registerHook(FeatureHook.PlayerUseItem, (e) => recordInteraction(e.player));
    registerHook(FeatureHook.PlayerMove, (e) => recordInteraction(e.player));
    registerHook(FeatureHook.PlayerLeave, (e) => {
      awayPlayers.delete(e.player);
      lastAway.delete(e.player);
    });

    registerCommand(syntax`away`, ({ sender }) => {
      const lastUsage = lastAway.get(sender);
      if (lastUsage) {
        const cooldownRemaining = lastUsage + kAwayCommandCooldown - Date.now();
        if (cooldownRemaining > 0) {
          const cooldownSeconds = Math.round(cooldownRemaining / 100) / 10;
          if (cooldownSeconds !== 3.0) {
            return p.error`You cannot use /away again for another ${p.red(cooldownSeconds)} seconds yet`;
          }

          return;
        }
      }

      lastAway.set(sender, Date.now());
      setAway(sender, true);
    });

    setInterval(checkAwayStatus, kAwayCheckInterval);
  },
});
