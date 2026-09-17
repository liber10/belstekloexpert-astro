import test from 'node:test';
import assert from 'node:assert/strict';
import {
  materializeCampaignBundle,
  reconcileCampaignBundle,
} from '../src/campaign-bundle-materializer.mjs';
import { recomputeApprovedPlanHash } from '../src/campaign-bundle-spec.mjs';

const NOW = new Date('2026-08-15T12:00:00.000Z');
const BUNDLE_REF = 'bundle_11111111-2222-4333-8444-555555555555';

function plan(mode = 'guarded') {
  return {
    schema_version: 'campaign-bundle/v1',
    policy_version: 'campaign-bundle-policy/v1',
    graph_version: 'v25.0',
    prepared_mode: mode,
    base_write_mode: mode,
    operation: 'materialize_paused_website_leads',
    account: {
      provider_id: 'act_303030303030303',
      scope: 'account_scope_abcdef123456',
      currency: 'USD',
      timezone: 'Europe/Minsk',
    },
    catalog: { version: 'assets/v1', hash: `sha256:${'c'.repeat(64)}` },
    bundle_ref: BUNDLE_REF,
    marker: 'B55555555',
    proposal_expires_at: '2026-08-15T13:00:00.000Z',
    rationale: 'A safe test fixture for a paused campaign bundle.',
    payloads: {
      campaign: {
        name: 'BSE | LEADS | CHIP_REPAIR | B55555555',
        objective: 'OUTCOME_LEADS',
        buying_type: 'AUCTION',
        special_ad_categories: [],
        status: 'PAUSED',
      },
      adset: {
        name: 'MINSK_BROAD | B55555555',
        campaign_id: { $ref: 'campaign.provider_id' },
        lifetime_budget: '3500',
        optimization_goal: 'OFFSITE_CONVERSIONS',
        billing_event: 'IMPRESSIONS',
        bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
        destination_type: 'WEBSITE',
        promoted_object: { pixel_id: '505050505050505', custom_event_type: 'LEAD' },
        targeting: {
          age_min: 18,
          age_max: 65,
          geo_locations: {
            custom_locations: [{ latitude: 53.9, longitude: 27.56, radius: 20, distance_unit: 'kilometer' }],
            location_types: ['home', 'recent'],
          },
        },
        start_time: '2026-09-01T06:00:00.000Z',
        end_time: '2026-09-08T06:00:00.000Z',
        status: 'PAUSED',
      },
      ads: [
        {
          variant_key: 'show_chip',
          creative: { name: 'CHIP_REPAIR | show_chip | B55555555', object_story_spec: { page_id: '404040404040404' } },
          ad: {
            name: 'CHIP_REPAIR | show_chip | v1 | B55555555',
            adset_id: { $ref: 'adset.provider_id' },
            creative: { creative_id: { $ref: 'creative.show_chip.provider_id' } },
            status: 'PAUSED',
          },
        },
      ],
    },
    invariants: { all_delivery_objects_paused: true },
    review: { campaign_name: 'BSE | LEADS | CHIP_REPAIR | B55555555' },
  };
}

function record(mode = 'guarded') {
  const approvedPlan = plan(mode);
  return {
    bundle_ref: BUNDLE_REF,
    state: 'prepared',
    expires_at: approvedPlan.proposal_expires_at,
    approved_plan_hash: recomputeApprovedPlanHash(approvedPlan),
    policy_version: approvedPlan.policy_version,
    graph_version: approvedPlan.graph_version,
    prepared_mode: mode,
    base_write_mode: mode,
    account_scope: approvedPlan.account.scope,
    approved_plan: approvedPlan,
    execution: { writes_performed: false, provider_ids: {}, steps: [] },
  };
}

class FakeStore {
  constructor(initial) {
    this.record = structuredClone(initial);
    this.audits = [];
    this.accountLock = null;
  }

  async withExclusive(action) {
    return action();
  }

  async loadBundle(bundleRef) {
    return bundleRef === this.record.bundle_ref ? structuredClone(this.record) : null;
  }

  async saveBundle(next) {
    this.record = structuredClone(next);
    return structuredClone(next);
  }

  async appendAudit(event) {
    this.audits.push(structuredClone(event));
  }

  async getAccountLock() {
    return this.accountLock ? structuredClone(this.accountLock) : null;
  }

