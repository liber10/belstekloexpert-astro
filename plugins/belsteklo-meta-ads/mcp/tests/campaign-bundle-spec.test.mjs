import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildCampaignBundlePlan,
  parseCampaignBundleInput,
  recomputeApprovedPlanHash,
} from '../src/campaign-bundle-spec.mjs';
import { taggedSha256 } from '../src/canonical-json.mjs';
import { loadCampaignBundleCatalog } from '../src/campaign-bundle-config.mjs';

const NOW = new Date('2026-08-15T12:00:00.000Z');
const BUNDLE_REF = 'bundle_11111111-2222-4333-8444-555555555555';

function request(overrides = {}) {
  const base = {
    spec: {
      targeting_template_key: 'minsk_broad',
      page_key: 'belsteklo_page',
      pixel_key: 'website_pixel',
      lifetime_budget_minor: 7000,
      start_time: '2026-09-01T06:00:00.000Z',
      end_time: '2026-09-08T06:00:00.000Z',
      landing_base_url: 'https://belstekloexpert.by/remont-skolov/#photo-form',
      ads: [
        {
          variant_key: 'diagnosis',
          media_key: 'chip_photo_01',
          primary_text: 'Покажите повреждение мастеру через защищённую форму с фотографией.',
          headline: 'Оценка повреждения стекла',
          description: 'Ответ после осмотра фотографии мастером.',
          call_to_action: 'GET_QUOTE',
        },
      ],
    },
    reason: 'Подготовить изолированный тест направления ремонта сколов.',
    idempotency_key: 'chip-repair-2026-09-v1',
    acknowledge: 'PREPARE_PAUSED_WEBSITE_LEADS',
  };
  return {
    ...base,
    ...overrides,
    spec: { ...base.spec, ...(overrides.spec || {}) },
  };
}

function catalog() {
  return {
    version: '2026-08-15',
    reviewed_at: '2026-08-15T10:00:00.000Z',
    pages: {
      belsteklo_page: {
        provider_id: '101010101010101',
        label: 'BelStekloExpert Page',
        verified_at: '2026-08-15T10:00:00.000Z',
      },
    },
    pixels: {
      website_pixel: {
        provider_id: '202020202020202',
        label: 'Website dataset',
        verified_at: '2026-08-15T10:00:00.000Z',
      },
    },
    targeting_templates: {
      minsk_broad: {
        version: 'v1',
        summary: 'Minsk approved broad template',
        reviewed_at: '2026-08-15T10:00:00.000Z',
        targeting: {
          age_min: 25,
          age_max: 65,
          geo_locations: {
            custom_locations: [
              { latitude: 53.9006, longitude: 27.559, radius: 25, distance_unit: 'kilometer' },
            ],
            location_types: ['home', 'recent'],
          },
        },
      },
    },
    media: {
      chip_photo_01: {
        image_hash: 'abcdef0123456789abcdef0123456789',
        content_sha256: `sha256:${'a'.repeat(64)}`,
        rights_ref: 'rights_chip_photo_01',
        verified_at: '2026-08-15T10:00:00.000Z',
      },
    },
    claims: {
      chip_repair_from_30: {
        kind: 'PRICE_FROM',
        approved_text: 'от 30 BYN',
        currency: 'BYN',
        amount_minor: 3000,
        evidence_refs: ['pricing/proglass/2026-08-15', 'pricing/nanoauto/2026-08-15'],
        offer_approval_ref: 'offer-approval/chip-repair-v1',
        reviewed_at: '2026-08-15T10:00:00.000Z',
        valid_until: '2026-09-15T10:00:00.000Z',
      },
    },
  };
}

function policy(overrides = {}) {
  return {
    bundleMode: 'dry-run',
    baseWriteMode: 'dry-run',
    maxLifetimeBudgetMinor: 10000,
    proposalTtlMinutes: 15,
    policyVersion: 'campaign-bundle-policy/v1',
    allowedLandingHosts: ['belstekloexpert.by'],
    expectedCurrency: 'USD',
    expectedTimezone: 'Europe/Minsk',
    ...overrides,
  };
}

