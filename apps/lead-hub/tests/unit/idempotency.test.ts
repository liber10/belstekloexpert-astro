import { describe, expect, it } from 'vitest';
import { hashPayload } from '../../src/domain/idempotency.js';

describe('hashPayload', () => {
  it('is stable across object key order', () => {
    expect(hashPayload({ phone: '+3751', source: 'web' })).toBe(
      hashPayload({ source: 'web', phone: '+3751' }),
    );
  });

  it('changes when meaningful payload changes', () => {
    expect(hashPayload({ phone: '+3751' })).not.toBe(hashPayload({ phone: '+3752' }));
  });
});
