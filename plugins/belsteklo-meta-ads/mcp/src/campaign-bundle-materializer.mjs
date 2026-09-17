import { taggedSha256 } from './canonical-json.mjs';
import { recomputeApprovedPlanHash } from './campaign-bundle-spec.mjs';

const BUNDLE_REF_PATTERN = /^bundle_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TERMINAL_STATES = new Set(['materialized_paused', 'dry_run']);
const BLOCKED_STATES = new Set([
  'materializing',
  'partial_paused',
  'outcome_unknown',
  'reconciliation_conflict',
  'definitive_failed',
  'policy_stopped',
  'expired',
]);
const READBACK_FIELDS = Object.freeze({
  campaign: 'id,account_id,name,status,effective_status,objective,buying_type,special_ad_categories,created_time,updated_time',
  adset:
    'id,account_id,name,status,effective_status,campaign_id,lifetime_budget,optimization_goal,billing_event,bid_strategy,destination_type,promoted_object,targeting,start_time,end_time,created_time,updated_time',
  creative: 'id,account_id,name,status,object_story_spec,degrees_of_freedom_spec,created_time',
  ad: 'id,account_id,name,status,effective_status,adset_id,creative{id},created_time,updated_time',
});

function nowDate(now) {
  const value = typeof now === 'function' ? now() : now || new Date();
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid materializer clock.');
  return date;
}

function assertBundleRef(bundleRef) {
  if (!BUNDLE_REF_PATTERN.test(String(bundleRef || ''))) throw new Error('Invalid bundle_ref.');
}

function assertNotExpired(record, currentDate) {
  if (Date.parse(record.expires_at) <= currentDate.getTime()) throw new Error('Campaign bundle proposal expired. Prepare it again.');
}

function assertModeBinding(record, policy, expectedMode) {
  if (policy.bundleMode !== expectedMode || record.prepared_mode !== expectedMode) {
    throw new Error('Campaign bundle mode changed after prepare. Prepare a new bundle.');
  }
  if (policy.baseWriteMode !== record.base_write_mode) {
    throw new Error('Base Meta write mode changed after prepare. Prepare a new bundle.');
  }
}

function assertGuardedPolicy(record, policy) {
  assertModeBinding(record, policy, 'guarded');
  if (policy.baseWriteMode !== 'guarded') throw new Error('META_WRITE_MODE must remain guarded.');
  if (!policy.creationEnabled) throw new Error('Campaign bundle creation kill switch is closed.');
  if (policy.guardedBlockers?.length) {
    throw new Error(`Guarded campaign creation is blocked: ${policy.guardedBlockers.join(', ')}.`);
  }
}

function resolvePlaceholders(value, providerIds) {
  if (Array.isArray(value)) return value.map((item) => resolvePlaceholders(item, providerIds));
  if (!value || typeof value !== 'object') return value;
  const keys = Object.keys(value);
  if (keys.length === 1 && keys[0] === '$ref') {
    const resolved = providerIds[value.$ref];
    if (!resolved) throw new Error(`Unresolved provider dependency: ${value.$ref}.`);
    return resolved;
  }
  return Object.fromEntries(keys.map((key) => [key, resolvePlaceholders(value[key], providerIds)]));
}

export function buildCampaignBundleSteps(plan, providerIds = {}) {
  const accountId = plan?.account?.provider_id;
  if (!/^act_\d+$/.test(String(accountId || ''))) throw new Error('Approved plan has an invalid account binding.');
  const steps = [
    {
      key: 'campaign',
      kind: 'campaign',
      path: `/${accountId}/campaigns`,
      body: resolvePlaceholders(plan.payloads.campaign, providerIds),
      fields: READBACK_FIELDS.campaign,
    },
  ];
  if (providerIds['campaign.provider_id']) {
    steps.push({
      key: 'adset',
      kind: 'adset',
      path: `/${accountId}/adsets`,
      body: resolvePlaceholders(plan.payloads.adset, providerIds),
      fields: READBACK_FIELDS.adset,
    });
  }
  if (providerIds['adset.provider_id']) {
    for (const item of plan.payloads.ads) {
      const creativeRef = `creative.${item.variant_key}.provider_id`;
      if (!providerIds[creativeRef]) {
        steps.push({
          key: `creative.${item.variant_key}`,
          kind: 'creative',
          variantKey: item.variant_key,
          path: `/${accountId}/adcreatives`,
          body: resolvePlaceholders(item.creative, providerIds),
          fields: READBACK_FIELDS.creative,
        });
        break;
      }
      const adRef = `ad.${item.variant_key}.provider_id`;
      if (!providerIds[adRef]) {
        steps.push({
          key: `ad.${item.variant_key}`,
          kind: 'ad',
          variantKey: item.variant_key,
          path: `/${accountId}/ads`,
          body: resolvePlaceholders(item.ad, providerIds),
          fields: READBACK_FIELDS.ad,
        });
        break;
      }
    }
  }
  return steps;
}

