import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import type { AppConfig } from './config.js';
import { createDatabaseClient, type DatabaseClient } from './db/client.js';
import {
  createTelegramIntegration,
  type TelegramIntegration,
} from './integrations/telegram/index.js';
import {
  createObjectStorage,
  type ObjectStorage,
} from './integrations/object-storage.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerLeadRoutes } from './routes/leads.js';
import { registerTelegramRoutes } from './routes/telegram.js';
import { registerUploadRoutes } from './routes/uploads.js';
import { LeadService } from './services/lead-service.js';
import { OutboxProcessor } from './worker/outbox-processor.js';

interface BuildRuntimeOptions {
  database?: DatabaseClient;
  telegram?: TelegramIntegration | null;
  objectStorage?: ObjectStorage | null;
  startWorker?: boolean;
}

export async function buildRuntime(config: AppConfig, options: BuildRuntimeOptions = {}) {
  const ownsDatabase = !options.database;
  const database = options.database || createDatabaseClient(config.databaseUrl);
  const app = Fastify({
    bodyLimit: 256 * 1_024,
    trustProxy: true,
    ajv: {
      customOptions: {
        removeAdditional: false,
      },
    },
    logger: {
      level: config.logLevel,
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.x-telegram-bot-api-secret-token',
          'req.body.phone',
          'req.body.vin',
        ],
        censor: '[redacted]',
      },
    },
  });

  await app.register(helmet);
  await app.register(cors, {
    origin: config.allowedOrigins,
    methods: ['GET', 'POST'],
  });
  await app.register(rateLimit, {
    global: false,
    hook: 'preHandler',
  });

  const objectStorage = options.objectStorage === undefined
    ? config.objectStorage
      ? createObjectStorage(config.objectStorage)
      : null
    : options.objectStorage;
  const leadService = new LeadService(database.db, objectStorage
    ? (reference, submissionId) => objectStorage.isReferenceForSubmission(reference, submissionId)
    : undefined);
  const telegram = options.telegram === undefined
    ? createConfiguredTelegram(config, leadService, objectStorage)
    : options.telegram;

  registerHealthRoutes(app, database.pool);
  registerLeadRoutes(app, config, leadService);
  registerUploadRoutes(app, config, objectStorage, leadService);
  registerTelegramRoutes(app, config, telegram);

  const outbox = telegram
    ? new OutboxProcessor(database.db, leadService, telegram, app.log, config.outbox)
    : null;

  if (outbox && options.startWorker !== false) outbox.start();

  app.setErrorHandler(async (error, request, reply) => {
    if (isValidationError(error)) {
      return reply.code(400).send({
        ok: false,
        error: 'validation_error',
        details: error.validation.map(
          (item) =>
            item.instancePath ||
            item.params.missingProperty ||
            item.params.additionalProperty ||
            'request',
        ),
      });
    }

    request.log.error({ err: error }, 'Unhandled request error.');
    return reply.code(500).send({ ok: false, error: 'internal_error' });
  });

  app.addHook('onClose', async () => {
    outbox?.stop();
    if (ownsDatabase) await database.pool.end();
  });

  return {
    app,
    database,
    objectStorage,
    leadService,
    telegram,
    outbox,
  };
}

function isValidationError(error: unknown): error is {
  validation: Array<{
    instancePath?: string;
    params: { missingProperty?: string; additionalProperty?: string };
  }>;
} {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'validation' in error &&
      Array.isArray(error.validation),
  );
}

function createConfiguredTelegram(
  config: AppConfig,
  leadService: LeadService,
  objectStorage: ObjectStorage | null,
) {
  if (!config.telegram.enabled) return null;
  if (!config.telegram.botToken || !config.telegram.chatId || !config.telegram.webhookSecret) {
    throw new Error('Telegram is enabled but its required configuration is missing.');
  }

  return createTelegramIntegration(
    {
      botToken: config.telegram.botToken,
      chatId: config.telegram.chatId,
      ...(objectStorage
        ? { photoUrlResolver: (references: string[]) => objectStorage.createDownloadUrls(references) }
        : {}),
    },
    leadService,
  );
}
