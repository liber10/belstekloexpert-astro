import type { APIRoute } from 'astro';
import {
  getLeadRuntimeEnv,
  LeadHubRequestError,
  normalizeSubmissionId,
  resolveLeadDeliveryMode,
  preparePhotoUploads,
  type PhotoUploadDescriptor,
} from '@/lib/lead-hub';
import {
  allowedPhotoTypes,
  maxPhotoCount,
  maxPhotoSizeBytes,
} from '@/lib/validation';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  if (!isSameOriginRequest(request)) {
    return json({ ok: false, error: 'forbidden' }, 403);
  }
  const env = getLeadRuntimeEnv();
  if (resolveLeadDeliveryMode(env) === 'legacy') {
    return json({ ok: false, error: 'storage_unavailable' }, 503);
  }


  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid_request' }, 400);
  }

  const parsed = parseUploadRequest(body);
  if (!parsed) {
    return json({ ok: false, error: 'invalid_upload' }, 400);
  }

  try {
    const result = await preparePhotoUploads({
      submissionId: parsed.submissionId,
      files: parsed.files,
      env,
    });
    return json({ ok: true, uploads: result.uploads });
  } catch (error) {
    console.error('Photo upload preparation failed.', {
      code: error instanceof LeadHubRequestError ? error.code : 'unexpected_error',
      upstreamStatus: error instanceof LeadHubRequestError ? error.status : undefined,
    });
    return json({ ok: false, error: 'storage_unavailable' }, 503);
  }
};

function parseUploadRequest(value: unknown): {
  submissionId: string;
  files: PhotoUploadDescriptor[];
} | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const request = value as Record<string, unknown>;
  const submissionId = typeof request.submissionId === 'string'
    ? normalizeSubmissionId(request.submissionId)
    : '';
  if (!submissionId || !Array.isArray(request.files)) return null;
  if (!request.files.length || request.files.length > maxPhotoCount) return null;

  const files: PhotoUploadDescriptor[] = [];
  for (const value of request.files) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const file = value as Record<string, unknown>;
    if (typeof file.contentType !== 'string' || !allowedPhotoTypes.has(file.contentType)) return null;
    if (!Number.isInteger(file.size) || Number(file.size) < 1 || Number(file.size) > maxPhotoSizeBytes) {
      return null;
    }
    if (typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)) return null;
    files.push({
      contentType: file.contentType,
      size: Number(file.size),
      sha256: file.sha256,
    });
  }

  return { submissionId, files };
}

function isSameOriginRequest(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function json(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
