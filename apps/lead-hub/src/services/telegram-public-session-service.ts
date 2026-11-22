import { createHash, randomUUID } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { TelegramPublicUpdate } from '../contracts/telegram-public.js';
import type { LeadHubDatabase, LeadHubTransaction } from '../db/client.js';
import { telegramPublicActivity, telegramPublicOutbox, telegramPublicSessions,
  telegramPublicSubscriptions, type TelegramPublicSession } from '../db/schema.js';
import { normalizeBelarusPhone } from '../domain/phone.js';
import { maxStoredPhotoSizeBytes, type ObjectStorage } from '../integrations/object-storage.js';
import { InvalidTelegramPhoto, type TelegramPublicIntegration } from '../integrations/telegram-public.js';
import type { LeadService } from './lead-service.js';

const replace = 'Замена стекла';
const repair = 'Ремонт скола';
const agree = 'Согласен и хочу продолжить';
const submit = 'Отправить заявку';
const submitWithUpdates = 'Отправить и получать статусы';
const skip = 'Пропустить';
const back = 'Назад';
const cancel = 'Отмена';
const human = 'Позвонить мастеру';
const glassChoices = ['Лобовое', 'Боковое', 'Заднее', 'Другое'];
const acquisitionPattern = /^[A-Za-z0-9_-]{1,64}$/;
const consentText = 'Для подготовки ответа на заявку мы обработаем сведения об автомобиле, контакт и фото, если вы его отправите.';
type Stage = 'consent' | 'service' | 'make' | 'model' | 'year' | 'glass' | 'photo' | 'comment' | 'contact' | 'confirm';
type Message = NonNullable<TelegramPublicUpdate['message']>;

interface Options {
  ttlHours: number;
  privacyVersion: string;
  privacyUrl: string;
  supportPhone: string;
  timeoutMs: number;
}

export class TelegramPublicSessionService {
  constructor(
    private readonly db: LeadHubDatabase,
    private readonly leads: LeadService,
    private readonly telegram: TelegramPublicIntegration,
    private readonly storage: ObjectStorage | null,
    private readonly options: Options,
  ) {}

