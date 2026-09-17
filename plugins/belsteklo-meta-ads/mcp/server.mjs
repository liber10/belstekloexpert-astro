import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  allowedAdAccounts,
  graphVersion,
  loadPolicy,
  resolveAdAccountId,
  tokenStatus,
} from './src/config.mjs';
import { ChangeStore } from './src/change-store.mjs';
import { verifyBundleApproval } from './src/approval-verifier.mjs';
import { loadDetachedApprovalFile } from './src/approval-file.mjs';
import {
  loadCampaignBundleCatalog,
  loadCampaignBundlePolicy,
} from './src/campaign-bundle-config.mjs';
import {
  materializeCampaignBundle,
  reconcileCampaignBundle,
} from './src/campaign-bundle-materializer.mjs';
import {
  buildCampaignBundlePlan,
  prepareCampaignBundleInputSchema,
  recomputeApprovedPlanHash,
} from './src/campaign-bundle-spec.mjs';
import { CampaignBundleStore } from './src/campaign-bundle-store.mjs';
import {
  MetaApiError,
  graphGet,
  graphGetWithWriteToken,
  graphList,
  graphListWithWriteToken,
  graphPost,
  normalizeInsightRow,
  safeError,
} from './src/meta-client.mjs';
import { assertFresh, planChange } from './src/policy.mjs';
import { ReferenceRegistry } from './src/references.mjs';
import { evaluateWriteAccess } from './src/write-access.mjs';
import { runGuardedWritePreflight } from './src/write-preflight.mjs';

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true };
const PREPARE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false };
const RECONCILE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true };
const WRITE = { readOnlyHint: false, destructiveHint: true, idempotentHint: false };
const accountInput = { ad_account_id: z.string().optional() };
const registry = new ReferenceRegistry();
const store = new ChangeStore(loadPolicy());

const SAFE_OUTPUT_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,199}$/;
const SAFE_OUTPUT_REF_PATTERN = /^[A-Za-z][A-Za-z0-9._:/-]{2,199}$/;
const BUNDLE_REF_PATTERN = /^bundle_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ACCOUNT_SCOPE_PATTERN = /^account_scope_[a-z0-9][a-z0-9_-]{2,63}$/;
const TAGGED_SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RAW_OUTPUT_PATTERN = /(?:EAA[A-Za-z0-9_-]{12,}|act_\d+|\b\d{8,}\b)/u;
const COPY_CONTACT_PATTERN = /(?:[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|(?:\+?\d[\s().-]*){7,})/u;

function containsConfiguredCredential(value) {
  return ['META_READ_ACCESS_TOKEN', 'META_WRITE_ACCESS_TOKEN', 'META_APP_SECRET'].some((name) => {
    const credential = process.env[name]?.trim();
    return credential ? value.includes(credential) : false;
  });
}

function outputTextSchema(maximum, { allowEmpty = false, copy = false } = {}) {
  return z
    .string()
    .min(allowEmpty ? 0 : 1)
    .max(maximum)
    .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value), { message: 'Output text contains control characters.' })
    .refine((value) => !RAW_OUTPUT_PATTERN.test(value), { message: 'Output text contains a raw provider identifier.' })
    .refine((value) => !containsConfiguredCredential(value), { message: 'Output text contains a configured credential.' })
    .refine((value) => !copy || !COPY_CONTACT_PATTERN.test(value), { message: 'Output copy contains contact data.' });
}

const outputTimestampSchema = z.string().datetime({ offset: true });
const outputCodeSchema = z
  .string()
  .regex(SAFE_OUTPUT_CODE_PATTERN)
  .refine((value) => !RAW_OUTPUT_PATTERN.test(value) && !containsConfiguredCredential(value));
const outputRefSchema = z
  .string()
  .regex(SAFE_OUTPUT_REF_PATTERN)
  .refine((value) => !RAW_OUTPUT_PATTERN.test(value) && !containsConfiguredCredential(value));
const outputHashSchema = z.string().regex(TAGGED_SHA256_PATTERN);
const nonNegativeSafeIntegerSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const positiveSafeIntegerSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

const safeClaimReviewSchema = z
  .object({
    key: outputRefSchema,
    kind: z.literal('PRICE_FROM'),
    approved_text: outputTextSchema(80, { copy: true }),
    currency: z.literal('BYN'),
    amount_minor: positiveSafeIntegerSchema,
    evidence_refs: z.array(outputRefSchema).min(2).max(8),
    reviewed_at: outputTimestampSchema,
    valid_until: outputTimestampSchema,
  })
  .strict();

const safeAdReviewSchema = z
  .object({
    variant_key: outputRefSchema,
    media_key: outputRefSchema,
    media_content_sha256: outputHashSchema,
    rights_ref: outputRefSchema,
    creative_name: outputTextSchema(200),
    ad_name: outputTextSchema(200),
    primary_text: outputTextSchema(500, { copy: true }),
    headline: outputTextSchema(100, { copy: true }),
    description: outputTextSchema(200, { allowEmpty: true, copy: true }),
    call_to_action: z.enum(['GET_QUOTE', 'LEARN_MORE']),
    landing_url: outputTextSchema(1000),
    claims: z.array(safeClaimReviewSchema).max(2),
  })
  .strict();

