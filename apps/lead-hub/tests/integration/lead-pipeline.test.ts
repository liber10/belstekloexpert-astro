import { fileURLToPath } from 'node:url';
import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildRuntime } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { createDatabaseClient, type DatabaseClient } from '../../src/db/client.js';
import { integrationOutbox, leadEvents, leads } from '../../src/db/schema.js';
import type { TelegramIntegration } from '../../src/integrations/telegram/index.js';
import type { LeadResponse } from '../../src/contracts/web-lead.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = describe.runIf(Boolean(databaseUrl));

integration('Lead Hub database pipeline', () => {
  let database: DatabaseClient;
  let runtime: Awaited<ReturnType<typeof buildRuntime>>;
  const sendLeadCard = vi.fn(() => Promise.resolve({ chatId: '-100123', messageId: 42 }));
  const editLeadCard = vi.fn(() => Promise.resolve());
  const handleUpdate = vi.fn(() => Promise.resolve());
  const telegram: TelegramIntegration = {
    sendLeadCard,
    editLeadCard,
    handleUpdate,
  };

  beforeAll(async () => {
    database = createDatabaseClient(databaseUrl as string);
    await migrate(database.db, {
      migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
    });
    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl,
      TELEGRAM_ENABLED: 'false',
      WEB_INGEST_API_KEY: 'integration-test-secret',
      LOG_LEVEL: 'silent',
    });
    runtime = await buildRuntime(config, { database, telegram, startWorker: false });
    await runtime.app.ready();
  });

  beforeEach(async () => {
    await database.db.execute(
      sql`truncate table integration_outbox, lead_events, leads restart identity cascade`,
    );
    vi.clearAllMocks();
  });

  afterAll(async () => {
    if (runtime) await runtime.app.close();
    if (database) await database.pool.end();
  });

  it('creates one lead and deduplicates a repeated request', async () => {
    const request = {
      method: 'POST' as const,
      url: '/api/v1/leads/web',
      headers: {
        authorization: 'Bearer integration-test-secret',
        'idempotency-key': 'form-submission-0001',
      },
      payload: {
        phone: '+375 29 111-11-11',
        name: 'Test Client',
        serviceType: 'Замена лобового',
        vin: 'WVWZZZ3CZJE123456',
        attribution: {
          utmSource: 'google',
          utmCampaign: 'windshield',
          gclid: 'test-gclid',
        },
      },
    };

    const first = await runtime.app.inject(request);
    const second = await runtime.app.inject(request);

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    const firstBody = first.json<LeadResponse>();
    const secondBody = second.json<LeadResponse>();
    expect(secondBody).toMatchObject({ ok: true, deduplicated: true });
    expect(secondBody.leadId).toBe(firstBody.leadId);

    const [leadCount] = await database.db.select({ total: sql<number>`count(*)::int` }).from(leads);
    const [eventCount] = await database.db.select({ total: sql<number>`count(*)::int` }).from(leadEvents);
    const [outboxCount] = await database.db.select({ total: sql<number>`count(*)::int` }).from(integrationOutbox);
    expect(leadCount?.total).toBe(1);
    expect(eventCount?.total).toBe(1);
    expect(outboxCount?.total).toBe(1);
  });

  it('rejects reuse of an idempotency key for a different payload', async () => {
    const headers = {
      authorization: 'Bearer integration-test-secret',
      'idempotency-key': 'form-submission-0002',
    };
    await runtime.app.inject({
      method: 'POST',
      url: '/api/v1/leads/web',
      headers,
      payload: { phone: '+375291111111', serviceType: 'Скол' },
    });
    const conflict = await runtime.app.inject({
      method: 'POST',
      url: '/api/v1/leads/web',
      headers,
      payload: { phone: '+375291111111', serviceType: 'Трещина' },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ error: 'idempotency_conflict' });
  });

  it('claims transitional Telegram delivery once and completes it', async () => {
    const created = await runtime.leadService.createWebLead(
      { phone: '+375291111111', serviceType: 'Legacy Telegram bridge' },
      'form-submission-legacy-telegram',
    );

    const unauthorized = await runtime.app.inject({
      method: 'POST',
      url: `/api/v1/leads/${created.lead.id}/legacy-telegram-delivery`,
      payload: { action: 'claim' },
    });
    expect(unauthorized.statusCode).toBe(401);

    const firstClaim = await runtime.app.inject({
      method: 'POST',
      url: `/api/v1/leads/${created.lead.id}/legacy-telegram-delivery`,
      headers: { authorization: 'Bearer integration-test-secret' },
      payload: { action: 'claim' },
    });
    expect(firstClaim.statusCode).toBe(200);
    expect(firstClaim.json()).toMatchObject({ ok: true, claimed: true });

    const duplicateClaim = await runtime.app.inject({
      method: 'POST',
      url: `/api/v1/leads/${created.lead.id}/legacy-telegram-delivery`,
      headers: { authorization: 'Bearer integration-test-secret' },
      payload: { action: 'claim' },
    });
    expect(duplicateClaim.json()).toMatchObject({ ok: true, claimed: false });

    const completed = await runtime.app.inject({
      method: 'POST',
      url: `/api/v1/leads/${created.lead.id}/legacy-telegram-delivery`,
      headers: { authorization: 'Bearer integration-test-secret' },
      payload: { action: 'complete' },
    });
    expect(completed.statusCode).toBe(200);

    const [job] = await database.db
      .select()
      .from(integrationOutbox)
      .where(eq(integrationOutbox.leadId, created.lead.id));
    expect(job?.status).toBe('sent');
    expect(job?.processedAt).toBeInstanceOf(Date);
  });

  it('rejects unauthenticated and unknown request fields before creating a lead', async () => {
    const unauthorized = await runtime.app.inject({
      method: 'POST',
      url: '/api/v1/leads/web',
      headers: { 'idempotency-key': 'form-submission-unauthorized' },
      payload: { phone: '+375291111111' },
    });
    expect(unauthorized.statusCode).toBe(401);

    const invalid = await runtime.app.inject({
      method: 'POST',
      url: '/api/v1/leads/web',
      headers: {
        authorization: 'Bearer integration-test-secret',
        'idempotency-key': 'form-submission-invalid-body',
      },
      payload: { phone: '+375291111111', unexpected: 'field' },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ error: 'validation_error' });

    const [leadCount] = await database.db.select({ total: sql<number>`count(*)::int` }).from(leads);
    expect(leadCount?.total).toBe(0);
  });

  it('delivers the card once and records an idempotent status event', async () => {
    const created = await runtime.leadService.createWebLead(
      { phone: '+375291111111', serviceType: 'Замена лобового' },
      'form-submission-0003',
    );

    await runtime.outbox?.processOnce();
    await runtime.leadService.changeStatus(created.lead.id, 'qualified', {
      source: 'telegram',
      externalEventId: 'telegram:callback:abc123',
      actorId: 'manager-1',
    });
    await runtime.leadService.changeStatus(created.lead.id, 'qualified', {
      source: 'telegram',
      externalEventId: 'telegram:callback:abc123',
      actorId: 'manager-1',
    });
    await runtime.outbox?.processOnce();

    expect(sendLeadCard).toHaveBeenCalledTimes(1);
    expect(editLeadCard).toHaveBeenCalledTimes(1);

    const [lead] = await database.db.select().from(leads).where(eq(leads.id, created.lead.id));
    const events = await database.db.select().from(leadEvents).where(eq(leadEvents.leadId, created.lead.id));
    expect(lead?.status).toBe('qualified');
    expect(lead?.telegramMessageId).toBe(42);
    expect(events.map((event) => event.eventType)).toEqual(['lead_received', 'status_changed']);
  });
});