  async handleUpdate(update: TelegramPublicUpdate, receivedAt: Date) {
    const message = update.message;
    if (!message?.from || message.chat.type !== 'private' || message.chat.id !== message.from.id) return;
    const chatId = String(message.chat.id);
    const updateId = String(update.update_id);
    const key = `telegram-public:reply:${chatId}:${updateId}`;
    const text = message.text?.trim() ?? '';
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'telegram-public:' + chatId}, 0))`);
      const [processed] = await tx.select({ id: telegramPublicOutbox.id }).from(telegramPublicOutbox)
        .where(eq(telegramPublicOutbox.idempotencyKey, key)).limit(1);
      if (processed) return;

      const [session] = await tx.select().from(telegramPublicSessions)
        .where(eq(telegramPublicSessions.telegramChatId, chatId)).limit(1);
      const send = (payload: Record<string, unknown>) => tx.insert(telegramPublicOutbox).values({
        sessionId: session?.id ?? null, chatId, payload, idempotencyKey: key,
      });

      if (text === '/stop_notifications') {
        await tx.update(telegramPublicSubscriptions).set({ revokedAt: receivedAt }).where(and(
          eq(telegramPublicSubscriptions.chatId, chatId), isNull(telegramPublicSubscriptions.revokedAt),
        ));
        await send(reply('Уведомления по вашим заявкам отключены.'));
        return;
      }
      if (text === '/info') {
        const website = new URL(this.options.privacyUrl).origin;
        await send(reply(`Замена автостёкол и ремонт сколов.\nСайт: ${website}\nСвязаться с мастером: ${this.options.supportPhone}\nНовая заявка: /start.`));
        return;
      }

      const start = /^\/start(?:\s+(\S+))?$/.exec(text);
      if (start) {
        const acquisitionCode = start[1] && acquisitionPattern.test(start[1]) ? start[1] : null;
        const fields = {
          stage: 'consent', payload: { requestId: randomUUID(), privacyVersion: this.options.privacyVersion },
          acquisitionCode, lastUpdateId: updateId, submittedLeadId: null, telegramUsername: null,
          expiresAt: this.expiresAt(), updatedAt: new Date(),
        };
        await tx.insert(telegramPublicSessions).values({ telegramUserId: chatId, telegramChatId: chatId, ...fields })
          .onConflictDoUpdate({ target: telegramPublicSessions.telegramChatId, set: fields });
        await this.activity(tx, updateId, 'started', acquisitionCode, receivedAt);
        await send(this.prompt('consent', fields.payload));
        return;
      }

      if (text === human || text === '/help') {
        const assistance = `Связаться с мастером: ${this.options.supportPhone}\nДля новой заявки отправьте /start.`;
        await send(session && session.stage in prompts && session.expiresAt > new Date()
          ? this.prompt(session.stage as Stage, session.payload, assistance) : reply(assistance));
        return;
      }
      if (!session || session.expiresAt <= new Date() || session.stage === 'expired') {
        await send(reply('Отправьте /start, чтобы начать заявку.'));
        return;
      }
      if (session.stage === 'submitted' || session.stage === 'cancelled') {
        await send(reply(session.stage === 'submitted'
          ? 'Заявка уже принята. Для новой отправьте /start.'
          : 'Заполнение отменено. Для новой заявки отправьте /start.'));
        return;
      }
      if (text === cancel || text === '/cancel') {
        await this.update(tx, session.id, 'cancelled', {}, updateId);
        await send(reply('Заполнение отменено. Для новой заявки отправьте /start.'));
        return;
      }

      const payload = { ...session.payload };
      const stage = session.stage as Stage;
      if (payload.privacyVersion !== this.options.privacyVersion) {
        await this.update(tx, session.id, 'expired', {}, updateId);
        await send(reply('Для продолжения отправьте /start и ознакомьтесь с актуальной политикой.'));
        return;
      }
      if (text === back) {
        const previous = flow(payload.serviceType === repair)[flow(payload.serviceType === repair).indexOf(stage) - 1];
        if (previous) {
          const edited = stageField[previous];
          if (edited) delete payload[edited];
          await this.update(tx, session.id, previous, payload, updateId);
          await send(this.prompt(previous, payload));
          return;
        }
      }
      if (stage === 'consent' && text === agree) {
        payload.consentAt = receivedAt.toISOString();
        payload.consentHash = createHash('sha256').update(this.consentNotice()).digest('hex');
        await this.activity(tx, updateId, 'begun', session.acquisitionCode, receivedAt);
      }
      if (stage === 'confirm' && (text === submit || text === submitWithUpdates)) {
        let photoRef: string | undefined;
        if (typeof payload.photo === 'string') {
          try {
            photoRef = await this.storePhoto(String(payload.requestId), payload.photo, receivedAt);
          } catch (error) {
            if (!(error instanceof InvalidTelegramPhoto)) throw error;
            delete payload.photo;
            await this.update(tx, session.id, 'photo', payload, updateId);
            await send(this.prompt('photo', payload, 'Не удалось прочитать фото. Пришлите другой снимок.'));
            return;
          }
        }
        const lead = await this.leads.createExternalLead({
          source: 'telegram', sourceDetail: 'public_bot', externalLeadId: `public:${String(payload.requestId)}`,
          externalEventId: updateId, phone: String(payload.phone), serviceType: String(payload.serviceType),
          carMake: String(payload.make), carModel: String(payload.model),
          ...(typeof payload.year === 'number' ? { carYear: payload.year } : {}),
          ...(typeof payload.glass === 'string' ? { damageType: payload.glass } : {}),
          ...(typeof payload.comment === 'string' ? { message: payload.comment } : {}),
          ...(photoRef ? { photoRefs: [photoRef] } : {}),
          ...(session.acquisitionCode ? { acquisitionCode: session.acquisitionCode } : {}),
          consentAt: String(payload.consentAt), privacyVersion: this.options.privacyVersion,
          consentVersion: this.options.privacyVersion, consentTextHash: String(payload.consentHash),
        }, tx);
        if (text === submitWithUpdates) {
          await tx.insert(telegramPublicSubscriptions).values({ leadId: lead.lead.id, chatId, optedInAt: receivedAt });
        }
        await this.update(tx, session.id, 'submitted', {}, updateId, lead.lead.id);
        const notification = text === submitWithUpdates ? '\nОтказ от уведомлений: /stop_notifications.' : '';
        await send(reply(`Заявка #${lead.lead.publicId} принята. Специалист свяжется с вами для уточнения деталей.${notification}`));
        return;
      }

      const value = stageValue(stage, message, text, receivedAt, payload.serviceType === repair);
      if (value === undefined) {
        await send(this.prompt(stage, payload, 'Проверьте ввод и попробуйте ещё раз.'));
        return;
      }
      const field = stageField[stage];
      if (stage === 'service') {
        delete payload.year;
        delete payload.glass;
        delete payload.photo;
      }
      if (field) payload[field] = value;
      const steps = flow(payload.serviceType === repair);
      const next = steps[steps.indexOf(stage) + 1];
      if (!next) {
        await send(reply('Отправьте /start, чтобы начать заявку.'));
        return;
      }
      await this.update(tx, session.id, next, payload, updateId);
      await send(this.prompt(next, payload));
    });
  }

  private async storePhoto(requestId: string, fileId: string, receivedAt: Date) {
    if (!this.storage) throw new Error('Private photo storage is unavailable.');
    const bytes = await this.telegram.downloadPhoto(fileId);
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
      throw new InvalidTelegramPhoto();
    }
    const [prepared] = await this.storage.prepareUploads(requestId, [{
      contentType: 'image/jpeg', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
    }], receivedAt);
    if (!prepared) throw new Error('Private photo preparation failed.');
    const response = await fetch(prepared.uploadUrl, {
      method: 'PUT', headers: prepared.headers, body: new Uint8Array(bytes),
      signal: AbortSignal.timeout(this.options.timeoutMs), redirect: 'error',
    });
    await response.body?.cancel();
    if (!response.ok) throw new Error('Private photo upload failed.');
    return prepared.ref;
  }

  private expiresAt() { return new Date(Date.now() + this.options.ttlHours * 3_600_000); }

  private async update(tx: LeadHubTransaction, id: string, stage: string, payload: Record<string, unknown>,
    lastUpdateId: string, submittedLeadId?: string) {
    await tx.update(telegramPublicSessions).set({
      stage, payload, lastUpdateId, submittedLeadId, expiresAt: this.expiresAt(), updatedAt: new Date(),
    }).where(eq(telegramPublicSessions.id, id));
  }

  private async activity(tx: LeadHubTransaction, updateId: string, kind: string,
    acquisitionCode: TelegramPublicSession['acquisitionCode'], createdAt: Date) {
    await tx.insert(telegramPublicActivity).values({ updateId, kind, acquisitionCode, createdAt }).onConflictDoNothing();
  }

  private consentNotice() {
    return `${consentText}\nПолитика обработки данных: ${this.options.privacyUrl}\nВерсия: ${this.options.privacyVersion}`;
  }

  private prompt(stage: Stage, payload: Record<string, unknown>, error?: string) {
    const description = stage === 'consent' ? this.consentNotice() : stage === 'confirm' ? [
        'Проверьте заявку', payload.serviceType, [payload.make, payload.model, payload.year].filter(Boolean).join(' '),
        payload.glass, payload.photo && 'Фото приложено', payload.comment, payload.phone,
      ].filter(Boolean).join('\n') : prompts[stage];
    const controls: Array<Array<string | Record<string, unknown>>> = {
      consent: [[agree]],
      service: [[replace, repair]],
      glass: [[...glassChoices.slice(0, 2)], [...glassChoices.slice(2)]],
      contact: [[{ text: 'Поделиться телефоном', request_contact: true }]],
      comment: [[skip]],
      confirm: [[submit], [submitWithUpdates]],
    }[stage as string] ?? [];
    if (stage === 'year' && payload.serviceType === repair) controls.push([skip]);
    return reply([error, description].filter(Boolean).join('\n'), [
      ...controls, stage === 'consent' ? [human, cancel] : [back, cancel], ...(stage === 'consent' ? [] : [[human]]),
    ]);
  }
}

