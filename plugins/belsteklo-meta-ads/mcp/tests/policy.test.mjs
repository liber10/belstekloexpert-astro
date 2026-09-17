import test from 'node:test';
import assert from 'node:assert/strict';
import { assertFresh, planChange } from '../src/policy.mjs';

const policy = {
  writeMode: 'guarded',
  maxBudgetChangePct: 20,
  maxDailyBudgetMinor: 5000,
};

test('prepares a reversible pause', () => {
  const plan = planChange({ entityType: 'ad', operation: 'pause', current: { status: 'ACTIVE' }, policy });
  assert.deepEqual(plan.payload, { status: 'PAUSED' });
  assert.deepEqual(plan.before, { status: 'ACTIVE' });
});

test('rejects budget changes beyond the percentage cap', () => {
  assert.throws(() =>
    planChange({
      entityType: 'adset',
      operation: 'set_daily_budget',
      requestedBudgetMinor: 1300,
      current: { daily_budget: '1000' },
      policy,
    }),
  );
});

test('autopilot cannot resume or increase budget', () => {
  const autopilot = { ...policy, writeMode: 'autopilot' };
  assert.throws(() => planChange({ entityType: 'ad', operation: 'resume', current: { status: 'PAUSED' }, policy: autopilot }));
  assert.throws(() =>
    planChange({ entityType: 'adset', operation: 'set_daily_budget', requestedBudgetMinor: 1100, current: { daily_budget: '1000' }, policy: autopilot }),
  );
});

test('stale state is rejected', () => {
  assert.throws(() => assertFresh({ before: { status: 'ACTIVE' } }, { status: 'PAUSED' }));
});
