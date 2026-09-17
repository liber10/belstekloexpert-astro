import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';

const SCHEMA_VERSION = 1;
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const BUNDLE_REF_PATTERN = /^bundle_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ACCOUNT_SCOPE_PATTERN = /^account_scope_[a-z0-9][a-z0-9_-]{2,63}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const TAGGED_SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const SAFE_CODE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,127}$/;
const SECRET_KEY_PATTERN = /(?:^|_)(?:access_?token|app_?secret|appsecret_?proof|authorization)(?:$|_)/i;

export class CampaignBundleStoreError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'CampaignBundleStoreError';
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CampaignBundleStoreError(`${label} must be an object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new CampaignBundleStoreError(`${label} must be a plain object.`);
  }
}

function assertBundleRef(value) {
  if (!BUNDLE_REF_PATTERN.test(String(value || ''))) {
    throw new CampaignBundleStoreError('Invalid bundle_ref.');
  }
  return String(value);
}

function assertAccountScope(value) {
  if (!ACCOUNT_SCOPE_PATTERN.test(String(value || ''))) {
    throw new CampaignBundleStoreError('Invalid account_scope. Use an opaque account reference.');
  }
  return String(value);
}

function assertIntentHash(value) {
  if (!TAGGED_SHA256_PATTERN.test(String(value || ''))) {
    throw new CampaignBundleStoreError('intentHash must be a tagged lowercase SHA-256 digest.');
  }
  return String(value);
}

function assertTaggedHash(value, label) {
  if (!TAGGED_SHA256_PATTERN.test(String(value || ''))) {
    throw new CampaignBundleStoreError(`${label} must be a tagged lowercase SHA-256 digest.`);
  }
  return String(value);
}

function assertIdempotencyKey(value) {
  if (
    typeof value !== 'string' ||
    value.length < 8 ||
    value.length > 200 ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new CampaignBundleStoreError('idempotencyKey must be 8-200 printable characters without surrounding whitespace.');
  }
  return value;
}

function assertNoSecrets(value, seen = new Set()) {
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) throw new CampaignBundleStoreError('Bundle records must be JSON-serializable.');
  seen.add(value);
  for (const [key, nested] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      throw new CampaignBundleStoreError('Bundle records may not contain credentials.');
    }
    assertNoSecrets(nested, seen);
  }
  seen.delete(value);
}

function jsonClone(value, label) {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error('undefined');
    return JSON.parse(serialized);
  } catch (error) {
    throw new CampaignBundleStoreError(`${label} must be JSON-serializable.`, { cause: error });
  }
}

function safeCode(value, label, { optional = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (optional) return undefined;
    throw new CampaignBundleStoreError(`${label} is required.`);
  }
  if (!SAFE_CODE_PATTERN.test(String(value))) {
    throw new CampaignBundleStoreError(`${label} must be a short machine-readable code.`);
  }
  return String(value);
}

async function bestEffortMode(target, mode) {
  try {
    await fs.chmod(target, mode);
  } catch {
    // Windows and some mounted filesystems do not implement POSIX modes.
  }
}

async function ensureDirectory(target) {
  await fs.mkdir(target, { recursive: true, mode: DIRECTORY_MODE });
  await bestEffortMode(target, DIRECTORY_MODE);
}

async function readJson(target, { missing = null } = {}) {
  let text;
  try {
    text = await fs.readFile(target, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return missing;
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new CampaignBundleStoreError('Campaign bundle state is corrupt; writes are blocked.', { cause: error });
  }
}

async function atomicWriteJson(target, value) {
  const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', FILE_MODE);
    await handle.writeFile(`${JSON.stringify(value)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await bestEffortMode(temporary, FILE_MODE);
    await fs.rename(temporary, target);
    await bestEffortMode(target, FILE_MODE);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await fs.unlink(temporary).catch(() => {});
    throw error;
  }
}

