import { Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config.js';
import {
  PhotoUploadValidationError,
  type ObjectStorage,
  type PhotoUploadDescriptor,
} from '../integrations/object-storage.js';
import { bearerToken, matchesSecret } from '../security/secrets.js';
import { LeadNotFoundError, type LeadService } from '../services/lead-service.js';

interface UploadRequestBody {
  submissionId: string;
  files: PhotoUploadDescriptor[];
}

interface LeadParams {
  leadId: string;
}

const UploadRequestSchema = Type.Object(
  {
    submissionId: Type.String({
      minLength: 8,
      maxLength: 160,
      pattern: '^[A-Za-z0-9_-]+$',
    }),
    files: Type.Array(
      Type.Object(
        {
          contentType: Type.Union([
            Type.Literal('image/jpeg'),
            Type.Literal('image/png'),
            Type.Literal('image/webp'),
            Type.Literal('image/heic'),
            Type.Literal('image/heif'),
          ]),
          size: Type.Integer({ minimum: 1, maximum: 10 * 1_024 * 1_024 }),
          sha256: Type.String({ pattern: '^[a-f0-9]{64}$' }),
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 5 },
    ),
  },
  { additionalProperties: false },
);

export function registerUploadRoutes(
  app: FastifyInstance,
  config: AppConfig,
  objectStorage: ObjectStorage | null,
  leadService: LeadService,
) {
  const authorize = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!config.webIngestApiKey) return;
    const provided = bearerToken(request.headers.authorization);
    if (!matchesSecret(provided, config.webIngestApiKey)) {
      return reply.code(401).send({ ok: false, error: 'unauthorized' });
    }
  };

  app.post<{ Body: UploadRequestBody }>(
    '/api/v1/uploads/presign',
    {
      config: {
        rateLimit: {
          max: config.rateLimitMax,
          timeWindow: '1 minute',
        },
      },
      schema: { body: UploadRequestSchema },
      preHandler: authorize,
    },
    async (request, reply) => {
      if (!objectStorage) {
        return reply.code(503).send({ ok: false, error: 'storage_unavailable' });
      }

      try {
        const uploads = await objectStorage.prepareUploads(
          request.body.submissionId,
          request.body.files,
        );
        request.log.info(
          { submissionId: request.body.submissionId, photoCount: uploads.length },
          'Photo upload slots prepared.',
        );
        return reply.send({ ok: true, uploads });
      } catch (error) {
        if (error instanceof PhotoUploadValidationError) {
          return reply.code(400).send({ ok: false, error: 'invalid_upload' });
        }
        throw error;
      }
    },
  );

  app.post<{ Params: LeadParams }>(
    '/api/v1/leads/:leadId/photo-downloads',
    {
      schema: {
        params: Type.Object({ leadId: Type.String({ format: 'uuid' }) }),
      },
      onRequest: (request, _reply, done) => {
        // This route has no body. Legacy clients sent JSON headers without JSON.
        delete request.headers['content-type'];
        done();
      },
      preHandler: authorize,
    },
    async (request, reply) => {
      if (!objectStorage) {
        return reply.code(503).send({ ok: false, error: 'storage_unavailable' });
      }

      try {
        const lead = await leadService.getLead(request.params.leadId);
        const photoUrls = await objectStorage.createDownloadUrls(lead.photoRefs);
        return reply.send({ ok: true, photoUrls });
      } catch (error) {
        if (error instanceof LeadNotFoundError) {
          return reply.code(404).send({ ok: false, error: 'lead_not_found' });
        }
        if (error instanceof PhotoUploadValidationError) {
          return reply.code(409).send({ ok: false, error: 'invalid_photo_reference' });
        }
        throw error;
      }
    },
  );
}