function account(overrides = {}) {
  return {
    id: 'act_303030303030303',
    account_status: 1,
    currency: 'USD',
    timezone_name: 'Europe/Minsk',
    min_daily_budget: 100,
    ...overrides,
  };
}

function build(overrides = {}) {
  const approvedCatalog = overrides.catalog || catalog();
  return buildCampaignBundlePlan({
    bundleRef: BUNDLE_REF,
    request: overrides.request || request(),
    catalog: approvedCatalog,
    catalogHash: overrides.catalogHash || taggedSha256('bse-meta-campaign-bundle-catalog/v1', approvedCatalog),
    account: overrides.account || account(),
    policy: overrides.policy || policy(),
    graphVersion: 'v25.0',
    now: overrides.now || NOW,
    proposalExpiresAt: overrides.proposalExpiresAt,
  });
}

test('parses a recursively strict prepare input and rejects dangerous or unsupported fields', () => {
  assert.equal(parseCampaignBundleInput(request()).spec.ads.length, 1);
  assert.throws(() => parseCampaignBundleInput({ ...request(), extra: true }), /unrecognized/i);
  assert.throws(
    () => parseCampaignBundleInput(request({ spec: { ads: [{ ...request().spec.ads[0], status: 'ACTIVE' }] } })),
    /unrecognized/i,
  );
  assert.throws(
    () => parseCampaignBundleInput(request({ spec: { ads: [{ ...request().spec.ads[0], headline: 'Скидка 20%' }] } })),
    /approved catalog claim/,
  );
  for (const primaryText of [
    'Ремонт скола — 30 рублей.',
    'Ремонт скола — 30 бел. руб.',
    'Ремонт скола — 30 р.',
    'Ремонт скола — 30 Br.',
  ]) {
    assert.throws(
      () =>
        parseCampaignBundleInput(
          request({
            spec: {
              ads: [
                {
                  ...request().spec.ads[0],
                  primary_text: primaryText,
                  headline: 'Ремонт скола',
                  claim_keys: [],
                },
              ],
            },
          }),
        ),
      /approved catalog claim/,
    );
  }
  assert.throws(
    () => parseCampaignBundleInput(request({ reason: 'Позвонить +375 29 123-45-67 для запуска кампании' })),
    /contact data/,
  );
  assert.throws(() => parseCampaignBundleInput(JSON.parse('{"spec":{},"__proto__":true}')), /Dangerous key/);
});

test('allows only an exact, current evidence-backed price claim', () => {
  const pricedAd = {
    ...request().spec.ads[0],
    primary_text:
      'Ремонт скола — от 30 BYN. Точная цена и возможность ремонта определяются после фото и осмотра мастером.',
    headline: 'Ремонт скола от 30 BYN',
    claim_keys: ['chip_repair_from_30'],
  };
  const result = build({ request: request({ spec: { ads: [pricedAd] } }) });
  assert.equal(result.plan.review.ads[0].claims[0].approved_text, 'от 30 BYN');
  assert.deepEqual(result.plan.review.ads[0].claims[0].evidence_refs, [
    'pricing/proglass/2026-08-15',
    'pricing/nanoauto/2026-08-15',
  ]);
  assert.equal(result.plan.review.ads[0].claims[0].offer_approval_ref, 'offer-approval/chip-repair-v1');

  const withoutApproval = { ...pricedAd, claim_keys: [] };
  assert.throws(
    () => build({ request: request({ spec: { ads: [withoutApproval] } }) }),
    /approved catalog claim/,
  );

  const alteredPrice = { ...pricedAd, headline: 'Ремонт скола от 25 BYN' };
  assert.throws(
    () => build({ request: request({ spec: { ads: [alteredPrice] } }) }),
    /outside the approved catalog/,
  );

  const withoutDisclaimer = {
    ...pricedAd,
    primary_text: 'Ремонт скола — от 30 BYN. Итог сообщим после обращения.',
  };
  assert.throws(
    () => build({ request: request({ spec: { ads: [withoutDisclaimer] } }) }),
    /price disclaimer/,
  );

  const shortClaimCatalog = catalog();
  shortClaimCatalog.claims.chip_repair_from_30.valid_until = '2026-09-05T10:00:00.000Z';
  assert.throws(
    () => build({ request: request({ spec: { ads: [pricedAd] } }), catalog: shortClaimCatalog }),
    /expires before the campaign ends/,
  );
});

