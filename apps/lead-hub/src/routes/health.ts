import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';

export function registerHealthRoutes(app: FastifyInstance, pool: Pool) {
  app.get('/health/live', () => ({ ok: true }));

  app.get('/health/ready', async (_request, reply) => {
    try {
      await pool.query('select 1');
      return { ok: true, database: 'ready' };
    } catch {
      return reply.code(503).send({ ok: false, database: 'unavailable' });
    }
  });
}
