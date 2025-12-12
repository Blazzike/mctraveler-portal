import { kPort, kPrimaryPort } from '@/config';
import { executeHook, FeatureHook, init as initFeatureManager } from '@/feature-api/manager';
import { createProxy, getOnlinePlayers } from '@/network/proxy';

await initFeatureManager();

createProxy({
  target: kPrimaryPort,
  port: kPort,
  onStatusRequest: () => {
    const players = getOnlinePlayers();

    return {
      players: {
        max: 20,
        online: players.length,
        sample: players.slice(0, 12).map((player) => ({
          name: player.username,
          id: player.uuid,
        })),
      },
      description: {
        text:
          executeHook(FeatureHook.MotdRequest)[0]
            ?.map((p) => p.toLegacyString())
            .join('\n') ?? 'MCTraveler Portal',
      },
      favicon: 'data:image/png;base64,<data>',
      enforcesSecureChat: true,
    };
  },
});

console.log(`Proxy started on port ${kPort}`);