const safeBundleReviewSchema = z
  .object({
    campaign_name: outputTextSchema(200),
    adset_name: outputTextSchema(200),
    account_scope: z.string().regex(ACCOUNT_SCOPE_PATTERN),
    currency: z.literal('USD'),
    timezone: z.literal('Europe/Minsk'),
    lifetime_budget_minor: positiveSafeIntegerSchema,
    start_time: outputTimestampSchema,
    end_time: outputTimestampSchema,
    targeting_template: z
      .object({ key: outputRefSchema, version: outputRefSchema, summary: outputTextSchema(300) })
      .strict(),
    page: z.object({ key: outputRefSchema, label: outputTextSchema(120) }).strict(),
    pixel: z.object({ key: outputRefSchema, label: outputTextSchema(120) }).strict(),
    ads: z.array(safeAdReviewSchema).min(1).max(3),
  })
  .strict();

const safeBundleInvariantsSchema = z
  .object({
    all_delivery_objects_paused: z.literal(true),
    objective: z.literal('OUTCOME_LEADS'),
    conversion_location: z.literal('WEBSITE'),
    budget_owner: z.literal('adset'),
    budget_type: z.literal('lifetime'),
    placements: z.literal('ADVANTAGE_BY_OMISSION'),
    activation_supported: z.literal(false),
    delete_supported: z.literal(false),
  })
  .strict();

const safeExecutionStepSchema = z
  .object({
    key: outputCodeSchema,
    kind: z.enum(['campaign', 'adset', 'creative', 'ad']),
    state: z.enum(['request_started', 'provider_confirmed', 'verified']).optional(),
    started_at: outputTimestampSchema.optional(),
    confirmed_at: outputTimestampSchema.optional(),
    verified_at: outputTimestampSchema.optional(),
  })
  .strict();

const safeReconciliationCheckSchema = z
  .object({
    step: outputCodeSchema,
    state: z.enum([
      'unresolved_unknown',
      'discovery_failed',
      'discovery_conflict',
      'verified_paused',
      'verification_failed',
    ]),
  })
  .strict();

const jsonResult = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });
const errorResult = (error) => ({
  content: [{ type: 'text', text: JSON.stringify(safeError(error), null, 2) }],
  isError: true,
});
const withErrors = (handler) => async (args) => {
  try {
    return await handler(args || {});
  } catch (error) {
    return errorResult(error);
  }
};

function entityRef(type, id, accountId, metadata = {}) {
  return registry.register(type, id, accountId, metadata);
}

function sanitizeAsset(type, row, accountId) {
  const ref = entityRef(type, row.id, accountId, { name: row.name });
  const result = { ...row, entity_ref: ref };
  delete result.id;
  for (const [field, parentType] of [
    ['campaign_id', 'campaign'],
    ['adset_id', 'adset'],
  ]) {
    if (result[field]) {
      result[field.replace('_id', '_ref')] = entityRef(parentType, result[field], accountId);
      delete result[field];
    }
  }
  if (result.creative?.id) {
    result.creative = {
      ...result.creative,
      entity_ref: entityRef('creative', result.creative.id, accountId),
    };
    delete result.creative.id;
  }
  return result;
}

function sanitizeInsight(row, accountId) {
  const normalized = normalizeInsightRow(row);
  const result = { ...normalized };
  for (const [field, type] of [
    ['account_id', 'account'],
    ['campaign_id', 'campaign'],
    ['adset_id', 'adset'],
    ['ad_id', 'ad'],
  ]) {
    if (result[field]) {
      result[field.replace('_id', '_ref')] = entityRef(type, result[field], accountId);
      delete result[field];
    }
  }
  return result;
}

async function listVisibleAllowedAccounts(limit = 500) {
  const allowed = allowedAdAccounts();
  const accounts = await graphList(
    '/me/adaccounts',
    { fields: 'id,name,account_status,currency,timezone_name,business_name,amount_spent,balance' },
    { maxPages: 10, maxItems: limit },
  );
  return {
    ...accounts,
    data: accounts.data
      .filter((account) => allowed.has(account.id))
      .map((account) => sanitizeAsset('account', account, account.id)),
  };
}

async function listVisibleAllowedAccountsWithWriteToken(limit = 500) {
  const allowed = allowedAdAccounts();
  if (allowed.size === 0) throw new Error('No Meta ad accounts are configured in the local allowlist.');
  const accountIds = [...allowed].slice(0, limit);
  const rows = [];
  for (const account of accountIds) {
    const row = await graphGetWithWriteToken(`/${account}`, {
      fields: 'id,name,account_status,currency,timezone_name',
    });
    rows.push(sanitizeAsset('account', row, account));
  }
  return {
    data: rows,
    meta: {
      items_returned: rows.length,
      configured_accounts: allowed.size,
      truncated: allowed.size > accountIds.length,
    },
  };
}

