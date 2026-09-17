import crypto from 'node:crypto';
import { canonicalJson } from './canonical-json.mjs';

export const BUNDLE_APPROVAL_ACTION = 'meta.campaign_bundle.materialize_paused';
export const BUNDLE_APPROVAL_DOMAIN = 'bse-meta-campaign-bundle-approval/v1';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPAQUE_REF_PATTERN = /^[A-Za-z][A-Za-z0-9._:/-]{2,199}$/;
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const GRAPH_VERSION_PATTERN = /^v\d{1,2}\.\d{1,2}$/;
const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

const PAYLOAD_FIELDS = [
  'version',
  'approval_id',
  'action',
  'bundle_ref',
  'approved_plan_hash',
  'policy_version',
  'graph_version',
  'account_scope',
  'prepared_mode',
  'base_write_mode',
  'decision',
  'approved_by',
  'issued_at',
  'expires_at',
];
const SIGNED_FIELDS = [...PAYLOAD_FIELDS, 'signature'];

export class ApprovalVerificationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ApprovalVerificationError';
  }
}

function fail(message) {
  throw new ApprovalVerificationError(message);
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be a plain object.`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(`${label} must be a plain object.`);
  if (Object.getOwnPropertySymbols(value).length > 0) fail(`${label} must not contain symbol properties.`);
}

function assertExactFields(value, fields, label) {
  const actual = Object.getOwnPropertyNames(value).sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
    fail(`${label} must contain exactly the approved schema fields.`);
  }
  for (const field of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      fail(`${label}.${field} must be an enumerable data property.`);
    }
  }
}

function assertOpaqueRef(value, label) {
  if (typeof value !== 'string' || !OPAQUE_REF_PATTERN.test(value)) {
    fail(`${label} must be an opaque safe reference.`);
  }
}

function timestampMillis(value, label) {
  if (typeof value !== 'string' || !UTC_TIMESTAMP_PATTERN.test(value)) {
    fail(`${label} must be a UTC ISO-8601 timestamp.`);
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) fail(`${label} is not a valid timestamp.`);
  const normalizedInput = value.includes('.') ? value : value.replace('Z', '.000Z');
  if (new Date(milliseconds).toISOString() !== normalizedInput) fail(`${label} is not a valid calendar timestamp.`);
  return milliseconds;
}

function assertBase64UrlSignature(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
    fail('approval.signature must be unpadded base64url.');
  }
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.length !== 64 || decoded.toString('base64url') !== value) {
    fail('approval.signature must encode one 64-byte Ed25519 signature.');
  }
  return decoded;
}

function parsePayload(payload) {
  assertPlainObject(payload, 'approval payload');
  assertExactFields(payload, PAYLOAD_FIELDS, 'approval payload');
  if (payload.version !== 1) fail('approval.version must equal 1.');
  if (typeof payload.approval_id !== 'string' || !UUID_PATTERN.test(payload.approval_id)) {
    fail('approval.approval_id must be a UUID.');
  }
  if (payload.action !== BUNDLE_APPROVAL_ACTION) fail('approval.action is not supported.');
  assertOpaqueRef(payload.bundle_ref, 'approval.bundle_ref');
  if (typeof payload.approved_plan_hash !== 'string' || !HASH_PATTERN.test(payload.approved_plan_hash)) {
    fail('approval.approved_plan_hash must be a tagged SHA-256 digest.');
  }
  assertOpaqueRef(payload.policy_version, 'approval.policy_version');
  if (typeof payload.graph_version !== 'string' || !GRAPH_VERSION_PATTERN.test(payload.graph_version)) {
    fail('approval.graph_version is invalid.');
  }
  assertOpaqueRef(payload.account_scope, 'approval.account_scope');
  if (payload.prepared_mode !== 'guarded') fail('approval.prepared_mode must equal guarded.');
  if (payload.base_write_mode !== 'guarded') fail('approval.base_write_mode must equal guarded.');
  if (payload.decision !== 'approved') fail('approval.decision must equal approved.');
  assertOpaqueRef(payload.approved_by, 'approval.approved_by');
  const issuedAt = timestampMillis(payload.issued_at, 'approval.issued_at');
  const expiresAt = timestampMillis(payload.expires_at, 'approval.expires_at');
  if (expiresAt <= issuedAt) fail('approval.expires_at must be later than approval.issued_at.');
  canonicalJson(payload);
  return { payload: { ...payload }, issuedAt, expiresAt };
}

function unsignedPayload(approval) {
  return Object.fromEntries(PAYLOAD_FIELDS.map((field) => [field, approval[field]]));
}

function publicKeyFromBase64(value) {
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    fail('publicKeyBase64 must be canonical base64 DER SPKI.');
  }
  const der = Buffer.from(value, 'base64');
  if (der.length === 0 || der.toString('base64') !== value) fail('publicKeyBase64 must be canonical base64 DER SPKI.');
  let key;
  try {
    key = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
  } catch {
    fail('publicKeyBase64 is not a valid DER SPKI public key.');
  }
  if (key.asymmetricKeyType !== 'ed25519') fail('publicKeyBase64 must contain an Ed25519 public key.');
  return key;
}

function nowMillis(now) {
  const value = now instanceof Date ? now.getTime() : typeof now === 'number' ? now : Date.parse(now);
  if (!Number.isFinite(value)) fail('now must be a valid Date, timestamp, or ISO-8601 string.');
  return value;
}

function expectedRecord(record) {
  assertPlainObject(record, 'bundle record');
  const required = [
    'bundle_ref',
    'approved_plan_hash',
    'policy_version',
    'graph_version',
    'account_scope',
    'prepared_mode',
    'base_write_mode',
    'expires_at',
  ];
  for (const field of required) {
    if (!Object.hasOwn(record, field)) fail(`bundle record is missing ${field}.`);
  }
  assertOpaqueRef(record.bundle_ref, 'bundle record.bundle_ref');
  if (typeof record.approved_plan_hash !== 'string' || !HASH_PATTERN.test(record.approved_plan_hash)) {
    fail('bundle record.approved_plan_hash must be a tagged SHA-256 digest.');
  }
  assertOpaqueRef(record.policy_version, 'bundle record.policy_version');
  if (typeof record.graph_version !== 'string' || !GRAPH_VERSION_PATTERN.test(record.graph_version)) {
    fail('bundle record.graph_version is invalid.');
  }
  assertOpaqueRef(record.account_scope, 'bundle record.account_scope');
  if (record.prepared_mode !== 'guarded') fail('bundle record.prepared_mode must equal guarded.');
  if (record.base_write_mode !== 'guarded') fail('bundle record.base_write_mode must equal guarded.');
  return { record, expiresAt: timestampMillis(record.expires_at, 'bundle record.expires_at') };
}

export function approvalSigningBytes(payload) {
  const parsed = parsePayload(payload).payload;
  return Buffer.concat([
    Buffer.from(BUNDLE_APPROVAL_DOMAIN, 'utf8'),
    Buffer.from([0]),
    Buffer.from(canonicalJson(parsed), 'utf8'),
  ]);
}

export function verifyBundleApproval({ approval, record, publicKeyBase64, now = new Date() }) {
  assertPlainObject(approval, 'approval');
  assertExactFields(approval, SIGNED_FIELDS, 'approval');
  const signature = assertBase64UrlSignature(approval.signature);
  const parsedApproval = parsePayload(unsignedPayload(approval));
  const key = publicKeyFromBase64(publicKeyBase64);
  if (!crypto.verify(null, approvalSigningBytes(parsedApproval.payload), key, signature)) {
    fail('Approval signature is invalid.');
  }

  const parsedRecord = expectedRecord(record);
  for (const field of [
    'bundle_ref',
    'approved_plan_hash',
    'policy_version',
    'graph_version',
    'account_scope',
    'prepared_mode',
    'base_write_mode',
  ]) {
    if (parsedApproval.payload[field] !== parsedRecord.record[field]) {
      fail(`Approval does not match bundle record field ${field}.`);
    }
  }

  if (parsedApproval.expiresAt > parsedRecord.expiresAt) {
    fail('Approval expiry must not exceed the bundle expiry.');
  }

  const currentTime = nowMillis(now);
  if (currentTime < parsedApproval.issuedAt) fail('Approval is not valid yet.');
  if (currentTime >= parsedApproval.expiresAt) fail('Approval has expired.');
  if (currentTime >= parsedRecord.expiresAt) fail('Bundle has expired.');

  return {
    ok: true,
    approval_id: parsedApproval.payload.approval_id,
    approved_by: parsedApproval.payload.approved_by,
    approved_plan_hash: parsedApproval.payload.approved_plan_hash,
    issued_at: parsedApproval.payload.issued_at,
    expires_at: parsedApproval.payload.expires_at,
  };
}
