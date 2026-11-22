import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import type { Update } from 'grammy/types';
import type { AppConfig } from '../config.js';
import type { TelegramIntegration } from '../integrations/telegram/index.js';
import { matchesSecret } from '../security/secrets.js';
import type { InboxService } from '../services/inbox-service.js';
import { parseStaffRoster } from '../services/telegram-staff-service.js';

interface TelegramHeaders {
  'x-telegram-bot-api-secret-token'?: string;
}

export function registerTelegramRoutes(
  app: FastifyInstance,
  config: AppConfig,
  telegram: TelegramIntegration | null,
  inbox?: InboxService,
) {
  const roles = parseStaffRoster(config.telegram.staffRoster);
  app.post<{ Body: unknown; Headers: TelegramHeaders }>(
    '/api/v1/webhooks/telegram',
    {
      config: {
        rateLimit: {
          max: 120,
          timeWindow: '1 minute',
        },
      },
      schema: {
        body: Type.Any(),
        headers: Type.Object(
          {
            'x-telegram-bot-api-secret-token': Type.Optional(Type.String({ maxLength: 256 })),
          },
          { additionalProperties: true },
        ),
      },
    },
    async (request, reply) => {
      if (!telegram || !config.telegram.enabled) {
        return reply.code(503).send({ ok: false, error: 'telegram_disabled' });
      }

      const provided = request.headers['x-telegram-bot-api-secret-token'];
      if (!matchesSecret(provided, config.telegram.webhookSecret)) {
        return reply.code(401).send({ ok: false, error: 'invalid_webhook_secret' });
      }

      const update = request.body as Update | null;
      if (!update || !Number.isSafeInteger(update.update_id) || update.update_id < 0) {
        return reply.code(400).send({ ok: false, error: 'invalid_update' });
      }
      if (inbox && roles.size) {
        const message = update.message ?? update.callback_query?.message;
        const user = update.message?.from ?? update.callback_query?.from;
        if (String(message?.chat?.id) !== config.telegram.chatId || user?.is_bot || !roles.has(String(user?.id))) {
          return reply.code(200).send({ ok: true, ignored: true });
        }
        const result = await inbox.accept('telegram_staff', 'update.received', String(update.update_id), { ...update });
        return reply.code(200).send({ ok: true, accepted: true, deduplicated: result.deduplicated });
      }
      await telegram.handleUpdate(update);
      return reply.code(200).send({ ok: true });
    },
  );
}
