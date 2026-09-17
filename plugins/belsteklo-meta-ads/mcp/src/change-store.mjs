import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function redactText(value) {
  return String(value || '')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[redacted-email]')
    .replace(/(?:\+?\d[\s().-]*){7,}/g, '[redacted-number]');
}

export class ChangeStore {
  #changes = new Map();
  #byIdempotencyKey = new Map();
  #lastAppliedByEntity = new Map();
  #secret = crypto.randomBytes(32);

  constructor({ auditLogPath }) {
    this.auditLogPath = auditLogPath;
  }

  async appendAudit(event) {
    await fs.mkdir(path.dirname(this.auditLogPath), { recursive: true });
    const safeEvent = { timestamp: new Date().toISOString(), ...event };
    await fs.appendFile(this.auditLogPath, `${JSON.stringify(safeEvent)}\n`, 'utf8');
  }

  async create(change, ttlMinutes) {
    const existingId = this.#byIdempotencyKey.get(change.idempotencyKey);
    if (existingId) {
      const existing = this.#changes.get(existingId);
      const sameIntent =
        existing &&
        existing.entityRef === change.entityRef &&
        existing.operation === change.operation &&
        canonical(existing.after) === canonical(change.after);
      if (!sameIntent) throw new Error('Idempotency key was already used for a different change.');
      if (existing.state === 'prepared' && Date.parse(existing.expiresAt) > Date.now()) return existing;
      throw new Error(`Idempotent change-set is already ${existing.state}.`);
    }
    const id = `chg_${crypto.randomUUID()}`;
    const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();
    const approvalCode = crypto
      .createHmac('sha256', this.#secret)
      .update(canonical({ id, expiresAt, entityRef: change.entityRef, after: change.after }))
      .digest('hex')
      .slice(0, 16);
    const stored = { ...change, id, approvalCode, expiresAt, state: 'prepared' };
    this.#changes.set(id, stored);
    this.#byIdempotencyKey.set(change.idempotencyKey, id);
    await this.appendAudit({
      event: 'change_prepared',
      change_set_id: id,
      entity_ref: change.entityRef,
      entity_type: change.entityType,
      operation: change.operation,
      before: change.before,
      after: change.after,
      reason: redactText(change.reason),
      expires_at: expiresAt,
    });
    return stored;
  }

  getApproved(id, approvalCode) {
    const change = this.#changes.get(id);
    if (!change) throw new Error('Unknown change-set. Prepare it again.');
    if (change.state !== 'prepared') throw new Error(`Change-set is already ${change.state}.`);
    if (Date.parse(change.expiresAt) <= Date.now()) {
      change.state = 'expired';
      throw new Error('Change-set expired. Prepare it again.');
    }
    const supplied = Buffer.from(String(approvalCode || ''));
    const expected = Buffer.from(change.approvalCode);
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
      throw new Error('Approval code does not match this change-set.');
    }
    return change;
  }

  assertCooldown(entityRef, cooldownHours) {
    const appliedAt = this.#lastAppliedByEntity.get(entityRef);
    if (!appliedAt || cooldownHours <= 0) return;
    const availableAt = appliedAt + cooldownHours * 3_600_000;
    if (Date.now() < availableAt) throw new Error(`Entity is in cooldown until ${new Date(availableAt).toISOString()}.`);
  }

  async mark(change, state, details = {}) {
    change.state = state;
    if (state === 'applied') this.#lastAppliedByEntity.set(change.entityRef, Date.now());
    await this.appendAudit({
      event: `change_${state}`,
      change_set_id: change.id,
      entity_ref: change.entityRef,
      entity_type: change.entityType,
      operation: change.operation,
      before: change.before,
      after: change.after,
      ...details,
    });
  }

  list() {
    return [...this.#changes.values()]
      .slice(-50)
      .reverse()
      .map(({ rawId, accountId, payload, approvalCode, idempotencyKey, reason, ...safe }) => ({
        ...safe,
        reason: redactText(reason),
      }));
  }
}
