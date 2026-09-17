import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  loadCampaignBundleCatalog,
  loadCampaignBundlePolicy,
} from '../src/campaign-bundle-config.mjs';

const REVIEWED_AT = '2026-08-15T08:00:00.000Z';

function validCatalog() {
  return {
    version: 'campaign-bundle-assets/v1',
    reviewed_at: REVIEWED_AT,
    pages: {
      'main-page': {
        provider_id: '123456789012345',
        label: 'BelStekloExpert Page',
        verified_at: REVIEWED_AT,
      },
    },
    pixels: {
      'lead-pixel': {
        provider_id: '234567890123456',
        label: 'Website lead pixel',
        verified_at: REVIEWED_AT,
      },
    },
    media: {
      'chip-wide': {
        image_hash: 'A'.repeat(32),
        content_sha256: `sha256:${'B'.repeat(64)}`,
        rights_ref: 'rights/chip-wide/v1',
        verified_at: REVIEWED_AT,
      },
    },
    targeting_templates: {
      'minsk-broad': {
        version: 'targeting/v1',
        summary: 'Broad adult audience around Minsk',
        reviewed_at: REVIEWED_AT,
        targeting: {
          age_min: 25,
          age_max: 65,
          geo_locations: {
            custom_locations: [
              {
                latitude: 53.9006,
                longitude: 27.559,
                radius: 25,
                distance_unit: 'kilometer',
              },
            ],
            location_types: ['home', 'recent'],
          },
        },
      },
    },
    claims: {
      'chip-repair-from-30': {
        kind: 'PRICE_FROM',
        approved_text: 'от 30 BYN',
        currency: 'BYN',
        amount_minor: 3000,
        evidence_refs: ['pricing/proglass/2026-08-15', 'pricing/nanoauto/2026-08-15'],
        offer_approval_ref: 'offer-approval/chip-repair-v1',
        reviewed_at: REVIEWED_AT,
        valid_until: '2026-09-15T08:00:00.000Z',
      },
    },
  };
}

function tempDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bse-campaign-bundle-config-'));
}

function writeCatalog(directory, value, name = 'catalog.json') {
  const filePath = path.join(directory, name);
  fs.writeFileSync(filePath, JSON.stringify(value), 'utf8');
  return filePath;
}

function guardedEnv(directory, overrides = {}) {
  return {
    META_WRITE_MODE: 'guarded',
    META_CAMPAIGN_BUNDLE_MODE: 'guarded',
    META_BUNDLE_CREATION_ENABLED: 'true',
    META_MAX_BUNDLE_LIFETIME_BUDGET_MINOR: '50000',
    META_BUNDLE_PROPOSAL_TTL_MINUTES: '60',
    META_BUNDLE_STATE_DIR: path.join(directory, 'state'),
    META_BUNDLE_ASSET_CATALOG_PATH: path.join(directory, 'assets.json'),
    META_BUNDLE_APPROVALS_PATH: path.join(directory, 'approvals'),
    META_BUNDLE_APPROVAL_PUBLIC_KEY_B64: Buffer.from('synthetic-public-key-config-value').toString('base64'),
    ...overrides,
  };
}

test('loads fail-closed policy defaults and fixed account expectations', () => {
  const cwd = path.resolve('campaign-bundle-config-defaults');
  const policy = loadCampaignBundlePolicy({}, cwd);

  assert.equal(policy.bundleMode, 'off');
  assert.equal(policy.baseWriteMode, 'off');
  assert.equal(policy.creationEnabled, false);
  assert.equal(policy.maxLifetimeBudgetMinor, null);
  assert.equal(policy.proposalTtlMinutes, 60);
  assert.equal(policy.stateDir, path.join(cwd, '.runtime', 'meta-campaign-bundles'));
  assert.equal(policy.assetCatalogPath, null);
  assert.equal(policy.approvalsPath, null);
  assert.equal(policy.approvalPublicKeyConfigured, false);
  assert.equal(policy.approvalPublicKeyB64, null);
  assert.equal(policy.policyVersion, 'campaign-bundle-policy/v1');
  assert.deepEqual(policy.allowedLandingHosts, ['belstekloexpert.by', 'www.belstekloexpert.by']);
  assert.equal(policy.expectedCurrency, 'USD');
  assert.equal(policy.expectedTimezone, 'Europe/Minsk');
  assert.equal(policy.guardedReady, false);
  assert.ok(policy.guardedBlockers.includes('base_write_mode_not_guarded'));
  assert.ok(policy.guardedBlockers.includes('bundle_mode_not_guarded'));
  assert.ok(Object.isFrozen(policy));
  assert.ok(Object.isFrozen(policy.allowedLandingHosts));
});

