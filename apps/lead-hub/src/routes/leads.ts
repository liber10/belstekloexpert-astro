import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config.js';
import { WebLeadBodySchema, type WebLeadBody } from '../contracts/web-lead.js';
import { IdempotencyConflictError } from '../domain/idempotency.js';
import { InvalidPhoneError } from '../domain/phone.js';
import { bearerToken, matchesSecret } from '../security/secrets.js';
import { LeadValidationError, type LeadService } from '../services/lead-service.js';

interface WebLeadHeaders {
  'idempotency-key': string;
  authorization?: string;
}

const HeadersSchema = Type.Object(
  {
    'idempotency-key': Type.String({ minLength: 8, maxLength: 160 }),
    authorization: Type.Optional(Type.String({ maxLength: 512 })),
  },
  { additionalProperties: true },
);

const SuccessSchema = Type.Object({
  ok: Type.Literal(true),
  leadId: Type.String({ format: 'uuid' }),
  publicId: Type.String(),
  status: Type.String(),
  deduplicated: Type.Boolean(),
});

export function registerLeadRoutes(
  app: FastifyInstance,
  config: AppConfig,
  leadService: LeadService,
) {
  app.post<{ Body: WebLeadBody; Headers: WebLeadHeaders }>(
    '/api/v1/leads/web',
    {
      config: {
        rateLimit: {
          max: config.rateLimitMax,
          timeWindow: '1 minute',
        },
      },
      schema: {
        body: WebLeadBodySchema,
        headers: HeadersSchema,
        response: {
          200: SuccessSchema,
          201: SuccessSchema,
        },
      },
      preHandler: async (request, reply) => {
        if (!config.webIngestApiKey) return;
        const provided = bearerToken(request.headers.authorization);
        if (!matchesSecret(provided, config.webIngestApiKey)) {
          return reply.code(401).send({ ok: false, error: 'unauthorized' });
        }
      },
    },
    async (request, reply) => {
      try {
        const result = await leadService.createWebLead(
          request.body,
          request.headers['idempotency-key'],
        );

        request.log.info(
          {
            leadId: result.lead.id,
            publicId: result.lead.publicId,
            source: result.lead.source,
            deduplicated: result.deduplicated,
          },
          'Web lead accepted.',
        );

        return reply.code(result.deduplicated ? 200 : 201).send({
          ok: true,
          leadId: result.lead.id,
          publicId: result.lead.publicId,
          status: result.lead.status,
          deduplicated: result.deduplicated,
        });
      } catch (error) {
        if (error instanceof IdempotencyConflictError) {
          return reply.code(409).send({ ok: false, error: 'idempotency_conflict' });
        }
        if (error instanceof InvalidPhoneError || error instanceof LeadValidationError) {
          return reply.code(400).send({ ok: false, error: 'invalid_lead', message: error.message });
        }
        throw error;
      }
    },
  );
}
