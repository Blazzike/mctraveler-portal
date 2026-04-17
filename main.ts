import { kPort, kPrimaryPort } from '@/config';
import { executeHook, FeatureHook, init as initFeatureManager } from '@/feature-api/manager';
import { log } from '@/logging';
import { createProxy, getOnlinePlayers } from '@/network/proxy';

await initFeatureManager();

const server = createProxy({
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
            ?.map((p: any) => p.toLegacyString())
            .join('\n') ?? 'MCTraveler Portal',
      },
      favicon: 'data:image/png;base64,<data>',
      enforcesSecureChat: true,
    };
  },
});

log.for('Proxy').info('Proxy started on port %d', kPort);

// Graceful shutdown
let isShuttingDown = false;

async function shutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  log.for('Proxy').info('Received %s, shutting down gracefully...', signal);

  // Stop accepting new connections
  server.close(() => {
    log.for('Proxy').info('Server closed');
    process.exit(0);
  });

  // Force exit after 10 seconds if connections don't close
  setTimeout(() => {
    log.for('Proxy').warn('Forcing shutdown after timeout');
    process.exit(1);
  }, 10_000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('uncaughtException', (error) => {
  log.for('Proxy').error('Uncaught exception: %s', error);
  shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  log.for('Proxy').error('Unhandled rejection: %s', reason);
});
