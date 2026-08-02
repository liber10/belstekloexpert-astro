import { buildRuntime } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const runtime = await buildRuntime(config, { startWorker: false });

await runtime.app.listen({ host: config.host, port: config.port });

try {
  if (runtime.telegram && config.publicUrl && config.telegram.webhookSecret) {
    const webhookUrl = new URL('/api/v1/webhooks/telegram', config.publicUrl).toString();
    await runtime.telegram.registerWebhook(webhookUrl, config.telegram.webhookSecret);
    runtime.app.log.info({ webhookUrl }, 'Telegram webhook registered.');
  }
  runtime.outbox?.start();
  runtime.inbox?.start();
} catch {
  runtime.app.log.error('Telegram startup failed.');
  await runtime.app.close();
  throw new Error('Telegram startup failed.');
}

runtime.app.log.info(
  { host: config.host, port: config.port, telegramEnabled: config.telegram.enabled },
  'Lead Hub started.',
);

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  runtime.app.log.info({ signal }, 'Lead Hub is shutting down.');
  await runtime.app.close();
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
