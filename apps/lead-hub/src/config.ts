import { z } from 'zod';

const booleanFromString = z.preprocess((value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return value;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}, z.boolean());

const optionalSecret = z.string().trim().min(16).optional().or(z.literal('').transform(() => undefined));
const optionalText = z.string().trim().min(1).optional().or(z.literal('').transform(() => undefined));
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
    KUFAR_INGEST_ENABLED: booleanFromString.default(false),
    KUFAR_INGEST_API_KEY: optionalSecret,
    TELEGRAM_ENABLED: booleanFromString.default(false),
    TELEGRAM_BOT_TOKEN: z.string().trim().optional().or(z.literal('').transform(() => undefined)),
    TELEGRAM_CHAT_ID: z.string().trim().optional().or(z.literal('').transform(() => undefined)),
    TELEGRAM_WEBHOOK_SECRET: optionalSecret,
    OBJECT_STORAGE_ENDPOINT: z.string().url().optional().or(z.literal('').transform(() => undefined)),
    OBJECT_STORAGE_REGION: optionalText,
    OBJECT_STORAGE_BUCKET: optionalText,
    OBJECT_STORAGE_ACCESS_KEY_ID: optionalText,
    OBJECT_STORAGE_SECRET_ACCESS_KEY: optionalSecret,
    OBJECT_STORAGE_PREFIX: z.string().trim().min(1).default('leads/'),
    OBJECT_STORAGE_UPLOAD_TTL_SECONDS: z.coerce.number().int().min(60).max(3_600).default(900),
    OBJECT_STORAGE_DOWNLOAD_TTL_SECONDS: z.coerce.number().int().min(60).max(3_600).default(900),
    OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(250).max(60_000).default(2_000),
    OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(10),
    OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(50).default(8),
    OUTBOX_PROCESSING_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(30_000)
      .max(3_600_000)
      .default(300_000),
    INBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(250).max(60_000).default(2_000),
    INBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(10),
    INBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(50).default(8),
    INBOX_PROCESSING_TIMEOUT_MS: z.coerce.number().int().min(30_000).max(3_600_000).default(300_000),
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

    const objectStorage = [
      ['OBJECT_STORAGE_ENDPOINT', config.OBJECT_STORAGE_ENDPOINT],
      ['OBJECT_STORAGE_REGION', config.OBJECT_STORAGE_REGION],
      ['OBJECT_STORAGE_BUCKET', config.OBJECT_STORAGE_BUCKET],
      ['OBJECT_STORAGE_ACCESS_KEY_ID', config.OBJECT_STORAGE_ACCESS_KEY_ID],
      ['OBJECT_STORAGE_SECRET_ACCESS_KEY', config.OBJECT_STORAGE_SECRET_ACCESS_KEY],
    ] as const;
    const objectStorageEnabled = objectStorage.some(([, value]) => Boolean(value));

    if (objectStorageEnabled) {
      for (const [name, value] of objectStorage) {
        if (!value) {
          context.addIssue({
            code: 'custom',
            message: `${name} is required when object storage is configured`,
            path: [name],
          });
        }
      }

      if (!/^[a-z0-9][a-z0-9.-]{4,61}[a-z0-9]$/.test(config.OBJECT_STORAGE_BUCKET || '')) {
        context.addIssue({
          code: 'custom',
          message: 'OBJECT_STORAGE_BUCKET must be a valid S3 bucket name',
          path: ['OBJECT_STORAGE_BUCKET'],
        });
      }

      if (!/^[A-Za-z0-9][A-Za-z0-9/_-]*\/$/.test(config.OBJECT_STORAGE_PREFIX)) {
        context.addIssue({
          code: 'custom',
          message: 'OBJECT_STORAGE_PREFIX must be a relative prefix ending with /',
          path: ['OBJECT_STORAGE_PREFIX'],
        });
      }
    }
    if (config.TELEGRAM_ENABLED) {
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

      if (!config.LEAD_HUB_PUBLIC_URL) {
        context.addIssue({
          code: 'custom',
          message: 'LEAD_HUB_PUBLIC_URL is required when TELEGRAM_ENABLED=true',
          path: ['LEAD_HUB_PUBLIC_URL'],
        });
      } else if (config.NODE_ENV === 'production' && new URL(config.LEAD_HUB_PUBLIC_URL).protocol !== 'https:') {
        context.addIssue({ code: 'custom', message: 'LEAD_HUB_PUBLIC_URL must use HTTPS in production', path: ['LEAD_HUB_PUBLIC_URL'] });
      }
    }

    if (config.KUFAR_INGEST_ENABLED && !config.KUFAR_INGEST_API_KEY) {
      context.addIssue({
        code: 'custom',
        message: 'KUFAR_INGEST_API_KEY is required when KUFAR_INGEST_ENABLED=true',
        path: ['KUFAR_INGEST_API_KEY'],
      });
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

  const objectStorage = parsed.data.OBJECT_STORAGE_ENDPOINT
    ? {
        endpoint: parsed.data.OBJECT_STORAGE_ENDPOINT,
        region: parsed.data.OBJECT_STORAGE_REGION!,
        bucket: parsed.data.OBJECT_STORAGE_BUCKET!,
        accessKeyId: parsed.data.OBJECT_STORAGE_ACCESS_KEY_ID!,
        secretAccessKey: parsed.data.OBJECT_STORAGE_SECRET_ACCESS_KEY!,
        prefix: parsed.data.OBJECT_STORAGE_PREFIX,
        uploadTtlSeconds: parsed.data.OBJECT_STORAGE_UPLOAD_TTL_SECONDS,
        downloadTtlSeconds: parsed.data.OBJECT_STORAGE_DOWNLOAD_TTL_SECONDS,
      }
    : null;

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
    kufar: {
      enabled: parsed.data.KUFAR_INGEST_ENABLED,
      ingestApiKey: parsed.data.KUFAR_INGEST_API_KEY,
    },
    telegram: {
      enabled: parsed.data.TELEGRAM_ENABLED,
      botToken: parsed.data.TELEGRAM_BOT_TOKEN,
      chatId: parsed.data.TELEGRAM_CHAT_ID,
      webhookSecret: parsed.data.TELEGRAM_WEBHOOK_SECRET,
    },
    objectStorage,
    outbox: {
      pollIntervalMs: parsed.data.OUTBOX_POLL_INTERVAL_MS,
      batchSize: parsed.data.OUTBOX_BATCH_SIZE,
      maxAttempts: parsed.data.OUTBOX_MAX_ATTEMPTS,
      processingTimeoutMs: parsed.data.OUTBOX_PROCESSING_TIMEOUT_MS,
    },
    inbox: {
      pollIntervalMs: parsed.data.INBOX_POLL_INTERVAL_MS,
      batchSize: parsed.data.INBOX_BATCH_SIZE,
      maxAttempts: parsed.data.INBOX_MAX_ATTEMPTS,
      processingTimeoutMs: parsed.data.INBOX_PROCESSING_TIMEOUT_MS,
    },
    logLevel: parsed.data.LOG_LEVEL,
  };
}
