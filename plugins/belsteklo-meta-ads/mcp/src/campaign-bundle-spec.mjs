import net from 'node:net';
import { z } from 'zod';
import { canonicalJson, taggedSha256 } from './canonical-json.mjs';

export const CAMPAIGN_BUNDLE_SCHEMA_VERSION = 'campaign-bundle/v1';
const PREPARE_ACKNOWLEDGEMENT = 'PREPARE_PAUSED_WEBSITE_LEADS';
const BUNDLE_REF_PATTERN = /^bundle_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ASSET_KEY_PATTERN = /^[a-z][a-z0-9_-]{2,63}$/;
const VARIANT_KEY_PATTERN = /^[a-z][a-z0-9_-]{2,39}$/;
const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MIN_LEAD_TIME_MS = 30 * 60_000;
const MIN_DURATION_MS = 7 * 24 * 60 * 60_000;
const MAX_DURATION_MS = 30 * 24 * 60 * 60_000;
const MAX_CATALOG_AGE_MS = 30 * 24 * 60 * 60_000;
const HIGH_RISK_CLAIM_PATTERN = /(?:\$\s*\d|€\s*\d|₽\s*\d|\d[\d\s,.]*\s*(?:(?:BYN|Br)\b|(?:бел(?:\.|орусск(?:их|ого|ие))\s*)?(?:руб(?:\.|ль|ля|лей)?|р\.))|скидк|гарант|навсегда|100\s*%|за\s+\d+\s*(?:мин|час))/iu;
const CONTACT_OR_RAW_ID_PATTERN = /(?:[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|(?:\+?\d[\s().-]*){7,}|\bact_\d+\b)/iu;
const PRICE_DISCLAIMER = 'Точная цена и возможность ремонта определяются после фото и осмотра мастером.';

const adSpecSchema = z
  .object({
    variant_key: z.string().regex(VARIANT_KEY_PATTERN),
    media_key: z.string().regex(ASSET_KEY_PATTERN),
    primary_text: z.string().min(10).max(500),
    headline: z.string().min(3).max(100),
    description: z.string().max(200).default(''),
    call_to_action: z.enum(['GET_QUOTE', 'LEARN_MORE']),
    claim_keys: z.array(z.string().regex(ASSET_KEY_PATTERN)).max(2).default([]),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.claim_keys).size !== value.claim_keys.length) {
      context.addIssue({ code: 'custom', path: ['claim_keys'], message: 'claim_keys must not contain duplicates.' });
    }
  });

const bundleSpecSchema = z
  .object({
    targeting_template_key: z.string().regex(ASSET_KEY_PATTERN),
    page_key: z.string().regex(ASSET_KEY_PATTERN),
    pixel_key: z.string().regex(ASSET_KEY_PATTERN),
    lifetime_budget_minor: z.number().int().positive().safe(),
    start_time: z.string().datetime({ offset: true }),
    end_time: z.string().datetime({ offset: true }),
    landing_base_url: z.string().url().max(300),
    ads: z.array(adSpecSchema).min(1).max(3),
  })
  .strict()
  .superRefine((value, context) => {
    const variants = new Set();
    for (const [index, ad] of value.ads.entries()) {
      if (variants.has(ad.variant_key)) {
        context.addIssue({ code: 'custom', path: ['ads', index, 'variant_key'], message: 'variant_key must be unique.' });
      }
      variants.add(ad.variant_key);
    }
  });

export const prepareCampaignBundleInputSchema = z
  .object({
    spec: bundleSpecSchema,
    reason: z.string().min(8).max(500),
    idempotency_key: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,119}$/),
    acknowledge: z.literal(PREPARE_ACKNOWLEDGEMENT),
  })
  .strict();

export function assertNoDangerousKeys(value, path = '$') {
  if (!value || typeof value !== 'object') return;
  for (const key of Object.keys(value)) {
    if (DANGEROUS_KEYS.has(key)) throw new Error(`Dangerous key is not allowed at ${path}.`);
    assertNoDangerousKeys(value[key], `${path}.${key}`);
  }
}

export function parseCampaignBundleInput(value) {
  assertNoDangerousKeys(value);
  const parsed = prepareCampaignBundleInputSchema.parse(value);
  for (const text of [parsed.reason, ...parsed.spec.ads.flatMap((ad) => [ad.primary_text, ad.headline, ad.description])]) {
    if (CONTACT_OR_RAW_ID_PATTERN.test(text)) {
      throw new Error('Campaign bundle text must not contain contact data or raw Meta identifiers.');
    }
  }
  for (const ad of parsed.spec.ads) {
    if (HIGH_RISK_CLAIM_PATTERN.test(`${ad.primary_text} ${ad.headline} ${ad.description}`) && ad.claim_keys.length === 0) {
      throw new Error('Price, discount, guarantee, or exact-time claims require an approved catalog claim.');
    }
  }
  return parsed;
}

