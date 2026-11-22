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
  formSubmissionAudits,
  leadEvents,
  leads,
  telegramPublicOutbox,
  telegramPublicSessions,
  telegramPublicActivity,
} from '../../src/db/schema.js';
import type { TelegramIntegration } from '../../src/integrations/telegram/index.js';
import type { TelegramPublicIntegration } from '../../src/integrations/telegram-public.js';
import { InvalidTelegramPhoto } from '../../src/integrations/telegram-public.js';
import { parseStaffRoster, TelegramStaffService } from '../../src/services/telegram-staff-service.js';
import type { LeadResponse } from '../../src/contracts/web-lead.js';
import { testDatabaseUrl } from '../helpers/test-database.js';

const databaseUrl = testDatabaseUrl();
const integration = describe.runIf(Boolean(databaseUrl));

integration('Lead Hub database pipeline', () => {
  let database: DatabaseClient;
  let runtime: Awaited<ReturnType<typeof buildRuntime>>;
  let publicRuntime: Awaited<ReturnType<typeof buildRuntime>>;
  let corporateRuntime: Awaited<ReturnType<typeof buildRuntime>>;
  const sendLeadCard = vi.fn(() => Promise.resolve({ chatId: '-100123', messageId: 42 }));
  const editLeadCard = vi.fn(() => Promise.resolve());
  const handleUpdate = vi.fn(() => Promise.resolve());
  const telegram: TelegramIntegration = {
    registerWebhook: vi.fn(() => Promise.resolve()),
    sendLeadCard,
    editLeadCard,
    sendInstagramAlert: vi.fn(() => Promise.resolve()),
    handleUpdate,
  };
  const sendPublicMessage = vi.fn<TelegramPublicIntegration['sendMessage']>(() => Promise.resolve());
  const downloadPhoto = vi.fn(() => Promise.resolve(Buffer.from([255, 216, 255, 217])));
  const telegramPublic: TelegramPublicIntegration = {
    registerWebhook: vi.fn(() => Promise.resolve()),
    sendMessage: sendPublicMessage,
    downloadPhoto,
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
      TELEGRAM_PUBLIC_PRIVACY_URL: 'https://example.test/privacy/',
      TELEGRAM_PUBLIC_SUPPORT_PHONE: '+375291111111',
      LEAD_HUB_PUBLIC_URL: 'https://lead-hub.example.test',
      LOG_LEVEL: 'silent',
    });
    publicRuntime = await buildRuntime(publicConfig, {
      database, telegram: null, telegramPublic, startWorker: false,
      objectStorage: {
        prepareUploads: () => Promise.resolve([{ ref: 'b2://fixture/photo', uploadUrl: 'https://storage.example.test/fixture', headers: {} }]),
        createDownloadUrls: () => Promise.resolve([]),
        isReferenceForSubmission: () => false,
      },
    });
    await publicRuntime.app.ready();
    corporateRuntime = await buildRuntime(loadConfig({
      NODE_ENV: 'test', DATABASE_URL: databaseUrl, LOG_LEVEL: 'silent', TELEGRAM_ENABLED: 'true',
      TELEGRAM_BOT_TOKEN: 'fixture-corporate-token', TELEGRAM_CHAT_ID: '-100123',
      TELEGRAM_WEBHOOK_SECRET: 'fixture-corporate-secret', TELEGRAM_STAFF_ROSTER: '10:admin,11:manager,12:master',
      LEAD_HUB_PUBLIC_URL: 'https://lead-hub.example.test',
    }), { database, telegram, startWorker: false });
    await corporateRuntime.app.ready();
  });

  beforeEach(async () => {
    await database.db.execute(
      sql`truncate table telegram_public_activity, telegram_public_outbox, telegram_public_sessions, form_submission_audits, integration_inbox, integration_outbox, lead_events, leads restart identity cascade`,
    );
    vi.clearAllMocks();
  });

  afterAll(async () => {
    if (runtime) await runtime.app.close();
    if (publicRuntime) await publicRuntime.app.close();
    if (corporateRuntime) await corporateRuntime.app.close();
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
    expect(eventCount?.total).toBe(3);
    expect(outboxCount?.total).toBe(1);
  });

  it('records and traces a privacy-safe honeypot outcome without a lead or Telegram job', async () => {
    const correlationId = 'honeypot-submission-001';
    const response = await runtime.app.inject({
      method: 'POST', url: '/api/v1/submissions/audit',
      headers: { authorization: 'Bearer integration-test-secret' },
      payload: { correlationId, event: 'honeypot_rejected', reason: 'honeypot', formType: 'callback' },
    });
    expect(response.statusCode).toBe(202);
    const [audit] = await database.db.select().from(formSubmissionAudits);
    expect(audit).toMatchObject({ correlationId, event: 'honeypot_rejected', reason: 'honeypot', formType: 'callback' });
    expect(await database.db.select().from(leads)).toHaveLength(0);
    expect(await database.db.select().from(integrationOutbox)).toHaveLength(0);

    const trace = await runtime.app.inject({
      method: 'GET', url: `/api/v1/submissions/${correlationId}/trace`,
      headers: { authorization: 'Bearer integration-test-secret' },
    });
    expect(trace.json()).toMatchObject({ ok: true, correlationId, lead: null });
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
    expect(events.map((event) => event.eventType)).toEqual([
      'lead_received', 'persisted', 'dispatch_pending', 'telegram_sent', 'status_changed',
    ]);
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

  it('keeps the lead and records retry after a Telegram sender failure', async () => {
    const created = await runtime.leadService.createWebLead(
      { phone: '+375291111111', serviceType: 'Sender failure test' },
      'form-submission-telegram-retry',
    );
    sendLeadCard.mockRejectedValueOnce(new Error('fake transport failure'));
    await runtime.outbox?.processOnce();
    const [lead] = await database.db.select().from(leads).where(eq(leads.id, created.lead.id));
    const [job] = await database.db.select().from(integrationOutbox).where(eq(integrationOutbox.leadId, created.lead.id));
    const events = await database.db.select().from(leadEvents).where(eq(leadEvents.leadId, created.lead.id));
    expect(lead?.id).toBe(created.lead.id);
    expect(job?.status).toBe('retry');
    expect(events.some((event) => event.eventType === 'telegram_retry')).toBe(true);
  });

  it('moves the job to dead without rolling back the lead', async () => {
    const created = await runtime.leadService.createWebLead(
      { phone: '+375291111111', serviceType: 'Dead-letter test' },
      'form-submission-telegram-dead',
    );
    await database.db.update(integrationOutbox).set({ attemptCount: 7 })
      .where(eq(integrationOutbox.leadId, created.lead.id));
    sendLeadCard.mockRejectedValueOnce(new Error('fake permanent failure'));
    await runtime.outbox?.processOnce();
    const [job] = await database.db.select().from(integrationOutbox).where(eq(integrationOutbox.leadId, created.lead.id));
    expect(job?.status).toBe('dead');
    expect(await database.db.select().from(leads).where(eq(leads.id, created.lead.id))).toHaveLength(1);
    const events = await database.db.select().from(leadEvents).where(eq(leadEvents.leadId, created.lead.id));
    expect(events.some((event) => event.eventType === 'telegram_dead')).toBe(true);
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
    const steps = ['/start qr_test', 'Согласен и хочу продолжить', 'Замена стекла', 'Тестовая марка', 'Тестовая модель',
      '2099', '2019', 'Лобовое', 'Тестовая заявка', '+375291111111', 'Назад', '+375291111112', 'Отправить и получать статусы'];
    for (const [index, text] of steps.entries()) {
      await acceptPublic(101 + index, { text });
      await expect.poll(() => publicRuntime.telegramPublicOutbox?.processOnce()).toBe(1);
    }
    const duplicate = await publicUpdate(100 + steps.length, { text: 'Отправить и получать статусы' });
    expect(duplicate.json()).toMatchObject({ deduplicated: true });

    const [lead] = await database.db.select().from(leads);
    const [session] = await database.db.select().from(telegramPublicSessions);
    const replies = await database.db.select().from(telegramPublicOutbox);
    expect(lead).toMatchObject({ source: 'telegram', sourceDetail: 'public_bot', acquisitionCode: 'qr_test',
      phoneNormalized: '+375291111112', carMake: 'Тестовая марка', carYear: 2019, damageType: 'Лобовое', privacyVersion: 'integration-v1' });
    expect(session).toMatchObject({ stage: 'submitted', submittedLeadId: lead?.id });
    expect(replies).toHaveLength(steps.length);
    expect(sendPublicMessage).toHaveBeenCalledTimes(steps.length);
    expect(await database.db.select().from(telegramPublicActivity)).toHaveLength(2);
    expect(await runtime.outbox?.processOnce()).toBe(1);
    expect(sendLeadCard).toHaveBeenCalledOnce();

    const staff = new TelegramStaffService(database.db, parseStaffRoster('10:admin,11:manager,12:master,13:master'));
    const leadRef = lead!.publicId;
    await expect(staff.apply(leadRef, { kind: 'assigned', assignee: '12' }, '99', 'denied')).rejects.toThrow();
    await staff.apply(leadRef, { kind: 'assigned', assignee: '12' }, '11', 'assign');
    await expect(staff.find(leadRef, '13')).rejects.toThrow();
    await expect(runtime.leadService.changeStatus(lead!.id, 'won', { source: 'telegram', requiredAssignee: '13' })).rejects.toThrow();
    await staff.apply(leadRef, { kind: 'note_added', text: 'Тестовый комментарий' }, '12', 'note');
    await runtime.leadService.changeStatus(lead!.id, 'booked', { source: 'telegram', requiredAssignee: '12', externalEventId: 'booked-fixture' });
    await runtime.leadService.changeStatus(lead!.id, 'booked', { source: 'telegram', requiredAssignee: '12', externalEventId: 'booked-fixture' });
    await expect.poll(() => publicRuntime.telegramPublicOutbox?.processOnce()).toBe(1);
    expect(sendPublicMessage.mock.lastCall?.[0]).toBe('7001');
    expect(sendPublicMessage.mock.lastCall?.[1].text).toContain('Запись подтверждена');
    await runtime.leadService.changeStatus(lead!.id, 'won', { source: 'telegram', requiredAssignee: '12' });
    await acceptPublic(160, { text: '/stop_notifications' });
    await expect.poll(() => publicRuntime.telegramPublicOutbox?.processOnce()).toBe(1);
    expect(sendPublicMessage).toHaveBeenCalledTimes(steps.length + 1);
    await expect.poll(() => publicRuntime.telegramPublicOutbox?.processOnce()).toBe(1);
    expect(sendPublicMessage.mock.lastCall?.[0]).toBe('7001');
    expect(sendPublicMessage.mock.lastCall?.[1].text).toContain('отключены');
    await staff.apply(leadRef, { kind: 'price_set', amount: '123.45' }, '11', 'price');
    await staff.apply(leadRef, { kind: 'payment_recorded' }, '10', 'payment');
    await staff.apply(leadRef, { kind: 'payment_recorded' }, '10', 'payment');
    expect(await staff.notes(lead!.id)).toEqual(['Тестовый комментарий']);
    expect(await staff.find(leadRef, '12')).toMatchObject({ finalAmount: '123.45', revenue: '123.45' });
    expect((await staff.report(new Date(0))).leadMetrics).toMatchObject([{ paid: 1, revenue: '123.45' }]);
  });

  it('recovers from bad photos and a failed private upload without creating a partial lead', async () => {
    const steps = ['/start tg_photo', 'Согласен и хочу продолжить', 'Ремонт скола', 'Марка', 'Модель', 'Пропустить'];
    for (const [index, text] of steps.entries()) await acceptPublic(201 + index, { text });
    await acceptPublic(207, { photo: [{ file_id: 'fixture-invalid' }] });
    await acceptPublic(208, { text: 'Пропустить' });
    await acceptPublic(209, { text: '+375291111111' });
    downloadPhoto.mockRejectedValueOnce(new InvalidTelegramPhoto());
    await acceptPublic(210, { text: 'Отправить заявку' });
    expect(await database.db.select().from(leads)).toHaveLength(0);
    const [recovered] = await database.db.select().from(telegramPublicSessions);
    expect(recovered?.stage).toBe('photo');
    await acceptPublic(211, { photo: [{ file_id: 'fixture-repair' }] });
    await acceptPublic(212, { text: 'Пропустить' });
    await acceptPublic(213, { text: '+375291111111' });
    const upload = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    try {
      await acceptPublic(214, { text: 'Отправить заявку' });
      expect(await database.db.select().from(leads)).toHaveLength(0);
      await database.db.update(integrationInbox).set({ nextAttemptAt: new Date(0) }).where(eq(integrationInbox.status, 'retry'));
      const restarted = await buildRuntime(loadConfig({
        NODE_ENV: 'test', DATABASE_URL: databaseUrl, TELEGRAM_PUBLIC_ENABLED: 'true',
        TELEGRAM_PUBLIC_BOT_TOKEN: 'integration-public-token', TELEGRAM_PUBLIC_BOT_USERNAME: 'BelStekloExpertHelpBot',
        TELEGRAM_PUBLIC_WEBHOOK_SECRET: 'integration-public-webhook-secret', TELEGRAM_PUBLIC_PRIVACY_VERSION: 'integration-v1',
        TELEGRAM_PUBLIC_PRIVACY_URL: 'https://example.test/privacy/', TELEGRAM_PUBLIC_SUPPORT_PHONE: '+375291111111',
        LEAD_HUB_PUBLIC_URL: 'https://lead-hub.example.test', LOG_LEVEL: 'silent',
      }), { database, telegram: null, telegramPublic, objectStorage: publicRuntime.objectStorage, startWorker: false });
      try {
        expect(await restarted.publicInbox?.processOnce()).toBe(1);
        const accepted = await database.db.select().from(leads);
        expect(accepted).toMatchObject([{ photoRefs: ['b2://fixture/photo'] }]);
        await restarted.leadService.changeStatus(accepted[0]!.id, 'booked', { source: 'telegram' });
        expect(await database.db.select().from(telegramPublicOutbox).where(sql`subscription_lead_id is not null`)).toHaveLength(0);
      } finally {
        await restarted.app.close();
      }
    } finally {
      upload.mockRestore();
    }
  });

  it('keeps the two authenticated webhooks independent and persists only allowed corporate updates', async () => {
    const corporateRequest = (actor: number, secret: string) => corporateRuntime.app.inject({
      method: 'POST', url: '/api/v1/webhooks/telegram', headers: { 'x-telegram-bot-api-secret-token': secret },
      payload: { update_id: 301, message: { text: '/queue', chat: { id: -100123 }, from: { id: actor } } },
    });
    expect((await corporateRequest(10, 'integration-public-webhook-secret')).statusCode).toBe(401);
    expect((await corporateRequest(99, 'fixture-corporate-secret')).json()).toMatchObject({ ignored: true });
    expect((await corporateRequest(10, 'fixture-corporate-secret')).json()).toMatchObject({ accepted: true, deduplicated: false });
    expect((await corporateRequest(10, 'fixture-corporate-secret')).json()).toMatchObject({ deduplicated: true });
    expect(handleUpdate).not.toHaveBeenCalled();
    await acceptPublic(301, { text: '/new +375291111111' });
    expect(await database.db.select().from(leads)).toHaveLength(0);
    await expect.poll(() => corporateRuntime.corporateInbox?.processOnce()).toBe(1);
    expect(handleUpdate).toHaveBeenCalledOnce();
    expect(await database.db.select().from(integrationInbox)).toHaveLength(2);
  });

  it('asks Telegram to retry when durable acceptance is unavailable', async () => {
    const unavailable = createDatabaseClient(databaseUrl as string);
    await unavailable.pool.end();
    const stopped = await buildRuntime(loadConfig({
      NODE_ENV: 'test', DATABASE_URL: databaseUrl, LOG_LEVEL: 'silent', TELEGRAM_PUBLIC_ENABLED: 'true',
      TELEGRAM_PUBLIC_BOT_TOKEN: 'integration-public-token', TELEGRAM_PUBLIC_BOT_USERNAME: 'BelStekloExpertHelpBot',
      TELEGRAM_PUBLIC_WEBHOOK_SECRET: 'integration-public-webhook-secret', TELEGRAM_PUBLIC_PRIVACY_VERSION: 'integration-v1',
      TELEGRAM_PUBLIC_PRIVACY_URL: 'https://example.test/privacy/', TELEGRAM_PUBLIC_SUPPORT_PHONE: '+375291111111',
      LEAD_HUB_PUBLIC_URL: 'https://lead-hub.example.test',
    }), { database: unavailable, telegram: null, telegramPublic, startWorker: false });
    try {
      const result = await stopped.app.inject({
        method: 'POST', url: '/api/v1/webhooks/telegram-public',
        headers: { 'x-telegram-bot-api-secret-token': 'integration-public-webhook-secret' },
        payload: { update_id: 401, message: { text: '/start', chat: { id: 7001, type: 'private' }, from: { id: 7001 } } },
      });
      expect(result.statusCode).toBe(500);
      await acceptPublic(401, { text: '/start' });
      expect(await database.db.select().from(telegramPublicSessions)).toHaveLength(1);
    } finally {
      await stopped.app.close();
    }
  });

  function publicUpdate(updateId: number, fields: Record<string, unknown>) {
    return publicRuntime.app.inject({
      method: 'POST', url: '/api/v1/webhooks/telegram-public',
      headers: { 'x-telegram-bot-api-secret-token': 'integration-public-webhook-secret' },
      payload: { update_id: updateId, message: { chat: { id: 7001, type: 'private' }, from: { id: 7001 }, ...fields } },
    });
  }

  async function acceptPublic(updateId: number, fields: Record<string, unknown>) {
    expect((await publicUpdate(updateId, fields)).statusCode).toBe(200);
    await expect.poll(() => publicRuntime.publicInbox?.processOnce()).toBe(1);
  }
});