function validateStoredRecord(record, expectedRef) {
  assertPlainObject(record, 'Stored bundle record');
  assertNoSecrets(record);
  const bundleRef = assertBundleRef(record.bundle_ref);
  if (expectedRef && bundleRef !== expectedRef) {
    throw new CampaignBundleStoreError('Campaign bundle state is corrupt; writes are blocked.');
  }
  assertAccountScope(record.account_scope);
  assertIntentHash(record.intent_hash);
  if (!SHA256_PATTERN.test(String(record.idempotency_digest || ''))) {
    throw new CampaignBundleStoreError('Campaign bundle state is corrupt; writes are blocked.');
  }
  if (!SHA256_PATTERN.test(String(record.idempotency_intent_digest || ''))) {
    throw new CampaignBundleStoreError('Campaign bundle state is corrupt; writes are blocked.');
  }
  if (!Number.isInteger(record.revision) || record.revision < 1) {
    throw new CampaignBundleStoreError('Campaign bundle state is corrupt; writes are blocked.');
  }
  return record;
}

function publicBundleSummary(record) {
  const summary = {
    bundle_ref: record.bundle_ref,
    account_scope: record.account_scope,
    state: safeCode(record.state, 'Stored bundle state', { optional: false }),
    intent_hash: record.intent_hash,
    policy_version: safeCode(record.policy_version, 'Stored policy version'),
    write_mode: safeCode(record.write_mode, 'Stored write mode'),
    prepared_mode: safeCode(record.prepared_mode, 'Stored prepared mode'),
    base_write_mode: safeCode(record.base_write_mode, 'Stored base write mode'),
    outcome: safeCode(record.outcome, 'Stored outcome'),
    created_at: record.created_at,
    updated_at: record.updated_at,
    revision: record.revision,
  };
  if (record.approved_plan_hash !== undefined) {
    summary.approved_plan_hash = assertTaggedHash(record.approved_plan_hash, 'Stored approved plan hash');
  }
  if (record.execution?.approval_id !== undefined) {
    summary.approval_id = safeCode(record.execution.approval_id, 'Stored approval ID');
  }
  return summary;
}

function sanitizedAuditEvent(event, now) {
  assertPlainObject(event, 'Audit event');
  const safe = {
    timestamp: now,
    event: safeCode(event.event, 'event', { optional: false }),
  };
  if (event.bundle_ref !== undefined) safe.bundle_ref = assertBundleRef(event.bundle_ref);
  if (event.account_scope !== undefined) safe.account_scope = assertAccountScope(event.account_scope);
  for (const key of [
    'state',
    'step',
    'outcome',
    'reason_code',
    'policy_version',
    'write_mode',
    'error_code',
    'approval_id',
    'classification',
  ]) {
    const value = safeCode(event[key], key);
    if (value !== undefined) safe[key] = value;
  }
  if (event.intent_hash !== undefined) safe.intent_hash = assertIntentHash(event.intent_hash);
  for (const key of ['approved_plan_hash', 'payload_fingerprint']) {
    if (event[key] !== undefined) safe[key] = assertTaggedHash(event[key], key);
  }
  for (const key of ['writes_performed', 'fully_verified', 'approval_verified']) {
    if (event[key] !== undefined) {
      if (typeof event[key] !== 'boolean') throw new CampaignBundleStoreError(`${key} must be boolean.`);
      safe[key] = event[key];
    }
  }
  for (const key of ['created_count', 'verified_step_count', 'expected_step_count', 'resolved_step_count', 'failed_step_count']) {
    if (event[key] !== undefined) {
      if (!Number.isInteger(event[key]) || event[key] < 0) {
        throw new CampaignBundleStoreError(`${key} must be a non-negative integer.`);
      }
      safe[key] = event[key];
    }
  }
  return safe;
}

export class CampaignBundleStore {
  #lockContext = new AsyncLocalStorage();

  constructor({ stateDir, now = () => new Date() } = {}) {
    const configured = stateDir === undefined ? path.join(process.cwd(), '.runtime', 'meta-campaign-bundles') : stateDir;
    if (typeof configured !== 'string' || configured.trim() === '') {
      throw new CampaignBundleStoreError('stateDir must be a non-empty path.');
    }
    this.stateDir = path.resolve(configured);
    this.bundlesDir = path.join(this.stateDir, 'bundles');
    this.accountLocksDir = path.join(this.stateDir, 'account-write-locks');
    this.storeLockDir = path.join(this.stateDir, '.store.lock');
    this.auditLogPath = path.join(this.stateDir, 'audit.jsonl');
    this.now = now;
  }

