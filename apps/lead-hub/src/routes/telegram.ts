import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config.js';
import type { TelegramIntegration } from '../integrations/telegram/index.js';
import { matchesSecret } from '../security/secrets.js';

interface TelegramHeaders {
  'x-telegram-bot-api-secret-token'?: string;
}

export function registerTelegramRoutes(
  app: FastifyInstance,
  config: AppConfig,
  telegram: TelegramIntegration | null,
) {
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

      await telegram.handleUpdate(request.body as Parameters<TelegramIntegration['handleUpdate']>[0]);
      return reply.code(200).send({ ok: true });
    },
  );
}
