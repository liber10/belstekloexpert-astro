import type { FastifyInstance, FastifyRequest } from 'fastify';

export type RawBodyRequest = FastifyRequest & { rawBody?: Buffer };

/**
 * Keep the exact JSON bytes available to signed webhook handlers.
 * Fastify normally discards the original representation after parsing; Meta
 * signs that representation, so re-stringifying request.body is not safe.
 */
export function registerRawBodyJsonParser(app: FastifyInstance) {
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, body, done) => {
    const rawBody = Buffer.isBuffer(body) ? Buffer.from(body) : Buffer.from(String(body));
    (request as RawBodyRequest).rawBody = rawBody;
    try {
      done(null, JSON.parse(rawBody.toString('utf8')) as unknown);
    } catch (error) {
      done(error as Error);
    }
  });
}
