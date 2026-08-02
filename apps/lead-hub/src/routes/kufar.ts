import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config.js';
import { KufarEmailEventSchema, type KufarEmailEvent } from '../contracts/kufar-email.js';
import { validateKufarConversationUrl } from '../integrations/kufar.js';
import { bearerToken, matchesSecret } from '../security/secrets.js';
import type { InboxService } from '../services/inbox-service.js';

export function registerKufarRoutes(app: FastifyInstance, config: AppConfig, inbox: InboxService) {
  if (!config.kufar.enabled) return;
  app.post<{ Body: KufarEmailEvent; Headers: { authorization?: string } }>(
    '/api/v1/integrations/kufar/email',
    {
      config: { rateLimit: { max: config.rateLimitMax, timeWindow: '1 minute' } },
      schema: {
        body: KufarEmailEventSchema,
        headers: Type.Object({ authorization: Type.Optional(Type.String({ maxLength: 512 })) }, { additionalProperties: true }),
      },
      preHandler: async (request, reply) => {
        if (!matchesSecret(bearerToken(request.headers.authorization), config.kufar.ingestApiKey)) {
          return reply.code(401).send({ ok: false, error: 'unauthorized' });
        }
      },
    },
    async (request, reply) => {
      const payload = { ...request.body };
      if (!validateKufarConversationUrl(payload.conversationUrl)) delete payload.conversationUrl;
      const result = await inbox.accept('kufar', 'email.received', payload.externalMessageId, payload);
      request.log.info({ inboxId: result.id, source: 'kufar', deduplicated: result.deduplicated }, 'Kufar event accepted.');
      return reply.code(result.deduplicated ? 200 : 202).send({ ok: true, accepted: true, deduplicated: result.deduplicated });
    },
  );
}
