import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CampaignBundleStore } from '../src/campaign-bundle-store.mjs';

const INTENT_A = `sha256:${'a'.repeat(64)}`;
const INTENT_B = `sha256:${'b'.repeat(64)}`;
const ACCOUNT_SCOPE = 'account_scope_primary';

async function fixture(t, suffix = '') {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), `meta-bundle-store-${suffix}`));
  t.after(async () => {
    await fs.rm(stateDir, { recursive: true, force: true });
  });
  return { stateDir, store: new CampaignBundleStore({ stateDir }) };
}

const createInput = (overrides = {}) => {
  const recordOverrides = overrides.record || {};
  return {
    idempotencyKey: overrides.idempotencyKey || 'campaign-bundle-test-key',
    intentHash: overrides.intentHash || INTENT_A,
    createRecord:
      overrides.createRecord ||
      ((bundleRef) => ({
        account_scope: overrides.accountScope || ACCOUNT_SCOPE,
        state: 'planned',
        policy_version: 'campaign-bundle-policy/v1',
        write_mode: 'dry-run',
        bundle_marker: bundleRef,
        plan: { campaign: { name: 'Internal approved copy' } },
        raw_provider_ids: { campaign: '123456789012345' },
        ...recordOverrides,
      })),
  };
};

test('resolves relative stateDir once and persists records across store restarts', async (t) => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'meta-bundle-relative-'));
  t.after(async () => fs.rm(parent, { recursive: true, force: true }));
  const relative = path.relative(process.cwd(), path.join(parent, 'state'));
  const firstStore = new CampaignBundleStore({ stateDir: relative });
  assert.equal(path.isAbsolute(firstStore.stateDir), true);
  assert.equal(firstStore.stateDir, path.resolve(relative));

  const created = await firstStore.createOrGet(createInput());
  const restarted = new CampaignBundleStore({ stateDir: firstStore.stateDir });
  assert.deepEqual(await restarted.loadBundle(created.bundle_ref), created);
  assert.equal(created.bundle_marker, created.bundle_ref);
});

test('returns the same record for an idempotent intent without storing the raw key', async (t) => {
  const { stateDir, store } = await fixture(t, 'idem-');
  let callbacks = 0;
  const first = await store.createOrGet(
    createInput({
      createRecord: (bundleRef) => {
        callbacks += 1;
        return createInput().createRecord(bundleRef);
      },
    }),
  );
  const second = await store.createOrGet(
    createInput({
      createRecord: () => {
        callbacks += 1;
        throw new Error('must not run for an idempotent retry');
      },
    }),
  );
  assert.deepEqual(second, first);
  assert.equal(callbacks, 1);
  assert.match(first.bundle_ref, /^bundle_[0-9a-f-]{36}$/);

  const serialized = (await fs.readdir(path.join(stateDir, 'bundles')))
    .map((name) => name)
    .join('\n') + (await fs.readFile(path.join(stateDir, 'bundles', `${first.bundle_ref}.json`), 'utf8'));
  assert.equal(serialized.includes('campaign-bundle-test-key'), false);
});

test('rejects idempotency-key reuse for a different intent', async (t) => {
  const { store } = await fixture(t, 'mismatch-');
  await store.createOrGet(createInput());
  await assert.rejects(
    () => store.createOrGet(createInput({ intentHash: INTENT_B })),
    /already used for a different bundle intent/,
  );
  assert.equal((await store.listBundles()).length, 1);
});

test('save is atomic, synchronizes caller metadata, and list exposes only safe summary fields', async (t) => {
  const { stateDir, store } = await fixture(t, 'save-');
  const created = await store.createOrGet(createInput());
  const working = {
    ...created,
    state: 'partial',
    raw_provider_ids: { campaign: '987654321098765' },
    plan: { ads: [{ body: 'Sentinel creative copy' }] },
  };
  const saved = await store.saveBundle(working);
  assert.equal(saved.revision, 2);
  assert.equal(working.revision, 2);
  working.state = 'materializing';
  await store.saveBundle(working);
  assert.equal(working.revision, 3);
  await assert.rejects(() => store.saveBundle({ ...created, state: 'stale-write' }), /record is stale/);

  const [summary] = await store.listBundles();
  assert.equal(summary.state, 'materializing');
  assert.equal('plan' in summary, false);
  assert.equal('raw_provider_ids' in summary, false);
  assert.equal('idempotency_digest' in summary, false);
  assert.equal(JSON.stringify(summary).includes('987654321098765'), false);
  assert.equal(JSON.stringify(summary).includes('Sentinel creative copy'), false);

  const temporaryFiles = (await fs.readdir(path.join(stateDir, 'bundles'))).filter((name) => name.endsWith('.tmp'));
  assert.deepEqual(temporaryFiles, []);
});

test('withExclusive is reentrant for its owner and fails closed for a concurrent writer', async (t) => {
  const { stateDir, store } = await fixture(t, 'lock-');
  await store.init();
  const secondStore = new CampaignBundleStore({ stateDir });
  let releaseOwner;
  let ownerStarted;
  const ownerStartedPromise = new Promise((resolve) => {
    ownerStarted = resolve;
  });
  const releaseOwnerPromise = new Promise((resolve) => {
    releaseOwner = resolve;
  });
  const owner = store.withExclusive(async () => {
    const created = await store.createOrGet(createInput());
    await store.appendAudit({ event: 'bundle_planned', bundle_ref: created.bundle_ref });
    ownerStarted();
    await releaseOwnerPromise;
  });
  await ownerStartedPromise;

  await assert.rejects(() => secondStore.createOrGet(createInput()), /stale lock requires manual reconciliation/);
  const lockDir = path.join(stateDir, '.store.lock');
  assert.equal(await fs.stat(lockDir).then((entry) => entry.isDirectory()), true);
  releaseOwner();
  await owner;
  await assert.rejects(() => fs.stat(lockDir), { code: 'ENOENT' });
});

