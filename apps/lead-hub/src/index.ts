import { buildRuntime } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const runtime = await buildRuntime(config);

await runtime.app.listen({ host: config.host, port: config.port });
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