  async setAccountLock(accountScope, details) {
    this.accountLock = { account_scope: accountScope, ...structuredClone(details) };
  }

  async clearAccountLock(accountScope, details = {}) {
    if (this.accountLock && this.accountLock.account_scope === accountScope) this.accountLock = null;
    return details;
  }
}

function policy(mode = 'guarded', overrides = {}) {
  return {
    bundleMode: mode,
    baseWriteMode: mode,
    creationEnabled: mode === 'guarded',
    guardedBlockers: [],
    ...overrides,
  };
}

function commonArgs(store, mode = 'guarded') {
  return {
    store,
    bundleRef: BUNDLE_REF,
    policyProvider: () => policy(mode),
    refreshPlan: async (stored) => ({ approvedPlanHash: stored.approved_plan_hash }),
    verifyApproval: async () => ({ approval_id: '11111111-2222-4333-8444-555555555555', approved_by: 'owner_primary' }),
    validateWriteAccess: async () => ({ ready_for_guarded_write: true }),
    now: () => NOW,
  };
}

function successfulAdapter() {
  const requests = [];
  const objects = new Map();
  const ids = ['1001', '1002', '1003', '1004'];
  return {
    requests,
    async post(path, body) {
      const id = ids[requests.length];
      requests.push({ path, body: structuredClone(body) });
      let current;
      if (path.endsWith('/campaigns')) {
        current = {
          ...structuredClone(body),
          id,
          account_id: '303030303030303',
          name: body.name,
          status: 'PAUSED',
          effective_status: 'PAUSED',
          objective: body.objective,
          buying_type: body.buying_type,
        };
      } else if (path.endsWith('/adsets')) {
        current = {
          ...structuredClone(body),
          id,
          account_id: '303030303030303',
          name: body.name,
          status: 'PAUSED',
          effective_status: 'PAUSED',
          campaign_id: body.campaign_id,
          lifetime_budget: body.lifetime_budget,
        };
      } else if (path.endsWith('/adcreatives')) {
        current = { ...structuredClone(body), id, account_id: '303030303030303' };
      } else {
        current = {
          ...structuredClone(body),
          id,
          account_id: '303030303030303',
          name: body.name,
          status: 'PAUSED',
          effective_status: 'PAUSED',
          adset_id: body.adset_id,
          creative: { id: body.creative.creative_id },
        };
      }
      objects.set(id, current);
      return { id };
    },
    async get(id) {
      return structuredClone(objects.get(String(id)));
    },
    classifyError: () => 'unknown',
  };
}

test('dry-run refreshes the exact plan and performs zero Meta writes', async () => {
  const store = new FakeStore(record('dry-run'));
  let validationCalls = 0;
  let postCalls = 0;
  const args = commonArgs(store, 'dry-run');
  args.validateWriteAccess = async () => {
    validationCalls += 1;
  };
  args.metaAdapter = {
    post: async () => {
      postCalls += 1;
    },
  };

  const first = await materializeCampaignBundle(args);
  const second = await materializeCampaignBundle(args);
  assert.equal(first.state, 'dry_run');
  assert.equal(second.state, 'dry_run');
  assert.equal(first.execution.writes_performed, false);
  assert.equal(first.execution.steps.length, 4);
  assert.equal(validationCalls, 0);
  assert.equal(postCalls, 0);
});

test('guarded materialization creates and verifies the exact PAUSED dependency order once', async () => {
  const store = new FakeStore(record());
  const adapter = successfulAdapter();
  const originalPost = adapter.post.bind(adapter);
  adapter.post = async (...args) => {
    assert.equal(store.accountLock?.bundle_ref, BUNDLE_REF);
    assert.equal(store.accountLock?.state, 'materializing');
    return originalPost(...args);
  };
  const args = { ...commonArgs(store), metaAdapter: adapter };

  const result = await materializeCampaignBundle(args);
  assert.equal(result.state, 'materialized_paused');
  assert.equal(result.execution.writes_performed, true);
  assert.equal(result.execution.steps.every(({ state }) => state === 'verified'), true);
  assert.equal(adapter.requests.length, 4);
  assert.equal(store.accountLock, null);
  assert.deepEqual(
    adapter.requests.map(({ path }) => path.split('/').at(-1)),
    ['campaigns', 'adsets', 'adcreatives', 'ads'],
  );
  assert.equal(adapter.requests[0].body.status, 'PAUSED');
  assert.equal(adapter.requests[1].body.status, 'PAUSED');
  assert.equal(adapter.requests[3].body.status, 'PAUSED');

  const repeated = await materializeCampaignBundle(args);
  assert.equal(repeated.state, 'materialized_paused');
  assert.equal(adapter.requests.length, 4);
});

