import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { z } from 'zod';
import { taggedSha256 } from './canonical-json.mjs';
import { ConfigurationError } from './config.mjs';

const DEFAULT_POLICY_VERSION = 'campaign-bundle-policy/v1';
const DEFAULT_ALLOWED_LANDING_HOSTS = ['belstekloexpert.by', 'www.belstekloexpert.by'];
const CATALOG_HASH_TAG = 'bse-meta-campaign-bundle-catalog/v1';
const MAX_CATALOG_BYTES = 2 * 1024 * 1024;
const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const ASSET_KEY_PATTERN = /^[a-z][a-z0-9_-]{2,63}$/;
const SAFE_REF_PATTERN = /^[A-Za-z][A-Za-z0-9._:/-]{2,199}$/;
const OFFER_APPROVAL_REF_PATTERN = /^offer-approval\/[a-z0-9](?:[a-z0-9._/-]{1,157}[a-z0-9])$/;
const HOST_LABEL_PATTERN = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

const positiveSafeIntegerSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);

const safeRefSchema = z
  .string()
  .regex(SAFE_REF_PATTERN)
  .refine((value) => !value.includes('..') && !value.includes('//'), {
    message: 'Reference contains an unsafe sequence.',
  });

const landingHostSchema = z.string().superRefine((value, context) => {
  if (
    value.length > 253 ||
    value.endsWith('.') ||
    value.includes('xn--') ||
    value.includes('://') ||
    value.includes(':') ||
    value.includes('*') ||
    net.isIP(value) !== 0 ||
    !value.split('.').every((label) => HOST_LABEL_PATTERN.test(label))
  ) {
    context.addIssue({ code: 'custom', message: 'Landing host is invalid.' });
  }
});

const policyInputSchema = z
  .object({
    bundleMode: z.enum(['off', 'dry-run', 'guarded']),
    baseWriteMode: z.enum(['off', 'dry-run', 'guarded', 'autopilot']),
    creationEnabled: z.boolean(),
    maxLifetimeBudgetMinor: positiveSafeIntegerSchema.nullable(),
    proposalTtlMinutes: z.number().int().min(5).max(1440),
    stateDir: z.string().min(1).max(4096).refine((value) => value === value.trim()),
    assetCatalogPath: z.string().min(1).max(4096).refine((value) => value === value.trim()).nullable(),
    approvalsPath: z.string().min(1).max(4096).refine((value) => value === value.trim()).nullable(),
    approvalPublicKeyB64: z
      .string()
      .min(1)
      .max(8192)
      .refine((value) => value === value.trim())
      .nullable(),
    policyVersion: safeRefSchema,
    allowedLandingHosts: z.array(landingHostSchema).min(1).max(20),
  })
  .strict();

const timestampSchema = z.string().datetime({ offset: true });
const catalogTextSchema = (minimum, maximum) =>
  z
    .string()
    .min(minimum)
    .max(maximum)
    .refine((value) => value === value.trim(), { message: 'Text must not have surrounding whitespace.' })
    .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value), { message: 'Text contains control characters.' });

const providerAssetSchema = z
  .object({
    provider_id: z.string().min(1).max(32).regex(/^\d+$/),
    label: catalogTextSchema(1, 120),
    verified_at: timestampSchema,
  })
  .strict();

const mediaAssetSchema = z
  .object({
    image_hash: z
      .string()
      .regex(/^[0-9a-fA-F]{32,64}$/)
      .transform((value) => value.toLowerCase()),
    content_sha256: z
      .string()
      .regex(/^sha256:[0-9a-fA-F]{64}$/)
      .transform((value) => value.toLowerCase()),
    rights_ref: safeRefSchema,
    verified_at: timestampSchema,
  })
  .strict();

const customLocationSchema = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    radius: z.number().int().min(1).max(80),
    distance_unit: z.literal('kilometer'),
  })
  .strict();

const locationTypesSchema = z
  .array(z.enum(['home', 'recent']))
  .min(1)
  .max(2)
  .superRefine((values, context) => {
    if (new Set(values).size !== values.length) {
      context.addIssue({ code: 'custom', message: 'location_types must not contain duplicates.' });
    }
  });

