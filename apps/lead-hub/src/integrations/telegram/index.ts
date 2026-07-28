import { Bot, type Context } from 'grammy';
import type { Update } from 'grammy/types';
import type { Lead } from '../../db/schema.js';
import { maskPhone } from '../../domain/phone.js';
import { isLeadStatus, statusLabels } from '../../domain/status.js';
import type { LeadService } from '../../services/lead-service.js';
import { buildLeadCard, buildLeadKeyboard } from './card.js';

export interface TelegramDelivery {
  sendLeadCard(lead: Lead): Promise<{ chatId: string; messageId: number }>;
  editLeadCard(lead: Lead): Promise<void>;
}

export interface TelegramIntegration extends TelegramDelivery {
  registerWebhook(url: string, secret: string): Promise<void>;
  handleUpdate(update: Update): Promise<void>;
}

interface TelegramOptions {
  botToken: string;
  chatId: string;
  photoUrlResolver?: (references: string[]) => Promise<string[]>;
}

export function createTelegramIntegration(
  options: TelegramOptions,
  leadService: LeadService,
): TelegramIntegration {
  const bot = new Bot(options.botToken);
  const isAllowedChat = (context: Context) => String(context.chat?.id || '') === options.chatId;

  bot.use(async (context, next) => {
    if (!isAllowedChat(context)) {
      if (context.callbackQuery) await context.answerCallbackQuery({ text: 'Нет доступа.' });
      return;
    }
    await next();
  });

  bot.callbackQuery(/^status:([^:]+):([0-9a-f-]{36})$/i, async (context) => {
    const [, rawStatus, leadId] = context.match;
    if (!rawStatus || !leadId || !isLeadStatus(rawStatus)) {
      await context.answerCallbackQuery({ text: 'Неизвестный статус.' });
      return;
    }

    const externalEventId = `telegram:callback:${context.callbackQuery.id}`;
    const lead = await leadService.changeStatus(leadId, rawStatus, {
      source: 'telegram',
      externalEventId,
      actorId: String(context.from.id),
    });

    await context.answerCallbackQuery({ text: `Статус: ${statusLabels[rawStatus]}` });
    if (rawStatus === 'won') {
      await context.reply(`Лид #${lead.publicId} выполнен. Зафиксируйте сумму в учётной системе.`);
    } else if (rawStatus === 'lost') {
      await context.reply(`Лид #${lead.publicId} потерян. Укажите причину ответом менеджеру.`);
    }
  });

  bot.command('new', async (context) => {
    const value = context.match.trim();
    const [phone, ...serviceParts] = value.split(/\s+/);
    if (!phone) {
      await context.reply('Формат: /new +375291234567 замена лобового');
      return;
    }

    const messageId = context.message?.message_id;
    if (!messageId) return;
    const serviceType = serviceParts.join(' ') || undefined;
    const idempotencyKey = `telegram:new:${context.chat.id}:${messageId}`;
    const result = await leadService.createManualLead(
      { phone, ...(serviceType ? { serviceType } : {}) },
      idempotencyKey,
    );
    await context.reply(
      `${result.deduplicated ? 'Найден' : 'Создан'} лид #${result.lead.publicId} (${maskPhone(result.lead.phoneNormalized)}).`,
    );
  });

  bot.command('today', async (context) => {
    const summary = await leadService.getTodaySummary();
    const total = summary.reduce((sum, row) => sum + row.total, 0);
    const lines = summary.map((row) => `${statusLabels[row.status as keyof typeof statusLabels] || row.status}: ${row.total}`);
    await context.reply([`Сегодня лидов: ${total}`, ...lines].join('\n'));
  });

  bot.command('sla', async (context) => {
    const overdue = await leadService.getSlaBreaches();
    if (!overdue.length) {
      await context.reply('Просроченных новых лидов нет.');
      return;
    }
    await context.reply(
      ['Новые лиды без реакции более 5 минут:', ...overdue.map((lead) => `#${lead.publicId} / ${maskPhone(lead.phoneNormalized)}`)].join('\n'),
    );
  });

  bot.command('funnel', async (context) => {
    const match = /^(\d{1,3})d$/i.exec(context.match.trim());
    const days = Math.min(Number(match?.[1] || 7), 90);
    const funnel = await leadService.getFunnel(days);
    const lines = funnel.map((row) => `${statusLabels[row.status as keyof typeof statusLabels] || row.status}: ${row.total}`);
    await context.reply([`Воронка за ${days} дн.:`, ...lines].join('\n'));
  });

  return {
    async registerWebhook(url, secret) {
      await bot.api.setWebhook(url, {
        secret_token: secret,
        allowed_updates: ['message', 'callback_query'],
      });
    },

    async sendLeadCard(lead) {
      const photoUrls = lead.photoRefs.length && options.photoUrlResolver
        ? await options.photoUrlResolver(lead.photoRefs)
        : [];
      const message = await bot.api.sendMessage(options.chatId, buildLeadCard(lead), {
        reply_markup: buildLeadKeyboard(lead.id),
      });

      for (const [index, photoUrl] of photoUrls.entries()) {
        try {
          await bot.api.sendPhoto(options.chatId, photoUrl, {
            caption: `#${lead.publicId} (${index + 1}/${photoUrls.length})`,
          });
        } catch {
          console.error('Telegram photo delivery failed.', {
            leadId: lead.publicId,
            photoIndex: index,
          });
        }
      }

      return { chatId: String(message.chat.id), messageId: message.message_id };
    },

    async editLeadCard(lead) {
      if (!lead.telegramChatId || !lead.telegramMessageId) return;
      await bot.api.editMessageText(
        lead.telegramChatId,
        lead.telegramMessageId,
        buildLeadCard(lead),
        { reply_markup: buildLeadKeyboard(lead.id) },
      );
    },

    async handleUpdate(update) {
      await bot.handleUpdate(update);
    },
  };
}