function requireAsset(collection, key, label) {
  const value = collection?.[key];
  if (!value) throw new Error(`${label} key is not present in the approved asset catalog.`);
  return value;
}

function assertRecentEvidence(value, label, nowMs) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp > nowMs + 5 * 60_000 || nowMs - timestamp > MAX_CATALOG_AGE_MS) {
    throw new Error(`${label} verification is missing, future-dated, or older than 30 days.`);
  }
}

function normalizeLandingBaseUrl(value, allowedHosts) {
  if (/[^\x20-\x7E]/.test(value)) throw new Error('Landing URL must use ASCII characters only.');
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== 'https:') throw new Error('Landing URL must use HTTPS.');
  if (url.username || url.password) throw new Error('Landing URL credentials are forbidden.');
  if (url.port) throw new Error('Landing URL must not use a custom port.');
  if (hostname.endsWith('.') || hostname.includes('xn--') || net.isIP(hostname)) {
    throw new Error('Landing URL hostname is not allowed.');
  }
  if (!allowedHosts.includes(hostname)) throw new Error('Landing URL hostname is not allow-listed.');
  if (url.pathname !== '/remont-skolov/') throw new Error('The v1 bundle supports only the chip-repair landing path.');
  if (url.search) throw new Error('Landing base URL must not contain query parameters; UTM values are generated server-side.');
  if (url.hash !== '#photo-form') throw new Error('Landing URL must point to the approved photo form anchor.');
  url.hostname = hostname;
  return url;
}

function campaignMonth(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date);
  const year = parts.find(({ type }) => type === 'year')?.value;
  const month = parts.find(({ type }) => type === 'month')?.value;
  return `${year}-${month}`;
}

function accountScope(accountId) {
  return `account_scope_${taggedSha256('bse-meta-account-scope/v1', accountId).slice(7, 23)}`;
}

function withTracking(baseUrl, month, variantKey) {
  const url = new URL(baseUrl);
  url.searchParams.set('utm_source', 'meta');
  url.searchParams.set('utm_medium', 'paid_social');
  url.searchParams.set('utm_campaign', `chip_repair_website_${month.replace('-', '_')}`);
  url.searchParams.set('utm_content', variantKey);
  return url.toString();
}

