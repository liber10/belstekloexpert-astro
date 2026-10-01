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
import {
  createTelegramPublicIntegration,
  type TelegramPublicIntegration,
} from './integrations/telegram-public.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerKufarRoutes } from './routes/kufar.js';
import { registerLeadRoutes } from './routes/leads.js';
import { registerMetaRoutes } from './routes/meta.js';
import { registerTelegramRoutes } from './routes/telegram.js';
import { registerTelegramPublicRoutes } from './routes/telegram-public.js';
import { registerUploadRoutes } from './routes/uploads.js';
import { registerSubmissionDiagnosticRoutes } from './routes/submission-diagnostics.js';
import { LeadService } from './services/lead-service.js';
import { InboxService } from './services/inbox-service.js';
import { TelegramPublicSessionService } from './services/telegram-public-session-service.js';
import { InboxProcessor } from './worker/inbox-processor.js';
import { OutboxProcessor } from './worker/outbox-processor.js';
import { TelegramPublicOutboxProcessor } from './worker/telegram-public-outbox-processor.js';
import { registerRawBodyJsonParser } from './security/raw-body.js';
import { InstagramMessageService } from './services/instagram-message-service.js';
import { InstagramMessagingAdapter, type InstagramDelivery } from './integrations/instagram-messaging.js';
import { InstagramOutboxProcessor } from './worker/instagram-outbox-processor.js';
import { InstagramConversationHistory, type InstagramConversationGuard } from './integrations/instagram-conversation-guard.js';

interface BuildRuntimeOptions {
  database?: DatabaseClient;
  telegram?: TelegramIntegration | null;
  telegramPublic?: TelegramPublicIntegration | null;
  objectStorage?: ObjectStorage | null;
  startWorker?: boolean;
  instagram?: InstagramDelivery;
  instagramHistory?: InstagramConversationGuard;
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
      serializers: {
        req: (request) => ({ method: request.method, url: (request.url.split('?')[0] || '').replace(
          /\/integrations\/meta\/events\/[^/]+/, '/integrations/meta/events/[redacted]'), hostname: request.hostname }),
      },
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.x-telegram-bot-api-secret-token',
          'req.headers.x-hub-signature-256',
          'req.body.phone',
          'req.body.vin',
          'req.body.email',
          'req.body.contact',
        ],
        censor: '[redacted]',
      },
    },
  });

  registerRawBodyJsonParser(app);

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
  const inboxService = new InboxService(database.db);
  const instagramHistory = config.instagramMessaging.enabled
    ? options.instagramHistory || new InstagramConversationHistory({
        accessToken: config.meta.instagramAccessToken!, accountId: config.instagramMessaging.accountId!,
        graphVersion: config.instagramMessaging.graphVersion, timeoutMs: config.outbox.deliveryTimeoutMs,
      }) : null;
  const instagramMessages = new InstagramMessageService(database.db, leadService, config.instagramMessaging, instagramHistory);
  const telegram = options.telegram === undefined
    ? createConfiguredTelegram(config, leadService, objectStorage)
    : options.telegram;
  const telegramPublic = options.telegramPublic === undefined
    ? createConfiguredTelegramPublic(config)
    : options.telegramPublic;
  const telegramPublicSession = telegramPublic && config.telegramPublic.botUsername && config.telegramPublic.privacyVersion
    ? new TelegramPublicSessionService(database.db, leadService, {
        ttlHours: config.telegramPublic.sessionTtlHours,
        botUsername: config.telegramPublic.botUsername,
        privacyVersion: config.telegramPublic.privacyVersion,
      })
    : null;

  registerKufarRoutes(app, config, inboxService);
  registerMetaRoutes(app, config, inboxService, database.db);
  registerLeadRoutes(app, config, leadService);
  registerUploadRoutes(app, config, objectStorage, leadService);
  registerSubmissionDiagnosticRoutes(app, config, database.db);
  registerTelegramRoutes(app, config, telegram);
  registerTelegramPublicRoutes(app, config, inboxService);

  const outbox = telegram
    ? new OutboxProcessor(database.db, leadService, telegram, app.log, config.outbox)
    : null;
  const inbox = config.kufar.enabled
    || config.meta.enabled
    || config.telegramPublic.enabled
    ? new InboxProcessor(database.db, leadService, app.log, config.inbox, telegramPublicSession, instagramMessages)
    : null;
  const instagramOutbox = config.instagramMessaging.enabled
    ? new InstagramOutboxProcessor(database.db, options.instagram || new InstagramMessagingAdapter({
        accessToken: config.meta.instagramAccessToken!, accountId: config.instagramMessaging.accountId!,
        graphVersion: config.instagramMessaging.graphVersion, timeoutMs: config.outbox.deliveryTimeoutMs,
      }), instagramHistory!, app.log, config.outbox, config.instagramMessaging.accountId!,
      Date.parse(config.instagramMessaging.startAt!),
      config.instagramMessaging.mode === 'canary' ? 'canary' : 'live') : null;
  const telegramPublicOutbox = telegramPublic
    ? new TelegramPublicOutboxProcessor(database.db, telegramPublic, app.log, config.outbox)
    : null;

  registerHealthRoutes(app, database.pool, {
    telegramConfigured: config.telegram.enabled,
    telegramWorkerActive: () => outbox?.isActive() ?? false,
    buildRevision: config.buildRevision,
    instagramConfigured: config.instagramMessaging.enabled,
    instagramWorkerActive: () => instagramOutbox?.isActive() ?? false,
  });

  if (options.startWorker !== false) {
    outbox?.start();
    inbox?.start();
    telegramPublicOutbox?.start();
    instagramOutbox?.start();
  }

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

    // Driver errors can include SQL parameters containing client messages.
    request.log.error('Unhandled request error; inspect durable state using the request/event ID.');
    return reply.code(500).send({ ok: false, error: 'internal_error' });
  });

  app.addHook('onClose', async () => {
    outbox?.stop();
    inbox?.stop();
    telegramPublicOutbox?.stop();
    await instagramOutbox?.stop();
    if (ownsDatabase) await database.pool.end();
  });

  return {
    app,
    database,
    objectStorage,
    leadService,
    inboxService,
    telegram,
    telegramPublic,
    telegramPublicSession,
    outbox,
    inbox,
    telegramPublicOutbox,
    instagramOutbox,
    instagramMessages,
  };
}

function createConfiguredTelegramPublic(config: AppConfig) {
  if (!config.telegramPublic.enabled) return null;
  if (!config.telegramPublic.botToken) {
    throw new Error('Public Telegram is enabled but its bot token is missing.');
  }
  return createTelegramPublicIntegration(config.telegramPublic.botToken);
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