test('builds only one WEBSITE lead bundle whose delivery objects are PAUSED', () => {
  const result = build();
  assert.equal(result.plan.operation, 'materialize_paused_website_leads');
  assert.equal(result.plan.payloads.campaign.objective, 'OUTCOME_LEADS');
  assert.equal(result.plan.payloads.campaign.status, 'PAUSED');
  assert.equal(result.plan.payloads.adset.destination_type, 'WEBSITE');
  assert.equal(result.plan.payloads.adset.status, 'PAUSED');
  assert.equal(result.plan.payloads.ads[0].ad.status, 'PAUSED');
  assert.equal('status' in result.plan.payloads.ads[0].creative, false);
  assert.equal('publisher_platforms' in result.plan.payloads.adset.targeting, false);
  assert.match(result.plan.payloads.ads[0].creative.object_story_spec.link_data.link, /utm_source=meta/);
  assert.match(result.plan.payloads.ads[0].creative.object_story_spec.link_data.link, /utm_content=diagnosis/);
  assert.equal(result.safePreview.external_approval_required_for_guarded_write, true);
  assert.equal(recomputeApprovedPlanHash(result.plan), result.approvedPlanHash);
});

test('produces a stable exact hash and changes it when approved copy changes', () => {
  const first = build({ proposalExpiresAt: '2026-08-15T12:15:00.000Z' });
  const second = build({ proposalExpiresAt: '2026-08-15T12:15:00.000Z' });
  assert.equal(first.approvedPlanHash, second.approvedPlanHash);
  assert.equal(first.intentHash, second.intentHash);

  const changed = request();
  changed.spec.ads[0].primary_text += ' Новый вариант.';
  const third = build({ request: changed, proposalExpiresAt: '2026-08-15T12:15:00.000Z' });
  assert.notEqual(first.approvedPlanHash, third.approvedPlanHash);
  assert.notEqual(first.intentHash, third.intentHash);
});

test('keeps the approved expiry stable during a fresh-plan rebuild', () => {
  const first = build({ proposalExpiresAt: '2026-08-15T12:15:00.000Z' });
  const refreshed = build({
    now: new Date('2026-08-15T12:05:00.000Z'),
    proposalExpiresAt: first.plan.proposal_expires_at,
  });
  assert.equal(first.approvedPlanHash, refreshed.approvedPlanHash);
});

test('rejects budget, account, schedule, catalog, and landing URL policy violations', () => {
  assert.throws(() => build({ request: request({ spec: { lifetime_budget_minor: 10001 } }) }), /budget exceeds/);
  assert.throws(() => build({ account: account({ currency: 'BYN' }) }), /currency/);
  assert.throws(
    () => build({ request: request({ spec: { start_time: '2026-08-15T12:10:00.000Z', end_time: '2026-08-22T12:10:00.000Z' } }) }),
    /at least 30 minutes/,
  );
  const staleCatalog = catalog();
  staleCatalog.reviewed_at = '2026-06-01T00:00:00.000Z';
  assert.throws(() => build({ catalog: staleCatalog }), /older than 30 days/);
  assert.throws(
    () => build({ request: request({ spec: { landing_base_url: 'https://evil.example/remont-skolov/#photo-form' } }) }),
    /allow-listed/,
  );
  assert.throws(
    () => build({ request: request({ spec: { landing_base_url: 'https://belstekloexpert.by/remont-skolov/?next=x#photo-form' } }) }),
    /query parameters/,
  );
});

