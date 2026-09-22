import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { InstagramDeliveryError, InstagramMessagingAdapter } from '../../src/integrations/instagram-messaging.js';
import { parseMetaMessageEvents } from '../../src/integrations/meta-messaging.js';

const options = { accessToken: 'fake-instagram-test-token', accountId: '111', graphVersion: 'v25.0', timeoutMs: 1000 };
const adapter = (fetchImpl: typeof fetch) => new InstagramMessagingAdapter({ ...options, fetchImpl });

describe('Instagram Login outbound adapter', () => {
  it('sends only the configured text through the fixed Instagram host', async () => {
    const send = vi.fn<typeof fetch>((url, init) => {
      expect(url).toBe('https://graph.instagram.com/v25.0/111/messages');
      expect(init?.method).toBe('POST');
      expect(init?.redirect).toBe('error');
      expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${options.accessToken}`);
      expect(JSON.parse(init?.body as string)).toEqual({ recipient: { id: '222' }, message: { text: 'Тестовый ответ' } });
      return Promise.resolve(Response.json({ message_id: 'fake-outbound-mid', recipient_id: '222' }));
    });
    await expect(adapter(send).sendText('222', 'Тестовый ответ')).resolves.toEqual({ messageId: 'fake-outbound-mid' });
    expect(send).toHaveBeenCalledTimes(1);
  });
  it.each([
    [429, { error: { code: 4 } }, 'retryable'],
    [400, { error: { code: 190, message: 'sensitive token or client text' } }, 'permanent'],
    [503, { error: { code: 2, is_transient: true } }, 'unknown'],
    [200, {}, 'unknown'],
  ])('classifies HTTP %s without implicit retries or provider message leakage', async (status, body, outcome) => {
    const send = vi.fn<typeof fetch>(() => Promise.resolve(Response.json(body, { status, headers: { 'retry-after': '20' } })));
    const error: unknown = await adapter(send).sendText('222', 'test').catch((value: unknown) => value);
    expect(error).toBeInstanceOf(InstagramDeliveryError);
    expect((error as InstagramDeliveryError).outcome).toBe(outcome);
    expect((error as Error).message).not.toContain('sensitive');
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('treats a network exception as an unknown outcome without logging it', async () => {
    const send = vi.fn<typeof fetch>(() => Promise.reject(new Error(options.accessToken)));
    await expect(adapter(send).sendText('222', 'test')).rejects.toMatchObject({ outcome: 'unknown', message: 'transport_outcome_unknown' });
  });
  it('aborts a stalled request', async () => {
    const send = vi.fn<typeof fetch>((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('abort')));
    }));
    await expect(new InstagramMessagingAdapter({ ...options, timeoutMs: 5, fetchImpl: send }).sendText('222', 'test'))
      .rejects.toMatchObject({ outcome: 'unknown' });
  });
  it('does not call a provider for an invalid target or payload', async () => {
    const send = vi.fn<typeof fetch>();
    await expect(adapter(send).sendText('../ads', 'test')).rejects.toMatchObject({ outcome: 'permanent' });
    await expect(adapter(send).sendText('222', '')).rejects.toMatchObject({ outcome: 'permanent' });
    expect(send).not.toHaveBeenCalled();
  });
});

describe('Instagram inbound guards', () => {
  const parse = (message: Record<string, unknown>, extra: Record<string, unknown> = {}) => parseMetaMessageEvents({
    object: 'instagram', entry: [{ id: '111', messaging: [{ sender: { id: '222' }, recipient: { id: '111' },
      timestamp: Date.now(), message, ...extra }] }],
  }, ['111']);
  it('ignores echoes, deletions, self messages and events without a real mid', () => {
    expect(parse({ mid: 'one', text: 'test', is_echo: true })).toEqual([]);
    expect(parse({ mid: 'one', is_deleted: true })).toEqual([]);
    expect(parse({ text: 'test' })).toEqual([]);
    expect(parse({ mid: 'one' }, { sender: { id: '111' } })).toEqual([]);
  });
  it('preserves supported ad context but never trusts free-form scenario instructions', () => {
    expect(parse({ mid: 'one', referral: { source: 'ADS', ad_id: '123', ref: 'chip_repair' } })[0]?.adId).toBe('123');
    expect(parse({ mid: 'two' }, { referral: { source: 'ADS', ad_id: '123' } })[0]?.adId).toBe('123');
    expect(parse({ mid: 'one', referral: { source: 'OTHER', ad_id: '123' } })[0]?.adId).toBeUndefined();
  });
  it('hashes long message IDs without truncation collisions and retains the original', () => {
    const prefix = 'a'.repeat(260);
    const a = parse({ mid: `${prefix}one` })[0]!;
    const b = parse({ mid: `${prefix}two` })[0]!;
    expect(a.externalEventId).not.toBe(b.externalEventId);
    expect(a.messageId).toBe(`${prefix}one`);
    expect(a.externalEventId.length).toBeLessThan(255);
  });
});

describe('Instagram rollout config', () => {
  it('is off by default and not controlled by Ads write mode', () => {
    expect(loadConfig({ DATABASE_URL: 'postgres://localhost/test', META_WRITE_MODE: 'off' }).instagramMessaging.enabled).toBe(false);
  });
  it('requires explicit rollout settings, texts and escalation', () => {
    expect(() => loadConfig({ DATABASE_URL: 'postgres://localhost/test', INSTAGRAM_MESSAGING_ENABLED: 'true' }))
      .toThrow('INSTAGRAM_REPLY_START_AT');
  });
  it('rejects malformed ad mapping without echoing its value', () => {
    expect(() => loadConfig({ DATABASE_URL: 'postgres://localhost/test', INSTAGRAM_AD_SCENARIOS_JSON: 'private-secret' }))
      .toThrow('Expected JSON object');
  });
});
