import { describe, expect, it } from 'vitest';
import { mapKufarEmailToLead, normalizeKufarText, validateKufarConversationUrl } from '../../src/integrations/kufar.js';

describe('Kufar integration', () => {
  it('accepts only an exact HTTPS conversation URL', () => {
    expect(validateKufarConversationUrl('https://www.kufar.by/account/messaging/abc-123')).toContain('/account/messaging/abc-123');
    expect(validateKufarConversationUrl('http://www.kufar.by/account/messaging/abc')).toBeNull();
    expect(validateKufarConversationUrl('https://kufar.by.evil.test/account/messaging/abc')).toBeNull();
    expect(validateKufarConversationUrl('https://user@kufar.by/account/messaging/abc')).toBeNull();
    expect(validateKufarConversationUrl('https://www.kufar.by/account/messages')).toBeNull();
  });

  it('normalizes customer text and maps a phone-less lead', () => {
    const lead = mapKufarEmailToLead({
      externalMessageId: 'gmail-message-001',
      customerMessage: 'Здравствуйте!\u00a0 Нужна замена.\r\n\r\n\r\nПодскажите цену.',
      conversationUrl: 'https://www.kufar.by/account/messaging/dialog-001',
    });
    expect(lead.phone).toBeUndefined();
    expect(lead.message).toBe('Здравствуйте! Нужна замена.\n\nПодскажите цену.');
    expect(lead.sourceActionUrl).toContain('/account/messaging/dialog-001');
  });

  it('keeps a safe message when the action URL is absent', () => {
    const lead = mapKufarEmailToLead({ externalMessageId: 'gmail-message-002', customerMessage: 'Нужна консультация' });
    expect(lead.message).toBe('Нужна консультация');
    expect(lead.sourceActionUrl).toBeUndefined();
  });

  it('limits normalized text', () => {
    expect(normalizeKufarText('x'.repeat(4_000))).toHaveLength(3_500);
  });
});
