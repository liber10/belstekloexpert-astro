import { and, asc, eq, inArray, lte } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { KufarEmailEvent } from '../contracts/kufar-email.js';
import type { TelegramPublicUpdate } from '../contracts/telegram-public.js';
import type { LeadHubDatabase } from '../db/client.js';
import { integrationInbox, type InboxEvent } from '../db/schema.js';
import { mapKufarEmailToLead } from '../integrations/kufar.js';
import type { LeadService } from '../services/lead-service.js';
import type { TelegramPublicSessionService } from '../services/telegram-public-session-service.js';

interface InboxOptions {
  pollIntervalMs: number;
  batchSize: number;
  maxAttempts: number;
  processingTimeoutMs: number;
}

export class InboxProcessor {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly db: LeadHubDatabase,
    private readonly leadService: LeadService,
    private readonly logger: FastifyBaseLogger,
    private readonly options: InboxOptions,
    private readonly telegramPublic: TelegramPublicSessionService | null = null,
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

  async processOnce() {
    if (this.running) return 0;
    this.running = true;
    try {
      await this.releaseStale();
      const candidates = await this.db.select().from(integrationInbox)
        .where(and(inArray(integrationInbox.status, ['pending', 'retry']), lte(integrationInbox.nextAttemptAt, new Date())))
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
    void this.processOnce().catch((error: unknown) => this.logger.error({ err: error }, 'Inbox polling failed.'));
  }

  private async releaseStale() {
    const staleBefore = new Date(Date.now() - this.options.processingTimeoutMs);
    const released = await this.db.update(integrationInbox)
      .set({ status: 'retry', nextAttemptAt: new Date(), updatedAt: new Date() })
      .where(and(eq(integrationInbox.status, 'processing'), lte(integrationInbox.updatedAt, staleBefore)))
      .returning({ id: integrationInbox.id });
    if (released.length) this.logger.warn({ count: released.length }, 'Stale inbox events released.');
  }

  private async claim(id: string) {
    const [event] = await this.db.update(integrationInbox)
      .set({ status: 'processing', updatedAt: new Date() })
      .where(and(eq(integrationInbox.id, id), inArray(integrationInbox.status, ['pending', 'retry'])))
      .returning();
    return event;
  }

  private async processEvent(event: InboxEvent) {
    try {
      if (event.source === 'kufar' && event.eventType === 'email.received') {
        await this.leadService.createExternalLead(mapKufarEmailToLead(event.payload as KufarEmailEvent));
      } else if (event.source === 'telegram_public' && event.eventType === 'update.received' && this.telegramPublic) {
        await this.telegramPublic.handleUpdate(event.payload as TelegramPublicUpdate);
      } else {
        throw new PermanentInboxError('Unsupported inbox event.');
      }
      await this.db.update(integrationInbox).set({
        status: 'done', attemptCount: event.attemptCount + 1, lastError: null,
        processedAt: new Date(), updatedAt: new Date(),
      }).where(eq(integrationInbox.id, event.id));
    } catch (error) {
      const attempts = event.attemptCount + 1;
      const dead = error instanceof PermanentInboxError || attempts >= this.options.maxAttempts;
      const message = safeError(error);
      await this.db.update(integrationInbox).set({
        status: dead ? 'dead' : 'retry', attemptCount: attempts,
        nextAttemptAt: new Date(Date.now() + retryDelayMs(attempts)),
        lastError: message, updatedAt: new Date(),
      }).where(eq(integrationInbox.id, event.id));
      this.logger.warn({ inboxId: event.id, source: event.source, attempts, dead, error: message }, 'Inbox processing failed.');
    }
  }
}

class PermanentInboxError extends Error {}
const retryDelayMs = (attempt: number) => Math.min(3_600_000, 2 ** Math.min(attempt, 10) * 1_000);
const safeError = (error: unknown) => (error instanceof Error ? error.message : 'Unknown inbox error.')
  .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 1_000);
