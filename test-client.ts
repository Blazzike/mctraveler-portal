import mineflayer from 'mineflayer';

const bot = mineflayer.createBot({
  host: 'localhost',
  port: 25565,
  username: 'TestPlayer',
  version: '1.21.8',
});

bot.once('spawn', () => {
  console.log('[Test Client] Connected and spawned!');
  console.log('[Test Client] Waiting 3 seconds before disconnect...');

  setTimeout(() => {
    console.log('[Test Client] Disconnecting...');
    bot.quit();
  }, 3000);
});

bot.on('message', (message: any) => {
  console.log('[Chat]', message.toString());
});

bot.on('error', (err: any) => {
  console.error('[Test Client] Error:', err);
});

bot.on('end', () => {
  console.log('[Test Client] Disconnected');
  process.exit(0);
});

bot.on('kicked', (reason: any) => {
  console.log('[Test Client] Kicked:', reason);
  process.exit(1);
});
