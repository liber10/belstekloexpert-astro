import Fastify from 'fastify';
import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { registerHealthRoutes } from '../../src/routes/health.js';

describe('health diagnostics', () => {
  it('reports safe outbox and revision diagnostics without sending Telegram', async () => {
    const pool = {
      query: vi.fn((query: string) => Promise.resolve(query.includes('select 1')
        ? { rows: [{ '?column?': 1 }] }
        : { rows: [
          { status: 'pending', count: '2', oldest_age_seconds: '31' },
          { status: 'dead', count: '1', oldest_age_seconds: '90' },
        ] })),
    } as unknown as Pool;
    const app = Fastify({ logger: false });
    registerHealthRoutes(app, pool, {
      telegramConfigured: true,
      telegramWorkerActive: () => true,
      buildRevision: 'test-revision',
    });
    const response = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true, database: 'ready', telegram_configured: true, telegram_worker_active: true,
      outbox_pending: 2, outbox_retry: 0, outbox_dead: 1,
      oldest_pending_age_seconds: 31, revision: 'test-revision',
    });
    await app.close();
  });

  it('is not ready when Telegram is configured but its worker is inactive', async () => {
    const pool = { query: vi.fn(() => Promise.resolve({ rows: [] })) } as unknown as Pool;
    const app = Fastify({ logger: false });
    registerHealthRoutes(app, pool, {
      telegramConfigured: true, telegramWorkerActive: () => false, buildRevision: 'test',
    });
    const response = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ telegram_configured: true, telegram_worker_active: false });
    await app.close();
  });
});
