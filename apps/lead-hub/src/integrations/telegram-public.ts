import { Bot, GrammyError } from 'grammy';
import { maxStoredPhotoSizeBytes } from './object-storage.js';

export interface TelegramPublicIntegration {
  registerWebhook(url: string, secret: string, username?: string): Promise<void>;
  sendMessage(chatId: string, payload: PublicReplyPayload): Promise<void>;
  downloadPhoto(fileId: string): Promise<Buffer>;
}

export interface PublicReplyPayload {
  text: string;
  reply_markup?: Record<string, unknown>;
}

export class InvalidTelegramPhoto extends Error {}

export function createTelegramPublicIntegration(botToken: string, timeoutMs: number): TelegramPublicIntegration {
  const bot = new Bot(botToken, { client: { timeoutSeconds: timeoutMs / 1_000 } });
  return {
    async registerWebhook(url, secret, username) {
      await bot.init();
      if (username && bot.botInfo.username.toLowerCase() !== username.toLowerCase()) {
        throw new Error('Public bot identity does not match configuration.');
      }
      await bot.api.setWebhook(url, { secret_token: secret, allowed_updates: ['message'], max_connections: 1 });
    },
    async sendMessage(chatId, payload) {
      await bot.api.sendMessage(chatId, payload.text, payload.reply_markup
        ? { reply_markup: payload.reply_markup as never }
        : {});
    },
    async downloadPhoto(fileId) {
      const file = await bot.api.getFile(fileId).catch((error: unknown) => {
        if (error instanceof GrammyError && error.error_code === 400) throw new InvalidTelegramPhoto();
        throw error;
      });
      if (!file.file_path || (file.file_size ?? 0) > maxStoredPhotoSizeBytes) throw new InvalidTelegramPhoto();
      const path = file.file_path.split('/').map(encodeURIComponent).join('/');
      const response = await fetch(`https://api.telegram.org/file/bot${botToken}/${path}`, {
        signal: AbortSignal.timeout(timeoutMs), redirect: 'error',
      });
      if (response.status === 404) throw new InvalidTelegramPhoto();
      if (!response.ok || !response.body) throw new Error('Telegram photo download failed.');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        const chunk: unknown = result.value;
        if (!(chunk instanceof Uint8Array)) throw new InvalidTelegramPhoto();
        size += chunk.byteLength;
        if (size > maxStoredPhotoSizeBytes) {
          await reader.cancel();
          throw new InvalidTelegramPhoto();
        }
        chunks.push(chunk);
      }
      return Buffer.concat(chunks, size);
    },
  };
}
