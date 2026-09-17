import test from 'node:test';
import assert from 'node:assert/strict';
import { runGuardedWritePreflight } from '../src/write-preflight.mjs';

const baseChange = { entityRef: 'campaign_test', before: { status: 'ACTIVE' } };

function handlers(overrides = {}) {
  return {
    checkApproval: () => baseChange,
    validateWriteAccess: async () => ({ ready_for_guarded_write: true }),
    assertCooldown: () => {},
    readCurrent: async () => ({ status: 'ACTIVE' }),
    assertFresh: () => {},
    validatePlan: () => {},
    ...overrides,
  };
}

test('rechecks approval after access validation and reads state only afterwards', async () => {
  const events = [];
  await runGuardedWritePreflight(
    handlers({
      checkApproval: () => {
        events.push('approval');
        return baseChange;
      },
      validateWriteAccess: async () => {
        events.push('access');
        return { ready_for_guarded_write: true };
      },
      assertCooldown: () => events.push('cooldown'),
      readCurrent: async () => {
        events.push('read');
        return { status: 'ACTIVE' };
      },
      assertFresh: () => events.push('fresh'),
      validatePlan: () => events.push('plan'),
    }),
  );
  assert.deepEqual(events, ['approval', 'access', 'approval', 'cooldown', 'read', 'fresh', 'plan']);
});

test('blocks when approval expires during access validation', async () => {
  let approvalChecks = 0;
  let currentRead = false;
  await assert.rejects(
    () =>
      runGuardedWritePreflight(
        handlers({
          checkApproval: () => {
            approvalChecks += 1;
            if (approvalChecks > 1) throw new Error('Change-set expired. Prepare it again.');
            return baseChange;
          },
          readCurrent: async () => {
            currentRead = true;
            return { status: 'ACTIVE' };
          },
        }),
      ),
    /expired/,
  );
  assert.equal(approvalChecks, 2);
  assert.equal(currentRead, false);
});

test('blocks when object state changes during access validation', async () => {
  let currentStatus = 'ACTIVE';
  let planValidated = false;
  await assert.rejects(
    () =>
      runGuardedWritePreflight(
        handlers({
          validateWriteAccess: async () => {
            currentStatus = 'PAUSED';
            return { ready_for_guarded_write: true };
          },
          readCurrent: async () => ({ status: currentStatus }),
          assertFresh: (change, current) => {
            if (change.before.status !== current.status) throw new Error('Entity changed after prepare.');
          },
          validatePlan: () => {
            planValidated = true;
          },
        }),
      ),
    /changed after prepare/,
  );
  assert.equal(planValidated, false);
});
