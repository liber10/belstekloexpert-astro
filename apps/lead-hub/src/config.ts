import { z } from 'zod';

const booleanFromString = z.preprocess((value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return value;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}, z.boolean());

const optionalSecret = z.string().trim().min(16).optional().or(z.literal('').transform(() => undefined));
const optionalPort = z.preprocess(
  (value) => (value === '' || value === undefined ? undefined : value),
  z.coerce.number().int().min(1).max(65_535).optional(),
);

const configSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LEAD_HUB_HOST: z.string().trim().min(1).default('0.0.0.0'),
    LEAD_HUB_PORT: optionalPort,
    PORT: optionalPort,
    LEAD_HUB_PUBLIC_URL: z.string().url().optional().or(z.literal('').transform(() => undefined)),
    LEAD_HUB_ALLOWED_ORIGINS: z.string().default('http://localhost:4321'),
    LEAD_HUB_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(10_000).default(20),
    DATABASE_URL: z.string().trim().min(1),
    WEB_INGEST_API_KEY: optionalSecret,
    TELEGRAM_ENABLED: booleanFromString.default(false),
    TELEGRAM_BOT_TOKEN: z.string().trim().optional().or(z.literal('').transform(() => undefined)),
    TELEGRAM_CHAT_ID: z.string().trim().optional().or(z.literal('').transform(() => undefined)),
    TELEGRAM_WEBHOOK_SECRET: optionalSecret,
    OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(250).max(60_000).default(2_000),
    OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(10),
    OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(50).default(8),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  })
  .superRefine((config, context) => {
    if (config.NODE_ENV === 'production' && !config.WEB_INGEST_API_KEY) {
      context.addIssue({
        code: 'custom',
        message: 'WEB_INGEST_API_KEY is required in production',
        path: ['WEB_INGEST_API_KEY'],
      });
    }

    if (!config.TELEGRAM_ENABLED) return;

    const required = [
      ['TELEGRAM_BOT_TOKEN', config.TELEGRAM_BOT_TOKEN],
      ['TELEGRAM_CHAT_ID', config.TELEGRAM_CHAT_ID],
      ['TELEGRAM_WEBHOOK_SECRET', config.TELEGRAM_WEBHOOK_SECRET],
    ] as const;

    for (const [name, value] of required) {
      if (!value) {
        context.addIssue({
          code: 'custom',
          message: `${name} is required when TELEGRAM_ENABLED=true`,
          path: [name],
        });
      }
    }
  });

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env) {
  const parsed = configSchema.safeParse(environment);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid Lead Hub environment: ${details}`);
  }

  return {
    nodeEnv: parsed.data.NODE_ENV,
    host: parsed.data.LEAD_HUB_HOST,
    port: parsed.data.LEAD_HUB_PORT ?? parsed.data.PORT ?? 8787,
    publicUrl: parsed.data.LEAD_HUB_PUBLIC_URL,
    allowedOrigins: parsed.data.LEAD_HUB_ALLOWED_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    rateLimitMax: parsed.data.LEAD_HUB_RATE_LIMIT_MAX,
    databaseUrl: parsed.data.DATABASE_URL,
    webIngestApiKey: parsed.data.WEB_INGEST_API_KEY,
    telegram: {
      enabled: parsed.data.TELEGRAM_ENABLED,
      botToken: parsed.data.TELEGRAM_BOT_TOKEN,
      chatId: parsed.data.TELEGRAM_CHAT_ID,
      webhookSecret: parsed.data.TELEGRAM_WEBHOOK_SECRET,
    },
    outbox: {
      pollIntervalMs: parsed.data.OUTBOX_POLL_INTERVAL_MS,
      batchSize: parsed.data.OUTBOX_BATCH_SIZE,
      maxAttempts: parsed.data.OUTBOX_MAX_ATTEMPTS,
    },
    logLevel: parsed.data.LOG_LEVEL,
  };
}
