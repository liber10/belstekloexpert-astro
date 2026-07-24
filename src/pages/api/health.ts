import type { APIRoute } from 'astro';
import { getDatabasePool } from '@/lib/database';

export const prerender = false;

export const GET: APIRoute = async () => {
  try {
    await getDatabasePool().query('SELECT 1');

    return json({
      status: 'ok',
      database: 'connected',
    });
  } catch {
    return json(
      {
        status: 'error',
        database: 'unavailable',
      },
      503,
    );
  }
};

function json(payload: Record<string, string>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