  #timestamp() {
    const value = this.now();
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) throw new CampaignBundleStoreError('Store clock returned an invalid date.');
    return date.toISOString();
  }

  async #ensureLayout() {
    await ensureDirectory(this.stateDir);
    await Promise.all([ensureDirectory(this.bundlesDir), ensureDirectory(this.accountLocksDir)]);
  }

  async init() {
    await this.#ensureLayout();
    return this;
  }

  async #withFilesystemLock(action) {
    await this.#ensureLayout();
    try {
      await fs.mkdir(this.storeLockDir, { mode: DIRECTORY_MODE });
      await bestEffortMode(this.storeLockDir, DIRECTORY_MODE);
    } catch (error) {
      if (error?.code === 'EEXIST') {
        throw new CampaignBundleStoreError(
          'Campaign bundle store is locked. A stale lock requires manual reconciliation; no write was attempted.',
        );
      }
      throw error;
    }

    let result;
    let actionError;
    try {
      result = await action();
    } catch (error) {
      actionError = error;
    }

    try {
      // Intentionally non-recursive: a non-empty or replaced lock fails closed.
      await fs.rmdir(this.storeLockDir);
    } catch (error) {
      throw new CampaignBundleStoreError(
        'Campaign bundle store lock could not be released; manual reconciliation is required.',
        { cause: error },
      );
    }
    if (actionError) throw actionError;
    return result;
  }

  async withExclusive(action) {
    if (typeof action !== 'function') {
      throw new CampaignBundleStoreError('withExclusive requires an async callback.');
    }
    const current = this.#lockContext.getStore();
    if (current?.owner === this && current.active) return action();
    return this.#withFilesystemLock(() => {
      const context = { owner: this, active: true };
      return this.#lockContext.run(context, async () => {
        try {
          return await action();
        } finally {
          // Async resources spawned by the callback may retain this context.
          // Deactivate it before releasing the filesystem lock so late work
          // cannot bypass a future owner.
          context.active = false;
        }
      });
    });
  }

  async #mutate(action) {
    const current = this.#lockContext.getStore();
    if (current?.owner === this && current.active) return action();
    return this.withExclusive(action);
  }

  #bundlePath(bundleRef) {
    return path.join(this.bundlesDir, `${assertBundleRef(bundleRef)}.json`);
  }

  #accountLockPath(accountScope) {
    const scope = assertAccountScope(accountScope);
    return path.join(this.accountLocksDir, `${sha256(scope)}.json`);
  }

  async #readBundleFiles() {
    await this.#ensureLayout();
    const entries = await fs.readdir(this.bundlesDir, { withFileTypes: true });
    const records = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.name.endsWith('.json')) continue;
      if (!BUNDLE_REF_PATTERN.test(entry.name.slice(0, -'.json'.length))) {
        throw new CampaignBundleStoreError('Campaign bundle state is corrupt; writes are blocked.');
      }
      if (!entry.isFile()) {
        throw new CampaignBundleStoreError('Campaign bundle state is corrupt; writes are blocked.');
      }
      const expectedRef = entry.name.slice(0, -'.json'.length);
      const record = await readJson(path.join(this.bundlesDir, entry.name));
      records.push(validateStoredRecord(record, expectedRef));
    }
    return records;
  }

  async createOrGet({ idempotencyKey, intentHash, createRecord }) {
    const key = assertIdempotencyKey(idempotencyKey);
    const intent = assertIntentHash(intentHash);
    if (typeof createRecord !== 'function') {
      throw new CampaignBundleStoreError('createRecord(bundleRef) callback is required.');
    }
    const idempotencyDigest = sha256(key);
    const idempotencyIntentDigest = sha256(`${key}\u0000${intent}`);

    return this.#mutate(async () => {
      const records = await this.#readBundleFiles();
      const existingForKey = records.find((candidate) => candidate.idempotency_digest === idempotencyDigest);
      if (existingForKey) {
        if (existingForKey.intent_hash !== intent) {
          throw new CampaignBundleStoreError('Idempotency key was already used for a different bundle intent.');
        }
        return jsonClone(existingForKey, 'Stored bundle record');
      }
      const bundleRef = `bundle_${crypto.randomUUID()}`;
      const collision = records.find((candidate) => candidate.bundle_ref === bundleRef);
      if (collision) {
        throw new CampaignBundleStoreError('Bundle reference collision; no write was attempted.');
      }
      const proposed = await createRecord(bundleRef);
      assertPlainObject(proposed, 'Bundle record');
      assertNoSecrets(proposed);
      const internalRecord = jsonClone(proposed, 'Bundle record');
      const scope = assertAccountScope(internalRecord.account_scope);
      const timestamp = this.#timestamp();
      const stored = {
        ...internalRecord,
        schema_version: SCHEMA_VERSION,
        bundle_ref: bundleRef,
        account_scope: scope,
        intent_hash: intent,
        idempotency_digest: idempotencyDigest,
        idempotency_intent_digest: idempotencyIntentDigest,
        state: safeCode(internalRecord.state || 'planned', 'Bundle state', { optional: false }),
        created_at: timestamp,
        updated_at: timestamp,
        revision: 1,
      };
      validateStoredRecord(stored, bundleRef);
      await atomicWriteJson(this.#bundlePath(bundleRef), stored);
      return jsonClone(stored, 'Stored bundle record');
    });
  }

  async loadBundle(bundleRef) {
    await this.#ensureLayout();
    const ref = assertBundleRef(bundleRef);
    const record = await readJson(this.#bundlePath(ref));
    return record === null ? null : jsonClone(validateStoredRecord(record, ref), 'Stored bundle record');
  }

  async listBundles() {
    const records = await this.#readBundleFiles();
    return records
      .sort((left, right) => String(right.updated_at).localeCompare(String(left.updated_at)))
      .map(publicBundleSummary);
  }

  async saveBundle(record) {
    assertPlainObject(record, 'Bundle record');
    assertNoSecrets(record);
    const candidate = jsonClone(record, 'Bundle record');
    validateStoredRecord(candidate);
    return this.#mutate(async () => {
      const current = await readJson(this.#bundlePath(candidate.bundle_ref));
      if (!current) throw new CampaignBundleStoreError('Unknown bundle_ref.');
      validateStoredRecord(current, candidate.bundle_ref);
      for (const field of [
        'account_scope',
        'intent_hash',
        'idempotency_digest',
        'idempotency_intent_digest',
        'created_at',
      ]) {
        if (candidate[field] !== current[field]) {
          throw new CampaignBundleStoreError(`Stored ${field} is immutable.`);
        }
      }
      if (candidate.revision !== current.revision) {
        throw new CampaignBundleStoreError('Bundle record is stale; reload it before saving.');
      }
      const stored = {
        ...candidate,
        schema_version: SCHEMA_VERSION,
        updated_at: this.#timestamp(),
        revision: current.revision + 1,
      };
      validateStoredRecord(stored, candidate.bundle_ref);
      await atomicWriteJson(this.#bundlePath(candidate.bundle_ref), stored);
      record.schema_version = stored.schema_version;
      record.updated_at = stored.updated_at;
      record.revision = stored.revision;
      return jsonClone(stored, 'Stored bundle record');
    });
  }

  async appendAudit(event) {
    const safe = sanitizedAuditEvent(event, this.#timestamp());
    return this.#mutate(async () => {
      await fs.appendFile(this.auditLogPath, `${JSON.stringify(safe)}\n`, {
        encoding: 'utf8',
        flag: 'a',
        mode: FILE_MODE,
      });
      await bestEffortMode(this.auditLogPath, FILE_MODE);
      return jsonClone(safe, 'Audit event');
    });
  }

  async listAudit({ limit = 100 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
      throw new CampaignBundleStoreError('Audit limit must be an integer from 1 to 1000.');
    }
    await this.#ensureLayout();
    let text;
    try {
      text = await fs.readFile(this.auditLogPath, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
    const rows = text
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch (error) {
          throw new CampaignBundleStoreError('Campaign bundle audit is corrupt; writes are blocked.', { cause: error });
        }
      });
    return rows.slice(-limit).reverse();
  }

  async getAccountLock(accountScope) {
    await this.#ensureLayout();
    const scope = assertAccountScope(accountScope);
    const record = await readJson(this.#accountLockPath(scope));
    if (!record || record.locked !== true) return null;
    if (record.account_scope !== scope) {
      throw new CampaignBundleStoreError('Account write-lock state is corrupt; writes are blocked.');
    }
    return jsonClone(record, 'Account write-lock');
  }

  async setAccountLock(accountScope, details = {}) {
    const scope = assertAccountScope(accountScope);
    assertPlainObject(details, 'Account lock details');
    const reason = safeCode(
      details.reason_code || details.reasonCode || details.reason || 'outcome_unknown',
      'reasonCode',
      { optional: false },
    );
    const suppliedRef = details.bundle_ref || details.bundleRef;
    const ref = suppliedRef === undefined ? undefined : assertBundleRef(suppliedRef);
    const state = safeCode(details.state, 'Account lock state');
    return this.#mutate(async () => {
      const target = this.#accountLockPath(scope);
      const existing = await readJson(target);
      if (existing?.locked === true) {
        if (existing.account_scope !== scope || (ref && existing.bundle_ref && existing.bundle_ref !== ref)) {
          throw new CampaignBundleStoreError('Account already has a different unresolved write lock.');
        }
        return jsonClone(existing, 'Account write-lock');
      }
      const locked = {
        account_scope: scope,
        locked: true,
        reason_code: reason,
        bundle_ref: ref,
        state,
        locked_at: this.#timestamp(),
      };
      await atomicWriteJson(target, locked);
      return jsonClone(locked, 'Account write-lock');
    });
  }

  async clearAccountLock(accountScope, details = {}) {
    const scope = assertAccountScope(accountScope);
    assertPlainObject(details, 'Account lock details');
    const suppliedRef = details.bundle_ref || details.bundleRef;
    const expectedRef = suppliedRef === undefined ? undefined : assertBundleRef(suppliedRef);
    const reason = safeCode(details.reason_code || details.reasonCode || 'reconciled', 'reasonCode', {
      optional: false,
    });
    return this.#mutate(async () => {
      const target = this.#accountLockPath(scope);
      const existing = await readJson(target);
      if (!existing || existing.locked !== true) return null;
      if (existing.account_scope !== scope) {
        throw new CampaignBundleStoreError('Account write-lock state is corrupt; writes are blocked.');
      }
      if (expectedRef && existing.bundle_ref && existing.bundle_ref !== expectedRef) {
        throw new CampaignBundleStoreError('Account write lock belongs to a different bundle.');
      }
      const cleared = {
        account_scope: scope,
        locked: false,
        previous_bundle_ref: existing.bundle_ref,
        reason_code: reason,
        locked_at: existing.locked_at,
        cleared_at: this.#timestamp(),
      };
      await atomicWriteJson(target, cleared);
      return jsonClone(cleared, 'Cleared account write-lock');
    });
  }

  // Compatibility aliases for callers migrated from the initial local prototype.
  load(bundleRef) {
    return this.loadBundle(bundleRef);
  }

  list() {
    return this.listBundles();
  }

  save(record) {
    return this.saveBundle(record);
  }

  getAccountWriteLock(accountScope) {
    return this.getAccountLock(accountScope);
  }

  setAccountWriteLock(accountScope, details) {
    return this.setAccountLock(accountScope, details);
  }

  clearAccountWriteLock(accountScope, details) {
    return this.clearAccountLock(accountScope, details);
  }
}

export const campaignBundleStoreInternals = Object.freeze({
  BUNDLE_REF_PATTERN,
  ACCOUNT_SCOPE_PATTERN,
});
