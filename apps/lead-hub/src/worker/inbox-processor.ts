import { and, asc, eq, inArray, lte, notInArray, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { GrammyError } from 'grammy';
import type { KufarEmailEvent } from '../contracts/kufar-email.js';
import type { TelegramPublicUpdate } from '../contracts/telegram-public.js';
import type { LeadHubDatabase } from '../db/client.js';
import { integrationInbox, telegramPublicSessions, type InboxEvent } from '../db/schema.js';
import { mapKufarEmailToLead } from '../integrations/kufar.js';
import { metaMessageToLeadInput, parseMetaMessageEvent } from '../integrations/meta-messaging.js';
import type { LeadService } from '../services/lead-service.js';
import type { TelegramPublicSessionService } from '../services/telegram-public-session-service.js';
import type { InstagramMessageService } from '../services/instagram-message-service.js';
import type { TelegramIntegration } from '../integrations/telegram/index.js';

interface InboxOptions {
  pollIntervalMs: number;
  batchSize: number;
  maxAttempts: number;
  processingTimeoutMs: number;
}

type InboxHandlers = {
  telegramPublic: TelegramPublicSessionService;
} | {
  telegramStaff: TelegramIntegration;
} | {
  instagramMessages: InstagramMessageService;
};

export class InboxProcessor {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly db: LeadHubDatabase,
    private readonly leadService: LeadService,
    private readonly logger: FastifyBaseLogger,
    private readonly options: InboxOptions,
    private readonly handlers: InboxHandlers,
  ) {}

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.trigger(), this.options.pollIntervalMs);
    this.timer.unref();
    this.trigger();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private get scope() {
    if ('telegramPublic' in this.handlers) return eq(integrationInbox.source, 'telegram_public');
    if ('telegramStaff' in this.handlers) return eq(integrationInbox.source, 'telegram_staff');
    return notInArray(integrationInbox.source, ['telegram_public', 'telegram_staff']);
  }

  async processOnce() {
    if (this.running) return 0;
    this.running = true;
    try {
      await this.releaseStale();
      if ('telegramPublic' in this.handlers) {
        await this.db.update(telegramPublicSessions).set({ stage: 'expired', payload: {} })
          .where(and(lte(telegramPublicSessions.expiresAt, sql`now()`), sql`${telegramPublicSessions.stage} <> 'expired'`));
      }
      const candidates = await this.db.select().from(integrationInbox)
        .where(and(this.scope, inArray(integrationInbox.status, ['pending', 'retry']), lte(integrationInbox.nextAttemptAt, sql`now()`),
          'telegramPublic' in this.handlers ? sql`not exists (
              select 1 from integration_inbox earlier
              where earlier.source = 'telegram_public'
                and earlier.status in ('pending', 'retry', 'processing')
                and earlier.payload #>> '{message,chat,id}' = ${integrationInbox.payload} #>> '{message,chat,id}'
                and (earlier.created_at, earlier.id) < (${integrationInbox.createdAt}, ${integrationInbox.id})
          )` : undefined))
        .orderBy(asc(integrationInbox.createdAt)).limit(this.options.batchSize);
      let processed = 0;
      for (const candidate of candidates) {
        const event = await this.claim(candidate.id);
        if (!event) continue;
        await this.processEvent(event);
        processed += 1;
      }
      return processed;
    } finally {
      this.running = false;
    }
  }

  private trigger() {
    void this.processOnce().catch(() => this.logger.error('Inbox polling failed; durable events retained.'));
  }

  private async releaseStale() {
    const staleBefore = new Date(Date.now() - this.options.processingTimeoutMs);
    const released = await this.db.update(integrationInbox)
      .set({ status: 'retry', nextAttemptAt: new Date(), updatedAt: new Date() })
      .where(and(this.scope, eq(integrationInbox.status, 'processing'), lte(integrationInbox.updatedAt, staleBefore)))
      .returning({ id: integrationInbox.id });
    if (released.length) this.logger.warn({ count: released.length }, 'Stale inbox events released.');
  }

  private async claim(id: string) {
    const [event] = await this.db.update(integrationInbox)
      .set({ status: 'processing', updatedAt: new Date() })
      .where(and(eq(integrationInbox.id, id), inArray(integrationInbox.status, ['pending', 'retry']), lte(integrationInbox.nextAttemptAt, sql`now()`)))
      .returning();
    return event;
  }

  private async processEvent(event: InboxEvent) {
    try {
      if (event.source === 'kufar' && event.eventType === 'email.received') {
        await this.leadService.createExternalLead(mapKufarEmailToLead(event.payload as KufarEmailEvent));
      } else if (event.source === 'meta' && event.eventType === 'message.received') {
        const message = parseMetaMessageEvent(event.payload);
        if (!message) throw new PermanentInboxError('Invalid Meta message event.');
        if (message.platform === 'instagram' && 'instagramMessages' in this.handlers) {
          await this.handlers.instagramMessages.accept(message, event.createdAt);
        } else {
          await this.leadService.createExternalLead(metaMessageToLeadInput(message));
        }
      } else if (event.source === 'telegram_public' && event.eventType === 'update.received' && 'telegramPublic' in this.handlers) {
        await this.handlers.telegramPublic.handleUpdate(event.payload as TelegramPublicUpdate, event.createdAt);
      } else if (event.source === 'telegram_staff' && event.eventType === 'update.received' && 'telegramStaff' in this.handlers) {
        const updateId = event.payload.update_id;
        if (typeof updateId !== 'number') throw new PermanentInboxError('Invalid Telegram staff update.');
        await this.handlers.telegramStaff.handleUpdate({ ...event.payload, update_id: updateId });
      } else {
        throw new PermanentInboxError('Unsupported inbox event.');
      }
      await this.db.update(integrationInbox).set({
        status: 'done', attemptCount: event.attemptCount + 1, lastError: null,
        processedAt: new Date(), updatedAt: new Date(),
        ...(['telegram_public', 'telegram_staff'].includes(event.source) ? { payload: { update_id: event.externalEventId } } : {}),
      }).where(eq(integrationInbox.id, event.id));
    } catch (error) {
      const attempts = event.attemptCount + 1;
      const dead = error instanceof PermanentInboxError || attempts >= this.options.maxAttempts;
      const message = safeError(error);
      const retryAfter = error instanceof GrammyError ? (error.parameters.retry_after ?? 0) * 1_000 : 0;
      await this.db.update(integrationInbox).set({
        status: dead ? 'dead' : 'retry', attemptCount: attempts,
        nextAttemptAt: new Date(Date.now() + Math.max(retryDelayMs(attempts), retryAfter)),
        lastError: message, updatedAt: new Date(),
      }).where(eq(integrationInbox.id, event.id));
      this.logger.warn({ inboxId: event.id, source: event.source, attempts, dead, error: message }, 'Inbox processing failed.');
    }
  }
}

class PermanentInboxError extends Error {}
const retryDelayMs = (attempt: number) => Math.min(3_600_000, 2 ** Math.min(attempt, 10) * 1_000);
const safeError = (error: unknown) => error instanceof PermanentInboxError ? error.message : 'Inbox persistence or processing failed.';
