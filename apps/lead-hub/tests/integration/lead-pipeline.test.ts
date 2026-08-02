import { fileURLToPath } from 'node:url';
import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildRuntime } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { createDatabaseClient, type DatabaseClient } from '../../src/db/client.js';
import {
  integrationInbox,
  integrationOutbox,
  leadEvents,
  leads,
  telegramPublicOutbox,
  telegramPublicSessions,
} from '../../src/db/schema.js';
import type { TelegramIntegration } from '../../src/integrations/telegram/index.js';
import type { TelegramPublicIntegration } from '../../src/integrations/telegram-public.js';
import type { LeadResponse } from '../../src/contracts/web-lead.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = describe.runIf(Boolean(databaseUrl));

integration('Lead Hub database pipeline', () => {
  let database: DatabaseClient;
  let runtime: Awaited<ReturnType<typeof buildRuntime>>;
  let publicRuntime: Awaited<ReturnType<typeof buildRuntime>>;
  const sendLeadCard = vi.fn(() => Promise.resolve({ chatId: '-100123', messageId: 42 }));
  const editLeadCard = vi.fn(() => Promise.resolve());
  const handleUpdate = vi.fn(() => Promise.resolve());
  const telegram: TelegramIntegration = {
    registerWebhook: vi.fn(() => Promise.resolve()),
    sendLeadCard,
    editLeadCard,
    handleUpdate,
  };
  const sendPublicMessage = vi.fn(() => Promise.resolve());
  const telegramPublic: TelegramPublicIntegration = {
    registerWebhook: vi.fn(() => Promise.resolve()),
    sendMessage: sendPublicMessage,
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
      KUFAR_INGEST_ENABLED: 'true',
      KUFAR_INGEST_API_KEY: 'integration-kufar-secret',
      LOG_LEVEL: 'silent',
    });
    runtime = await buildRuntime(config, { database, telegram, startWorker: false });
    await runtime.app.ready();
    const publicConfig = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl,
      TELEGRAM_PUBLIC_ENABLED: 'true',
      TELEGRAM_PUBLIC_BOT_TOKEN: 'integration-public-token',
      TELEGRAM_PUBLIC_BOT_USERNAME: 'BelStekloExpertHelpBot',
      TELEGRAM_PUBLIC_WEBHOOK_SECRET: 'integration-public-webhook-secret',
      TELEGRAM_PUBLIC_PRIVACY_VERSION: 'integration-v1',
      LEAD_HUB_PUBLIC_URL: 'https://lead-hub.example.test',
      LOG_LEVEL: 'silent',
    });
    publicRuntime = await buildRuntime(publicConfig, { database, telegram: null, telegramPublic, startWorker: false });
    await publicRuntime.app.ready();
  });

  beforeEach(async () => {
    await database.db.execute(
      sql`truncate table telegram_public_outbox, telegram_public_sessions, integration_inbox, integration_outbox, lead_events, leads restart identity cascade`,
    );
    vi.clearAllMocks();
  });

  afterAll(async () => {
    if (runtime) await runtime.app.close();
    if (publicRuntime) await publicRuntime.app.close();
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

  it('releases a stale processing job and delivers it', async () => {
    const created = await runtime.leadService.createWebLead(
      { phone: '+375291111111', serviceType: 'Worker recovery test' },
      'form-submission-worker-recovery',
    );

    await database.db
      .update(integrationOutbox)
      .set({
        status: 'processing',
        updatedAt: new Date(Date.now() - 10 * 60_000),
      })
      .where(eq(integrationOutbox.leadId, created.lead.id));

    await runtime.outbox?.processOnce();

    expect(sendLeadCard).toHaveBeenCalledTimes(1);
    const [job] = await database.db
      .select()
      .from(integrationOutbox)
      .where(eq(integrationOutbox.leadId, created.lead.id));
    expect(job?.status).toBe('sent');
  });

  it('durably accepts and deduplicates a phone-less Kufar event', async () => {
    const request = {
      method: 'POST' as const,
      url: '/api/v1/integrations/kufar/email',
      headers: { authorization: 'Bearer integration-kufar-secret' },
      payload: {
        externalMessageId: 'gmail-message-integration-001',
        customerMessage: 'Нужна замена лобового стекла без телефона.',
        conversationUrl: 'https://www.kufar.by/account/messaging/dialog-integration-001',
      },
    };
    const first = await runtime.app.inject(request);
    const duplicate = await runtime.app.inject(request);
    expect(first.statusCode).toBe(202);
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json()).toMatchObject({ accepted: true, deduplicated: true });

    expect(await runtime.inbox?.processOnce()).toBe(1);
    const [lead] = await database.db.select().from(leads);
    const [inboxEvent] = await database.db.select().from(integrationInbox);
    const [outboxJob] = await database.db.select().from(integrationOutbox);
    expect(lead).toMatchObject({ source: 'kufar', phoneNormalized: null });
    expect(inboxEvent?.status).toBe('done');
    expect(outboxJob?.eventType).toBe('lead.created');
  });

  it('keeps the website phone requirement after the nullable migration', async () => {
    const response = await runtime.app.inject({
      method: 'POST',
      url: '/api/v1/leads/web',
      headers: {
        authorization: 'Bearer integration-test-secret',
        'idempotency-key': 'web-without-phone-001',
      },
      payload: { serviceType: 'Замена стекла' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('durably completes the public Telegram FSM and creates one attributed lead', async () => {
    const updates = [
      { update_id: 101, message: { message_id: 1, chat: { id: 7001, type: 'private' }, from: { id: 7001, first_name: 'Test' }, text: '/start qr_test' } },
      { update_id: 102, message: { message_id: 2, chat: { id: 7001, type: 'private' }, from: { id: 7001, first_name: 'Test' }, text: 'Замена стекла' } },
      { update_id: 103, message: { message_id: 3, chat: { id: 7001, type: 'private' }, from: { id: 7001, first_name: 'Test' }, text: 'Тестовая заявка' } },
      { update_id: 104, message: { message_id: 4, chat: { id: 7001, type: 'private' }, from: { id: 7001, first_name: 'Test' }, contact: { phone_number: '+375291111111', user_id: 7001 } } },
      { update_id: 105, message: { message_id: 5, chat: { id: 7001, type: 'private' }, from: { id: 7001, first_name: 'Test' }, text: 'Подтвердить и согласиться' } },
    ];

    for (const payload of updates) {
      const response = await publicRuntime.app.inject({
        method: 'POST', url: '/api/v1/webhooks/telegram-public',
        headers: { 'x-telegram-bot-api-secret-token': 'integration-public-webhook-secret' }, payload,
      });
      expect(response.statusCode).toBe(200);
      expect(await publicRuntime.inbox?.processOnce()).toBe(1);
      expect(await publicRuntime.telegramPublicOutbox?.processOnce()).toBe(1);
    }

    const [lead] = await database.db.select().from(leads);
    const [session] = await database.db.select().from(telegramPublicSessions);
    const replies = await database.db.select().from(telegramPublicOutbox);
    expect(lead).toMatchObject({ source: 'telegram', sourceDetail: 'public_bot', acquisitionCode: 'qr_test' });
    expect(session).toMatchObject({ stage: 'submitted', submittedLeadId: lead?.id });
    expect(replies).toHaveLength(5);
    expect(sendPublicMessage).toHaveBeenCalledTimes(5);
  });
});
