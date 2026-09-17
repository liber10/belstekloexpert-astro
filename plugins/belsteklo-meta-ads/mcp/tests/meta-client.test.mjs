import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { graphGetWithWriteToken, graphList, graphPost, normalizeInsightRow, safeError } from '../src/meta-client.mjs';

test('marks pagination truncated when max pages is reached', async () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.META_READ_ACCESS_TOKEN;
  process.env.META_READ_ACCESS_TOKEN = 'clearly-fake-test-token';
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({ data: [{ value: 1 }], paging: { cursors: { after: 'still-more' } } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  try {
    const result = await graphList('/test', {}, { maxPages: 1, maxItems: 10 });
    assert.equal(result.meta.truncated, true);
    assert.equal(result.meta.truncation_reason, 'max_pages');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.META_READ_ACCESS_TOKEN;
    else process.env.META_READ_ACCESS_TOKEN = originalToken;
  }
});

test('sums duplicate action types instead of overwriting them', () => {
  const row = normalizeInsightRow({
    actions: [
      { action_type: 'lead', value: '2' },
      { action_type: 'lead', value: '3' },
    ],
  });
  assert.equal(row.actions_by_type.lead, 5);
});

test('write-token GET uses the separate credential and appsecret_proof', async () => {
  const originalFetch = globalThis.fetch;
  const originalReadToken = process.env.META_READ_ACCESS_TOKEN;
  const originalWriteToken = process.env.META_WRITE_ACCESS_TOKEN;
  const originalAppSecret = process.env.META_APP_SECRET;
  const writeToken = 'clearly-fake-write-token';
  const appSecret = 'clearly-fake-app-secret';
  let request;
  process.env.META_READ_ACCESS_TOKEN = 'clearly-fake-read-token';
  process.env.META_WRITE_ACCESS_TOKEN = writeToken;
  process.env.META_APP_SECRET = appSecret;
  globalThis.fetch = async (url, options) => {
    request = {
      url: String(url),
      authorization: options.headers.Authorization,
      method: options.method,
      body: options.body,
    };
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  try {
    await graphGetWithWriteToken('/me');
    const expectedProof = crypto.createHmac('sha256', appSecret).update(writeToken).digest('hex');
    assert.equal(request.authorization, `Bearer ${writeToken}`);
    assert.equal(request.method, 'GET');
    assert.equal(request.body, undefined);
    assert.equal(request.url.includes(writeToken), false);
    assert.equal(new URL(request.url).searchParams.get('appsecret_proof'), expectedProof);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalReadToken === undefined) delete process.env.META_READ_ACCESS_TOKEN;
    else process.env.META_READ_ACCESS_TOKEN = originalReadToken;
    if (originalWriteToken === undefined) delete process.env.META_WRITE_ACCESS_TOKEN;
    else process.env.META_WRITE_ACCESS_TOKEN = originalWriteToken;
    if (originalAppSecret === undefined) delete process.env.META_APP_SECRET;
    else process.env.META_APP_SECRET = originalAppSecret;
  }
});

test('every write-token request refuses to call Meta without app secret', async () => {
  const originalFetch = globalThis.fetch;
  const originalWriteToken = process.env.META_WRITE_ACCESS_TOKEN;
  const originalAppSecret = process.env.META_APP_SECRET;
  let fetchCalled = false;
  process.env.META_WRITE_ACCESS_TOKEN = 'clearly-fake-write-token';
  delete process.env.META_APP_SECRET;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return new Response('{}', { status: 200 });
  };
  try {
    await assert.rejects(() => graphGetWithWriteToken('/me'), /META_APP_SECRET is required/);
    await assert.rejects(() => graphPost('/test', { status: 'PAUSED' }), /META_APP_SECRET is required/);
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWriteToken === undefined) delete process.env.META_WRITE_ACCESS_TOKEN;
    else process.env.META_WRITE_ACCESS_TOKEN = originalWriteToken;
    if (originalAppSecret === undefined) delete process.env.META_APP_SECRET;
    else process.env.META_APP_SECRET = originalAppSecret;
  }
});

test('safe errors redact exact configured secrets and account identifiers', () => {
  const originalWriteToken = process.env.META_WRITE_ACCESS_TOKEN;
  const originalAppSecret = process.env.META_APP_SECRET;
  process.env.META_WRITE_ACCESS_TOKEN = 'custom-write-secret-value';
  process.env.META_APP_SECRET = 'custom-app-secret-value';
  try {
    const result = safeError(
      new Error('custom-write-secret-value custom-app-secret-value act_123456789012345'),
    );
    assert.equal(result.error.includes('custom-write-secret-value'), false);
    assert.equal(result.error.includes('custom-app-secret-value'), false);
    assert.equal(result.error.includes('123456789012345'), false);
  } finally {
    if (originalWriteToken === undefined) delete process.env.META_WRITE_ACCESS_TOKEN;
    else process.env.META_WRITE_ACCESS_TOKEN = originalWriteToken;
    if (originalAppSecret === undefined) delete process.env.META_APP_SECRET;
    else process.env.META_APP_SECRET = originalAppSecret;
  }
});