function providerRefKey(step) {
  if (step.kind === 'campaign') return 'campaign.provider_id';
  if (step.kind === 'adset') return 'adset.provider_id';
  return `${step.kind}.${step.variantKey}.provider_id`;
}

function normalizeAccountId(value) {
  const text = String(value || '');
  return text.startsWith('act_') ? text : `act_${text}`;
}

function assertProviderSubset(expected, actual, label, path = label) {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) {
      throw new Error(`${label} readback differs from the approved plan at ${path}.`);
    }
    expected.forEach((value, index) => assertProviderSubset(value, actual[index], label, `${path}[${index}]`));
    return;
  }
  if (expected && typeof expected === 'object') {
    if (!actual || typeof actual !== 'object' || Array.isArray(actual)) {
      throw new Error(`${label} readback differs from the approved plan at ${path}.`);
    }
    for (const [key, value] of Object.entries(expected)) {
      assertProviderSubset(value, actual[key], label, `${path}.${key}`);
    }
    return;
  }
  if (String(actual) !== String(expected)) {
    throw new Error(`${label} readback differs from the approved plan at ${path}.`);
  }
}

function verifyCreatedObject(step, current, expectedAccountId, providerIds) {
  if (String(current?.name || '') !== String(step.body.name)) throw new Error('Created object name does not match approved plan.');
  if (!current?.account_id || normalizeAccountId(current.account_id) !== expectedAccountId) {
    throw new Error('Created object belongs to a different ad account.');
  }
  if (['campaign', 'adset', 'ad'].includes(step.kind)) {
    if (String(current?.status || '').toUpperCase() !== 'PAUSED') {
      throw new Error('Created delivery object is not configured as PAUSED.');
    }
    if (String(current?.effective_status || '').toUpperCase() === 'ACTIVE') {
      throw new Error('Created delivery object is effectively ACTIVE.');
    }
  }
  if (step.kind === 'campaign') {
    assertProviderSubset(step.body, current, 'Campaign');
  }
  if (step.kind === 'adset') {
    if (String(current.campaign_id) !== String(providerIds['campaign.provider_id'])) {
      throw new Error('Created ad set parent differs from approved plan.');
    }
    const { start_time: expectedStart, end_time: expectedEnd, ...expectedAdset } = step.body;
    assertProviderSubset(expectedAdset, current, 'Ad set');
    if (Date.parse(current.start_time) !== Date.parse(expectedStart)) throw new Error('Created ad set start differs from approved plan.');
    if (Date.parse(current.end_time) !== Date.parse(expectedEnd)) throw new Error('Created ad set end differs from approved plan.');
  }
  if (step.kind === 'creative') assertProviderSubset(step.body, current, 'Creative');
  if (step.kind === 'ad') {
    if (String(current.adset_id) !== String(providerIds['adset.provider_id'])) {
      throw new Error('Created ad parent differs from approved plan.');
    }
    const expectedCreative = providerIds[`creative.${step.variantKey}.provider_id`];
    if (String(current.creative?.id || '') !== String(expectedCreative)) {
      throw new Error('Created ad creative differs from approved plan.');
    }
    const { creative: _creative, ...expectedAd } = step.body;
    assertProviderSubset(expectedAd, current, 'Ad');
  }
}

