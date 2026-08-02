import { Bot } from 'grammy';

export interface TelegramPublicIntegration {
  registerWebhook(url: string, secret: string): Promise<void>;
  sendMessage(chatId: string, payload: PublicReplyPayload): Promise<void>;
}

export interface PublicReplyPayload {
  text: string;
  reply_markup?: Record<string, unknown>;
}

export function createTelegramPublicIntegration(botToken: string): TelegramPublicIntegration {
  const bot = new Bot(botToken);
  return {
    async registerWebhook(url, secret) {
      await bot.init();
      await bot.api.setWebhook(url, { secret_token: secret, allowed_updates: ['message'] });
    },
    async sendMessage(chatId, payload) {
      await bot.api.sendMessage(chatId, payload.text, payload.reply_markup
        ? { reply_markup: payload.reply_markup as never }
        : {});
    },
  };
}
