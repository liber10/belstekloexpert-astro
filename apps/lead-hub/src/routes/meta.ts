import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { asc, eq } from 'drizzle-orm';
import type { AppConfig } from '../config.js';
import type { LeadHubDatabase } from '../db/client.js';
import { integrationInbox } from '../db/schema.js';
import { parseMetaMessageEvents } from '../integrations/meta-messaging.js';
import type { RawBodyRequest } from '../security/raw-body.js';
import { verifyMetaWebhookSignature } from '../security/meta-signature.js';
import { bearerToken, matchesSecret } from '../security/secrets.js';
import type { InboxService } from '../services/inbox-service.js';

interface MetaVerificationQuery {
  'hub.mode'?: string;
  'hub.verify_token'?: string;
  'hub.challenge'?: string;
}

export function registerMetaRoutes(
  app: FastifyInstance,
  config: AppConfig,
  inbox: InboxService,
  db: LeadHubDatabase,
) {
  if (!config.meta.enabled) return;

  app.get<{ Querystring: MetaVerificationQuery }>(
    '/api/v1/webhooks/meta',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      if (request.query['hub.mode'] !== 'subscribe'
        || !matchesSecret(request.query['hub.verify_token'], config.meta.webhookVerifyToken)
        || !request.query['hub.challenge']) {
        return reply.code(403).send({ ok: false, error: 'verification_failed' });
      }
      return reply.type('text/plain').send(request.query['hub.challenge']);
    },
  );

  app.post(
    '/api/v1/webhooks/meta',
    {
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const rawRequest = request as RawBodyRequest;
      if (!rawRequest.rawBody
        || !verifyMetaWebhookSignature(
          rawRequest.rawBody,
          headerValue(request.headers['x-hub-signature-256']),
          config.meta.appSecret,
        )) {
        return reply.code(401).send({ ok: false, error: 'invalid_signature' });
      }

      const events = parseMetaMessageEvents(request.body, config.meta.allowedRecipientIds);
      let accepted = 0;
      let deduplicated = 0;
      for (const event of events) {
        const result = await inbox.accept('meta', 'message.received', event.externalEventId, { ...event });
        if (result.deduplicated) deduplicated += 1;
        else accepted += 1;
      }

      request.log.info({ eventCount: events.length, accepted, deduplicated }, 'Meta webhook events accepted.');
      return reply.code(accepted ? 202 : 200).send({
        ok: true,
        accepted,
        deduplicated,
      });
    },
  );

  app.get<{ Params: { externalEventId: string } }>(
    '/api/v1/integrations/meta/events/:externalEventId',
    {
      schema: {
        params: Type.Object({
          externalEventId: Type.String({ minLength: 1, maxLength: 255 }),
        }),
      },
      preHandler: async (request, reply) => {
        if (!matchesSecret(bearerToken(request.headers.authorization), config.webIngestApiKey)) {
          return reply.code(401).send({ ok: false, error: 'unauthorized' });
        }
      },
    },
    async (request, reply) => {
      const [event] = await db.select({
        source: integrationInbox.source,
        eventType: integrationInbox.eventType,
        status: integrationInbox.status,
        attempts: integrationInbox.attemptCount,
        lastError: integrationInbox.lastError,
        createdAt: integrationInbox.createdAt,
        processedAt: integrationInbox.processedAt,
      }).from(integrationInbox)
        .where(eq(integrationInbox.externalEventId, request.params.externalEventId))
        .orderBy(asc(integrationInbox.createdAt))
        .limit(1);
      if (!event || event.source !== 'meta') return reply.code(404).send({ ok: false, error: 'not_found' });
      return { ok: true, event };
    },
  );
}

function headerValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
