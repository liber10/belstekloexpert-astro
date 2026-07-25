import { describe, expect, it, vi } from 'vitest';
import {
  buildWebLeadPayload,
  classifyDeliveryFailure,
  getLeadPhotoUrls,
  getLeadRuntimeEnv,
  LeadHubRequestError,
  normalizeSubmissionId,
  resolveLeadDeliveryMode,
  preparePhotoUploads,
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

  it('includes private photo references in the ingest payload', () => {
    const reference = 'b2://bucket-name/leads/2026/07/hash/1-photo.jpg';
    const payload = buildWebLeadPayload(
      { phone: '+375291111111' },
      'submission_test_003',
      1,
      [reference],
    );

    expect(payload.photoRefs).toEqual([reference]);
    expect(payload.message).toContain('\u0424\u043e\u0442\u043e \u043f\u0440\u0438\u043b\u043e\u0436\u0435\u043d\u043e: 1');
  });

  it('requests and validates signed upload slots', async () => {
    let requestedUrl = '';
    let requestedInit: RequestInit | undefined;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestedUrl = String(input);
      requestedInit = init;
      return new Response(
        JSON.stringify({
          ok: true,
          uploads: [
            {
              ref: 'b2://bucket-name/leads/2026/07/hash/1-photo.jpg',
              uploadUrl: 'https://signed.example/upload',
              headers: { 'content-type': 'image/jpeg' },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const result = await preparePhotoUploads({
      submissionId: 'submission_test_004',
      files: [{ contentType: 'image/jpeg', size: 1_024, sha256: 'a'.repeat(64) }],
      env: {
        LEAD_HUB_URL: 'https://hub.example',
        WEB_INGEST_API_KEY: 'test-api-key',
      },
      fetchImpl,
    });

    expect(requestedUrl).toBe('https://hub.example/api/v1/uploads/presign');
    expect(requestedInit?.method).toBe('POST');
    expect(JSON.parse(String(requestedInit?.body))).toEqual({
      submissionId: 'submission_test_004',
      files: [{ contentType: 'image/jpeg', size: 1_024, sha256: 'a'.repeat(64) }],
    });
    expect(result.uploads[0]?.ref).toContain('b2://bucket-name/');
  });

  it('sends an explicit JSON body when requesting private photo URLs', async () => {
    let requestedUrl = '';
    let requestedInit: RequestInit | undefined;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestedUrl = String(input);
      requestedInit = init;
      return new Response(
        JSON.stringify({ photoUrls: ['https://signed.example/photo.jpg'] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const photoUrls = await getLeadPhotoUrls({
      leadId: '7f5a15b8-00ce-40c5-86dc-abd21dbd3d94',
      env: {
        LEAD_HUB_URL: 'https://hub.example',
        WEB_INGEST_API_KEY: 'test-api-key',
      },
      fetchImpl,
    });

    expect(requestedUrl).toBe(
      'https://hub.example/api/v1/leads/7f5a15b8-00ce-40c5-86dc-abd21dbd3d94/photo-downloads',
    );
    expect(requestedInit?.method).toBe('POST');
    expect(requestedInit?.headers).toMatchObject({
      'content-type': 'application/json',
    });
    expect(requestedInit?.body).toBe('{}');
    expect(photoUrls).toEqual(['https://signed.example/photo.jpg']);
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