function ledgerStepDefinition(record, providerIds, ledgerStep) {
  const planned = buildCampaignBundleSteps(record.approved_plan, providerIds).find(({ key }) => key === ledgerStep.key);
  if (planned) return planned;
  const variantKey = ledgerStep.key.includes('.') ? ledgerStep.key.split('.').slice(1).join('.') : undefined;
  const item = variantKey
    ? record.approved_plan.payloads.ads.find(({ variant_key }) => variant_key === variantKey)
    : undefined;
  if (ledgerStep.kind === 'campaign') {
    return {
      key: ledgerStep.key,
      kind: 'campaign',
      body: record.approved_plan.payloads.campaign,
      fields: READBACK_FIELDS.campaign,
    };
  }
  if (ledgerStep.kind === 'adset') {
    return {
      key: ledgerStep.key,
      kind: 'adset',
      body: resolvePlaceholders(record.approved_plan.payloads.adset, providerIds),
      fields: READBACK_FIELDS.adset,
    };
  }
  if (ledgerStep.kind === 'creative' && item) {
    return {
      key: ledgerStep.key,
      kind: 'creative',
      variantKey,
      body: item.creative,
      fields: READBACK_FIELDS.creative,
    };
  }
  if (ledgerStep.kind === 'ad' && item) {
    return {
      key: ledgerStep.key,
      kind: 'ad',
      variantKey,
      body: resolvePlaceholders(item.ad, providerIds),
      fields: READBACK_FIELDS.ad,
    };
  }
  throw new Error('Stored campaign bundle step is not present in the approved plan.');
}

function stepPreview(plan) {
  const rows = [
    { key: 'campaign', kind: 'campaign', name: plan.payloads.campaign.name, status: 'PAUSED' },
    { key: 'adset', kind: 'adset', name: plan.payloads.adset.name, status: 'PAUSED' },
  ];
  for (const item of plan.payloads.ads) {
    rows.push({ key: `creative.${item.variant_key}`, kind: 'creative', name: item.creative.name });
    rows.push({ key: `ad.${item.variant_key}`, kind: 'ad', name: item.ad.name, status: 'PAUSED' });
  }
  return rows.map((row) => ({ ...row, payload_fingerprint: taggedSha256('bse-meta-provider-payload/v1', row) }));
}

async function persistFailure({ store, record, step, classification, error, currentDate }) {
  const hasKnownObjects = Object.keys(record.execution?.provider_ids || {}).length > 0;
  const state =
    classification === 'definitive'
      ? hasKnownObjects
        ? 'partial_paused'
        : 'definitive_failed'
      : classification === 'policy_stop'
        ? hasKnownObjects
          ? 'partial_paused'
          : 'policy_stopped'
        : 'outcome_unknown';
  record.state = state;
  record.updated_at = currentDate.toISOString();
  record.execution.failure = {
    step: step?.key,
    classification,
    provider_status: Number.isInteger(error?.details?.status) ? error.details.status : undefined,
    provider_code: Number.isInteger(error?.details?.code) ? error.details.code : undefined,
  };
  await store.saveBundle(record);
  await store.appendAudit({
    event: `campaign_bundle_${state}`,
    bundle_ref: record.bundle_ref,
    approved_plan_hash: record.approved_plan_hash,
    account_scope: record.account_scope,
    step: step?.key,
    classification,
  });
  if (state === 'outcome_unknown' || hasKnownObjects) {
    await store.setAccountLock(record.account_scope, {
      bundle_ref: record.bundle_ref,
      state,
      reason: 'campaign_bundle_requires_reconciliation',
      created_at: currentDate.toISOString(),
    });
  } else {
    await store.clearAccountLock(record.account_scope, {
      bundle_ref: record.bundle_ref,
      reason_code: 'no_provider_change',
    });
  }
  return state;
}

