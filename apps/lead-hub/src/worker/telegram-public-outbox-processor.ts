import { and, asc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { GrammyError } from 'grammy';
import type { LeadHubDatabase } from '../db/client.js';
import { telegramPublicOutbox, telegramPublicSubscriptions, type TelegramPublicOutboxJob } from '../db/schema.js';
import type { PublicReplyPayload, TelegramPublicIntegration } from '../integrations/telegram-public.js';

interface Options { pollIntervalMs: number; batchSize: number; maxAttempts: number; processingTimeoutMs: number }

export class TelegramPublicOutboxProcessor {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  constructor(private readonly db: LeadHubDatabase, private readonly telegram: TelegramPublicIntegration,
    private readonly logger: FastifyBaseLogger, private readonly options: Options) {}
  start() { if (this.timer) return; this.timer = setInterval(() => this.trigger(), this.options.pollIntervalMs); this.timer.unref(); this.trigger(); }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = undefined; }
  isActive() { return Boolean(this.timer); }
  async processOnce() {
    if (this.running) return 0;
    this.running = true;
    try {
      const stale = new Date(Date.now() - this.options.processingTimeoutMs);
      await this.db.update(telegramPublicOutbox).set({ status: 'retry', nextAttemptAt: new Date(), updatedAt: new Date() })
        .where(and(eq(telegramPublicOutbox.status, 'processing'), lte(telegramPublicOutbox.updatedAt, stale)));
      const jobs = await this.db.select().from(telegramPublicOutbox)
        .where(and(inArray(telegramPublicOutbox.status, ['pending', 'retry']), lte(telegramPublicOutbox.nextAttemptAt, new Date()),
          sql`not exists (
            select 1 from telegram_public_outbox earlier
            where earlier.chat_id = ${telegramPublicOutbox.chatId}
              and earlier.status in ('pending', 'retry', 'processing')
              and (earlier.created_at, earlier.id) < (${telegramPublicOutbox.createdAt}, ${telegramPublicOutbox.id})
          )`))
        .orderBy(asc(telegramPublicOutbox.createdAt)).limit(this.options.batchSize);
      for (const candidate of jobs) {
        const [job] = await this.db.update(telegramPublicOutbox).set({ status: 'processing', updatedAt: new Date() })
          .where(and(eq(telegramPublicOutbox.id, candidate.id), inArray(telegramPublicOutbox.status, ['pending', 'retry']),
            lte(telegramPublicOutbox.nextAttemptAt, new Date()))).returning();
        if (job) await this.process(job);
      }
      return jobs.length;
    } finally { this.running = false; }
  }
  private trigger() { void this.processOnce().catch(() => this.logger.error('Public Telegram outbox polling failed.')); }
  private async process(job: TelegramPublicOutboxJob) {
    try {
      if (job.subscriptionLeadId) {
        const [active] = await this.db.select({ leadId: telegramPublicSubscriptions.leadId }).from(telegramPublicSubscriptions)
          .where(and(eq(telegramPublicSubscriptions.leadId, job.subscriptionLeadId), isNull(telegramPublicSubscriptions.revokedAt)));
        if (!active) {
          await this.db.update(telegramPublicOutbox).set({ status: 'cancelled', payload: {}, processedAt: new Date(), updatedAt: new Date() })
            .where(eq(telegramPublicOutbox.id, job.id));
          return;
        }
      }
      await this.telegram.sendMessage(job.chatId, job.payload as unknown as PublicReplyPayload);
      await this.db.update(telegramPublicOutbox).set({ status: 'sent', attemptCount: job.attemptCount + 1,
        lastError: null, payload: {}, processedAt: new Date(), updatedAt: new Date() }).where(eq(telegramPublicOutbox.id, job.id));
    } catch (error) {
      const attempts = job.attemptCount + 1;
      const code = error instanceof GrammyError ? error.error_code : 0;
      const retryAfter = error instanceof GrammyError ? (error.parameters.retry_after ?? 0) * 1_000 : 0;
      const dead = code === 400 || code === 403 || attempts >= this.options.maxAttempts;
      const delay = Math.max(retryAfter, Math.min(3_600_000, 2 ** Math.min(attempts, 10) * 1_000));
      await this.db.update(telegramPublicOutbox).set({ status: dead ? 'dead' : 'retry',
        attemptCount: attempts, nextAttemptAt: new Date(Date.now() + delay),
        lastError: code ? `Telegram API ${code}` : 'Telegram delivery failed.', updatedAt: new Date() })
        .where(eq(telegramPublicOutbox.id, job.id));
      if (retryAfter) {
        await this.db.update(telegramPublicOutbox).set({ nextAttemptAt: new Date(Date.now() + delay) })
          .where(and(inArray(telegramPublicOutbox.status, ['pending', 'retry']),
            lte(telegramPublicOutbox.nextAttemptAt, new Date(Date.now() + delay))));
      }
    }
  }
}