test('the checked-in Minsk chip-repair canary request and sanitized catalog template build exactly', (t) => {
  const testsDirectory = path.dirname(fileURLToPath(import.meta.url));
  const examplePath = path.resolve(testsDirectory, '..', '..', 'examples', 'chip-repair-bundle.request.json');
  const catalogTemplatePath = path.resolve(
    testsDirectory,
    '..',
    '..',
    'examples',
    'campaign-bundle-catalog.template.json',
  );
  const draftRequest = JSON.parse(fs.readFileSync(examplePath, 'utf8'));
  const catalogTemplate = JSON.parse(fs.readFileSync(catalogTemplatePath, 'utf8'));
  catalogTemplate.version = 'assets/chip-repair/2026-08-15';
  catalogTemplate.pages.belsteklo_page_v1.provider_id = '101010101010101';
  catalogTemplate.pixels.lead_dataset_v1.provider_id = '202020202020202';
  catalogTemplate.targeting_templates.minsk_workshop_20km_broad_v1.targeting.geo_locations.custom_locations[0].latitude =
    53.9006;
  catalogTemplate.targeting_templates.minsk_workshop_20km_broad_v1.targeting.geo_locations.custom_locations[0].longitude =
    27.559;
  const mediaKeys = ['chip_price_4x5_v1', 'chip_decision_4x5_v1', 'chip_first_steps_4x5_v1'];
  mediaKeys.forEach((mediaKey, index) => {
    catalogTemplate.media[mediaKey].image_hash = String(index + 1).repeat(32);
    catalogTemplate.media[mediaKey].content_sha256 = `sha256:${String.fromCharCode(97 + index).repeat(64)}`;
  });
  catalogTemplate.claims.chip_repair_from_30_byn_2026_08.offer_approval_ref =
    'offer-approval/chip-repair-owner-v1';
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-bundle-example-'));
  t.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
  const catalogPath = path.join(temporaryDirectory, 'catalog.json');
  fs.writeFileSync(catalogPath, JSON.stringify(catalogTemplate), 'utf8');
  const { catalog: approvedCatalog, catalogHash } = loadCampaignBundleCatalog(catalogPath);

  const result = build({ request: draftRequest, catalog: approvedCatalog, catalogHash });
  assert.equal(result.plan.review.lifetime_budget_minor, 3500);
  assert.equal(result.plan.payloads.ads.length, 3);
  assert.equal(result.plan.payloads.campaign.status, 'PAUSED');
  assert.equal(result.plan.payloads.adset.status, 'PAUSED');
  assert.equal(result.plan.payloads.ads.every(({ ad }) => ad.status === 'PAUSED'), true);
  assert.equal(result.plan.review.ads[0].claims[0].approved_text, 'от 30 BYN');
  assert.equal(result.plan.review.ads[0].claims[0].offer_approval_ref, 'offer-approval/chip-repair-owner-v1');
  assert.deepEqual(result.plan.review.ads[0].claims[0].evidence_refs, [
    'pricing/minsk-chip-repair/nanoauto/2026-08-15',
    'pricing/minsk-chip-repair/steklocar/2026-08-15',
    'pricing/minsk-chip-repair/proglass/2026-08-15',
    'pricing/minsk-chip-repair/autoglass/2026-08-15',
    'pricing/minsk-chip-repair/art-glass/2026-08-15',
    'pricing/minsk-chip-repair/vlobovik/2026-08-15',
  ]);
  assert.equal(new Date(result.plan.review.end_time) - new Date(result.plan.review.start_time), 7 * 24 * 60 * 60_000);
  assert.equal(result.plan.review.start_time, '2026-08-31T21:05:00.000Z');
  assert.equal(result.plan.review.end_time, '2026-09-07T21:05:00.000Z');
  assert.equal(result.plan.review.ads.every(({ landing_url }) => landing_url.includes('utm_campaign=chip_repair_website_2026_09')), true);
  assert.equal(new Set(result.plan.review.ads.map(({ media_content_sha256 }) => media_content_sha256)).size, 3);
  assert.equal(Date.parse(result.plan.review.ads[0].claims[0].valid_until) > Date.parse(result.plan.review.end_time), true);
});