async function validateWriteAccess() {
  const status = tokenStatus();
  if (!status.write_token_configured) throw new Error('META_WRITE_ACCESS_TOKEN is not available to the MCP process.');
  if (!status.app_secret_proof_enabled) throw new Error('META_APP_SECRET is required before validating or using the write token.');

  const accounts = await listVisibleAllowedAccountsWithWriteToken();
  let permissions = [];
  let permissionEndpointAvailable = true;
  try {
    const response = await graphGetWithWriteToken('/me/permissions');
    permissions = (response?.data || []).map(({ permission, status: permissionStatus }) => ({
      permission,
      status: permissionStatus,
    }));
  } catch {
    permissionEndpointAvailable = false;
  }
  const evaluation = evaluateWriteAccess({
    permissions,
    permissionEndpointAvailable,
    appSecretProofEnabled: status.app_secret_proof_enabled,
    visibleAccountCount: accounts.data.length,
    configuredAccountCount: allowedAdAccounts().size,
  });

  return {
    ...evaluation,
    graph_version: graphVersion(),
    write_token_accepted: true,
    app_secret_proof_enabled: status.app_secret_proof_enabled,
    permission_endpoint_available: permissionEndpointAvailable,
    writes_performed: false,
    visible_allowed_accounts: accounts.data,
    pagination: accounts.meta,
  };
}

const bundleStores = new Map();
const PROVISIONAL_BUNDLE_REF = 'bundle_00000000-0000-4000-8000-000000000000';

async function bundleStoreFor(policy) {
  let bundleStore = bundleStores.get(policy.stateDir);
  if (!bundleStore) {
    bundleStore = new CampaignBundleStore({ stateDir: policy.stateDir });
    await bundleStore.init();
    bundleStores.set(policy.stateDir, bundleStore);
  }
  return bundleStore;
}

function approvedCatalogFor(policy) {
  if (!policy.assetCatalogPath) {
    throw new Error('META_BUNDLE_ASSET_CATALOG_PATH is required before preparing a campaign bundle.');
  }
  return loadCampaignBundleCatalog(policy.assetCatalogPath);
}

async function loadBundleAccount({ accountId, writeToken = false } = {}) {
  const account = resolveAdAccountId(accountId);
  const get = writeToken ? graphGetWithWriteToken : graphGet;
  return get(`/${account}`, {
    fields: 'id,name,account_status,currency,timezone_name,min_daily_budget',
  });
}

function safeBundleRecord(record) {
  if (!record) return null;
  if (!record.approved_plan || typeof record.approved_plan !== 'object' || Array.isArray(record.approved_plan)) {
    throw new Error('Campaign bundle state is malformed; no data was returned.');
  }
  const accountId = record.approved_plan.account.provider_id;
  const objectRefs = (record.execution?.steps || [])
    .filter(({ provider_id }) => /^\d+$/.test(String(provider_id || '')))
    .map((step) => ({
      step: step.key,
      kind: step.kind,
      entity_ref: entityRef(step.kind, step.provider_id, accountId),
      state: step.state,
    }));
  const failure = record.execution?.failure
    ? {
        step: record.execution.failure.step,
        classification: record.execution.failure.classification,
        provider_status: record.execution.failure.provider_status,
        provider_code: record.execution.failure.provider_code,
      }
    : undefined;
  return {
    bundle_ref: record.bundle_ref,
    state: record.state,
    account_scope: record.account_scope,
    approved_plan_hash: record.approved_plan_hash,
    policy_version: record.policy_version,
    graph_version: record.graph_version,
    prepared_mode: record.prepared_mode,
    base_write_mode: record.base_write_mode,
    created_at: record.created_at,
    updated_at: record.updated_at,
    expires_at: record.expires_at,
    safe_preview: record.safe_preview,
    execution: record.execution
      ? {
          mode: record.execution.mode,
          writes_performed: Boolean(record.execution.writes_performed),
          approval_verified: Boolean(record.execution.approval_verified),
          approval_id: record.execution.approval_id,
          steps: (record.execution.steps || []).map(({ key, kind, state, started_at, confirmed_at, verified_at }) => ({
            key,
            kind,
            state,
            started_at,
            confirmed_at,
            verified_at,
          })),
          object_refs: objectRefs,
          failure,
          completed_at: record.execution.completed_at,
        }
      : undefined,
    reconciliation: record.reconciliation,
  };
}

async function loadDetachedApproval(policy, bundleRef) {
  if (!policy.approvalsPath || !policy.approvalPublicKeyB64) {
    throw new Error('Detached campaign-bundle approval is not configured.');
  }
  return loadDetachedApprovalFile({ approvalsPath: policy.approvalsPath, bundleRef });
}

async function refreshCampaignBundlePlan(record, { writeToken, now }) {
  const policy = loadCampaignBundlePolicy();
  const { catalog, catalogHash } = approvedCatalogFor(policy);
  const account = await loadBundleAccount({
    accountId: record.approved_plan.account.provider_id,
    writeToken,
  });
  return buildCampaignBundlePlan({
    bundleRef: record.bundle_ref,
    request: record.request,
    catalog,
    catalogHash,
    account,
    policy,
    graphVersion: graphVersion(),
    now,
    proposalExpiresAt: record.expires_at,
  });
}

async function assertBundleWriteAccess() {
  const result = await validateWriteAccess();
  if (!result.ready_for_guarded_write) {
    throw new Error('The ads-only write principal did not pass least-privilege validation.');
  }
  return result;
}

function classifyBundleWriteError(error) {
  if (error instanceof MetaApiError) {
    const status = Number(error.details?.status);
    const retryUnsafeStatus = [408, 409, 425, 429].includes(status);
    if (status >= 400 && status < 500 && !retryUnsafeStatus && !error.details?.is_transient) return 'definitive';
  }
  return 'unknown';
}

