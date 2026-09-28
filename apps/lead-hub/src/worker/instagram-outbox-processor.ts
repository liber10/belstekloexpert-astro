import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { AppConfig } from '../config.js';
import type { LeadHubDatabase } from '../db/client.js';
import { integrationOutbox, leadEvents, leads, type OutboxJob } from '../db/schema.js';
import { InstagramDeliveryError, type InstagramDelivery } from '../integrations/instagram-messaging.js';
import type { InstagramConversationGuard } from '../integrations/instagram-conversation-guard.js';

export class InstagramOutboxProcessor {
  private timer: NodeJS.Timeout | undefined;
  private activeRun: Promise<number> | undefined;
  constructor(private readonly db: LeadHubDatabase, private readonly delivery: InstagramDelivery,
    private readonly history: InstagramConversationGuard,
    private readonly logger: FastifyBaseLogger, private readonly options: AppConfig['outbox'],
    private readonly accountId: string, private readonly startAt = 0) {}

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.trigger(), this.options.pollIntervalMs);
    this.timer.unref();
    this.trigger();
  }
  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.activeRun;
  }
  isActive() { return Boolean(this.timer); }
  async processOnce() {
    if (this.activeRun) return 0;
    this.activeRun = this.run();
    try { return await this.activeRun; } finally { this.activeRun = undefined; }
  }
  private trigger() {
    void this.processOnce().catch(() => this.logger.error('Instagram outbox polling failed; durable jobs retained.'));
  }
  private owned(job: OutboxJob) {
    return and(eq(integrationOutbox.id, job.id), eq(integrationOutbox.destination, 'instagram'),
      eq(integrationOutbox.status, 'sending'), eq(integrationOutbox.attemptCount, job.attemptCount));
  }
  private async run() {
    const stale = await this.db.select().from(integrationOutbox).where(and(
      eq(integrationOutbox.destination, 'instagram'), eq(integrationOutbox.status, 'sending'),
      lte(integrationOutbox.updatedAt, new Date(Date.now() - this.options.processingTimeoutMs)),
    )).limit(this.options.batchSize);
    for (const job of stale) await this.fail(job, new InstagramDeliveryError('interrupted_send_outcome_unknown', 'unknown'));

    const candidates = await this.db.select().from(integrationOutbox).where(and(
      eq(integrationOutbox.destination, 'instagram'), inArray(integrationOutbox.status, ['pending', 'retry']),
      lte(integrationOutbox.nextAttemptAt, sql`now()`),
    )).orderBy(asc(integrationOutbox.createdAt)).limit(this.options.batchSize);
    let processed = 0;
    for (const candidate of candidates) {
      const job = await this.db.transaction(async (tx) => {
        const [claimed] = await tx.update(integrationOutbox).set({ status: 'sending',
          attemptCount: sql`${integrationOutbox.attemptCount} + 1`, updatedAt: new Date() })
          .where(and(eq(integrationOutbox.id, candidate.id), eq(integrationOutbox.destination, 'instagram'),
            inArray(integrationOutbox.status, ['pending', 'retry']), lte(integrationOutbox.nextAttemptAt, sql`now()`)))
          .returning();
        if (claimed) await tx.insert(leadEvents).values({ leadId: claimed.leadId,
          source: 'instagram_outbox', eventType: 'instagram_send_started',
          payload: { outboxId: claimed.id, attempt: claimed.attemptCount } });
        return claimed;
      });
      if (!job) continue;
      await this.deliver(job);
      processed += 1;
    }
    return processed;
  }
  private async deliver(job: OutboxJob) {
    const payload = job.payload;
    const invalid = job.eventType !== 'instagram.first_reply' || payload.accountId !== this.accountId
      || typeof payload.recipientId !== 'string' || !/^\d+$/.test(payload.recipientId)
      || typeof payload.inboundMessageId !== 'string' || !payload.inboundMessageId
      || typeof payload.text !== 'string' || !payload.text.trim() || payload.text.length > 1000
      || typeof payload.expiresAt !== 'number' || !Number.isFinite(payload.expiresAt);
    if (invalid || typeof payload.timestamp !== 'number' || payload.timestamp < this.startAt
      || Number(payload.expiresAt) <= Date.now()
      || Date.now() - job.updatedAt.getTime() >= this.options.deliveryTimeoutMs) {
      await this.fail(job, new InstagramDeliveryError(invalid ? 'invalid_job' : 'window_or_claim_expired', 'permanent'));
      return;
    }
    const verdict = await this.history.inspectFirstMessage(payload.recipientId as string,
      payload.inboundMessageId as string).catch(() => 'unverified' as const);
    if (verdict !== 'first') {
      await this.fail(job, new InstagramDeliveryError(verdict === 'existing'
        ? 'conversation_changed_before_send' : 'conversation_unverified_before_send', 'permanent'));
      return;
    }
    const [lead] = await this.db.select({ status: leads.status, firstResponseAt: leads.firstResponseAt })
      .from(leads).where(eq(leads.id, job.leadId)).limit(1);
    if (!lead || lead.status !== 'new' || lead.firstResponseAt
      || Number(payload.expiresAt) <= Date.now()
      || Date.now() - job.updatedAt.getTime() >= this.options.deliveryTimeoutMs) {
      await this.fail(job, new InstagramDeliveryError('lead_taken_over_or_claim_expired', 'permanent'));
      return;
    }
    let result: { messageId: string };
    try {
      result = await this.delivery.sendText(payload.recipientId as string, payload.text as string);
    } catch (error) {
      await this.fail(job, error instanceof InstagramDeliveryError ? error
        : new InstagramDeliveryError('unexpected_send_outcome_unknown', 'unknown'));
      return;
    }
    // DB failures after a successful send must NOT enter a resend path.
    await this.db.transaction(async (tx) => {
      const changed = await tx.update(integrationOutbox).set({ status: 'sent', processedAt: new Date(),
        updatedAt: new Date(), lastError: null, payload: { ...payload, providerMessageId: result.messageId } })
        .where(this.owned(job)).returning({ id: integrationOutbox.id });
      await tx.insert(leadEvents).values({ leadId: job.leadId, source: 'instagram_outbox',
        eventType: changed.length ? 'instagram_sent' : 'instagram_late_send_result',
        payload: { outboxId: job.id, providerMessageId: result.messageId, attempt: job.attemptCount } });
    });
  }
  private async fail(job: OutboxJob, error: InstagramDeliveryError) {
    const delay = Math.max(error.retryAfterMs, Math.min(3_600_000, 2 ** Math.min(job.attemptCount, 10) * 1000));
    const retry = error.outcome === 'retryable' && job.attemptCount < this.options.maxAttempts
      && typeof job.payload.expiresAt === 'number' && Date.now() + delay < job.payload.expiresAt;
    await this.db.transaction(async (tx) => {
      const changed = await tx.update(integrationOutbox).set({ status: retry ? 'retry' : 'dead',
        lastError: error.reason, nextAttemptAt: new Date(Date.now() + delay), updatedAt: new Date(),
        processedAt: retry ? null : new Date() }).where(this.owned(job)).returning({ id: integrationOutbox.id });
      if (!changed.length) return;
      await tx.insert(leadEvents).values({ leadId: job.leadId, source: 'instagram_outbox',
        eventType: retry ? 'instagram_retry' : 'instagram_dead',
        payload: { outboxId: job.id, attempt: job.attemptCount, reason: error.reason, outcome: error.outcome } });
      if (!retry) await tx.insert(integrationOutbox).values({ leadId: job.leadId,
        destination: 'telegram', eventType: 'instagram.escalation',
        idempotencyKey: `telegram:instagram.dead:${job.id}`,
        payload: { instagramOutboxId: job.id, reason: error.reason, outcome: error.outcome },
      }).onConflictDoNothing({ target: integrationOutbox.idempotencyKey });
    });
    this.logger.warn({ jobId: job.id, leadId: job.leadId, attempt: job.attemptCount, retry, outcome: error.outcome },
      'Instagram delivery requires attention.');
  }
}
