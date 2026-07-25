import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/config.js';
import type { ObjectStorage } from '../../src/integrations/object-storage.js';
import { registerUploadRoutes } from '../../src/routes/uploads.js';
import type { LeadService } from '../../src/services/lead-service.js';

describe('upload routes', () => {
  it('accepts a legacy POST with a JSON content type and no body', async () => {
    const app = Fastify({ logger: false });

    const objectStorage: ObjectStorage = {
      prepareUploads: vi.fn(() => Promise.resolve([])),
      createDownloadUrls: vi.fn(() => Promise.resolve(['https://signed.example/photo.jpg'])),
      isReferenceForSubmission: vi.fn(() => true),
    };
    const leadService = {
      getLead: vi.fn(() => Promise.resolve({ photoRefs: ['b2://private-bucket/leads/photo.jpg'] })),
    } as unknown as LeadService;

    registerUploadRoutes(
      app,
      loadConfig({
        DATABASE_URL: 'postgres://localhost/lead_hub',
        WEB_INGEST_API_KEY: 'test-web-ingest-api-key',
      }),
      objectStorage,
      leadService,
    );

    await app.ready();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/leads/6c82e1c6-1307-4393-a3eb-b41441940bc0/photo-downloads',
        headers: {
          authorization: 'Bearer test-web-ingest-api-key',
          'content-type': 'application/json',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        ok: true,
        photoUrls: ['https://signed.example/photo.jpg'],
      });
    } finally {
      await app.close();
    }
  });
});
