import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { ChangeStore } from '../src/change-store.mjs';

test('returns the same prepared change for the same idempotent intent', async () => {
  const store = new ChangeStore({ auditLogPath: path.join(os.tmpdir(), `meta-audit-${Date.now()}.jsonl`) });
  const input = {
    entityRef: 'ad_abc',
    entityType: 'ad',
    rawId: '123',
    accountId: 'act_456',
    operation: 'pause',
    before: { status: 'ACTIVE' },
    after: { status: 'PAUSED' },
    payload: { status: 'PAUSED' },
    reason: 'Unit test safety check',
    idempotencyKey: 'unit-test-key',
  };
  const first = await store.create(input, 15);
  const second = await store.create(input, 15);
  assert.equal(second.id, first.id);
  assert.equal(second.approvalCode, first.approvalCode);
});

test('rejects idempotency key reuse for a different change', async () => {
  const store = new ChangeStore({ auditLogPath: path.join(os.tmpdir(), `meta-audit-${Date.now()}-2.jsonl`) });
  const base = {
    entityRef: 'ad_abc',
    entityType: 'ad',
    rawId: '123',
    accountId: 'act_456',
    operation: 'pause',
    before: { status: 'ACTIVE' },
    after: { status: 'PAUSED' },
    payload: { status: 'PAUSED' },
    reason: 'Unit test safety check',
    idempotencyKey: 'reused-test-key',
  };
  await store.create(base, 15);
  await assert.rejects(() => store.create({ ...base, entityRef: 'ad_other' }, 15));
});
