import type { APIRoute } from 'astro';
import { checkLeadHubReady } from '@/lib/lead-hub';

export const prerender = false;

export const GET: APIRoute = async () => {
  try {
    if (!(await checkLeadHubReady())) {
      return unavailable();
    }

    return json({
      status: 'ok',
      database: 'connected',
    });
  } catch {
    return unavailable();
  }
};

function unavailable() {
  return json(
    {
      status: 'error',
      database: 'unavailable',
    },
    503,
  );
}

function json(payload: Record<string, string>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
