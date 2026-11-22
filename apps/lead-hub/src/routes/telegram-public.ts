import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config.js';
import { TelegramPublicUpdateSchema, type TelegramPublicUpdate } from '../contracts/telegram-public.js';
import { matchesSecret } from '../security/secrets.js';
import type { InboxService } from '../services/inbox-service.js';

interface Headers { 'x-telegram-bot-api-secret-token'?: string }

export function registerTelegramPublicRoutes(app: FastifyInstance, config: AppConfig, inbox: InboxService) {
  if (!config.telegramPublic.enabled) return;
  app.post<{ Body: TelegramPublicUpdate; Headers: Headers }>('/api/v1/webhooks/telegram-public', {
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
    schema: { body: TelegramPublicUpdateSchema },
  }, async (request, reply) => {
    if (!matchesSecret(request.headers['x-telegram-bot-api-secret-token'], config.telegramPublic.webhookSecret)) {
      return reply.code(401).send({ ok: false, error: 'invalid_webhook_secret' });
    }
    const { update_id, message } = request.body;
    if (!message?.from || message.from.is_bot || message.chat.type !== 'private' || message.chat.id !== message.from.id) {
      return reply.code(200).send({ ok: true, ignored: true });
    }
    const result = await inbox.accept('telegram_public', 'update.received', String(update_id), {
      update_id,
      message: {
        chat: { id: message.chat.id, type: message.chat.type },
        from: { id: message.from.id },
        text: message.text,
        contact: message.contact && { user_id: message.contact.user_id, phone_number: message.contact.phone_number },
        photo: message.photo?.map(({ file_id, file_size }) => ({ file_id, file_size })),
      },
    });
    return reply.code(200).send({ ok: true, accepted: true, deduplicated: result.deduplicated });
  });
}
