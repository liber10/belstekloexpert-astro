import { eq } from 'drizzle-orm';
import type { TelegramPublicUpdate } from '../contracts/telegram-public.js';
import type { LeadHubDatabase } from '../db/client.js';
import { telegramPublicOutbox, telegramPublicSessions } from '../db/schema.js';
import { LeadValidationError, type LeadService } from './lead-service.js';

const acquisitionPattern = /^[A-Za-z0-9_-]{1,64}$/;
const serviceChoices = ['Замена стекла', 'Ремонт скола/трещины', 'Мобильный выезд', 'Уточнение по VIN'];
const confirmText = 'Подтвердить и согласиться';

interface Options { ttlHours: number; privacyVersion: string; botUsername: string }

export class TelegramPublicSessionService {
  constructor(private readonly db: LeadHubDatabase, private readonly leads: LeadService, private readonly options: Options) {}

  async handleUpdate(update: TelegramPublicUpdate) {
    const message = update.message;
    if (!message || message.chat.type !== 'private' || !message.from) return;
    const chatId = String(message.chat.id);
    const userId = String(message.from.id);
    const updateId = String(update.update_id);
    const text = String(message.text || '').trim();

    if (text.startsWith('/start')) {
      const candidate = text.split(/\s+/, 2)[1];
      const acquisitionCode = candidate && acquisitionPattern.test(candidate) ? candidate : null;
      const payload = { name: message.from.first_name || null };
      const [session] = await this.db.insert(telegramPublicSessions).values({
        telegramUserId: userId, telegramChatId: chatId, telegramUsername: message.from.username ?? null,
        stage: 'service', payload, acquisitionCode, lastUpdateId: updateId, expiresAt: this.expiresAt(),
      }).onConflictDoUpdate({
        target: telegramPublicSessions.telegramChatId,
        set: { telegramUserId: userId, telegramUsername: message.from.username ?? null, stage: 'service', payload,
          acquisitionCode, lastUpdateId: updateId, submittedLeadId: null, expiresAt: this.expiresAt(), updatedAt: new Date() },
      }).returning();
      if (session) await this.reply(session.id, chatId, updateId, servicePrompt());
      return;
    }

    const [session] = await this.db.select().from(telegramPublicSessions)
      .where(eq(telegramPublicSessions.telegramChatId, chatId)).limit(1);
    if (!session || session.expiresAt <= new Date()) {
      await this.reply(null, chatId, updateId, reply('Сессия истекла. Отправьте /start, чтобы начать заново.'));
      return;
    }
    if (session.lastUpdateId === updateId) return;
    if (text === '/cancel' || text === 'Отмена') {
      await this.update(session.id, 'cancelled', session.payload, updateId);
      await this.reply(session.id, chatId, updateId, reply('Заполнение отменено. Для новой заявки отправьте /start.'));
      return;
    }

    const payload = { ...session.payload };
    if (session.stage === 'service') {
      if (!serviceChoices.includes(text)) {
        await this.reply(session.id, chatId, updateId, servicePrompt('Выберите услугу кнопкой.'));
        return;
      }
      payload.serviceType = text;
      await this.update(session.id, 'comment', payload, updateId);
      await this.reply(session.id, chatId, updateId, reply('Кратко опишите автомобиль и задачу.', [['Пропустить'], ['Отмена']]));
      return;
    }
    if (session.stage === 'comment') {
      if (text && text !== 'Пропустить') payload.message = text.slice(0, 2_000);
      await this.update(session.id, 'contact', payload, updateId);
      await this.reply(session.id, chatId, updateId, {
        text: 'Поделитесь своим номером кнопкой или введите его сообщением.',
        reply_markup: { keyboard: [[{ text: 'Поделиться телефоном', request_contact: true }], [{ text: 'Отмена' }]], resize_keyboard: true, one_time_keyboard: true },
      });
      return;
    }
    if (session.stage === 'contact') {
      if (message.contact?.user_id && String(message.contact.user_id) !== userId) {
        await this.reply(session.id, chatId, updateId, reply('Контакт принадлежит другому пользователю. Введите свой номер вручную.'));
        return;
      }
      const phone = String(message.contact?.phone_number || text).trim();
      if (!phone) {
        await this.reply(session.id, chatId, updateId, reply('Введите номер телефона.'));
        return;
      }
      payload.phone = phone.slice(0, 40);
      await this.update(session.id, 'confirm', payload, updateId);
      await this.reply(session.id, chatId, updateId, confirmPrompt(payload, this.options.privacyVersion));
      return;
    }
    if (session.stage === 'confirm') {
      if (text !== confirmText) {
        await this.reply(session.id, chatId, updateId, confirmPrompt(payload, this.options.privacyVersion));
        return;
      }
      try {
        const name = stringValue(payload.name);
        const phone = stringValue(payload.phone);
        const serviceType = stringValue(payload.serviceType);
        const leadMessage = stringValue(payload.message);
        const optional = {
          ...(name ? { name } : {}),
          ...(phone ? { phone } : {}),
          ...(serviceType ? { serviceType } : {}),
          ...(leadMessage ? { message: leadMessage } : {}),
          ...(session.acquisitionCode ? { acquisitionCode: session.acquisitionCode } : {}),
          ...(session.telegramUsername ? { telegramUsername: session.telegramUsername } : {}),
        };
        const result = await this.leads.createExternalLead({
          source: 'telegram', sourceDetail: 'public_bot', externalLeadId: `public:${session.id}`,
          externalEventId: updateId, telegramUserId: userId, telegramChatId: chatId,
          ...optional, consentAt: new Date().toISOString(),
          privacyVersion: this.options.privacyVersion,
          sourceMetadata: { publicBotUsername: this.options.botUsername, sessionId: session.id },
        });
        await this.db.update(telegramPublicSessions).set({ stage: 'submitted', submittedLeadId: result.lead.id,
          lastUpdateId: updateId, updatedAt: new Date() }).where(eq(telegramPublicSessions.id, session.id));
        await this.reply(session.id, chatId, updateId, reply('Заявка принята. Менеджер BelStekloExpert свяжется с вами для уточнения наличия и стоимости.'));
      } catch (error) {
        if (!(error instanceof LeadValidationError)) throw error;
        delete payload.phone;
        await this.update(session.id, 'contact', payload, updateId);
        await this.reply(session.id, chatId, updateId, reply('Не удалось распознать номер. Введите его, например: +375291234567.'));
      }
      return;
    }
    if (session.stage === 'submitted') {
      await this.reply(session.id, chatId, updateId, reply('Эта заявка уже принята. Для новой отправьте /start.'));
    }
  }