export async function materializeCampaignBundle({
  store,
  bundleRef,
  policyProvider,
  refreshPlan,
  verifyApproval,
  validateWriteAccess,
  metaAdapter,
  now,
}) {
  assertBundleRef(bundleRef);
  const initialPolicy = policyProvider();
  if (initialPolicy.bundleMode === 'off') throw new Error('Campaign bundle materialization is disabled.');
  if (initialPolicy.baseWriteMode === 'autopilot') throw new Error('Autopilot may not create campaign bundles.');

  return store.withExclusive(async () => {
    let record = await store.loadBundle(bundleRef);
    if (!record) throw new Error('Unknown campaign bundle. Prepare it again.');
    if (TERMINAL_STATES.has(record.state)) return record;
    if (BLOCKED_STATES.has(record.state)) {
      throw new Error(`Campaign bundle is ${record.state}; reconcile it before any retry.`);
    }
    const currentDate = nowDate(now);
    assertNotExpired(record, currentDate);

    if (initialPolicy.bundleMode === 'dry-run') {
      assertModeBinding(record, initialPolicy, 'dry-run');
      const refreshed = await refreshPlan(record, { writeToken: false, now: currentDate });
      if (refreshed.approvedPlanHash !== record.approved_plan_hash) {
        throw new Error('Campaign bundle plan changed after prepare. Prepare a new bundle.');
      }
      record.state = 'dry_run';
      record.updated_at = currentDate.toISOString();
      record.execution = {
        mode: 'dry-run',
        writes_performed: false,
        approval_verified: false,
        steps: stepPreview(record.approved_plan),
      };
      await store.saveBundle(record);
      await store.appendAudit({
        event: 'campaign_bundle_dry_run',
        bundle_ref: record.bundle_ref,
        approved_plan_hash: record.approved_plan_hash,
        account_scope: record.account_scope,
        writes_performed: false,
      });
      return record;
    }

    assertGuardedPolicy(record, initialPolicy);
    const existingLock = await store.getAccountLock(record.account_scope);
    if (existingLock) throw new Error('Campaign creation is locked for this account pending reconciliation.');

    await validateWriteAccess();
    const refreshed = await refreshPlan(record, { writeToken: true, now: currentDate });
    if (refreshed.approvedPlanHash !== record.approved_plan_hash) {
      throw new Error('Campaign bundle plan changed after prepare. Prepare a new bundle.');
    }
    let approval = await verifyApproval(record, currentDate);

    record = await store.loadBundle(bundleRef);
    const preWriteDate = nowDate(now);
    assertNotExpired(record, preWriteDate);
    assertGuardedPolicy(record, policyProvider());
    const preWriteRefresh = await refreshPlan(record, { writeToken: true, now: preWriteDate });
    if (preWriteRefresh.approvedPlanHash !== record.approved_plan_hash) {
      throw new Error('Campaign bundle plan changed immediately before materialization. Prepare a new bundle.');
    }
    if (recomputeApprovedPlanHash(record.approved_plan) !== record.approved_plan_hash) {
      throw new Error('Stored campaign bundle plan failed its integrity check.');
    }
    approval = await verifyApproval(record, preWriteDate);
    await store.setAccountLock(record.account_scope, {
      bundle_ref: record.bundle_ref,
      state: 'materializing',
      reason_code: 'campaign_bundle_in_progress',
    });
    record.state = 'materializing';
    record.updated_at = preWriteDate.toISOString();
    const priorExecution = record.execution || {};
    record.execution = {
      mode: 'guarded',
      writes_performed: Boolean(priorExecution.writes_performed),
      approval_verified: true,
      approval_id: approval.approval_id,
      approved_by: approval.approved_by,
      provider_ids: { ...(priorExecution.provider_ids || {}) },
      steps: [...(priorExecution.steps || [])],
    };
    await store.saveBundle(record);
    await store.appendAudit({
      event: 'campaign_bundle_materializing',
      bundle_ref: record.bundle_ref,
      approved_plan_hash: record.approved_plan_hash,
      account_scope: record.account_scope,
      approval_id: approval.approval_id,
      approved_by: approval.approved_by,
    });

    const expectedSteps = 2 + record.approved_plan.payloads.ads.length * 2;
    while (record.execution.steps.filter(({ state }) => state === 'verified').length < expectedSteps) {
      const step = buildCampaignBundleSteps(record.approved_plan, record.execution.provider_ids).at(-1);
      if (!step) throw new Error('Campaign bundle dependency plan is incomplete.');
      try {
        assertGuardedPolicy(record, policyProvider());
        const beforePostDate = nowDate(now);
        assertNotExpired(record, beforePostDate);
        approval = await verifyApproval(record, beforePostDate);
      } catch (error) {
        await persistFailure({ store, record, step, classification: 'policy_stop', error, currentDate: nowDate(now) });
        throw error;
      }

      const ledgerStep = {
        key: step.key,
        kind: step.kind,
        state: 'request_started',
        payload_fingerprint: taggedSha256('bse-meta-provider-payload/v1', step.body),
        started_at: nowDate(now).toISOString(),
      };
      record.execution.steps.push(ledgerStep);
      await store.saveBundle(record);
      await store.appendAudit({
        event: 'campaign_bundle_request_started',
        bundle_ref: record.bundle_ref,
        approved_plan_hash: record.approved_plan_hash,
        account_scope: record.account_scope,
        step: step.key,
        payload_fingerprint: ledgerStep.payload_fingerprint,
      });

      try {
        const dispatchDate = nowDate(now);
        assertGuardedPolicy(record, policyProvider());
        assertNotExpired(record, dispatchDate);
        approval = await verifyApproval(record, dispatchDate);
      } catch (error) {
        // No provider request has been sent yet. Remove the dispatch marker so
        // reconciliation never searches for an object that cannot exist.
        if (record.execution.steps.at(-1) === ledgerStep) record.execution.steps.pop();
        await persistFailure({ store, record, step, classification: 'policy_stop', error, currentDate: nowDate(now) });
        throw error;
      }

      let response;
      try {
        response = await metaAdapter.post(step.path, step.body);
      } catch (error) {
        const classification = metaAdapter.classifyError?.(error) || 'unknown';
        const state = await persistFailure({ store, record, step, classification, error, currentDate: nowDate(now) });
        throw new Error(`Campaign bundle stopped in ${state}; no POST will be retried automatically.`);
      }
      const providerId = String(response?.id || '');
      if (!/^\d+$/.test(providerId)) {
        const state = await persistFailure({
          store,
          record,
          step,
          classification: 'unknown',
          error: new Error('Provider response did not contain an ID.'),
          currentDate: nowDate(now),
        });
        throw new Error(`Campaign bundle stopped in ${state}; provider response had no usable ID.`);
      }
      record.execution.writes_performed = true;
      record.execution.provider_ids[providerRefKey(step)] = providerId;
      ledgerStep.state = 'provider_confirmed';
      ledgerStep.provider_id = providerId;
      ledgerStep.confirmed_at = nowDate(now).toISOString();
      await store.saveBundle(record);

      let current;
      try {
        current = await metaAdapter.get(providerId, step.fields);
        verifyCreatedObject(step, current, record.approved_plan.account.provider_id, record.execution.provider_ids);
      } catch (error) {
        const state = await persistFailure({
          store,
          record,
          step,
          classification: 'unknown',
          error,
          currentDate: nowDate(now),
        });
        throw new Error(`Campaign bundle stopped in ${state}; read-after-write verification failed.`);
      }
      ledgerStep.state = 'verified';
      ledgerStep.verified_at = nowDate(now).toISOString();
      await store.saveBundle(record);
      await store.appendAudit({
        event: 'campaign_bundle_step_verified',
        bundle_ref: record.bundle_ref,
        approved_plan_hash: record.approved_plan_hash,
        account_scope: record.account_scope,
        step: step.key,
      });
    }

    record.state = 'materialized_paused';
    record.updated_at = nowDate(now).toISOString();
    record.execution.completed_at = record.updated_at;
    await store.saveBundle(record);
    await store.clearAccountLock(record.account_scope, {
      bundle_ref: record.bundle_ref,
      reason_code: 'materialized_paused',
    });
    await store.appendAudit({
      event: 'campaign_bundle_materialized_paused',
      bundle_ref: record.bundle_ref,
      approved_plan_hash: record.approved_plan_hash,
      account_scope: record.account_scope,
      writes_performed: true,
      verified_step_count: expectedSteps,
    });
    return record;
  });
}

