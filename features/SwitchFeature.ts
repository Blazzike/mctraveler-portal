import { kPrimaryPort, kSecondaryPort } from '@/config';
import { registerCommand, syntax } from '@/feature-api/command';
import { defineFeature } from '@/feature-api/manager';
import p from '@/feature-api/paint';

export default defineFeature({
  name: 'SwitchFeature',
  onEnable: () => {
    registerCommand(syntax`switch`, async ({ sender }) => {
      const currentPort = sender.currentServerPort || kPrimaryPort;
      const newPort = currentPort === kPrimaryPort ? kSecondaryPort : kPrimaryPort;

      const serverName = newPort === kPrimaryPort ? 'Primary' : 'Secondary';

      try {
        sender.sendMessage(p.gray`Switching to ${p.green(serverName)}...`);
        await sender.switchServer(newPort);
      } catch (error) {
        sender.sendMessage(p.error`Failed to switch server: ${error}`);
      }
    });
  },
});