function campaignBundleMetaAdapter() {
  return {
    post: (pathname, body) => graphPost(pathname, body),
    get: (providerId, fields) => graphGetWithWriteToken(`/${providerId}`, { fields }),
    classifyError: classifyBundleWriteError,
    find: async (step, { record }) => {
      const endpointByKind = {
        campaign: 'campaigns',
        adset: 'adsets',
        creative: 'adcreatives',
        ad: 'ads',
      };
      const fieldsByKind = {
        campaign: 'id,account_id,name,status,effective_status,objective,buying_type,created_time',
        adset: 'id,account_id,name,status,effective_status,campaign_id,lifetime_budget,created_time',
        creative: 'id,account_id,name,status,created_time',
        ad: 'id,account_id,name,status,effective_status,adset_id,creative{id},created_time',
      };
      const endpoint = endpointByKind[step.kind];
      if (!endpoint) throw new Error('Unsupported reconciliation step kind.');
      const result = await graphListWithWriteToken(
        `/${record.approved_plan.account.provider_id}/${endpoint}`,
        { fields: fieldsByKind[step.kind] },
        { maxPages: 10, maxItems: 500, pageLimit: 100 },
      );
      return result.data.filter((row) => {
        if (String(row.name || '') !== String(step.body.name || '')) return false;
        if (step.kind === 'adset' && String(row.campaign_id || '') !== String(step.body.campaign_id || '')) return false;
        if (step.kind === 'ad' && String(row.adset_id || '') !== String(step.body.adset_id || '')) return false;
        return true;
      });
    },
  };
}

async function prepareCampaignBundle(request) {
  const policy = loadCampaignBundlePolicy();
  const { catalog, catalogHash } = approvedCatalogFor(policy);
  const account = await loadBundleAccount();
  const preparedAt = new Date();
  const provisional = buildCampaignBundlePlan({
    bundleRef: PROVISIONAL_BUNDLE_REF,
    request,
    catalog,
    catalogHash,
    account,
    policy,
    graphVersion: graphVersion(),
    now: preparedAt,
  });
  const bundleStore = await bundleStoreFor(policy);
  const stored = await bundleStore.createOrGet({
    idempotencyKey: provisional.parsedRequest.idempotency_key,
    intentHash: provisional.intentHash,
    createRecord: async (bundleRef) => {
      const exact = buildCampaignBundlePlan({
        bundleRef,
        request: provisional.parsedRequest,
        catalog,
        catalogHash,
        account,
        policy,
        graphVersion: graphVersion(),
        now: preparedAt,
        proposalExpiresAt: provisional.plan.proposal_expires_at,
      });
      return {
        state: 'prepared',
        account_scope: exact.plan.account.scope,
        approved_plan_hash: exact.approvedPlanHash,
        policy_version: exact.plan.policy_version,
        graph_version: exact.plan.graph_version,
        prepared_mode: exact.plan.prepared_mode,
        base_write_mode: exact.plan.base_write_mode,
        prepared_at: preparedAt.toISOString(),
        expires_at: exact.plan.proposal_expires_at,
        request: exact.parsedRequest,
        approved_plan: exact.plan,
        safe_preview: exact.safePreview,
        execution: { writes_performed: false, approval_verified: false, provider_ids: {}, steps: [] },
      };
    },
  });
  await bundleStore.appendAudit({
    event: 'campaign_bundle_prepared',
    bundle_ref: stored.bundle_ref,
    account_scope: stored.account_scope,
    intent_hash: stored.intent_hash,
    approved_plan_hash: stored.approved_plan_hash,
    policy_version: stored.policy_version,
    write_mode: stored.prepared_mode,
    writes_performed: false,
  });
  return safeBundleRecord(stored);
}

const server = new McpServer(
  { name: 'belsteklo-meta-ads', version: '0.1.0' },
  {
    instructions:
      'BelStekloExpert Meta Ads control plane. Raw Meta IDs and tokens are not returned. Writes are disabled by default. Legacy bounded changes require a short-lived change-set; PAUSED campaign-bundle creation has a separate kill switch, durable ledger, exact plan hash, detached Ed25519 human approval, and provider reconciliation. Activation and publishing are not supported. Never ask the user to paste credentials or lead PII into chat.',
  },
);

server.registerTool(
  'meta_connection_status',
  {
    title: 'Meta Ads connection status',
    description: 'Checks token visibility and lists only allow-listed visible accounts without returning raw IDs.',
    inputSchema: z.object({}),
    annotations: READ_ONLY,
  },
  withErrors(async () => {
    const allowed = allowedAdAccounts();
    const accounts = await listVisibleAllowedAccounts();
    let permissions = [];
    try {
      const response = await graphGet('/me/permissions');
      permissions = (response?.data || []).map(({ permission, status }) => ({ permission, status }));
    } catch {
      // Some system-user tokens do not expose /me/permissions.
    }
    return jsonResult({
      ok: true,
      graph_version: graphVersion(),
      ...tokenStatus(),
      write_mode: loadPolicy().writeMode,
      allowed_account_count: allowed.size,
      visible_allowed_accounts: accounts.data,
      permissions,
      pagination: accounts.meta,
    });
  }),
);

