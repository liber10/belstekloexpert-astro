import { describe, expect, it } from 'vitest';
import {
  buildWebLeadPayload,
  classifyDeliveryFailure,
  getLeadRuntimeEnv,
  LeadHubRequestError,
  normalizeSubmissionId,
  resolveLeadDeliveryMode,
} from '../src/lib/lead-hub';

describe('site Lead Hub client', () => {
  it('maps form fields and attribution to the ingest contract', () => {
    expect(
      buildWebLeadPayload(
        {
          service: 'VIN/фото',
          phone: '+375 33 111-22-33',
          name: 'Иван',
          make: 'Peugeot',
          model: '308',
          year: '2019',
          vin: 'vf3abc12345678901',
          glass_type: 'Лобовое',
          comment: 'Есть камера',
          utm_source: 'yandex',
          yclid: 'test-click-id',
          landing_url: 'https://belstekloexpert.by/kalkulyator/',
        },
        'submission_test_001',
        2,
      ),
    ).toEqual({
      sourceDetail: 'VIN/фото',
      externalLeadId: 'submission_test_001',
      name: 'Иван',
      phone: '+375 33 111-22-33',
      carMake: 'Peugeot',
      carModel: '308',
      carYear: 2019,
      vin: 'VF3ABC12345678901',
      serviceType: 'VIN/фото',
      message: 'Есть камера\nТип стекла: Лобовое\nФото приложено: 2',
      attribution: {
        utmSource: 'yandex',
        yclid: 'test-click-id',
        landingUrl: 'https://belstekloexpert.by/kalkulyator/',
      },
    });
  });

  it('keeps an invalid partial VIN in the message instead of the VIN field', () => {
    const payload = buildWebLeadPayload(
      { phone: '+375291111111', vin: 'abc123', comment: 'Проверьте VIN' },
      'submission_test_002',
    );

    expect(payload.vin).toBeUndefined();
    expect(payload.message).toContain('VIN как введён: ABC123');
  });

  it('selects a rollback-safe delivery mode from server configuration', () => {
    expect(resolveLeadDeliveryMode({})).toBe('legacy');
    expect(resolveLeadDeliveryMode({ WEB_INGEST_API_KEY: 'configured' })).toBe('hub');
    expect(
      resolveLeadDeliveryMode({
        WEB_INGEST_API_KEY: 'configured',
        TELEGRAM_BOT_TOKEN: 'configured',
        TELEGRAM_CHAT_ID: 'configured',
      }),
    ).toBe('hub-with-legacy-telegram');
    expect(
      resolveLeadDeliveryMode({
        LEAD_DELIVERY_MODE: 'legacy',
        WEB_INGEST_API_KEY: 'configured',
      }),
    ).toBe('legacy');
  });

  it('accepts only stable idempotency keys', () => {
    expect(normalizeSubmissionId('submission_123')).toBe('submission_123');
    expect(normalizeSubmissionId('short')).toBe('');
    expect(normalizeSubmissionId('bad key with spaces')).toBe('');
  });

  it('reads private server settings from the runtime environment', () => {
    const previous = process.env.WEB_INGEST_API_KEY;
    process.env.WEB_INGEST_API_KEY = 'runtime-test-key';

    try {
      expect(getLeadRuntimeEnv().WEB_INGEST_API_KEY).toBe('runtime-test-key');
    } finally {
      if (previous === undefined) {
        delete process.env.WEB_INGEST_API_KEY;
      } else {
        process.env.WEB_INGEST_API_KEY = previous;
      }
    }
  });

  it('returns safe diagnostic codes without exception details', () => {
    expect(
      classifyDeliveryFailure(
        'hub',
        new LeadHubRequestError('request_failed', 401),
      ),
    ).toBe('hub_authentication_failed');
    expect(
      classifyDeliveryFailure(
        'hub',
        new LeadHubRequestError('request_failed', 404),
      ),
    ).toBe('hub_endpoint_unavailable');
    expect(
      classifyDeliveryFailure(
        'telegram_bridge',
        new Error('private upstream details'),
      ),
    ).toBe('telegram_bridge_unavailable');
  });
});
