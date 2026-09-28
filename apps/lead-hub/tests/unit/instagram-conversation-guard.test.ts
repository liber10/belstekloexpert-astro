import { describe, expect, it, vi } from 'vitest';
import { InstagramConversationHistory } from '../../src/integrations/instagram-conversation-guard.js';

const options = { accessToken: 'fake-instagram-test-token', accountId: '111', graphVersion: 'v25.0', timeoutMs: 1000 };
const guard = (fetchImpl: typeof fetch) => new InstagramConversationHistory({ ...options, fetchImpl });

describe('Instagram first-conversation guard', () => {
  it('allows only the sole matching inbound message and uses fixed read-only endpoints', async () => {
    const fetchImpl = vi.fn<typeof fetch>((url, init) => {
      expect(init?.method).toBe('GET');
      expect(init?.redirect).toBe('error');
      expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${options.accessToken}`);
      expect(url).toBeInstanceOf(URL);
      const request = url as URL;
      expect(request.origin).toBe('https://graph.instagram.com');
      if (request.pathname === '/v25.0/111/conversations') {
        expect(request.searchParams.get('user_id')).toBe('222');
        return Promise.resolve(Response.json({ data: [{ id: 't_opaque-conversation' }] }));
      }
      expect(request.pathname).toBe('/v25.0/t_opaque-conversation');
      expect(request.searchParams.get('fields')).toBe('messages.limit(2){id,from}');
      return Promise.resolve(Response.json({ messages: { data: [{ id: 'mid-one', from: { id: '222' } }] } }));
    });
    await expect(guard(fetchImpl).inspectFirstMessage('222', 'mid-one')).resolves.toBe('first');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it.each([
    [{ data: [{ id: 'mid-one', from: { id: '222' } }, { id: 'older', from: { id: '111' } }] }, 'existing'],
    [{ data: [{ id: 'different', from: { id: '222' } }] }, 'existing'],
    [{ data: [{ id: 'mid-one', from: { id: '222' } }], paging: { next: 'hidden' } }, 'existing'],
    [{ data: [{ id: 'mid-one', from: { id: '111' } }] }, 'unverified'],
    [{ data: [] }, 'unverified'],
  ] as const)('fails closed on non-first or incomplete history %#', async (messages, verdict) => {
    const fetchImpl = vi.fn<typeof fetch>((url) => Promise.resolve(Response.json(
      url instanceof URL && url.pathname.endsWith('/conversations') ? { data: [{ id: '333' }] } : { messages })));
    await expect(guard(fetchImpl).inspectFirstMessage('222', 'mid-one')).resolves.toBe(verdict);
  });

  it('does not treat an empty or inaccessible conversation lookup as a new dialog', async () => {
    const empty = vi.fn<typeof fetch>(() => Promise.resolve(Response.json({ data: [] })));
    await expect(guard(empty).inspectFirstMessage('222', 'mid-one')).resolves.toBe('unverified');
    const denied = vi.fn<typeof fetch>(() => Promise.resolve(Response.json({ error: { message: 'sensitive' } }, { status: 403 })));
    await expect(guard(denied).inspectFirstMessage('222', 'mid-one')).resolves.toBe('unverified');
    const failed = vi.fn<typeof fetch>(() => Promise.reject(new Error(options.accessToken)));
    await expect(guard(failed).inspectFirstMessage('222', 'mid-one')).resolves.toBe('unverified');
  });

  it('never sends an invalid sender ID to the provider', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(guard(fetchImpl).inspectFirstMessage('../ads', 'mid-one')).resolves.toBe('unverified');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