server.registerTool(
  'meta_validate_write_access',
  {
    title: 'Validate Meta Ads write access',
    description:
      'Uses the configured write token for non-mutating GET requests to verify required permissions, appsecret_proof, and allow-listed account visibility without returning credentials or raw IDs.',
    inputSchema: z.object({}),
    annotations: READ_ONLY,
  },
  withErrors(async () => jsonResult(await validateWriteAccess())),
);

server.registerTool(
  'meta_list_ad_accounts',
  {
    title: 'List allow-listed Meta ad accounts',
    description: 'Lists only accounts visible to the token and present in the local allowlist. Raw IDs are replaced with references.',
    inputSchema: z.object({ limit: z.number().int().min(1).max(500).default(200) }),
    annotations: READ_ONLY,
  },
  withErrors(async ({ limit }) => jsonResult(await listVisibleAllowedAccounts(limit))),
);

server.registerTool(
  'meta_get_ad_account',
  {
    title: 'Get allow-listed Meta ad account',
    description: 'Gets currency, timezone, status, spend cap, and balance without returning the raw account ID.',
    inputSchema: z.object({ ...accountInput }),
    annotations: READ_ONLY,
  },
  withErrors(async ({ ad_account_id }) => {
    const account = resolveAdAccountId(ad_account_id);
    const data = await graphGet(`/${account}`, {
      fields: 'id,name,account_status,currency,timezone_name,timezone_offset_hours_utc,business_name,amount_spent,balance,spend_cap,created_time',
    });
    return jsonResult(sanitizeAsset('account', data, account));
  }),
);

server.registerTool(
  'meta_get_guardrails',
  {
    title: 'Meta Ads write guardrails',
    description: 'Shows effective write mode, budget caps, TTL, cooldown, and allowed operation classes.',
    inputSchema: z.object({}),
    annotations: READ_ONLY,
  },
  withErrors(async () => {
    const policy = loadPolicy();
    const bundlePolicy = loadCampaignBundlePolicy();
    return jsonResult({
      write_mode: policy.writeMode,
      max_budget_change_pct: policy.maxBudgetChangePct,
      max_daily_budget_minor: policy.maxDailyBudgetMinor,
      change_ttl_minutes: policy.changeTtlMinutes,
      cooldown_hours: policy.cooldownHours,
      allowed_operations: ['pause', 'resume', 'set_daily_budget', 'materialize_approved_paused_website_leads_bundle'],
      unsupported_operations: ['activate_bundle', 'delete', 'archive', 'billing', 'roles', 'audiences', 'arbitrary_targeting', 'publish'],
      autopilot_restrictions: ['pause only', 'budget reductions only', 'no resume'],
      campaign_bundle: {
        mode: bundlePolicy.bundleMode,
        creation_enabled: bundlePolicy.creationEnabled,
        guarded_ready: bundlePolicy.guardedReady,
        guarded_blockers: bundlePolicy.guardedBlockers,
        max_lifetime_budget_minor: bundlePolicy.maxLifetimeBudgetMinor,
        proposal_ttl_minutes: bundlePolicy.proposalTtlMinutes,
        asset_catalog_configured: Boolean(bundlePolicy.assetCatalogPath),
        approvals_directory_configured: Boolean(bundlePolicy.approvalsPath),
        approval_public_key_configured: bundlePolicy.approvalPublicKeyConfigured,
        policy_version: bundlePolicy.policyVersion,
        allowed_landing_hosts: bundlePolicy.allowedLandingHosts,
        fixed_constraints: [
          'OUTCOME_LEADS',
          'WEBSITE',
          'one campaign',
          'one broad Minsk ad set',
          'one to three pre-approved image ads',
          'campaign, ad set, and ads remain PAUSED',
        ],
      },
    });
  }),
);

server.registerTool(
  'meta_prepare_campaign_bundle',
  {
    title: 'Prepare an exact PAUSED Meta campaign bundle',
    description:
      'Validates one allow-listed Website leads campaign against the external asset and claim catalog, stores an exact short-lived plan, and returns a safe review. Performs no Meta POST and never issues its own approval.',
    inputSchema: prepareCampaignBundleInputSchema,
    annotations: PREPARE,
  },
  withErrors(async (request) => jsonResult(await prepareCampaignBundle(request))),
);

