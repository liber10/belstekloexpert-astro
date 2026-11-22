import { buildRuntime } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
let corporateWebhookReady = false;
const runtime = await buildRuntime(config, { startWorker: false, corporateWebhookReady: () => corporateWebhookReady });

await runtime.app.listen({ host: config.host, port: config.port });

runtime.outbox?.start();
runtime.inbox?.start();
runtime.publicInbox?.start();
runtime.corporateInbox?.start();
runtime.instagramOutbox?.start();

let closing = false;
if (runtime.telegram && config.publicUrl && config.telegram.webhookSecret) {
  const telegram = runtime.telegram;
  const webhookUrl = new URL('/api/v1/webhooks/telegram', config.publicUrl).toString();
  const secret = config.telegram.webhookSecret;
  registerWebhook('Corporate', () => telegram.registerWebhook(webhookUrl, secret), () => {
    corporateWebhookReady = true;
  });
}

if (runtime.telegramPublic && config.publicUrl && config.telegramPublic.webhookSecret) {
  const telegram = runtime.telegramPublic;
  const webhookUrl = new URL('/api/v1/webhooks/telegram-public', config.publicUrl).toString();
  const secret = config.telegramPublic.webhookSecret;
  registerWebhook('Public', () => telegram.registerWebhook(webhookUrl, secret, config.telegramPublic.botUsername), () => {
    runtime.telegramPublicOutbox?.start();
  });
}

runtime.app.log.info(
  { host: config.host, port: config.port, telegramEnabled: config.telegram.enabled,
    telegramPublicEnabled: config.telegramPublic.enabled },
  'Lead Hub started.',
);

function registerWebhook(kind: 'Corporate' | 'Public', register: () => Promise<void>, onReady: () => void, attempt = 1) {
  void register().then(() => {
    if (closing) return;
    onReady();
    runtime.app.log.info({ kind }, 'Telegram webhook registered.');
  }).catch(() => {
    if (closing) return;
    runtime.app.log.warn({ kind, attempt }, 'Telegram webhook registration failed.');
    if (attempt < 6) {
      setTimeout(() => {
        if (!closing) registerWebhook(kind, register, onReady, attempt + 1);
      }, 2 ** attempt * 1_000).unref();
    }
  });
}

async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  runtime.app.log.info({ signal }, 'Lead Hub is shutting down.');
  await runtime.app.close();
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