function finiteMinor(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive safe integer.`);
  return value;
}

function planHash(plan) {
  return taggedSha256('bse-meta-campaign-bundle/v1', plan);
}

export function buildCampaignBundlePlan({
  bundleRef,
  request,
  catalog,
  catalogHash,
  account,
  policy,
  graphVersion,
  now = new Date(),
  proposalExpiresAt,
}) {
  if (!BUNDLE_REF_PATTERN.test(bundleRef)) throw new Error('Invalid bundle reference.');
  const parsed = parseCampaignBundleInput(request);
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(nowMs)) throw new Error('Invalid current time.');
  const proposalExpiry =
    proposalExpiresAt === undefined
      ? new Date(nowMs + policy.proposalTtlMinutes * 60_000)
      : new Date(proposalExpiresAt);
  if (!Number.isFinite(proposalExpiry.getTime()) || proposalExpiry.getTime() <= nowMs) {
    throw new Error('Campaign bundle proposal expiry is invalid or has already passed.');
  }
  if (!/^act_\d+$/.test(String(account?.id || ''))) throw new Error('Bundle account must be a normalized allow-listed account.');
  if (Number(account.account_status) !== 1) throw new Error('Meta ad account is not active.');
  if (account.currency !== policy.expectedCurrency) throw new Error('Meta ad account currency does not match bundle policy.');
  if (account.timezone_name !== policy.expectedTimezone) throw new Error('Meta ad account timezone does not match bundle policy.');
  if (!policy.maxLifetimeBudgetMinor) throw new Error('Bundle creation is disabled until a lifetime budget cap is configured.');

  const budget = finiteMinor(parsed.spec.lifetime_budget_minor, 'Lifetime budget');
  if (budget > policy.maxLifetimeBudgetMinor) throw new Error('Lifetime budget exceeds the bundle policy cap.');
  const start = new Date(parsed.spec.start_time);
  const end = new Date(parsed.spec.end_time);
  const durationMs = end.getTime() - start.getTime();
  if (start.getTime() < nowMs + MIN_LEAD_TIME_MS) throw new Error('Bundle start_time must be at least 30 minutes in the future.');
  if (durationMs < MIN_DURATION_MS || durationMs > MAX_DURATION_MS) {
    throw new Error('Bundle duration must be between 7 and 30 full days.');
  }
  if (account.min_daily_budget !== undefined && account.min_daily_budget !== null) {
    const minimum = Number(account.min_daily_budget);
    const averageDaily = Math.floor((budget * 24 * 60 * 60_000) / durationMs);
    if (Number.isFinite(minimum) && averageDaily < minimum) {
      throw new Error('Lifetime budget is below the account minimum for the selected duration.');
    }
  }

  assertRecentEvidence(catalog.reviewed_at, 'Asset catalog', nowMs);
  const page = requireAsset(catalog.pages, parsed.spec.page_key, 'Page');
  const pixel = requireAsset(catalog.pixels, parsed.spec.pixel_key, 'Pixel');
  const targetingTemplate = requireAsset(
    catalog.targeting_templates,
    parsed.spec.targeting_template_key,
    'Targeting template',
  );
  for (const [label, asset] of [
    ['Page', page],
    ['Pixel', pixel],
    ['Targeting template', targetingTemplate],
  ]) {
    assertRecentEvidence(asset.verified_at || asset.reviewed_at, label, nowMs);
  }
  const mediaByVariant = Object.fromEntries(
    parsed.spec.ads.map((ad) => {
      const media = requireAsset(catalog.media, ad.media_key, 'Media');
      assertRecentEvidence(media.verified_at, `Media ${ad.media_key}`, nowMs);
      return [ad.variant_key, media];
    }),
  );
  const claimsByVariant = Object.fromEntries(
    parsed.spec.ads.map((ad) => {
      const text = `${ad.primary_text} ${ad.headline} ${ad.description}`;
      let uncoveredText = text;
      const claims = ad.claim_keys.map((claimKey) => {
        const claim = requireAsset(catalog.claims, claimKey, 'Claim');
        if (claim.kind !== 'PRICE_FROM') throw new Error('Only PRICE_FROM catalog claims are supported by bundle v1.');
        assertRecentEvidence(claim.reviewed_at, `Claim ${claimKey}`, nowMs);
        if (Date.parse(claim.valid_until) <= nowMs) throw new Error(`Claim ${claimKey} has expired.`);
        if (Date.parse(claim.valid_until) < end.getTime()) {
          throw new Error(`Claim ${claimKey} expires before the campaign ends.`);
        }
        if (!text.includes(claim.approved_text)) {
          throw new Error(`Campaign copy must contain the exact approved text for claim ${claimKey}.`);
        }
        if (!ad.primary_text.includes(PRICE_DISCLAIMER)) {
          throw new Error(`Price claim ${claimKey} requires the exact approved price disclaimer.`);
        }
        uncoveredText = uncoveredText.replaceAll(claim.approved_text, '');
        return { key: claimKey, ...claim };
      });
      if (HIGH_RISK_CLAIM_PATTERN.test(uncoveredText)) {
        throw new Error('Campaign copy contains a price, discount, guarantee, or exact-time claim outside the approved catalog.');
      }
      return [ad.variant_key, claims];
    }),
  );

  const baseUrl = normalizeLandingBaseUrl(parsed.spec.landing_base_url, policy.allowedLandingHosts);
  const month = campaignMonth(start, account.timezone_name);
  const marker = bundleRef.slice(-8);
  const campaignName = `BSE | LEADS | CHIP_REPAIR | MINSK | WEBSITE | ${month} | B${marker}`;
  const adsetName = `MINSK_BROAD | ADVANTAGE_PLACEMENTS | LEAD | v1 | B${marker}`;
  const scope = accountScope(account.id);

  const payloads = {
    campaign: {
      name: campaignName,
      objective: 'OUTCOME_LEADS',
      buying_type: 'AUCTION',
      special_ad_categories: [],
      status: 'PAUSED',
    },
    adset: {
      name: adsetName,
      campaign_id: { $ref: 'campaign.provider_id' },
      lifetime_budget: String(budget),
      billing_event: 'IMPRESSIONS',
      optimization_goal: 'OFFSITE_CONVERSIONS',
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      destination_type: 'WEBSITE',
      promoted_object: { pixel_id: pixel.provider_id, custom_event_type: 'LEAD' },
      targeting: targetingTemplate.targeting,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      status: 'PAUSED',
    },
    ads: parsed.spec.ads.map((ad) => {
      const media = mediaByVariant[ad.variant_key];
      const link = withTracking(baseUrl, month, ad.variant_key);
      const creativeName = `CHIP_REPAIR | ${ad.variant_key} | STATIC | B${marker}`;
      const adName = `CHIP_REPAIR | ${ad.variant_key} | v1 | B${marker}`;
      const linkData = {
        link,
        message: ad.primary_text,
        name: ad.headline,
        image_hash: media.image_hash,
        call_to_action: { type: ad.call_to_action, value: { link } },
        ...(ad.description ? { description: ad.description } : {}),
      };
      return {
        variant_key: ad.variant_key,
        creative: {
          name: creativeName,
          object_story_spec: { page_id: page.provider_id, link_data: linkData },
          degrees_of_freedom_spec: {
            creative_features_spec: { standard_enhancements: { enroll_status: 'OPT_OUT' } },
          },
        },
        ad: {
          name: adName,
          adset_id: { $ref: 'adset.provider_id' },
          creative: { creative_id: { $ref: `creative.${ad.variant_key}.provider_id` } },
          status: 'PAUSED',
        },
      };
    }),
  };

  const plan = {
    schema_version: CAMPAIGN_BUNDLE_SCHEMA_VERSION,
    policy_version: policy.policyVersion,
    graph_version: graphVersion,
    prepared_mode: policy.bundleMode,
    base_write_mode: policy.baseWriteMode,
    operation: 'materialize_paused_website_leads',
    account: {
      provider_id: account.id,
      scope,
      currency: account.currency,
      timezone: account.timezone_name,
    },
    catalog: { version: catalog.version, hash: catalogHash },
    bundle_ref: bundleRef,
    marker: `B${marker}`,
    proposal_expires_at: proposalExpiry.toISOString(),
    rationale: parsed.reason,
    payloads,
    invariants: {
      all_delivery_objects_paused: true,
      objective: 'OUTCOME_LEADS',
      conversion_location: 'WEBSITE',
      budget_owner: 'adset',
      budget_type: 'lifetime',
      placements: 'ADVANTAGE_BY_OMISSION',
      activation_supported: false,
      delete_supported: false,
    },
    review: {
      campaign_name: campaignName,
      adset_name: adsetName,
      account_scope: scope,
      currency: account.currency,
      timezone: account.timezone_name,
      lifetime_budget_minor: budget,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      targeting_template: {
        key: parsed.spec.targeting_template_key,
        version: targetingTemplate.version,
        summary: targetingTemplate.summary,
      },
      page: { key: parsed.spec.page_key, label: page.label },
      pixel: { key: parsed.spec.pixel_key, label: pixel.label },
      ads: parsed.spec.ads.map((ad) => ({
        variant_key: ad.variant_key,
        media_key: ad.media_key,
        media_content_sha256: mediaByVariant[ad.variant_key].content_sha256,
        rights_ref: mediaByVariant[ad.variant_key].rights_ref,
        creative_name: `CHIP_REPAIR | ${ad.variant_key} | STATIC | B${marker}`,
        ad_name: `CHIP_REPAIR | ${ad.variant_key} | v1 | B${marker}`,
        primary_text: ad.primary_text,
        headline: ad.headline,
        description: ad.description,
        call_to_action: ad.call_to_action,
        landing_url: withTracking(baseUrl, month, ad.variant_key),
        claims: claimsByVariant[ad.variant_key].map((claim) => ({
          key: claim.key,
          kind: claim.kind,
          approved_text: claim.approved_text,
          currency: claim.currency,
          amount_minor: claim.amount_minor,
          evidence_refs: claim.evidence_refs,
          offer_approval_ref: claim.offer_approval_ref,
          reviewed_at: claim.reviewed_at,
          valid_until: claim.valid_until,
        })),
      })),
    },
  };
  const approvedPlanHash = planHash(plan);
  const { idempotency_key: _idempotencyKey, acknowledge: _acknowledgement, ...intentRequest } = parsed;
  const intentHash = taggedSha256('bse-meta-campaign-bundle-intent/v1', {
    request: intentRequest,
    catalog_hash: catalogHash,
    policy_version: policy.policyVersion,
    graph_version: graphVersion,
    prepared_mode: policy.bundleMode,
    base_write_mode: policy.baseWriteMode,
    account_scope: scope,
    currency: account.currency,
    timezone: account.timezone_name,
    max_lifetime_budget_minor: policy.maxLifetimeBudgetMinor,
    allowed_landing_hosts: policy.allowedLandingHosts,
  });

  return {
    parsedRequest: parsed,
    intentHash,
    approvedPlanHash,
    plan,
    safePreview: {
      bundle_ref: bundleRef,
      approved_plan_hash: approvedPlanHash,
      policy_version: plan.policy_version,
      graph_version: plan.graph_version,
      prepared_mode: plan.prepared_mode,
      base_write_mode: plan.base_write_mode,
      expires_at: plan.proposal_expires_at,
      review: plan.review,
      invariants: plan.invariants,
      external_approval_required_for_guarded_write: true,
    },
  };
}

export function recomputeApprovedPlanHash(plan) {
  return planHash(plan);
}

export function canonicalCampaignBundlePlan(plan) {
  return canonicalJson(plan);
}