  private expiresAt() { return new Date(Date.now() + this.options.ttlHours * 3_600_000); }
  private async update(id: string, stage: string, payload: Record<string, unknown>, updateId: string) {
    await this.db.update(telegramPublicSessions).set({ stage, payload, lastUpdateId: updateId,
      expiresAt: this.expiresAt(), updatedAt: new Date() }).where(eq(telegramPublicSessions.id, id));
  }
  private async reply(sessionId: string | null, chatId: string, updateId: string, payload: Record<string, unknown>) {
    await this.db.insert(telegramPublicOutbox).values({ sessionId, chatId, payload,
      idempotencyKey: `telegram-public:reply:${chatId}:${updateId}` })
      .onConflictDoNothing({ target: telegramPublicOutbox.idempotencyKey });
  }
}

const stringValue = (value: unknown) => typeof value === 'string' && value ? value : undefined;
const reply = (text: string, keyboard?: Array<Array<string>>) => ({ text,
  reply_markup: keyboard ? { keyboard, resize_keyboard: true, one_time_keyboard: true } : { remove_keyboard: true } });
const servicePrompt = (text = 'Какая услуга вам нужна?') => reply(text,
  [['Замена стекла', 'Ремонт скола/трещины'], ['Мобильный выезд', 'Уточнение по VIN'], ['Отмена']]);
const confirmPrompt = (payload: Record<string, unknown>, privacyVersion: string) => reply([
  'Проверьте заявку:', `Услуга: ${stringValue(payload.serviceType) ?? ''}`,
  stringValue(payload.message) ? `Комментарий: ${stringValue(payload.message)}` : '', `Телефон: ${stringValue(payload.phone) ?? ''}`,
  `Подтверждая, вы соглашаетесь на обработку данных (версия ${privacyVersion}).`,
].filter(Boolean).join('\n'), [[confirmText], ['Отмена']]);