const prompts: Record<Stage, string> = {
  consent: '', confirm: '',
  service: 'Какая услуга вам нужна?',
  make: 'Укажите марку автомобиля.',
  model: 'Укажите модель автомобиля.',
  year: 'Укажите год выпуска четырьмя цифрами.',
  glass: 'Какое стекло нужно заменить?',
  photo: 'Отправьте один чёткий снимок повреждения как фото Telegram.',
  comment: 'Добавьте детали, если нужно. Для замены можно указать камеру, датчик дождя или обогрев.',
  contact: 'Поделитесь своим номером или введите его вручную.',
};

const stageField: Partial<Record<Stage, string>> = {
  service: 'serviceType', make: 'make', model: 'model', year: 'year', glass: 'glass',
  photo: 'photo', comment: 'comment', contact: 'phone',
};

function flow(chip: boolean): Stage[] {
  return ['consent', 'service', 'make', 'model', 'year', chip ? 'photo' : 'glass',
    'comment', 'contact', 'confirm'];
}

function stageValue(stage: Stage, message: Message, text: string, receivedAt: Date, chip: boolean) {
  switch (stage) {
    case 'consent': return text === agree ? true : undefined;
    case 'service': return text === replace || text === repair ? text : undefined;
    case 'make':
    case 'model': return text && text.length <= 120 && !text.startsWith('/') ? text : undefined;
    case 'year': {
      if (chip && text === skip) return null;
      return /^\d{4}$/.test(text) && +text >= 1900 && +text <= receivedAt.getUTCFullYear() + 1 ? +text : undefined;
    }
    case 'glass': return glassChoices.includes(text) ? text : undefined;
    case 'photo': return message.photo?.findLast((size) => (size.file_size ?? 0) <= maxStoredPhotoSizeBytes)?.file_id;
    case 'comment': return text === skip ? null : text && text.length <= 2_000 && !text.startsWith('/') ? text : undefined;
    case 'contact': {
      if (message.contact && message.contact.user_id !== message.from?.id) return undefined;
      try { return normalizeBelarusPhone(message.contact?.phone_number ?? text); } catch { return undefined; }
    }
    default: return undefined;
  }
}

const reply = (text: string, keyboard?: Array<Array<string | Record<string, unknown>>>) => ({
  text, reply_markup: keyboard ? { keyboard, resize_keyboard: true } : { remove_keyboard: true },
});
