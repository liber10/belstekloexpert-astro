import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';

interface HealthOptions {
  telegramConfigured: boolean;
  telegramWorkerActive: () => boolean;
  buildRevision: string;
  instagramConfigured?: boolean;
  instagramWorkerActive?: () => boolean;
  telegramPublicConfigured?: boolean;
  telegramPublicWorkerActive?: () => boolean;
  corporateWebhookReady?: (() => boolean) | undefined;
  corporateInboxConfigured?: boolean;
}

export function registerHealthRoutes(app: FastifyInstance, pool: Pool, options: HealthOptions) {
  app.get('/health/live', () => ({ ok: true, revision: options.buildRevision }));

  app.get('/health/ready', async (_request, reply) => {
    try {
      await pool.query('select 1');
      const result = await pool.query<{ status: string; count: string; oldest_age_seconds: string | null }>(`
        select status, count(*)::text as count,
          extract(epoch from (now() - min(created_at)))::bigint::text as oldest_age_seconds
        from integration_outbox
        where status in ('pending', 'retry', 'dead')
        group by status
      `);
      const counts = { pending: 0, retry: 0, dead: 0 };
      let oldestPendingAge: number | null = null;
      for (const row of result.rows) {
        if (row.status in counts) counts[row.status as keyof typeof counts] = Number(row.count);
        if ((row.status === 'pending' || row.status === 'retry') && row.oldest_age_seconds !== null) {
          oldestPendingAge = Math.max(oldestPendingAge ?? 0, Number(row.oldest_age_seconds));
        }
      }
      const workerActive = options.telegramWorkerActive();
      const instagramWorkerActive = options.instagramWorkerActive?.() ?? false;
      const publicWorkerActive = options.telegramPublicWorkerActive?.() ?? false;
      const corporateDead = options.corporateInboxConfigured ? (await pool.query<{ count: string }>(`
        select count(*)::text as count from integration_inbox where source = 'telegram_staff' and status = 'dead'
      `)).rows[0]?.count : undefined;
      const publicQueues = options.telegramPublicConfigured ? (await pool.query<{
        inbox_pending: number; inbox_dead: number; outbox_pending: number; outbox_dead: number;
      }>(`
        select
          (select count(*)::int from integration_inbox where source = 'telegram_public' and status in ('pending','retry','processing')) as inbox_pending,
          (select count(*)::int from integration_inbox where source = 'telegram_public' and status = 'dead') as inbox_dead,
          (select count(*)::int from telegram_public_outbox where status in ('pending','retry','processing')) as outbox_pending,
          (select count(*)::int from telegram_public_outbox where status = 'dead') as outbox_dead
      `)).rows[0] : null;
      const ok = (!options.telegramConfigured || workerActive)
        && (!options.instagramConfigured || instagramWorkerActive);
      const body = {
        ok,
        database: 'ready',
        telegram_configured: options.telegramConfigured,
        telegram_worker_active: workerActive,
        ...(options.corporateWebhookReady && options.telegramConfigured ? {
          telegram_corporate_webhook_ready: options.corporateWebhookReady(),
        } : {}),
        ...(options.corporateInboxConfigured ? { telegram_corporate_inbox_dead: Number(corporateDead ?? 0) } : {}),
        instagram_configured: options.instagramConfigured ?? false,
        instagram_worker_active: instagramWorkerActive,
        outbox_pending: counts.pending,
        outbox_retry: counts.retry,
        outbox_dead: counts.dead,
        oldest_pending_age_seconds: oldestPendingAge,
        revision: options.buildRevision,
        ...(options.telegramPublicConfigured ? {
          telegram_public_worker_active: publicWorkerActive,
          telegram_public_inbox_pending: publicQueues?.inbox_pending ?? 0,
          telegram_public_inbox_dead: publicQueues?.inbox_dead ?? 0,
          telegram_public_outbox_pending: publicQueues?.outbox_pending ?? 0,
          telegram_public_outbox_dead: publicQueues?.outbox_dead ?? 0,
        } : {}),
      };
      return ok ? body : reply.code(503).send(body);
    } catch {
      return reply.code(503).send({
        ok: false,
        database: 'unavailable',
        telegram_configured: options.telegramConfigured,
        telegram_worker_active: options.telegramWorkerActive(),
        revision: options.buildRevision,
      });
    }
  });
}
