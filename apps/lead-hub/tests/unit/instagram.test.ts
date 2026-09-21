import { describe, expect, it, vi } from 'vitest';
import { InstagramGraphApiError, InstagramGraphClient } from '../../src/integrations/instagram.js';

const fakeToken = `IG${'x'.repeat(30)}`;

describe('InstagramGraphClient', () => {
  it('reads identity through the fixed Instagram Graph host without exposing the token', async () => {
    const fetchImpl = vi.fn<typeof fetch>((input, init) => {
      const requestUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      expect(requestUrl).toBe('https://graph.instagram.com/me?fields=id%2Cusername');
      expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${fakeToken}`);
      return Promise.resolve(new Response(JSON.stringify({ id: '17840000000000000', username: 'belstekloexpert' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));
    });

    await expect(new InstagramGraphClient({ accessToken: fakeToken, fetchImpl }).getIdentity())
      .resolves.toEqual({ id: '17840000000000000', username: 'belstekloexpert' });
  });

  it('redacts the configured token from provider errors', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify({
      error: { code: '190', message: `Invalid token ${fakeToken}` },
    }), { status: 401 })));

    const error = await new InstagramGraphClient({ accessToken: fakeToken, fetchImpl })
      .getIdentity().catch((value: unknown) => value);

    expect(error).toBeInstanceOf(InstagramGraphApiError);
    expect((error as Error).message).not.toContain(fakeToken);
    expect((error as InstagramGraphApiError).providerCode).toBe('190');
  });

  it('rejects an incomplete identity response', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify({ id: '17840000000000000' }), {
      status: 200,
    })));

    await expect(new InstagramGraphClient({ accessToken: fakeToken, fetchImpl }).getIdentity())
      .rejects.toThrow('identity response is incomplete');
  });
});
