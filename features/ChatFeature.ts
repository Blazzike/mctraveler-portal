import { registerCommand, syntax } from '@/feature-api/command';
import { defineFeature, FeatureHook, registerHook } from '@/feature-api/manager';
import p from '@/feature-api/paint';
import type { OnlinePlayer } from '@/modules/OnlinePlayersModule';

const replyMap = new WeakMap<OnlinePlayer, OnlinePlayer>();

export default defineFeature({
  name: 'ChatProvider',
  onEnable: () => {
    registerHook(FeatureHook.PlayerChat, (e) => p`${p.green(e.player.name)} ${e.message}`);
    registerHook(FeatureHook.PlayerJoinedMessage, ({ username }) => p.gray`${p.darkGray`[${p.green('+')}]`} ${p.green(username)} joined`);
    registerHook(FeatureHook.PlayerLeftMessage, ({ username }) => p.gray`${p.darkGray`[${p.red('-')}]`} ${p.red(username)} left.`);
    registerCommand(syntax`shrug`, ({ sender }) => sender.chat('¯\\_(ツ)_/¯'));
    registerCommand(syntax`tableflip`, ({ sender }) => sender.chat('(╯°□°）╯︵ ┻━┻'));

    registerCommand(syntax`msg ${syntax.onlinePlayer('target')} ${syntax.string.rest('message')}`, ({ sender, args: { target, message } }) => {
      if (target.id === sender.id) {
        return p.error`You can't send a message to yourself`;
      }

      replyMap.set(target, sender);
      replyMap.set(sender, target);

      const privateMessage = p`${p.green(sender.name)} ${p.gray('→')} ${p.green(target.name)}: ${message}`;
      target.sendMessage(privateMessage);

      return privateMessage;
    });

    registerCommand(syntax`${syntax.oneOf('reply', ['reply', 'r'] as const)} ${syntax.string.rest('message')}`, ({ sender, args: { message } }) => {
      const target = replyMap.get(sender);
      if (!target) {
        return p.error`You have no-one to reply to`;
      }

      if (!target.isOnline) {
        return p.error`The player you were messaging is no longer online`;
      }

      const privateMessage = p`${p.green(sender.name)} ${p.gray('→')} ${p.green(target.name)}: ${message}`;
      target.sendMessage(privateMessage);

      return privateMessage;
    });
  },
});