test('enables guarded bundle creation only when every independent guard is configured', () => {
  const directory = tempDirectory();
  try {
    const env = guardedEnv(directory);
    const policy = loadCampaignBundlePolicy(env, directory);

    assert.equal(policy.guardedReady, true);
    assert.deepEqual(policy.guardedBlockers, []);
    assert.equal(policy.maxLifetimeBudgetMinor, 50000);
    assert.equal(policy.approvalPublicKeyConfigured, true);
    assert.equal(policy.approvalPublicKeyB64, env.META_BUNDLE_APPROVAL_PUBLIC_KEY_B64);
    assert.equal(Object.keys(policy).includes('approvalPublicKeyB64'), false);
    assert.equal(JSON.stringify(policy).includes(env.META_BUNDLE_APPROVAL_PUBLIC_KEY_B64), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('treats only the exact string true as an open creation kill switch', () => {
  const directory = tempDirectory();
  try {
    for (const value of ['TRUE', '1', 'yes', ' true ']) {
      const policy = loadCampaignBundlePolicy(
        guardedEnv(directory, { META_BUNDLE_CREATION_ENABLED: value }),
        directory,
      );
      assert.equal(policy.creationEnabled, false);
      assert.ok(policy.guardedBlockers.includes('bundle_creation_not_enabled'));
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('does not treat a whitespace-only approval key as configured', () => {
  const directory = tempDirectory();
  try {
    assert.throws(
      () =>
        loadCampaignBundlePolicy(
          guardedEnv(directory, { META_BUNDLE_APPROVAL_PUBLIC_KEY_B64: ' ' }),
          directory,
        ),
      /META_BUNDLE_APPROVAL_PUBLIC_KEY_B64/,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('requires positive safe integer caps and bounded proposal TTL values', () => {
  const directory = tempDirectory();
  try {
    for (const cap of ['0', '-1', '1.5', '1e3', String(Number.MAX_SAFE_INTEGER + 1)]) {
      assert.throws(
        () =>
          loadCampaignBundlePolicy(
            guardedEnv(directory, { META_MAX_BUNDLE_LIFETIME_BUDGET_MINOR: cap }),
            directory,
          ),
        /META_MAX_BUNDLE_LIFETIME_BUDGET_MINOR/,
      );
    }
    for (const ttl of ['4', '1441', '5.5']) {
      assert.throws(
        () =>
          loadCampaignBundlePolicy(
            guardedEnv(directory, { META_BUNDLE_PROPOSAL_TTL_MINUTES: ttl }),
            directory,
          ),
        /META_BUNDLE_PROPOSAL_TTL_MINUTES/,
      );
    }
    assert.equal(
      loadCampaignBundlePolicy(
        guardedEnv(directory, { META_BUNDLE_PROPOSAL_TTL_MINUTES: '5' }),
        directory,
      ).proposalTtlMinutes,
      5,
    );
    assert.equal(
      loadCampaignBundlePolicy(
        guardedEnv(directory, { META_BUNDLE_PROPOSAL_TTL_MINUTES: '1440' }),
        directory,
      ).proposalTtlMinutes,
      1440,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('normalizes allowed landing hosts but rejects hosts with bypass syntax', () => {
  const directory = tempDirectory();
  try {
    const policy = loadCampaignBundlePolicy(
      guardedEnv(directory, {
        META_ALLOWED_LANDING_HOSTS: 'BELSTEKLOEXPERT.BY, www.belstekloexpert.by,belstekloexpert.by',
      }),
      directory,
    );
    assert.deepEqual(policy.allowedLandingHosts, ['belstekloexpert.by', 'www.belstekloexpert.by']);

    for (const hosts of ['*.belstekloexpert.by', 'https://belstekloexpert.by', '127.0.0.1', 'xn--example.test']) {
      assert.throws(
        () => loadCampaignBundlePolicy(guardedEnv(directory, { META_ALLOWED_LANDING_HOSTS: hosts }), directory),
        /META_ALLOWED_LANDING_HOSTS/,
      );
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('blocks guarded mode for relative or unstable operational paths without echoing them', () => {
  const directory = tempDirectory();
  try {
    const relativeState = 'private-state/../runtime-state';
    const relativeCatalog = 'private-assets.json';
    const relativeApprovals = 'private-approvals';
    const policy = loadCampaignBundlePolicy(
      guardedEnv(directory, {
        META_BUNDLE_STATE_DIR: relativeState,
        META_BUNDLE_ASSET_CATALOG_PATH: relativeCatalog,
        META_BUNDLE_APPROVALS_PATH: relativeApprovals,
      }),
      directory,
    );

    assert.equal(policy.guardedReady, false);
    assert.ok(policy.guardedBlockers.includes('state_dir_not_absolute_stable'));
    assert.ok(policy.guardedBlockers.includes('asset_catalog_path_not_absolute_stable'));
    assert.ok(policy.guardedBlockers.includes('approvals_path_not_absolute_stable'));
    const diagnostics = policy.guardedBlockers.join(',');
    assert.equal(diagnostics.includes(relativeState), false);
    assert.equal(diagnostics.includes(relativeCatalog), false);
    assert.equal(diagnostics.includes(relativeApprovals), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('loads, normalizes, freezes, and canonically hashes an approved asset catalog', () => {
  const directory = tempDirectory();
  try {
    const source = validCatalog();
    const firstPath = writeCatalog(directory, source, 'catalog-a.json');
    const reordered = {
      claims: source.claims,
      targeting_templates: source.targeting_templates,
      media: source.media,
      pixels: source.pixels,
      pages: source.pages,
      reviewed_at: source.reviewed_at,
      version: source.version,
    };
    const secondPath = writeCatalog(directory, reordered, 'catalog-b.json');

    const first = loadCampaignBundleCatalog(firstPath);
    const second = loadCampaignBundleCatalog(secondPath);

    assert.match(first.catalogHash, /^sha256:[0-9a-f]{64}$/);
    assert.equal(first.catalogHash, second.catalogHash);
    assert.equal(first.catalog.media['chip-wide'].image_hash, 'a'.repeat(32));
    assert.equal(first.catalog.media['chip-wide'].content_sha256, `sha256:${'b'.repeat(64)}`);
    assert.equal(first.catalog.claims['chip-repair-from-30'].approved_text, 'от 30 BYN');
    assert.ok(Object.isFrozen(first));
    assert.ok(Object.isFrozen(first.catalog));
    assert.ok(Object.isFrozen(first.catalog.targeting_templates['minsk-broad'].targeting));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('rejects unapproved targeting dimensions and unknown catalog fields', () => {
  const directory = tempDirectory();
  try {
    const mutations = [
      (catalog) => {
        catalog.targeting_templates['minsk-broad'].targeting.interests = [{ id: '1' }];
      },
      (catalog) => {
        catalog.targeting_templates['minsk-broad'].targeting.custom_audiences = [{ id: '1' }];
      },
      (catalog) => {
        catalog.targeting_templates['minsk-broad'].targeting.publisher_platforms = ['facebook'];
      },
      (catalog) => {
        catalog.targeting_templates['minsk-broad'].targeting.geo_locations.countries = ['BY'];
      },
      (catalog) => {
        catalog.pages['main-page'].unexpected = true;
      },
      (catalog) => {
        catalog.claims['chip-repair-from-30'].unexpected = true;
      },
    ];

    for (const [index, mutate] of mutations.entries()) {
      const catalog = validCatalog();
      mutate(catalog);
      const filePath = writeCatalog(directory, catalog, `invalid-${index}.json`);
      assert.throws(() => loadCampaignBundleCatalog(filePath), /asset catalog is invalid/);
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('rejects unsafe asset identifiers, media provenance, and targeting values', () => {
  const directory = tempDirectory();
  try {
    const mutations = [
      (catalog) => {
        catalog.pages['main-page'].provider_id = 'act_123';
      },
      (catalog) => {
        catalog.media['chip-wide'].image_hash = 'a'.repeat(31);
      },
      (catalog) => {
        catalog.media['chip-wide'].content_sha256 = `sha256:${'z'.repeat(64)}`;
      },
      (catalog) => {
        catalog.media['chip-wide'].rights_ref = '../private/release';
      },
      (catalog) => {
        catalog.targeting_templates['minsk-broad'].targeting.geo_locations.custom_locations[0].distance_unit =
          'mile';
      },
      (catalog) => {
        catalog.targeting_templates['minsk-broad'].targeting.geo_locations.location_types = ['home', 'home'];
      },
      (catalog) => {
        catalog.claims['chip-repair-from-30'].approved_text = 'по договорённости';
      },
      (catalog) => {
        catalog.claims['chip-repair-from-30'].evidence_refs = [
          'pricing/proglass/2026-08-15',
          'pricing/proglass/2026-08-15',
        ];
      },
      (catalog) => {
        catalog.claims['chip-repair-from-30'].offer_approval_ref = 'pricing/market-only';
      },
      (catalog) => {
        catalog.claims['chip-repair-from-30'].offer_approval_ref = 'offer-approval/';
      },
      (catalog) => {
        catalog.claims['chip-repair-from-30'].offer_approval_ref =
          'offer-approval/REPLACE_WITH_MASTER_CONFIRMED_CHIP_PRICE';
      },
    ];

    for (const [index, mutate] of mutations.entries()) {
      const catalog = validCatalog();
      mutate(catalog);
      const filePath = writeCatalog(directory, catalog, `unsafe-${index}.json`);
      assert.throws(() => loadCampaignBundleCatalog(filePath), /asset catalog is invalid/);
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('catalog parse failures do not echo file paths or JSON values', () => {
  const directory = tempDirectory();
  try {
    const filePath = path.join(directory, 'private-catalog-marker.json');
    const privateMarker = 'SYNTHETIC_PRIVATE_VALUE_DO_NOT_ECHO';
    fs.writeFileSync(filePath, `{\"version\":\"${privateMarker}\"`, 'utf8');

    assert.throws(
      () => loadCampaignBundleCatalog(filePath),
      (error) => {
        assert.equal(error.message.includes(filePath), false);
        assert.equal(error.message.includes(privateMarker), false);
        return true;
      },
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
