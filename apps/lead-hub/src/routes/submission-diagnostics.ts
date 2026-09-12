import { Type } from '@sinclair/typebox';
import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config.js';
import type { LeadHubDatabase } from '../db/client.js';
import { formSubmissionAudits, integrationOutbox, leadEvents, leads } from '../db/schema.js';
import { bearerToken, matchesSecret } from '../security/secrets.js';

const outcomes = [
  'received',
  'validation_rejected',
  'honeypot_rejected',
  'hub_request_failed',
] as const;

type Outcome = (typeof outcomes)[number];

interface AuditBody {
  correlationId: string;
  event: Outcome;
  reason?: string;
  formType: string;
}

export function registerSubmissionDiagnosticRoutes(
  app: FastifyInstance,
  config: AppConfig,
  db: LeadHubDatabase,
) {
  const authorize = async (request: FastifyRequest, reply: FastifyReply) => {
    const provided = bearerToken(request.headers.authorization);
    if (!config.webIngestApiKey || !matchesSecret(provided, config.webIngestApiKey)) {
      return reply.code(401).send({ ok: false, error: 'unauthorized' });
    }
  };

  app.post<{ Body: AuditBody }>(
    '/api/v1/submissions/audit',
    {
      schema: {
        body: Type.Object({
          correlationId: Type.String({ minLength: 8, maxLength: 160, pattern: '^[A-Za-z0-9_-]+$' }),
          event: Type.Union(outcomes.map((value) => Type.Literal(value))),
          reason: Type.Optional(Type.String({ minLength: 1, maxLength: 80, pattern: '^[a-z0-9_-]+$' })),
          formType: Type.String({ minLength: 1, maxLength: 160 }),
        }, { additionalProperties: false }),
      },
      preHandler: authorize,
    },
    async (request, reply) => {
      await db.insert(formSubmissionAudits).values({
        correlationId: request.body.correlationId,
        event: request.body.event,
        reason: request.body.reason,
        formType: request.body.formType,
      });
      request.log.info({
        correlationId: request.body.correlationId,
        event: request.body.event,
        reason: request.body.reason,
        formType: request.body.formType,
      }, 'Form submission audit recorded.');
      return reply.code(202).send({ ok: true });
    },
  );

  app.get<{ Params: { correlationId: string } }>(
    '/api/v1/submissions/:correlationId/trace',
    {
      schema: {
        params: Type.Object({
          correlationId: Type.String({ minLength: 8, maxLength: 160, pattern: '^[A-Za-z0-9_-]+$' }),
        }),
      },
      preHandler: authorize,
    },
    async (request) => {
      const audit = await db.select({
        event: formSubmissionAudits.event,
        reason: formSubmissionAudits.reason,
        formType: formSubmissionAudits.formType,
        at: formSubmissionAudits.createdAt,
      }).from(formSubmissionAudits)
        .where(eq(formSubmissionAudits.correlationId, request.params.correlationId))
        .orderBy(asc(formSubmissionAudits.createdAt));
      const [lead] = await db.select({ id: leads.id, publicId: leads.publicId, createdAt: leads.createdAt })
        .from(leads).where(eq(leads.idempotencyKey, request.params.correlationId)).limit(1);
      if (!lead) return { ok: true, correlationId: request.params.correlationId, audit, lead: null, events: [], outbox: [] };
      const events = await db.select({ event: leadEvents.eventType, at: leadEvents.createdAt })
        .from(leadEvents).where(eq(leadEvents.leadId, lead.id)).orderBy(asc(leadEvents.createdAt));
      const outbox = await db.select({
        event: integrationOutbox.eventType,
        status: integrationOutbox.status,
        attempts: integrationOutbox.attemptCount,
        createdAt: integrationOutbox.createdAt,
        processedAt: integrationOutbox.processedAt,
      }).from(integrationOutbox).where(eq(integrationOutbox.leadId, lead.id)).orderBy(asc(integrationOutbox.createdAt));
      return {
        ok: true,
        correlationId: request.params.correlationId,
        audit,
        lead: { publicId: lead.publicId, createdAt: lead.createdAt },
        events,
        outbox,
      };
    },
  );
}
