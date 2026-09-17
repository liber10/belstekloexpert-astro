import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  metaMessageToLeadInput,
  parseMetaMessageEvents,
} from '../../src/integrations/meta-messaging.js';
import { verifyMetaWebhookSignature } from '../../src/security/meta-signature.js';

describe('Meta messaging webhook normalization', () => {
  it('keeps an inbound Instagram message and removes attachment URLs', () => {
    const events = parseMetaMessageEvents({
      object: 'instagram',
      entry: [{
        id: 'page-123',
        time: 1_757_900_000,
        messaging: [{
          sender: { id: 'person-456' },
          recipient: { id: 'page-123' },
          timestamp: 1_757_900_001,
          message: {
            mid: 'mid-789',
            text: 'Отправляю фото скола',
            attachments: [{ type: 'image', payload: { url: 'https://provider.invalid/private' } }],
          },
        }],
      }],
    }, ['page-123']);

    expect(events).toEqual([{
      externalEventId: 'mid-789',
      platform: 'instagram',
      pageId: 'page-123',
      senderId: 'person-456',
      recipientId: 'page-123',
      conversationId: 'page-123:person-456',
      timestamp: 1_757_900_001,
      text: 'Отправляю фото скола',
      attachmentTypes: ['image'],
    }]);

    const lead = metaMessageToLeadInput(events[0]!);
    expect(lead).toMatchObject({
      source: 'meta',
      externalLeadId: 'page-123:person-456',
      externalEventId: 'mid-789',
      message: 'Отправляю фото скола',
    });
    expect(lead.sourceMetadata).not.toHaveProperty('url');
  });

  it('ignores messages addressed to a different Meta asset', () => {
    const events = parseMetaMessageEvents({
      object: 'page',
      entry: [{
        id: 'page-other',
        messaging: [{
          sender: { id: 'person-1' },
          recipient: { id: 'page-other' },
          message: { mid: 'mid-1', text: 'hello' },
        }],
      }],
    }, ['page-allowed']);
    expect(events).toHaveLength(0);
  });
});

describe('Meta webhook signature', () => {
  it('verifies the exact signed bytes and rejects changed payloads', () => {
    const secret = 'test-meta-app-secret-123456';
    const body = Buffer.from('{"entry":[]}');
    const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
    expect(verifyMetaWebhookSignature(body, signature, secret)).toBe(true);
    expect(verifyMetaWebhookSignature(Buffer.from('{"entry":[1]}'), signature, secret)).toBe(false);
    expect(verifyMetaWebhookSignature(body, undefined, secret)).toBe(false);
  });
});
