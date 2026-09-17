import crypto from 'node:crypto';

export class ReferenceRegistry {
  #byReference = new Map();
  #byRaw = new Map();

  register(type, rawId, accountId, metadata = {}) {
    if (!rawId) return null;
    const key = `${type}:${accountId}:${rawId}`;
    const existing = this.#byRaw.get(key);
    if (existing) return existing;
    const digest = crypto.createHash('sha256').update(key).digest('hex').slice(0, 14);
    const reference = `${type}_${digest}`;
    this.#byReference.set(reference, { type, rawId: String(rawId), accountId, metadata });
    this.#byRaw.set(key, reference);
    return reference;
  }

  resolve(reference, expectedType) {
    const record = this.#byReference.get(reference);
    if (!record || (expectedType && record.type !== expectedType)) {
      throw new Error('Unknown or stale entity_ref. List the entity again before preparing a change.');
    }
    return record;
  }
}