test('an unknown POST outcome is never retried and locks the account', async () => {
  const store = new FakeStore(record());
  let postCalls = 0;
  const args = commonArgs(store);
  args.metaAdapter = {
    async post() {
      postCalls += 1;
      throw new Error('synthetic timeout');
    },
    classifyError: () => 'unknown',
  };

  await assert.rejects(() => materializeCampaignBundle(args), /no POST will be retried/);
  assert.equal(store.record.state, 'outcome_unknown');
  assert.equal(postCalls, 1);
  assert.equal(store.accountLock.account_scope, 'account_scope_abcdef123456');
  await assert.rejects(() => materializeCampaignBundle(args), /reconcile it before any retry/);
  assert.equal(postCalls, 1);
});

test('a kill-switch change immediately before the first POST performs zero writes', async () => {
  const store = new FakeStore(record());
  let policyCalls = 0;
  let postCalls = 0;
  const args = commonArgs(store);
  args.policyProvider = () => {
    policyCalls += 1;
    return policy(policyCalls >= 3 ? 'off' : 'guarded', {
      baseWriteMode: policyCalls >= 3 ? 'guarded' : 'guarded',
      creationEnabled: policyCalls < 3,
    });
  };
  args.metaAdapter = {
    async post() {
      postCalls += 1;
      return { id: '9999' };
    },
  };

  await assert.rejects(() => materializeCampaignBundle(args), /mode changed|kill switch|blocked/i);
  assert.equal(store.record.state, 'policy_stopped');
  assert.equal(store.accountLock, null);
  assert.equal(postCalls, 0);
});

test('re-verifies the approval after reload and performs no POST when the second verification fails', async () => {
  const store = new FakeStore(record());
  let approvalCalls = 0;
  let postCalls = 0;
  const args = commonArgs(store);
  args.verifyApproval = async () => {
    approvalCalls += 1;
    if (approvalCalls === 2) throw new Error('synthetic detached approval mismatch');
    return { approval_id: '11111111-2222-4333-8444-555555555555', approved_by: 'owner_primary' };
  };
  args.metaAdapter = { post: async () => (postCalls += 1) };

  await assert.rejects(() => materializeCampaignBundle(args), /approval mismatch/);
  assert.equal(approvalCalls, 2);
  assert.equal(postCalls, 0);
  assert.equal(store.accountLock, null);
});

test('stops with the account locked if approval expires between provider steps', async () => {
  const store = new FakeStore(record());
  const adapter = successfulAdapter();
  const args = commonArgs(store);
  let approvalCalls = 0;
  args.verifyApproval = async () => {
    approvalCalls += 1;
    if (approvalCalls === 5) throw new Error('synthetic approval expired');
    return { approval_id: '11111111-2222-4333-8444-555555555555', approved_by: 'owner_primary' };
  };
  args.metaAdapter = adapter;

  await assert.rejects(() => materializeCampaignBundle(args), /approval expired/);
  assert.equal(adapter.requests.length, 1);
  assert.equal(store.record.state, 'partial_paused');
  assert.equal(store.accountLock?.bundle_ref, BUNDLE_REF);
});

test('fails closed when Meta readback changes approved targeting', async () => {
  const store = new FakeStore(record());
  const adapter = successfulAdapter();
  const originalGet = adapter.get.bind(adapter);
  adapter.get = async (id) => {
    const current = await originalGet(id);
    if (String(id) === '1002') current.targeting.age_min = 21;
    return current;
  };

  await assert.rejects(
    () => materializeCampaignBundle({ ...commonArgs(store), metaAdapter: adapter }),
    /read-after-write verification failed/,
  );
  assert.equal(adapter.requests.length, 2);
  assert.equal(store.record.state, 'outcome_unknown');
  assert.equal(store.accountLock?.bundle_ref, BUNDLE_REF);
});