export async function reconcileCampaignBundle({ store, bundleRef, metaAdapter, now }) {
  assertBundleRef(bundleRef);
  return store.withExclusive(async () => {
    const record = await store.loadBundle(bundleRef);
    if (!record) throw new Error('Unknown campaign bundle.');
    const accountLock = await store.getAccountLock(record.account_scope);
    const interruptedBeforeStateSave =
      record.state === 'prepared' && accountLock?.bundle_ref === record.bundle_ref;
    if (
      ![
        'materializing',
        'outcome_unknown',
        'partial_paused',
        'reconciliation_conflict',
        'materialized_paused',
      ].includes(record.state) &&
      !interruptedBeforeStateSave
    ) {
      throw new Error(`Campaign bundle state ${record.state} does not require provider reconciliation.`);
    }
    if (accountLock && accountLock.bundle_ref && accountLock.bundle_ref !== record.bundle_ref) {
      throw new Error('Account write lock belongs to a different campaign bundle.');
    }
    const providerIds = record.execution?.provider_ids || {};
    const checks = [];
    for (const ledgerStep of record.execution?.steps || []) {
      const step = ledgerStepDefinition(record, providerIds, ledgerStep);
      let providerId = ledgerStep.provider_id;
      if (!providerId) {
        if (typeof metaAdapter.find !== 'function') {
          checks.push({ step: ledgerStep.key, state: 'unresolved_unknown' });
          continue;
        }
        let matches;
        try {
          matches = await metaAdapter.find(step, { record, providerIds });
        } catch {
          checks.push({ step: ledgerStep.key, state: 'discovery_failed' });
          continue;
        }
        if (!Array.isArray(matches) || matches.length === 0) {
          checks.push({ step: ledgerStep.key, state: 'unresolved_unknown' });
          continue;
        }
        if (matches.length !== 1 || !/^\d+$/.test(String(matches[0]?.id || ''))) {
          checks.push({ step: ledgerStep.key, state: 'discovery_conflict' });
          continue;
        }
        providerId = String(matches[0].id);
        ledgerStep.provider_id = providerId;
        ledgerStep.state = 'provider_confirmed';
        ledgerStep.confirmed_at = nowDate(now).toISOString();
        providerIds[providerRefKey(step)] = providerId;
        record.execution.writes_performed = true;
      }
      try {
        const current = await metaAdapter.get(providerId, step.fields);
        verifyCreatedObject(step, current, record.approved_plan.account.provider_id, providerIds);
        ledgerStep.state = 'verified';
        ledgerStep.verified_at = nowDate(now).toISOString();
        checks.push({ step: ledgerStep.key, state: 'verified_paused' });
      } catch {
        checks.push({ step: ledgerStep.key, state: 'verification_failed' });
      }
    }
    const expectedSteps = 2 + record.approved_plan.payloads.ads.length * 2;
    if ((record.execution?.steps || []).length === 0) {
      record.state = 'prepared';
      record.reconciliation = {
        checked_at: nowDate(now).toISOString(),
        checks: [],
        outcome: 'no_provider_request_started',
      };
      await store.clearAccountLock(record.account_scope, {
        bundle_ref: record.bundle_ref,
        reason_code: 'no_provider_request_started',
      });
      await store.saveBundle(record);
      await store.appendAudit({
        event: 'campaign_bundle_reconciled',
        bundle_ref: record.bundle_ref,
        approved_plan_hash: record.approved_plan_hash,
        account_scope: record.account_scope,
        fully_verified: false,
        expected_step_count: expectedSteps,
        resolved_step_count: 0,
        failed_step_count: 0,
      });
      return record;
    }
    const attemptedStepsVerified = checks.length > 0 && checks.every(({ state }) => state === 'verified_paused');
    const fullyVerified = checks.length === expectedSteps && attemptedStepsVerified;
    record.reconciliation = { checked_at: nowDate(now).toISOString(), checks };
    if (fullyVerified) {
      record.state = 'materialized_paused';
      await store.clearAccountLock(record.account_scope, {
        bundle_ref: record.bundle_ref,
        reason_code: 'reconciled',
      });
    } else if (attemptedStepsVerified) {
      record.state = 'prepared';
      delete record.execution.failure;
      await store.clearAccountLock(record.account_scope, {
        bundle_ref: record.bundle_ref,
        reason_code: 'reconciled',
      });
    } else {
      record.state = checks.some(({ state }) => ['verification_failed', 'discovery_conflict'].includes(state))
        ? 'reconciliation_conflict'
        : record.state;
    }
    record.updated_at = nowDate(now).toISOString();
    await store.saveBundle(record);
    await store.appendAudit({
      event: 'campaign_bundle_reconciled',
      bundle_ref: record.bundle_ref,
      approved_plan_hash: record.approved_plan_hash,
      account_scope: record.account_scope,
      fully_verified: fullyVerified,
      expected_step_count: expectedSteps,
      resolved_step_count: checks.filter(({ state }) => state === 'verified_paused').length,
      failed_step_count: checks.filter(({ state }) => state !== 'verified_paused').length,
    });
    return record;
  });
}
