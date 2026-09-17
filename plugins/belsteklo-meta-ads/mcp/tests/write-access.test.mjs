import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateWriteAccess } from '../src/write-access.mjs';

const exactPermissions = [
  { permission: 'ads_management', status: 'granted' },
  { permission: 'ads_read', status: 'granted' },
];

const evaluate = (overrides = {}) =>
  evaluateWriteAccess({
    permissions: exactPermissions,
    permissionEndpointAvailable: true,
    appSecretProofEnabled: true,
    visibleAccountCount: 1,
    configuredAccountCount: 1,
    ...overrides,
  });

test('accepts only the exact ads-only permission set and complete account visibility', () => {
  const result = evaluate();
  assert.equal(result.ok, true);
  assert.equal(result.ready_for_guarded_write, true);
  assert.equal(result.least_privilege_confirmed, true);
  assert.deepEqual(result.unexpected_granted_permissions, []);
});

test('rejects missing required permissions', () => {
  const result = evaluate({ permissions: [{ permission: 'ads_read', status: 'granted' }] });
  assert.equal(result.ok, false);
  assert.equal(result.required_permissions.ads_management, 'missing');
});

test('rejects forbidden and unexpected permissions', () => {
  const result = evaluate({
    permissions: [
      ...exactPermissions,
      { permission: 'business_management', status: 'granted' },
      { permission: 'pages_manage_posts', status: 'granted' },
    ],
  });
  assert.equal(result.ok, false);
  assert.equal(result.forbidden_permissions.business_management, 'granted');
  assert.deepEqual(result.unexpected_granted_permissions, ['business_management', 'pages_manage_posts']);
});

test('rejects unavailable permission evidence and incomplete account visibility', () => {
  const result = evaluate({
    permissions: [],
    permissionEndpointAvailable: false,
    visibleAccountCount: 1,
    configuredAccountCount: 2,
  });
  assert.equal(result.ok, false);
  assert.equal(result.required_permissions.ads_management, 'unconfirmed');
  assert.equal(result.all_configured_accounts_visible, false);
  assert.equal(result.warnings.length >= 2, true);
});