test('fails closed when Meta readback changes approved creative copy', async () => {
  const store = new FakeStore(record());
  const adapter = successfulAdapter();
  const originalGet = adapter.get.bind(adapter);
  adapter.get = async (id) => {
    const current = await originalGet(id);
    if (String(id) === '1003') current.object_story_spec.page_id = '999999999999999';
    return current;
  };

  await assert.rejects(
    () => materializeCampaignBundle({ ...commonArgs(store), metaAdapter: adapter }),
    /read-after-write verification failed/,
  );
  assert.equal(adapter.requests.length, 3);
  assert.equal(store.record.state, 'outcome_unknown');
  assert.equal(store.accountLock?.bundle_ref, BUNDLE_REF);
});

test('reconciles a pre-POST crash lock without attempting provider discovery', async () => {
  const interrupted = record();
  interrupted.state = 'materializing';
  const store = new FakeStore(interrupted);
  store.accountLock = {
    account_scope: interrupted.account_scope,
    bundle_ref: interrupted.bundle_ref,
    locked: true,
    state: 'materializing',
  };
  let providerCalls = 0;
  const result = await reconcileCampaignBundle({
    store,
    bundleRef: BUNDLE_REF,
    metaAdapter: {
      find: async () => (providerCalls += 1),
      get: async () => (providerCalls += 1),
    },
    now: () => NOW,
  });
  assert.equal(result.state, 'prepared');
  assert.equal(result.reconciliation.outcome, 'no_provider_request_started');
  assert.equal(store.accountLock, null);
  assert.equal(providerCalls, 0);
});

test('reconciliation can discover one exact paused object and resume the remaining saga', async () => {
  const failed = record();
  failed.state = 'outcome_unknown';
  failed.execution = {
    mode: 'guarded',
    writes_performed: false,
    approval_verified: true,
    provider_ids: {},
    steps: [{ key: 'campaign', kind: 'campaign', state: 'request_started' }],
  };
  const store = new FakeStore(failed);
  store.accountLock = { account_scope: failed.account_scope, bundle_ref: failed.bundle_ref, locked: true };
  const campaign = {
    id: '7001',
    account_id: '303030303030303',
    name: failed.approved_plan.payloads.campaign.name,
    status: 'PAUSED',
    effective_status: 'PAUSED',
    objective: 'OUTCOME_LEADS',
    buying_type: 'AUCTION',
    special_ad_categories: [],
  };
  const reconcileAdapter = {
    find: async () => [campaign],
    get: async () => campaign,
  };

  const reconciled = await reconcileCampaignBundle({
    store,
    bundleRef: BUNDLE_REF,
    metaAdapter: reconcileAdapter,
    now: () => NOW,
  });
  assert.equal(reconciled.state, 'prepared');
  assert.equal(reconciled.execution.provider_ids['campaign.provider_id'], '7001');
  assert.equal(store.accountLock, null);

  const adapter = successfulAdapter();
  // The campaign already exists, so the remaining sequence begins with the ad set.
  adapter.post = async function post(path, body) {
    const sequence = { adsets: '7002', adcreatives: '7003', ads: '7004' };
    const kind = path.split('/').at(-1);
    const id = sequence[kind];
    this.requests.push({ path, body: structuredClone(body) });
    if (kind === 'adsets') {
      this._objects ??= new Map();
      this._objects.set(id, {
        ...structuredClone(body),
        id,
        account_id: '303030303030303',
        name: body.name,
        status: 'PAUSED',
        effective_status: 'PAUSED',
        campaign_id: body.campaign_id,
        lifetime_budget: body.lifetime_budget,
      });
    } else if (kind === 'adcreatives') {
      this._objects.set(id, { ...structuredClone(body), id, account_id: '303030303030303' });
    } else {
      this._objects.set(id, {
        ...structuredClone(body),
        id,
        account_id: '303030303030303',
        name: body.name,
        status: 'PAUSED',
        effective_status: 'PAUSED',
        adset_id: body.adset_id,
        creative: { id: body.creative.creative_id },
      });
    }
    return { id };
  };
  adapter.get = async function get(id) {
    if (String(id) === '7001') return campaign;
    return structuredClone(this._objects.get(String(id)));
  };
  const result = await materializeCampaignBundle({ ...commonArgs(store), metaAdapter: adapter });
  assert.equal(result.state, 'materialized_paused');
  assert.deepEqual(adapter.requests.map(({ path }) => path.split('/').at(-1)), ['adsets', 'adcreatives', 'ads']);
});
