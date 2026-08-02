import { and, asc, eq, inArray, lte } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { LeadHubDatabase } from '../db/client.js';
import { telegramPublicOutbox, type TelegramPublicOutboxJob } from '../db/schema.js';
import type { PublicReplyPayload, TelegramPublicIntegration } from '../integrations/telegram-public.js';

interface Options { pollIntervalMs: number; batchSize: number; maxAttempts: number; processingTimeoutMs: number }

export class TelegramPublicOutboxProcessor {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  constructor(private readonly db: LeadHubDatabase, private readonly telegram: TelegramPublicIntegration,
    private readonly logger: FastifyBaseLogger, private readonly options: Options) {}
  start() { if (this.timer) return; this.timer = setInterval(() => this.trigger(), this.options.pollIntervalMs); this.timer.unref(); this.trigger(); }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = undefined; }
  async processOnce() {
    if (this.running) return 0;
    this.running = true;
    try {
      const stale = new Date(Date.now() - this.options.processingTimeoutMs);
      await this.db.update(telegramPublicOutbox).set({ status: 'retry', nextAttemptAt: new Date(), updatedAt: new Date() })
        .where(and(eq(telegramPublicOutbox.status, 'processing'), lte(telegramPublicOutbox.updatedAt, stale)));
      const jobs = await this.db.select().from(telegramPublicOutbox)
        .where(and(inArray(telegramPublicOutbox.status, ['pending', 'retry']), lte(telegramPublicOutbox.nextAttemptAt, new Date())))
        .orderBy(asc(telegramPublicOutbox.createdAt)).limit(this.options.batchSize);
      for (const candidate of jobs) {
        const [job] = await this.db.update(telegramPublicOutbox).set({ status: 'processing', updatedAt: new Date() })
          .where(and(eq(telegramPublicOutbox.id, candidate.id), inArray(telegramPublicOutbox.status, ['pending', 'retry']))).returning();
        if (job) await this.process(job);
      }
      return jobs.length;
    } finally { this.running = false; }
  }
  private trigger() { void this.processOnce().catch((error: unknown) => this.logger.error({ err: error }, 'Public Telegram outbox polling failed.')); }
  private async process(job: TelegramPublicOutboxJob) {
    try {
      await this.telegram.sendMessage(job.chatId, job.payload as unknown as PublicReplyPayload);
      await this.db.update(telegramPublicOutbox).set({ status: 'sent', attemptCount: job.attemptCount + 1,
        lastError: null, processedAt: new Date(), updatedAt: new Date() }).where(eq(telegramPublicOutbox.id, job.id));
    } catch (error) {
      const attempts = job.attemptCount + 1;
      await this.db.update(telegramPublicOutbox).set({ status: attempts >= this.options.maxAttempts ? 'dead' : 'retry',
        attemptCount: attempts, nextAttemptAt: new Date(Date.now() + Math.min(3_600_000, 2 ** Math.min(attempts, 10) * 1_000)),
        lastError: safeError(error), updatedAt: new Date() })
        .where(eq(telegramPublicOutbox.id, job.id));
    }
  }
}

const safeError = (error: unknown) => (error instanceof Error ? error.message : 'Unknown public Telegram error')
  .replace(/bot\d+:[A-Za-z0-9_-]+/g, 'bot[redacted]')
  .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
  .slice(0, 1_000);
