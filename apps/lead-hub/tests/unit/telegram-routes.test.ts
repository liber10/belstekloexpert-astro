import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/config.js';
import type { TelegramIntegration } from '../../src/integrations/telegram/index.js';
import { registerTelegramRoutes } from '../../src/routes/telegram.js';

const webhookSecret = 'test-webhook-secret';

function createTelegram() {
  const handleUpdate = vi.fn(() => Promise.resolve());
  const telegram: TelegramIntegration = {
    registerWebhook: vi.fn(() => Promise.resolve()),
    sendLeadCard: vi.fn(() => Promise.resolve({ chatId: '-100123', messageId: 42 })),
    editLeadCard: vi.fn(() => Promise.resolve()),
    handleUpdate,
  };
  return { telegram, handleUpdate };
}

function telegramConfig() {
  return loadConfig({
    DATABASE_URL: 'postgres://localhost/lead_hub',
    TELEGRAM_ENABLED: 'true',
    TELEGRAM_BOT_TOKEN: 'test-bot-token',
    TELEGRAM_CHAT_ID: '-100123456789',
    TELEGRAM_WEBHOOK_SECRET: webhookSecret,
    LEAD_HUB_PUBLIC_URL: 'https://lead-hub.example.test',
    LOG_LEVEL: 'silent',
  });
}

describe('Telegram webhook route', () => {
  it('rejects an invalid secret without handling the update', async () => {
    const app = Fastify({ logger: false });
    const { telegram, handleUpdate } = createTelegram();
    registerTelegramRoutes(app, telegramConfig(), telegram);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/telegram',
      headers: { 'x-telegram-bot-api-secret-token': 'wrong-secret-value' },
      payload: { update_id: 1 },
    });

    expect(response.statusCode).toBe(401);
    expect(handleUpdate).not.toHaveBeenCalled();
    await app.close();
  });

  it('handles an authenticated update exactly once', async () => {
    const app = Fastify({ logger: false });
    const { telegram, handleUpdate } = createTelegram();
    registerTelegramRoutes(app, telegramConfig(), telegram);
    const update = { update_id: 2 };

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/telegram',
      headers: { 'x-telegram-bot-api-secret-token': webhookSecret },
      payload: update,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(handleUpdate).toHaveBeenCalledOnce();
    expect(handleUpdate).toHaveBeenCalledWith(update);
    await app.close();
  });
});
