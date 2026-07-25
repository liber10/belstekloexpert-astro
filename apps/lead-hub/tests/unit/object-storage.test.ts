import { describe, expect, it } from 'vitest';
import {
  buildPhotoObjectKey,
  buildPhotoReference,
  parsePhotoReference,
  validatePhotoUploadDescriptors,
} from '../../src/integrations/object-storage.js';

const descriptor = {
  contentType: 'image/jpeg',
  size: 2_048,
  sha256: 'a'.repeat(64),
};

describe('object storage references', () => {
  it('builds deterministic, non-PII keys for a submission and file digest', () => {
    const key = buildPhotoObjectKey(
      'leads/',
      'submission_test_001',
      descriptor,
      0,
      new Date('2026-07-25T10:00:00.000Z'),
    );

    expect(key).toMatch(/^leads\/2026\/07\/[a-f0-9]{64}\/1-[a-f0-9]{32}\.jpg$/);
    expect(key).not.toContain('submission_test_001');
  });

  it('parses only references from the configured bucket and prefix', () => {
    const key = buildPhotoObjectKey(
      'leads/',
      'submission_test_001',
      descriptor,
      0,
      new Date('2026-07-25T10:00:00.000Z'),
    );
    const reference = buildPhotoReference('private-photo-bucket', key);

    expect(parsePhotoReference(reference, 'private-photo-bucket', 'leads/')).toBe(key);
    expect(parsePhotoReference(reference, 'other-bucket', 'leads/')).toBeNull();
    expect(
      parsePhotoReference('b2://private-photo-bucket/leads/../../secret.jpg', 'private-photo-bucket', 'leads/'),
    ).toBeNull();
  });

  it('rejects unsupported types, oversized files and malformed digests', () => {
    expect(() => validatePhotoUploadDescriptors([{ ...descriptor, contentType: 'text/plain' }]))
      .toThrow('Unsupported photo content type');
    expect(() => validatePhotoUploadDescriptors([{ ...descriptor, size: 11 * 1_024 * 1_024 }]))
      .toThrow('Invalid photo size');
    expect(() => validatePhotoUploadDescriptors([{ ...descriptor, sha256: 'bad' }]))
      .toThrow('Invalid photo digest');
  });
});