server.registerTool(
  'meta_materialize_campaign_bundle',
  {
    title: 'Materialize an externally approved PAUSED campaign bundle',
    description:
      'In dry-run mode performs zero POSTs. In separately guarded mode verifies least privilege, exact plan freshness, detached Ed25519 approval, kill switch, durable ledger, and then creates only PAUSED objects with read-after-write checks.',
    inputSchema: z
      .object({
        bundle_ref: z.string().regex(/^bundle_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
        acknowledge: z.literal('MATERIALIZE_APPROVED_PAUSED_BUNDLE'),
      })
      .strict(),
    annotations: WRITE,
  },
  withErrors(async ({ bundle_ref }) => {
    const policy = loadCampaignBundlePolicy();
    const bundleStore = await bundleStoreFor(policy);
    const result = await materializeCampaignBundle({
      store: bundleStore,
      bundleRef: bundle_ref,
      policyProvider: () => loadCampaignBundlePolicy(),
      refreshPlan: refreshCampaignBundlePlan,
      verifyApproval: async (record, currentDate) => {
        const currentPolicy = loadCampaignBundlePolicy();
        const approval = await loadDetachedApproval(currentPolicy, record.bundle_ref);
        return verifyBundleApproval({
          approval,
          record,
          publicKeyBase64: currentPolicy.approvalPublicKeyB64,
          now: currentDate,
        });
      },
      validateWriteAccess: assertBundleWriteAccess,
      metaAdapter: campaignBundleMetaAdapter(),
      now: () => new Date(),
    });
    return jsonResult(safeBundleRecord(result));
  }),
);

server.registerTool(
  'meta_reconcile_campaign_bundle',
  {
    title: 'Reconcile a stopped campaign bundle with Meta',
    description:
      'Uses bounded write-token GETs and the unique bundle marker to resolve known or unknown provider outcomes. It never creates, retries, activates, or deletes a Meta object.',
    inputSchema: z
      .object({
        bundle_ref: z.string().regex(/^bundle_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
        acknowledge: z.literal('RECONCILE_PROVIDER_STATE'),
      })
      .strict(),
    annotations: RECONCILE,
  },
  withErrors(async ({ bundle_ref }) => {
    await assertBundleWriteAccess();
    const policy = loadCampaignBundlePolicy();
    const bundleStore = await bundleStoreFor(policy);
    const result = await reconcileCampaignBundle({
      store: bundleStore,
      bundleRef: bundle_ref,
      metaAdapter: campaignBundleMetaAdapter(),
      now: () => new Date(),
    });
    return jsonResult(safeBundleRecord(result));
  }),
);

server.registerTool(
  'meta_get_campaign_bundle',
  {
    title: 'Get a local PAUSED campaign bundle',
    description: 'Reads one durable bundle record through a safe projection without raw Meta IDs, provider payloads, tokens, or approval signatures.',
    inputSchema: z
      .object({
        bundle_ref: z.string().regex(/^bundle_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
      })
      .strict(),
    annotations: READ_ONLY,
  },
  withErrors(async ({ bundle_ref }) => {
    const policy = loadCampaignBundlePolicy();
    const bundleStore = await bundleStoreFor(policy);
    const record = await bundleStore.loadBundle(bundle_ref);
    if (!record) throw new Error('Unknown campaign bundle.');
    return jsonResult(safeBundleRecord(record));
  }),
);

server.registerTool(
  'meta_list_campaign_bundles',
  {
    title: 'List local PAUSED campaign bundles',
    description: 'Lists durable bundle summaries without approved provider payloads, raw Meta IDs, tokens, or signatures.',
    inputSchema: z.object({}).strict(),
    annotations: READ_ONLY,
  },
  withErrors(async () => {
    const policy = loadCampaignBundlePolicy();
    const bundleStore = await bundleStoreFor(policy);
    return jsonResult({ bundles: await bundleStore.listBundles() });
  }),
);

server.registerTool(
  'meta_list_campaigns',
  {
    title: 'List Meta campaigns',
    description: 'Lists campaigns in one allow-listed account. Raw object IDs are replaced with temporary references.',
    inputSchema: z.object({ ...accountInput, limit: z.number().int().min(1).max(2000).default(500) }),
    annotations: READ_ONLY,
  },
  withErrors(async ({ ad_account_id, limit }) => {
    const account = resolveAdAccountId(ad_account_id);
    const result = await graphList(
      `/${account}/campaigns`,
      { fields: 'id,name,status,effective_status,objective,buying_type,daily_budget,lifetime_budget,budget_remaining,start_time,stop_time,created_time,updated_time' },
      { maxPages: 20, maxItems: limit },
    );
    return jsonResult({ ...result, data: result.data.map((row) => sanitizeAsset('campaign', row, account)) });
  }),
);

server.registerTool(
  'meta_list_adsets',
  {
    title: 'List Meta ad sets',
    description: 'Lists ad sets in one allow-listed account with delivery and budget fields.',
    inputSchema: z.object({ ...accountInput, limit: z.number().int().min(1).max(3000).default(1000) }),
    annotations: READ_ONLY,
  },
  withErrors(async ({ ad_account_id, limit }) => {
    const account = resolveAdAccountId(ad_account_id);
    const result = await graphList(
      `/${account}/adsets`,
      { fields: 'id,name,status,effective_status,campaign_id,daily_budget,lifetime_budget,budget_remaining,optimization_goal,billing_event,bid_strategy,start_time,end_time,created_time,updated_time' },
      { maxPages: 20, maxItems: limit },
    );
    return jsonResult({ ...result, data: result.data.map((row) => sanitizeAsset('adset', row, account)) });
  }),
);

server.registerTool(
  'meta_list_ads',
  {
    title: 'List Meta ads',
    description: 'Lists ads and basic creative metadata in one allow-listed account.',
    inputSchema: z.object({ ...accountInput, limit: z.number().int().min(1).max(5000).default(1500) }),
    annotations: READ_ONLY,
  },
  withErrors(async ({ ad_account_id, limit }) => {
    const account = resolveAdAccountId(ad_account_id);
    const result = await graphList(
      `/${account}/ads`,
      { fields: 'id,name,status,effective_status,campaign_id,adset_id,creative{id,name},created_time,updated_time' },
      { maxPages: 20, maxItems: limit },
    );
    return jsonResult({ ...result, data: result.data.map((row) => sanitizeAsset('ad', row, account)) });
  }),
);

server.registerTool(
  'meta_list_ad_creatives',
  {
    title: 'List Meta ad creatives',
    description: 'Lists common creative text, link, call-to-action, and thumbnail metadata in one allow-listed account.',
    inputSchema: z.object({ ...accountInput, limit: z.number().int().min(1).max(3000).default(1000) }),
    annotations: READ_ONLY,
  },
  withErrors(async ({ ad_account_id, limit }) => {
    const account = resolveAdAccountId(ad_account_id);
    const result = await graphList(
      `/${account}/adcreatives`,
      { fields: 'id,name,title,body,object_url,call_to_action_type,thumbnail_url,status' },
      { maxPages: 20, maxItems: limit },
    );
    return jsonResult({ ...result, data: result.data.map((row) => sanitizeAsset('creative', row, account)) });
  }),
);

server.registerTool(
  'meta_get_insights',
  {
    title: 'Get Meta Ads insights',
    description: 'Gets account/campaign/ad-set/ad Insights with optional completed-day ranges and time increments.',
    inputSchema: z.object({
      ...accountInput,
      level: z.enum(['account', 'campaign', 'adset', 'ad']).default('campaign'),
      date_preset: z.enum(['yesterday', 'last_3d', 'last_7d', 'last_14d', 'last_28d', 'this_month', 'last_month']).default('last_7d'),
      since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      time_increment: z.union([z.literal(1), z.literal(7), z.literal('monthly'), z.literal('all_days')]).default('all_days'),
      breakdowns: z.array(z.enum(['age', 'gender', 'country', 'region', 'device_platform', 'publisher_platform', 'platform_position', 'impression_device'])).max(3).optional(),
      limit: z.number().int().min(1).max(5000).default(1000),
    }),
    annotations: READ_ONLY,
  },
  withErrors(async ({ ad_account_id, level, date_preset, since, until, time_increment, breakdowns, limit }) => {
    if (Boolean(since) !== Boolean(until)) throw new Error('Provide both since and until, or neither.');
    const account = resolveAdAccountId(ad_account_id);
    const params = {
      level,
      time_increment,
      breakdowns,
      action_report_time: 'conversion',
      fields: [
        'date_start','date_stop','account_id','account_name','campaign_id','campaign_name','adset_id','adset_name','ad_id','ad_name',
        'impressions','reach','frequency','spend','clicks','inline_link_clicks','outbound_clicks','ctr','cpc','cpm',
        'video_play_actions','video_avg_time_watched_actions','actions','action_values','cost_per_action_type',
      ].join(','),
      ...(since ? { time_range: { since, until } } : { date_preset }),
    };
    const result = await graphList(`/${account}/insights`, params, { maxPages: 30, maxItems: limit, pageLimit: 200 });
    return jsonResult({
      ...result,
      data: result.data.map((row) => sanitizeInsight(row, account)),
      query: { level, date_preset: since ? undefined : date_preset, time_range: since ? { since, until } : undefined, time_increment, breakdowns: breakdowns || [] },
    });
  }),
);

server.registerTool(
  'meta_get_account_activities',
  {
    title: 'Get Meta ad account activities',
    description: 'Reads recent account change history and returns redacted object references.',
    inputSchema: z.object({ ...accountInput, limit: z.number().int().min(1).max(500).default(100) }),
    annotations: READ_ONLY,
  },
  withErrors(async ({ ad_account_id, limit }) => {
    const account = resolveAdAccountId(ad_account_id);
    const result = await graphList(
      `/${account}/activities`,
      { fields: 'event_time,event_type,translated_event_type,object_id,object_name' },
      { maxPages: 10, maxItems: limit },
    );
    return jsonResult({
      ...result,
      data: result.data.map(({ object_id, ...row }) => ({
        ...row,
        object_ref: object_id ? entityRef('activity_object', object_id, account) : undefined,
      })),
    });
  }),
);

server.registerTool(
  'meta_prepare_change',
  {
    title: 'Prepare guarded Meta Ads change',
    description: 'Fetches fresh state, validates policy, and returns a short-lived dry-run diff. Does not change Meta.',
    inputSchema: z.object({
      entity_type: z.enum(['campaign', 'adset', 'ad']),
      entity_ref: z.string().min(5),
      operation: z.enum(['pause', 'resume', 'set_daily_budget']),
      daily_budget_minor: z.number().int().positive().optional(),
      reason: z.string().min(8).max(500),
      idempotency_key: z.string().min(8).max(120),
    }),
    annotations: PREPARE,
  },
  withErrors(async ({ entity_type, entity_ref, operation, daily_budget_minor, reason, idempotency_key }) => {
    const resolved = registry.resolve(entity_ref, entity_type);
    resolveAdAccountId(resolved.accountId);
    const current = await graphGet(`/${resolved.rawId}`, {
      fields: 'id,name,status,effective_status,daily_budget,lifetime_budget,updated_time',
    });
    const policy = loadPolicy();
    const plan = planChange({
      entityType: entity_type,
      operation,
      requestedBudgetMinor: daily_budget_minor,
      current,
      policy,
    });
    const change = await store.create(
      {
        entityType: entity_type,
        entityRef: entity_ref,
        rawId: resolved.rawId,
        accountId: resolved.accountId,
        entityName: current.name,
        entityUpdatedTime: current.updated_time,
        operation,
        payload: plan.payload,
        before: plan.before,
        after: plan.after,
        changePct: plan.change_pct,
        risk: plan.risk,
        reason,
        idempotencyKey: idempotency_key,
      },
      policy.changeTtlMinutes,
    );
    return jsonResult({
      change_set_id: change.id,
      approval_code: change.approvalCode,
      expires_at: change.expiresAt,
      write_mode: policy.writeMode,
      entity_ref,
      entity_name: current.name,
      operation,
      before: change.before,
      after: change.after,
      change_pct: change.changePct,
      risk: change.risk,
      dry_run: true,
      next_step: policy.writeMode === 'off' ? 'Enable dry-run or guarded mode outside Git.' : 'Review this exact diff before apply.',
    });
  }),
);

server.registerTool(
  'meta_apply_change',
  {
    title: 'Apply approved Meta Ads change',
    description: 'Applies one unexpired prepared change after policy, cooldown, and fresh-state checks. Performs read-after-write verification.',
    inputSchema: z.object({
      change_set_id: z.string().startsWith('chg_'),
      approval_code: z.string().length(16),
      acknowledge: z.literal('APPLY_APPROVED_CHANGE'),
    }),
    annotations: WRITE,
  },
  withErrors(async ({ change_set_id, approval_code }) => {
    const policy = loadPolicy();
    if (policy.writeMode === 'off') throw new Error('Writes are disabled by META_WRITE_MODE=off.');

    if (policy.writeMode === 'dry-run') {
      const change = store.getApproved(change_set_id, approval_code);
      store.assertCooldown(change.entityRef, policy.cooldownHours);
      const current = await graphGet(`/${change.rawId}`, {
        fields: 'id,name,status,effective_status,daily_budget,lifetime_budget,updated_time',
      });
      assertFresh(change, current);
      await store.mark(change, 'dry_run', { verified_at: new Date().toISOString() });
      return jsonResult({ applied: false, dry_run: true, entity_ref: change.entityRef, before: change.before, after: change.after });
    }

    const { change } = await runGuardedWritePreflight({
      checkApproval: () => store.getApproved(change_set_id, approval_code),
      validateWriteAccess,
      assertCooldown: (approvedChange) => store.assertCooldown(approvedChange.entityRef, policy.cooldownHours),
      readCurrent: (approvedChange) =>
        graphGet(`/${approvedChange.rawId}`, {
          fields: 'id,name,status,effective_status,daily_budget,lifetime_budget,updated_time',
        }),
      assertFresh,
      validatePlan: (approvedChange, current) =>
        planChange({
          entityType: approvedChange.entityType,
          operation: approvedChange.operation,
          requestedBudgetMinor: approvedChange.after.daily_budget_minor,
          current,
          policy,
        }),
    });
    let response;
    try {
      response = await graphPost(`/${change.rawId}`, change.payload);
    } catch (error) {
      await store.mark(change, 'outcome_unknown', { provider_call_failed: true });
      throw new Error('Meta write outcome is unknown. Do not retry; read current state and prepare a new change-set.');
    }
    let after;
    try {
      after = await graphGet(`/${change.rawId}`, {
        fields: 'id,name,status,effective_status,daily_budget,lifetime_budget,updated_time',
      });
    } catch (error) {
      await store.mark(change, 'outcome_unknown', { read_after_write_failed: true });
      throw new Error('Meta accepted the write, but verification failed. Stop further writes and inspect current state.');
    }
    const verified =
      change.operation === 'set_daily_budget'
        ? Number(after.daily_budget) === Number(change.after.daily_budget_minor)
        : String(after.status).toUpperCase() === String(change.after.status).toUpperCase();
    if (!verified) {
      await store.mark(change, 'verification_failed');
      throw new Error('Meta accepted the request but read-after-write verification did not match. Stop further writes.');
    }
    await store.mark(change, 'applied', { provider_success: Boolean(response?.success), verified: true });
    return jsonResult({
      applied: true,
      verified: true,
      entity_ref: change.entityRef,
      operation: change.operation,
      before: change.before,
      after: change.after,
      rollback: change.operation === 'pause' ? 'Prepare resume after review.' : change.operation === 'resume' ? 'Prepare pause.' : `Prepare daily budget ${change.before.daily_budget_minor}.`,
    });
  }),
);

server.registerTool(
  'meta_list_local_changes',
  {
    title: 'List local Meta change sets',
    description: 'Lists recent prepared/applied local changes without raw Meta IDs, tokens, or payloads.',
    inputSchema: z.object({}),
    annotations: READ_ONLY,
  },
  withErrors(async () => jsonResult({ changes: store.list() })),
);

async function main() {
  await server.connect(new StdioServerTransport());
  console.error(`belsteklo-meta-ads MCP ready (Graph ${graphVersion()}, writes ${loadPolicy().writeMode})`);
}

main().catch((error) => {
  console.error(safeError(error));
  process.exit(1);
});