const broadTargetingSchema = z
  .object({
    age_min: z.number().int().min(18).max(65),
    age_max: z.number().int().min(18).max(65),
    geo_locations: z
      .object({
        custom_locations: z.array(customLocationSchema).min(1).max(10),
        location_types: locationTypesSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.age_max < value.age_min) {
      context.addIssue({ code: 'custom', path: ['age_max'], message: 'age_max must not be below age_min.' });
    }
  });

const targetingTemplateSchema = z
  .object({
    version: safeRefSchema,
    summary: catalogTextSchema(3, 300),
    reviewed_at: timestampSchema,
    targeting: broadTargetingSchema,
  })
  .strict();

const approvedClaimSchema = z
  .object({
    kind: z.literal('PRICE_FROM'),
    approved_text: catalogTextSchema(3, 80),
    currency: z.literal('BYN'),
    amount_minor: positiveSafeIntegerSchema,
    evidence_refs: z.array(safeRefSchema).min(2).max(8),
    offer_approval_ref: safeRefSchema.refine((value) => OFFER_APPROVAL_REF_PATTERN.test(value), {
      message: 'offer_approval_ref must contain a lowercase stable business offer approval reference.',
    }),
    reviewed_at: timestampSchema,
    valid_until: timestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.evidence_refs).size !== value.evidence_refs.length) {
      context.addIssue({ code: 'custom', path: ['evidence_refs'], message: 'evidence_refs must not contain duplicates.' });
    }
    if (Date.parse(value.valid_until) <= Date.parse(value.reviewed_at)) {
      context.addIssue({ code: 'custom', path: ['valid_until'], message: 'valid_until must be later than reviewed_at.' });
    }
    if (!value.approved_text.includes(String(value.amount_minor / 100)) || !value.approved_text.includes(value.currency)) {
      context.addIssue({
        code: 'custom',
        path: ['approved_text'],
        message: 'approved_text must contain the configured amount and currency.',
      });
    }
  });

const assetKeySchema = z
  .string()
  .regex(ASSET_KEY_PATTERN)
  .refine((value) => !DANGEROUS_KEYS.has(value), { message: 'Prototype-dangerous asset key is forbidden.' });

const campaignBundleCatalogSchema = z
  .object({
    version: safeRefSchema,
    reviewed_at: timestampSchema,
    pages: z.record(assetKeySchema, providerAssetSchema),
    pixels: z.record(assetKeySchema, providerAssetSchema),
    media: z.record(assetKeySchema, mediaAssetSchema),
    targeting_templates: z.record(assetKeySchema, targetingTemplateSchema),
    claims: z.record(assetKeySchema, approvedClaimSchema).default({}),
  })
  .strict();

const POLICY_FIELD_ENV = {
  bundleMode: 'META_CAMPAIGN_BUNDLE_MODE',
  baseWriteMode: 'META_WRITE_MODE',
  creationEnabled: 'META_BUNDLE_CREATION_ENABLED',
  maxLifetimeBudgetMinor: 'META_MAX_BUNDLE_LIFETIME_BUDGET_MINOR',
  proposalTtlMinutes: 'META_BUNDLE_PROPOSAL_TTL_MINUTES',
  stateDir: 'META_BUNDLE_STATE_DIR',
  assetCatalogPath: 'META_BUNDLE_ASSET_CATALOG_PATH',
  approvalsPath: 'META_BUNDLE_APPROVALS_PATH',
  approvalPublicKeyB64: 'META_BUNDLE_APPROVAL_PUBLIC_KEY_B64',
  policyVersion: 'META_BUNDLE_POLICY_VERSION',
  allowedLandingHosts: 'META_ALLOWED_LANDING_HOSTS',
};

function optionalString(value) {
  if (value === undefined || value === null || value === '') return null;
  return value;
}

function numericCandidate(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'number') return value;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return Number.NaN;
  return Number(value);
}

