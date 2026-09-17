import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  BUNDLE_APPROVAL_ACTION,
  approvalSigningBytes,
  verifyBundleApproval,
} from '../src/approval-verifier.mjs';

const NOW = '2026-08-15T12:00:00.000Z';

function fixture() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const payload = {
    version: 1,
    approval_id: crypto.randomUUID(),
    action: BUNDLE_APPROVAL_ACTION,
    bundle_ref: 'bundle_01K2QH74R8V6A2Z1M5C9D3F7GX',
    approved_plan_hash: `sha256:${'a'.repeat(64)}`,
    policy_version: 'campaign-bundle-policy/v1',
    graph_version: 'v25.0',
    account_scope: 'account_scope_primary',
    prepared_mode: 'guarded',
    base_write_mode: 'guarded',
    decision: 'approved',
    approved_by: 'owner_primary',
    issued_at: '2026-08-15T11:55:00.000Z',
    expires_at: '2026-08-15T12:05:00.000Z',
  };
  const signature = crypto.sign(null, approvalSigningBytes(payload), privateKey).toString('base64url');
  const approval = { ...payload, signature };
  const record = {
    bundle_ref: payload.bundle_ref,
    approved_plan_hash: payload.approved_plan_hash,
    policy_version: payload.policy_version,
    graph_version: payload.graph_version,
    account_scope: payload.account_scope,
    prepared_mode: payload.prepared_mode,
    base_write_mode: payload.base_write_mode,
    expires_at: '2026-08-15T12:10:00.000Z',
    state: 'prepared',
  };
  return {
    approval,
    record,
    privateKey,
    publicKeyBase64: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
  };
}

test('verifies a detached Ed25519 approval against the exact bundle record', () => {
  const input = fixture();
  const result = verifyBundleApproval({ ...input, now: NOW });
  assert.deepEqual(result, {
    ok: true,
    approval_id: input.approval.approval_id,
    approved_by: input.approval.approved_by,
    approved_plan_hash: input.approval.approved_plan_hash,
    issued_at: input.approval.issued_at,
    expires_at: input.approval.expires_at,
  });
});

test('rejects tampering and a signature from another Ed25519 key', () => {
  const input = fixture();
  assert.throws(
    () => verifyBundleApproval({ ...input, approval: { ...input.approval, approved_by: 'owner_other' }, now: NOW }),
    /signature is invalid/,
  );

  const other = crypto.generateKeyPairSync('ed25519');
  const wrongSignature = crypto.sign(
    null,
    approvalSigningBytes(Object.fromEntries(Object.entries(input.approval).filter(([key]) => key !== 'signature'))),
    other.privateKey,
  ).toString('base64url');
  assert.throws(
    () => verifyBundleApproval({ ...input, approval: { ...input.approval, signature: wrongSignature }, now: NOW }),
    /signature is invalid/,
  );
});

test('matches hash, policy, graph, account, and both guarded modes', () => {
  for (const [field, value] of [
    ['bundle_ref', 'bundle_01K2QH74R8V6A2Z1M5C9D3F7GY'],
    ['approved_plan_hash', `sha256:${'b'.repeat(64)}`],
    ['policy_version', 'campaign-bundle-policy/v2'],
    ['graph_version', 'v26.0'],
    ['account_scope', 'account_scope_secondary'],
  ]) {
    const input = fixture();
    assert.throws(
      () => verifyBundleApproval({ ...input, record: { ...input.record, [field]: value }, now: NOW }),
      new RegExp(field),
    );
  }

  for (const field of ['prepared_mode', 'base_write_mode']) {
    const input = fixture();
    assert.throws(
      () => verifyBundleApproval({ ...input, record: { ...input.record, [field]: 'dry-run' }, now: NOW }),
      new RegExp(field),
    );
  }
});

test('requires now to be after issuance and before both expiries', () => {
  const input = fixture();
  assert.throws(() => verifyBundleApproval({ ...input, now: '2026-08-15T11:54:59.999Z' }), /not valid yet/);
  assert.throws(() => verifyBundleApproval({ ...input, now: input.approval.expires_at }), /Approval has expired/);

  const bundleExpiresFirst = { ...input.record, expires_at: '2026-08-15T11:59:00.000Z' };
  assert.throws(() => verifyBundleApproval({ ...input, record: bundleExpiresFirst, now: NOW }), /must not exceed/);
});

test('enforces the strict flat approval schema and canonical encodings', () => {
  const input = fixture();
  assert.throws(
    () => verifyBundleApproval({ ...input, approval: { ...input.approval, extra: true }, now: NOW }),
    /exactly the approved schema fields/,
  );
  assert.throws(
    () => verifyBundleApproval({ ...input, approval: { ...input.approval, signature: `${input.approval.signature}=` }, now: NOW }),
    /base64url/,
  );
  assert.throws(
    () => verifyBundleApproval({ ...input, publicKeyBase64: `${input.publicKeyBase64}\n`, now: NOW }),
    /canonical base64/,
  );

  const wrongAction = { ...input.approval, action: 'meta.campaign_bundle.publish' };
  assert.throws(() => verifyBundleApproval({ ...input, approval: wrongAction, now: NOW }), /action is not supported/);

  const rejected = { ...input.approval, decision: 'rejected' };
  assert.throws(() => verifyBundleApproval({ ...input, approval: rejected, now: NOW }), /decision must equal approved/);
});
