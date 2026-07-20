import { describe, expect, it } from 'vitest';
import type { Lead } from '../../src/db/schema.js';
import { buildLeadCard, buildLeadKeyboard } from '../../src/integrations/telegram/card.js';

const lead: Lead = {
  id: 'f83db34b-3442-4f8e-823f-c2700490a001',
  publicId: 'BSE-20260716-F83DB34B',
  source: 'web',
  sourceDetail: 'google_ads',
  externalLeadId: null,
  idempotencyKey: 'test-key-123456',
  requestHash: 'a'.repeat(64),
  status: 'new',
  name: 'Иван',
  phoneNormalized: '+375291111111',
  emailNormalized: null,
  carMake: 'Volkswagen',
  carModel: 'Passat',
  carYear: 2018,
  vin: 'WVWZZZ3CZJE123456',
  vehicleType: null,
  serviceType: 'Замена лобового',
  damageType: null,
  sensors: null,
  heating: null,
  adas: null,
  district: 'Минск',
  visitType: null,
  preferredAt: null,
  message: 'Трещина со стороны водителя',
  photoRefs: ['photo://one'],
  utmSource: 'google',
  utmMedium: 'cpc',
  utmCampaign: 'windshield',
  utmContent: null,
  utmTerm: null,
  gclid: null,
  gbraid: null,
  wbraid: null,
  yclid: null,
  fbclid: null,
  ymClientId: null,
  gaClientId: null,
  landingUrl: null,
  referrer: null,
  consentAt: null,
  privacyVersion: null,
  assignedTo: null,
  firstResponseAt: null,
  qualifiedAt: null,
  bookedAt: null,
  arrivedAt: null,
  wonAt: null,
  lostAt: null,
  quoteAmount: null,
  revenue: null,
  cost: null,
  grossProfit: null,
  lostReason: null,
  telegramChatId: null,
  telegramMessageId: null,
  createdAt: new Date('2026-07-16T07:42:00.000Z'),
  updatedAt: new Date('2026-07-16T07:42:00.000Z'),
};

describe('Telegram lead card', () => {
  it('contains operational lead details', () => {
    const card = buildLeadCard(lead);
    expect(card).toContain('#BSE-20260716-F83DB34B');
    expect(card).toContain('+375291111111');
    expect(card).toContain('Volkswagen Passat 2018');
    expect(card).toContain('windshield');
  });

  it('builds status callbacks that fit Telegram limits', () => {
    const keyboard = buildLeadKeyboard(lead.id).inline_keyboard;
    const callbacks = keyboard.flat().map((button) => ('callback_data' in button ? button.callback_data : ''));
    expect(callbacks).toContain(`status:qualified:${lead.id}`);
    expect(callbacks.every((value) => value.length <= 64)).toBe(true);
  });
});