test('a stale lock directory is never removed automatically', async (t) => {
  const { stateDir, store } = await fixture(t, 'stale-lock-');
  await store.init();
  const lockDir = path.join(stateDir, '.store.lock');
  await fs.mkdir(lockDir);
  await assert.rejects(() => store.createOrGet(createInput()), /manual reconciliation/);
  assert.equal(await fs.stat(lockDir).then((entry) => entry.isDirectory()), true);
  await fs.rmdir(lockDir);
});

test('late async work cannot retain reentrant ownership after withExclusive returns', async (t) => {
  const { stateDir, store } = await fixture(t, 'late-context-');
  const competingStore = new CampaignBundleStore({ stateDir });
  let triggerLate;
  const lateTrigger = new Promise((resolve) => {
    triggerLate = resolve;
  });
  let lateWrite;
  await store.withExclusive(async () => {
    lateWrite = lateTrigger.then(() => store.appendAudit({ event: 'late_write_must_lock' }));
  });

  let releaseCompetitor;
  let competitorStarted;
  const releaseCompetitorPromise = new Promise((resolve) => {
    releaseCompetitor = resolve;
  });
  const competitorStartedPromise = new Promise((resolve) => {
    competitorStarted = resolve;
  });
  const competitor = competingStore.withExclusive(async () => {
    competitorStarted();
    await releaseCompetitorPromise;
  });
  await competitorStartedPromise;
  triggerLate();
  await assert.rejects(() => lateWrite, /stale lock requires manual reconciliation/);
  releaseCompetitor();
  await competitor;
});

test('sets, persists, guards, and clears account-scoped write locks', async (t) => {
  const { stateDir, store } = await fixture(t, 'account-lock-');
  const bundle = await store.createOrGet(createInput());
  const locked = await store.setAccountLock(ACCOUNT_SCOPE, {
    reason: 'campaign_bundle_requires_reconciliation',
    state: 'outcome_unknown',
    bundle_ref: bundle.bundle_ref,
  });
  assert.equal(locked.locked, true);
  assert.deepEqual(await new CampaignBundleStore({ stateDir }).getAccountLock(ACCOUNT_SCOPE), locked);

  const otherBundleRef = 'bundle_00000000-0000-4000-8000-000000000000';
  await assert.rejects(
    () => store.setAccountLock(ACCOUNT_SCOPE, { reason: 'outcome_unknown', bundle_ref: otherBundleRef }),
    /different unresolved write lock/,
  );
  await assert.rejects(
    () => store.clearAccountLock(ACCOUNT_SCOPE, { bundle_ref: otherBundleRef }),
    /belongs to a different bundle/,
  );

  const cleared = await store.clearAccountLock(ACCOUNT_SCOPE, {
    bundle_ref: bundle.bundle_ref,
    reason_code: 'reconciled',
  });
  assert.equal(cleared.locked, false);
  assert.equal(await store.getAccountLock(ACCOUNT_SCOPE), null);
});

test('audit uses a strict safe projection and never writes raw IDs, copy, or credentials', async (t) => {
  const { stateDir, store } = await fixture(t, 'audit-');
  const bundle = await store.createOrGet(createInput());
  const sentinelToken = 'EAA_THIS_MUST_NEVER_APPEAR';
  const sentinelCopy = 'PRIVATE CREATIVE COPY SENTINEL';
  const rawId = '1772344387539896';
  const event = await store.appendAudit({
    event: 'bundle_partial',
    bundle_ref: bundle.bundle_ref,
    account_scope: ACCOUNT_SCOPE,
    state: 'partial',
    step: 'adset_create',
    outcome: 'known_failure',
    reason_code: 'provider_rejected',
    policy_version: 'campaign-bundle-policy/v1',
    write_mode: 'guarded',
    approved_plan_hash: `sha256:${'d'.repeat(64)}`,
    payload_fingerprint: `sha256:${'e'.repeat(64)}`,
    approval_id: '00000000-0000-4000-8000-000000000000',
    classification: 'definitive',
    writes_performed: true,
    created_count: 2,
    verified_step_count: 1,
    access_token: sentinelToken,
    raw_provider_ids: { campaign_id: rawId },
    plan: { copy: sentinelCopy },
  });
  assert.equal(event.event, 'bundle_partial');
  assert.equal('access_token' in event, false);

  const auditText = await fs.readFile(path.join(stateDir, 'audit.jsonl'), 'utf8');
  for (const forbidden of [sentinelToken, sentinelCopy, rawId, 'raw_provider_ids', 'campaign_id']) {
    assert.equal(auditText.includes(forbidden), false);
  }
  assert.deepEqual(await store.listAudit(), [event]);
});

test('rejects path-like refs, unsafe account scopes, and credentials in durable records', async (t) => {
  const { store } = await fixture(t, 'validation-');
  await assert.rejects(() => store.loadBundle('../bundle_deadbeef'), /Invalid bundle_ref/);
  await assert.rejects(
    () => store.createOrGet(createInput({ accountScope: 'act_1772344387539896' })),
    /Invalid account_scope/,
  );
  await assert.rejects(
    () => store.createOrGet(createInput({ record: { state: 'planned', access_token: 'secret' } })),
    /may not contain credentials/,
  );
});
