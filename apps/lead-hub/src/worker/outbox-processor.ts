import { and, asc, eq, inArray, lte } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { LeadHubDatabase } from '../db/client.js';
import { integrationOutbox, leadEvents, leads, type OutboxJob } from '../db/schema.js';
import type { TelegramDelivery } from '../integrations/telegram/index.js';
import type { LeadService } from '../services/lead-service.js';

interface OutboxOptions {
  pollIntervalMs: number;
  batchSize: number;
  maxAttempts: number;
  processingTimeoutMs: number;
  deliveryTimeoutMs: number;
}

export class OutboxProcessor {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly db: LeadHubDatabase,
    private readonly leadService: LeadService,
    private readonly telegram: TelegramDelivery,
    private readonly logger: FastifyBaseLogger,
    private readonly options: OutboxOptions,
  ) {}

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.trigger();
    }, this.options.pollIntervalMs);
    this.timer.unref();
    this.trigger();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  isActive() {
    return Boolean(this.timer);
  }

  async processOnce() {
    if (this.running) return 0;
    this.running = true;

    try {
      await this.releaseStaleJobs();
      const candidates = await this.db
        .select()
        .from(integrationOutbox)
        .where(
          and(
            inArray(integrationOutbox.status, ['pending', 'retry']),
            lte(integrationOutbox.nextAttemptAt, new Date()),
          ),
        )
        .orderBy(asc(integrationOutbox.createdAt))
        .limit(this.options.batchSize);

      let processed = 0;
      for (const candidate of candidates) {
        const job = await this.claim(candidate.id);
        if (!job) continue;
        await this.processJob(job);
        processed += 1;
      }
      return processed;
    } finally {
      this.running = false;
    }
  }

  private trigger() {
    void this.processOnce().catch((error: unknown) => {
      this.logger.error({ err: error }, 'Outbox polling failed.');
    });
  }

  private async releaseStaleJobs() {
    const staleBefore = new Date(Date.now() - this.options.processingTimeoutMs);
    const released = await this.db
      .update(integrationOutbox)
      .set({
        status: 'retry',
        nextAttemptAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(integrationOutbox.status, 'processing'),
          lte(integrationOutbox.updatedAt, staleBefore),
        ),
      )
      .returning({ id: integrationOutbox.id });

    if (released.length) {
      this.logger.warn({ count: released.length }, 'Stale outbox jobs released for retry.');
    }
  }

  private async claim(jobId: string) {
    const [job] = await this.db
      .update(integrationOutbox)
      .set({ status: 'processing', updatedAt: new Date() })
      .where(
        and(
          eq(integrationOutbox.id, jobId),
          inArray(integrationOutbox.status, ['pending', 'retry']),
        ),
      )
      .returning();
    return job;
  }

  private async processJob(job: OutboxJob) {
    try {
      if (job.destination !== 'telegram') throw new Error('Unsupported outbox destination.');
      const lead = await this.leadService.getLead(job.leadId);
      const correlationId = typeof job.payload.correlationId === 'string'
        ? job.payload.correlationId
        : lead.idempotencyKey;

      if (job.eventType === 'lead.created') {
        const message = lead.telegramMessageId && lead.telegramChatId
          ? { chatId: lead.telegramChatId, messageId: lead.telegramMessageId }
          : await withTimeout(this.telegram.sendLeadCard(lead), this.options.deliveryTimeoutMs);
        await this.db.transaction(async (transaction) => {
          await transaction.update(leads).set({
            telegramChatId: message.chatId,
            telegramMessageId: message.messageId,
            updatedAt: new Date(),
          }).where(eq(leads.id, lead.id));
          await transaction.update(integrationOutbox).set({
            status: 'sent', attemptCount: job.attemptCount + 1, lastError: null,
            processedAt: new Date(), updatedAt: new Date(),
          }).where(eq(integrationOutbox.id, job.id));
          await transaction.insert(leadEvents).values({
            leadId: lead.id,
            eventType: 'telegram_sent',
            source: 'outbox',
            payload: { correlationId, outboxJobId: job.id, messageId: message.messageId },
          });
        });
      } else if (job.eventType === 'lead.status_changed') {
        await withTimeout(this.telegram.editLeadCard(lead), this.options.deliveryTimeoutMs);
      } else {
        throw new Error('Unsupported Telegram outbox event.');
      }

      if (job.eventType !== 'lead.created') {
        await this.db.update(integrationOutbox).set({ status: 'sent', attemptCount: job.attemptCount + 1,
          lastError: null, processedAt: new Date(), updatedAt: new Date() })
          .where(eq(integrationOutbox.id, job.id));
      }

      this.logger.info({ jobId: job.id, leadId: job.leadId, correlationId }, 'Outbox job delivered.');
    } catch (error) {
      const attempts = job.attemptCount + 1;
      const dead = attempts >= this.options.maxAttempts;
      const nextAttemptAt = new Date(Date.now() + retryDelayMs(attempts));
      const message = safeErrorMessage(error);

      await this.db
        .update(integrationOutbox)
        .set({
          status: dead ? 'dead' : 'retry',
          attemptCount: attempts,
          nextAttemptAt,
          lastError: message,
          updatedAt: new Date(),
        })
        .where(eq(integrationOutbox.id, job.id));

      await this.db.insert(leadEvents).values({
        leadId: job.leadId,
        eventType: dead ? 'telegram_dead' : 'telegram_retry',
        source: 'outbox',
        payload: {
          correlationId: typeof job.payload.correlationId === 'string' ? job.payload.correlationId : undefined,
          outboxJobId: job.id,
          attempt: attempts,
        },
      });

      this.logger.warn(
        { jobId: job.id, leadId: job.leadId, attempts, dead, error: message },
        'Outbox delivery failed.',
      );
    }
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Telegram delivery timed out.')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function retryDelayMs(attempt: number) {
  return Math.min(60 * 60 * 1_000, 2 ** Math.min(attempt, 10) * 1_000);
}

function safeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : 'Unknown integration error.';
  return message.replace(/bot\d+:[A-Za-z0-9_-]+/g, 'bot[redacted]').slice(0, 1_000);
}
