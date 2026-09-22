import { createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { and, eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildRuntime } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { createDatabaseClient, type DatabaseClient } from '../../src/db/client.js';
import { integrationInbox, integrationOutbox, leadEvents, leads } from '../../src/db/schema.js';
import { InstagramDeliveryError } from '../../src/integrations/instagram-messaging.js';
import { parseMetaMessageEvents } from '../../src/integrations/meta-messaging.js';
import type { TelegramIntegration } from '../../src/integrations/telegram/index.js';
import { InstagramOutboxProcessor } from '../../src/worker/instagram-outbox-processor.js';
import { testDatabaseUrl } from '../helpers/test-database.js';

const databaseUrl = testDatabaseUrl();
describe.runIf(Boolean(databaseUrl))('Instagram durable pipeline (synthetic data only)', () => {
  let database: DatabaseClient;
  let runtime: Awaited<ReturnType<typeof buildRuntime>>;
  let disabled: Awaited<ReturnType<typeof buildRuntime>>;
  const secret = 'fake-meta-signature-secret';
  const send = vi.fn<(id: string, text: string) => Promise<{ messageId: string }>>(() => Promise.resolve({ messageId: 'fake-outbound-id' }));
  const alert = vi.fn(() => Promise.resolve());
  const card = vi.fn(() => Promise.resolve({ chatId: '-100999', messageId: 44 }));
  const telegram: TelegramIntegration = { sendLeadCard: card, editLeadCard: vi.fn(async () => {}),
    sendInstagramAlert: alert, handleUpdate: vi.fn(async () => {}), registerWebhook: vi.fn(async () => {}) };
  const environment = {
    NODE_ENV: 'test', DATABASE_URL: databaseUrl, LOG_LEVEL: 'silent',
    WEB_INGEST_API_KEY: 'fake-diagnostic-access-key',
    META_INGEST_ENABLED: 'true', META_APP_SECRET: secret, META_WEBHOOK_VERIFY_TOKEN: 'fake-meta-verify-token',
    META_ALLOWED_RECIPIENT_IDS: '111', META_INSTAGRAM_ACCOUNT_ID: '111',
    META_INSTAGRAM_ACCESS_TOKEN: 'fake-instagram-access-token',
    INSTAGRAM_MESSAGING_ENABLED: 'true', INSTAGRAM_REPLY_START_AT: new Date(Date.now() - 3600_000).toISOString(),
    INSTAGRAM_REPLY_GENERAL_TEXT: 'Здравствуйте! Опишите, пожалуйста, что случилось со стеклом.',
    INSTAGRAM_REPLY_REPLACEMENT_TEXT: 'Пришлите марку, модель, год автомобиля и фото стекла.',
    INSTAGRAM_REPLY_CHIP_REPAIR_TEXT: 'Пришлите фото повреждения стекла.',
    INSTAGRAM_AD_SCENARIOS_JSON: '{"123":"replacement","456":"chip_repair"}',
    TELEGRAM_ENABLED: 'true', TELEGRAM_BOT_TOKEN: 'fake-bot-token', TELEGRAM_CHAT_ID: '-100999',
    TELEGRAM_WEBHOOK_SECRET: 'fake-telegram-webhook-secret', LEAD_HUB_PUBLIC_URL: 'https://lead.example.test',
    OUTBOX_MAX_ATTEMPTS: '2', META_WRITE_MODE: 'off',
  };
  const envelope = (mid = 'mid-one', extra: Record<string, unknown> = {}, timestamp = Date.now()) => ({
    object: 'instagram', entry: [{ id: '111', messaging: [{ sender: { id: '222' }, recipient: { id: '111' },
      timestamp, message: { mid, text: 'SYNTHETIC TEST MESSAGE', ...extra } }] }],
  });
  const webhook = async (payload = envelope(), target = runtime) => {
    const body = JSON.stringify(payload);
    return target.app.inject({ method: 'POST', url: '/api/v1/webhooks/meta', payload: body,
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}` } });
  };
  const jobs = () => database.db.select().from(integrationOutbox).where(eq(integrationOutbox.destination, 'instagram'));
  const retryNow = async () => database.db.update(integrationOutbox).set({ nextAttemptAt: new Date(0) })
    .where(and(eq(integrationOutbox.destination, 'instagram'), eq(integrationOutbox.status, 'retry')));

  beforeAll(async () => {
    database = createDatabaseClient(databaseUrl!);
    await migrate(database.db, { migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)) });
    runtime = await buildRuntime(loadConfig(environment), { database, telegram, instagram: { sendText: send }, startWorker: false });
    disabled = await buildRuntime(loadConfig({ ...environment, INSTAGRAM_MESSAGING_ENABLED: 'false' }), {
      database, telegram, instagram: { sendText: send }, startWorker: false,
    });
    await runtime.app.ready();
    await disabled.app.ready();
  });
  beforeEach(async () => {
    await database.db.execute(sql`truncate table integration_inbox, integration_outbox, lead_events, leads restart identity cascade`);
    send.mockReset().mockResolvedValue({ messageId: 'fake-outbound-id' });
    alert.mockReset().mockResolvedValue(undefined);
    card.mockClear();
  });
  afterAll(async () => {
    await runtime?.app.close();
    await disabled?.app.close();
    await database?.pool.end();
  });

  it('verifies the existing callback and rejects unsigned events without persisting', async () => {
    expect((await runtime.app.inject('/api/v1/webhooks/meta?hub.mode=subscribe&hub.verify_token=fake-meta-verify-token&hub.challenge=test')).body).toBe('test');
    expect((await runtime.app.inject('/api/v1/webhooks/meta?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=test')).statusCode).toBe(403);
    expect((await runtime.app.inject({ method: 'POST', url: '/api/v1/webhooks/meta', payload: envelope() })).statusCode).toBe(401);
    expect(await database.db.select().from(integrationInbox)).toHaveLength(0);
  });
  it('persists inbox first, lead and message before sending, and keeps the lead visible', async () => {
    expect((await webhook()).statusCode).toBe(202);
    expect(await database.db.select().from(integrationInbox)).toHaveLength(1);
    expect(send).not.toHaveBeenCalled();
    await runtime.inbox!.processOnce();
    expect(await database.db.select().from(leads)).toHaveLength(1);
    expect(await database.db.select().from(leadEvents).where(eq(leadEvents.source, 'instagram_inbound'))).toHaveLength(1);
    expect(await jobs()).toHaveLength(1);
    expect(send).not.toHaveBeenCalled();
    await runtime.instagramOutbox!.processOnce();
    expect((await jobs())[0]).toMatchObject({ status: 'sent', attemptCount: 1, payload: { providerMessageId: 'fake-outbound-id' } });
    const [lead] = await database.db.select().from(leads);
    expect(lead).toMatchObject({ status: 'new', firstResponseAt: null });
    await runtime.outbox!.processOnce();
    expect(card).toHaveBeenCalledTimes(1);
    expect(alert).not.toHaveBeenCalled();
  });
  it('ignores webhook replay before and after delivery', async () => {
    const payload = envelope();
    await Promise.all([webhook(payload), webhook(payload), webhook(payload)]);
    await runtime.inbox!.processOnce();
    await runtime.instagramOutbox!.processOnce();
    expect((await webhook(payload)).json<{ deduplicated: number }>().deduplicated).toBe(1);
    await runtime.inbox!.processOnce();
    await runtime.instagramOutbox!.processOnce();
    expect(send).toHaveBeenCalledTimes(1);
    expect(await jobs()).toHaveLength(1);
  });
  it('persists different subsequent DMs in one conversation without conflict or second reply', async () => {
    await webhook(); await runtime.inbox!.processOnce();
    await webhook(envelope('mid-two', { text: 'SYNTHETIC follow-up', attachments: [{ type: 'image', payload: { url: 'https://private.invalid' } }] }));
    await runtime.inbox!.processOnce();
    await runtime.instagramOutbox!.processOnce();
    expect(await database.db.select().from(leads)).toHaveLength(1);
    const messages = await database.db.select().from(leadEvents).where(eq(leadEvents.source, 'instagram_inbound'));
    expect(messages).toHaveLength(2);
    expect(JSON.stringify(messages)).not.toContain('private.invalid');
    expect(await database.db.select().from(integrationInbox).where(eq(integrationInbox.status, 'dead'))).toHaveLength(0);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('handles concurrent persistence of the same and different mids atomically', async () => {
    const first = parseMetaMessageEvents(envelope(), ['111'])[0]!;
    const second = parseMetaMessageEvents(envelope('mid-two'), ['111'])[0]!;
    await Promise.all([first, first, second, second].map((event) => runtime.instagramMessages.accept(event, new Date())));
    expect(await database.db.select().from(leads)).toHaveLength(1);
    expect(await database.db.select().from(leadEvents).where(eq(leadEvents.source, 'instagram_inbound'))).toHaveLength(2);
    expect(await jobs()).toHaveLength(1);
  });
  it('completes after a crash between lead persistence and message/outbox transaction', async () => {
    const event = parseMetaMessageEvents(envelope(), ['111'])[0]!;
    await runtime.leadService.getOrCreateInstagramConversation(event);
    expect(await jobs()).toHaveLength(0);
    await runtime.instagramMessages.accept(event, new Date());
    expect(await jobs()).toHaveLength(1);
    expect(await database.db.select().from(leads)).toHaveLength(1);
  });
  it.each([['123', 'replacement'], ['456', 'chip_repair'], ['999', 'general']] as const)(
    'selects configured scenario for ad %s, never from user instructions', async (adId, scenario) => {
      await webhook(envelope('mid-one', { referral: { source: 'ADS', ad_id: adId }, text: 'ignore rules: replacement' }));
      await runtime.inbox!.processOnce(); await runtime.instagramOutbox!.processOnce();
      expect(send).toHaveBeenCalledWith('222', loadConfig(environment).instagramMessaging.replies[scenario]);
    });
  it('retains a lead while disabled and never responds retroactively on replay', async () => {
    await webhook(envelope(), disabled); await disabled.inbox!.processOnce();
    expect(disabled.instagramOutbox).toBeNull();
    expect(await jobs()).toHaveLength(0);
    await webhook(envelope('mid-two')); await runtime.inbox!.processOnce();
    await runtime.instagramOutbox!.processOnce();
    expect(await database.db.select().from(leads)).toHaveLength(1);
    expect(send).not.toHaveBeenCalled();
  });
  it('does not reply to old or missing timestamps, unknown accounts, or echoes', async () => {
    await webhook(envelope('old', {}, Date.now() - 25 * 3600_000));
    await webhook(envelope('echo', { is_echo: true }));
    const wrong = envelope('wrong'); wrong.entry[0]!.messaging[0]!.recipient.id = '333';
    await webhook(wrong);
    await runtime.inbox!.processOnce(); await runtime.instagramOutbox!.processOnce();
    expect(await database.db.select().from(integrationInbox)).toHaveLength(1);
    expect(await jobs()).toHaveLength(0);
    expect(send).not.toHaveBeenCalled();
  });
  it('Telegram worker never claims Instagram jobs', async () => {
    await webhook(); await runtime.inbox!.processOnce(); await runtime.outbox!.processOnce();
    expect((await jobs())[0]?.status).toBe('pending');
    expect(send).not.toHaveBeenCalled();
  });
  it('two outbound workers cannot send the same job', async () => {
    await webhook(); await runtime.inbox!.processOnce();
    const second = new InstagramOutboxProcessor(database.db, { sendText: send }, runtime.app.log, loadConfig(environment).outbox, '111');
    await Promise.all([second.processOnce(), runtime.instagramOutbox!.processOnce()]);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('retries a known rejection and records eventual success', async () => {
    send.mockRejectedValueOnce(new InstagramDeliveryError('graph_rate_limit', 'retryable', 5000));
    await webhook(); await runtime.inbox!.processOnce(); await runtime.instagramOutbox!.processOnce();
    expect((await jobs())[0]?.status).toBe('retry');
    await runtime.instagramOutbox!.processOnce(); expect(send).toHaveBeenCalledTimes(1);
    await retryNow(); await runtime.instagramOutbox!.processOnce();
    expect((await jobs())[0]).toMatchObject({ status: 'sent', attemptCount: 2 });
    expect(alert).not.toHaveBeenCalled();
  });
  it('exhausts retries then atomically dead-letters and schedules a Telegram escalation', async () => {
    send.mockRejectedValue(new InstagramDeliveryError('graph_rate_limit', 'retryable'));
    await webhook(); await runtime.inbox!.processOnce(); await runtime.instagramOutbox!.processOnce();
    await retryNow(); await runtime.instagramOutbox!.processOnce();
    expect((await jobs())[0]).toMatchObject({ status: 'dead', attemptCount: 2 });
    const alerts = await database.db.select().from(integrationOutbox).where(eq(integrationOutbox.eventType, 'instagram.escalation'));
    expect(alerts).toHaveLength(1); expect(alert).not.toHaveBeenCalled();
    await runtime.outbox!.processOnce();
    expect(alert).toHaveBeenCalledTimes(1);
    expect((await database.db.select().from(integrationOutbox).where(eq(integrationOutbox.id, alerts[0]!.id)))[0]?.status).toBe('sent');
  });
  it.each(['unknown', 'permanent'] as const)('does not retry a %s outcome and retains the lead', async (outcome) => {
    send.mockRejectedValue(new InstagramDeliveryError('synthetic_failure', outcome));
    await webhook(); await runtime.inbox!.processOnce(); await runtime.instagramOutbox!.processOnce();
    await runtime.instagramOutbox!.processOnce(); await runtime.outbox!.processOnce();
    expect(send).toHaveBeenCalledTimes(1); expect(alert).toHaveBeenCalledWith(expect.objectContaining({ status: 'new' }), outcome === 'unknown');
    expect((await jobs())[0]?.status).toBe('dead');
  });
  it('recovers interrupted sending as unknown, never blind resend', async () => {
    await webhook(); await runtime.inbox!.processOnce();
    const [job] = await jobs();
    await database.db.update(integrationOutbox).set({ status: 'sending', attemptCount: 1, updatedAt: new Date(0) })
      .where(eq(integrationOutbox.id, job!.id));
    await runtime.instagramOutbox!.processOnce(); await runtime.instagramOutbox!.processOnce();
    expect(send).not.toHaveBeenCalled();
    expect((await jobs())[0]).toMatchObject({ status: 'dead', lastError: 'interrupted_send_outcome_unknown' });
    expect(await database.db.select().from(integrationOutbox).where(eq(integrationOutbox.eventType, 'instagram.escalation'))).toHaveLength(1);
  });
  it('rolls back message and reply together if enqueue fails; durable inbox retries', async () => {
    await database.pool.query(`create function test_ig_enqueue_failure() returns trigger language plpgsql as $$
      begin if NEW.destination = 'instagram' then raise exception 'synthetic enqueue failure'; end if; return NEW; end $$;
      create trigger test_ig_enqueue_failure before insert on integration_outbox for each row execute function test_ig_enqueue_failure();`);
    try {
      await webhook(); await runtime.inbox!.processOnce();
      expect((await database.db.select().from(integrationInbox))[0]?.status).toBe('retry');
      expect(await database.db.select().from(leads)).toHaveLength(1);
      expect(await database.db.select().from(leadEvents).where(eq(leadEvents.source, 'instagram_inbound'))).toHaveLength(0);
      expect(await jobs()).toHaveLength(0);
      expect(send).not.toHaveBeenCalled();
    } finally {
      await database.pool.query('drop trigger test_ig_enqueue_failure on integration_outbox; drop function test_ig_enqueue_failure();');
    }
    await database.db.update(integrationInbox).set({ nextAttemptAt: new Date(0) });
    await runtime.inbox!.processOnce(); await runtime.instagramOutbox!.processOnce();
    expect(send).toHaveBeenCalledTimes(1);
    expect((await jobs())[0]?.status).toBe('sent');
  });
  it('does not resend if Meta succeeded but committing the delivery result failed', async () => {
    await webhook(); await runtime.inbox!.processOnce();
    await database.pool.query(`create function test_ig_result_failure() returns trigger language plpgsql as $$
      begin if NEW.destination = 'instagram' and NEW.status = 'sent' then raise exception 'synthetic result failure'; end if; return NEW; end $$;
      create trigger test_ig_result_failure before update on integration_outbox for each row execute function test_ig_result_failure();`);
    try {
      await expect(runtime.instagramOutbox!.processOnce()).rejects.toThrow();
      expect(send).toHaveBeenCalledTimes(1);
      expect((await jobs())[0]?.status).toBe('sending');
    } finally {
      await database.pool.query('drop trigger test_ig_result_failure on integration_outbox; drop function test_ig_result_failure();');
    }
    await database.db.update(integrationOutbox).set({ updatedAt: new Date(0) }).where(eq(integrationOutbox.destination, 'instagram'));
    await runtime.instagramOutbox!.processOnce(); await runtime.outbox!.processOnce();
    expect(send).toHaveBeenCalledTimes(1);
    expect((await jobs())[0]?.status).toBe('dead');
    expect(alert).toHaveBeenCalledWith(expect.anything(), true);
  });
  it('does not let a late sender overwrite a recovered dead-letter', async () => {
    await webhook(); await runtime.inbox!.processOnce();
    let completeSend!: (result: { messageId: string }) => void;
    let started!: () => void;
    const sendStarted = new Promise<void>((resolve) => { started = resolve; });
    send.mockImplementationOnce(() => {
      started();
      return new Promise((resolve) => { completeSend = resolve; });
    });
    const active = runtime.instagramOutbox!.processOnce();
    await sendStarted;
    await database.db.update(integrationOutbox).set({ updatedAt: new Date(0) }).where(eq(integrationOutbox.destination, 'instagram'));
    const recovery = new InstagramOutboxProcessor(database.db, { sendText: send }, runtime.app.log, loadConfig(environment).outbox, '111');
    await recovery.processOnce();
    completeSend({ messageId: 'late-fake-id' }); await active;
    expect((await jobs())[0]?.status).toBe('dead');
    expect(await database.db.select().from(leadEvents).where(eq(leadEvents.eventType, 'instagram_late_send_result'))).toHaveLength(1);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('does not send expired queued work', async () => {
    await webhook(); await runtime.inbox!.processOnce();
    const [job] = await jobs();
    await database.db.update(integrationOutbox).set({ payload: { ...job!.payload, expiresAt: Date.now() - 1 } })
      .where(eq(integrationOutbox.id, job!.id));
    await runtime.instagramOutbox!.processOnce();
    expect(send).not.toHaveBeenCalled(); expect((await jobs())[0]?.status).toBe('dead');
  });
  it('Telegram outage does not lose messages or roll back the Instagram result', async () => {
    alert.mockRejectedValue(new Error('synthetic Telegram unavailable'));
    send.mockRejectedValue(new InstagramDeliveryError('synthetic_failure', 'permanent'));
    await webhook(); await runtime.inbox!.processOnce(); await runtime.instagramOutbox!.processOnce(); await runtime.outbox!.processOnce();
    expect((await jobs())[0]?.status).toBe('dead');
    expect(await database.db.select().from(leads)).toHaveLength(1);
    expect((await database.db.select().from(integrationOutbox).where(eq(integrationOutbox.eventType, 'instagram.escalation')))[0]?.status).toBe('retry');
  });
  it('respects a new rollout cutoff when an old pending job is resumed', async () => {
    await webhook(); await runtime.inbox!.processOnce();
    const restart = new InstagramOutboxProcessor(database.db, { sendText: send }, runtime.app.log,
      loadConfig(environment).outbox, '111', Date.now() + 1000);
    await restart.processOnce();
    expect(send).not.toHaveBeenCalled(); expect((await jobs())[0]?.status).toBe('dead');
  });
  it('exposes only authorized, PII-free delivery diagnostics', async () => {
    await webhook(); await runtime.inbox!.processOnce(); await runtime.instagramOutbox!.processOnce();
    const url = '/api/v1/integrations/meta/events/mid-one';
    expect((await runtime.app.inject(url)).statusCode).toBe(401);
    const result = await runtime.app.inject({ url, headers: { authorization: 'Bearer fake-diagnostic-access-key' } });
    const diagnostic = result.json<{ messagePersisted: boolean; deliveries: Array<{ destination: string; status: string }> }>();
    expect(diagnostic.messagePersisted).toBe(true);
    expect(diagnostic.deliveries).toContainEqual(expect.objectContaining({ destination: 'instagram', status: 'sent' }));
    expect(result.body).not.toContain('SYNTHETIC TEST');
    expect(result.body).not.toContain('fake-outbound-id');
  });
});