function modeCandidate(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

function landingHostsCandidate(value) {
  if (value === undefined || value === null || value === '') return [...DEFAULT_ALLOWED_LANDING_HOSTS];
  if (typeof value !== 'string') return value;
  return [...new Set(value.split(',').map((host) => host.trim().toLowerCase()).filter(Boolean))];
}

function stableAbsolutePath(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0')) return false;
  const root = path.parse(value).root;
  const segments = value
    .slice(root.length)
    .split(/[\\/]+/u)
    .filter(Boolean);
  return !segments.some((segment) => segment === '.' || segment === '..');
}

function resolvedPath(value, cwd) {
  return value === null ? null : path.resolve(cwd, value);
}

function invalidPolicyError(error) {
  const field = error instanceof z.ZodError ? error.issues[0]?.path?.[0] : null;
  const envName = typeof field === 'string' ? POLICY_FIELD_ENV[field] : null;
  return new ConfigurationError(
    envName ? `${envName} is invalid for campaign bundle policy.` : 'Campaign bundle policy is invalid.',
  );
}

function assertNoDangerousKeys(value) {
  if (!value || typeof value !== 'object') return;
  for (const key of Object.keys(value)) {
    if (DANGEROUS_KEYS.has(key)) throw new Error('Prototype-dangerous JSON key is forbidden.');
    assertNoDangerousKeys(value[key]);
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function loadCampaignBundlePolicy(env = process.env, cwd = process.cwd()) {
  if (!env || typeof env !== 'object' || Array.isArray(env)) {
    throw new ConfigurationError('Campaign bundle policy environment must be an object.');
  }
  if (typeof cwd !== 'string' || cwd.length === 0 || cwd !== cwd.trim() || cwd.includes('\0')) {
    throw new ConfigurationError('Campaign bundle policy cwd is invalid.');
  }

  const resolvedCwd = path.resolve(cwd);
  const defaultStateDir = path.join(resolvedCwd, '.runtime', 'meta-campaign-bundles');
  const stateDirInput = optionalString(env.META_BUNDLE_STATE_DIR) ?? defaultStateDir;
  const assetCatalogPathInput = optionalString(env.META_BUNDLE_ASSET_CATALOG_PATH);
  const approvalsPathInput = optionalString(env.META_BUNDLE_APPROVALS_PATH);
  const approvalPublicKeyInput = optionalString(env.META_BUNDLE_APPROVAL_PUBLIC_KEY_B64);
  const policyVersionInput = optionalString(env.META_BUNDLE_POLICY_VERSION) ?? DEFAULT_POLICY_VERSION;

  let parsed;
  try {
    parsed = policyInputSchema.parse({
      bundleMode: modeCandidate(env.META_CAMPAIGN_BUNDLE_MODE, 'off'),
      baseWriteMode: modeCandidate(env.META_WRITE_MODE, 'off'),
      creationEnabled: env.META_BUNDLE_CREATION_ENABLED === 'true',
      maxLifetimeBudgetMinor: numericCandidate(env.META_MAX_BUNDLE_LIFETIME_BUDGET_MINOR, null),
      proposalTtlMinutes: numericCandidate(env.META_BUNDLE_PROPOSAL_TTL_MINUTES, 60),
      stateDir: stateDirInput,
      assetCatalogPath: assetCatalogPathInput,
      approvalsPath: approvalsPathInput,
      approvalPublicKeyB64: approvalPublicKeyInput,
      policyVersion: policyVersionInput,
      allowedLandingHosts: landingHostsCandidate(env.META_ALLOWED_LANDING_HOSTS),
    });
  } catch (error) {
    throw invalidPolicyError(error);
  }

  const stateDirStable = stableAbsolutePath(parsed.stateDir);
  const assetCatalogPathStable = stableAbsolutePath(parsed.assetCatalogPath);
  const approvalsPathStable = stableAbsolutePath(parsed.approvalsPath);
  const guardedBlockers = [];

  if (parsed.baseWriteMode !== 'guarded') guardedBlockers.push('base_write_mode_not_guarded');
  if (parsed.bundleMode !== 'guarded') guardedBlockers.push('bundle_mode_not_guarded');
  if (!parsed.creationEnabled) guardedBlockers.push('bundle_creation_not_enabled');
  if (parsed.maxLifetimeBudgetMinor === null) guardedBlockers.push('lifetime_budget_cap_missing');
  if (!stateDirStable) guardedBlockers.push('state_dir_not_absolute_stable');
  if (parsed.assetCatalogPath === null) guardedBlockers.push('asset_catalog_path_missing');
  else if (!assetCatalogPathStable) guardedBlockers.push('asset_catalog_path_not_absolute_stable');
  if (parsed.approvalsPath === null) guardedBlockers.push('approvals_path_missing');
  else if (!approvalsPathStable) guardedBlockers.push('approvals_path_not_absolute_stable');
  if (parsed.approvalPublicKeyB64 === null) guardedBlockers.push('approval_public_key_missing');

  const policy = {
    bundleMode: parsed.bundleMode,
    baseWriteMode: parsed.baseWriteMode,
    creationEnabled: parsed.creationEnabled,
    maxLifetimeBudgetMinor: parsed.maxLifetimeBudgetMinor,
    proposalTtlMinutes: parsed.proposalTtlMinutes,
    stateDir: resolvedPath(parsed.stateDir, resolvedCwd),
    assetCatalogPath: resolvedPath(parsed.assetCatalogPath, resolvedCwd),
    approvalsPath: resolvedPath(parsed.approvalsPath, resolvedCwd),
    approvalPublicKeyConfigured: parsed.approvalPublicKeyB64 !== null,
    policyVersion: parsed.policyVersion,
    allowedLandingHosts: Object.freeze([...parsed.allowedLandingHosts]),
    expectedCurrency: 'USD',
    expectedTimezone: 'Europe/Minsk',
    guardedReady: guardedBlockers.length === 0,
    guardedBlockers: Object.freeze(guardedBlockers),
  };
  Object.defineProperty(policy, 'approvalPublicKeyB64', {
    value: parsed.approvalPublicKeyB64,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return Object.freeze(policy);
}

export function loadCampaignBundleCatalog(filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0 || filePath !== filePath.trim()) {
    throw new ConfigurationError('Campaign bundle asset catalog path is invalid.');
  }

  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    throw new ConfigurationError('Campaign bundle asset catalog could not be read.');
  }
  if (Buffer.byteLength(raw, 'utf8') > MAX_CATALOG_BYTES) {
    throw new ConfigurationError('Campaign bundle asset catalog exceeds its size limit.');
  }

  let decoded;
  try {
    decoded = JSON.parse(raw);
  } catch {
    throw new ConfigurationError('Campaign bundle asset catalog must contain valid JSON.');
  }

  let catalog;
  try {
    assertNoDangerousKeys(decoded);
    catalog = campaignBundleCatalogSchema.parse(decoded);
  } catch {
    throw new ConfigurationError('Campaign bundle asset catalog is invalid.');
  }

  const catalogHash = taggedSha256(CATALOG_HASH_TAG, catalog);
  deepFreeze(catalog);
  return Object.freeze({ catalog, catalogHash });
}
