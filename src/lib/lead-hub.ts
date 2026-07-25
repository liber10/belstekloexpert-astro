const defaultLeadHubUrl = 'https://belstekloexpert-astro.onrender.com';
const defaultTimeoutMs = 25_000;

export type LeadDeliveryMode = 'legacy' | 'hub' | 'hub-with-legacy-telegram';

type RuntimeEnv = Record<string, string | undefined>;
type LeadFields = Record<string, string>;

interface LeadAttribution {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
  yclid?: string;
  fbclid?: string;
  landingUrl?: string;
  referrer?: string;
}

export interface WebLeadPayload {
  sourceDetail?: string;
  externalLeadId: string;
  name?: string;
  phone: string;
  carMake?: string;
  carModel?: string;
  carYear?: number;
  vin?: string;
  serviceType?: string;
  message?: string;
  photoRefs?: string[];
  attribution?: LeadAttribution;
}

export interface LeadHubResult {
  leadId: string;
  publicId: string;
  deduplicated: boolean;
}

export interface PhotoUploadDescriptor {
  contentType: string;
  size: number;
  sha256: string;
}

export interface PreparedPhotoUpload {
  ref: string;
  uploadUrl: string;
  headers: Record<string, string>;
}

export interface PreparePhotoUploadsResult {
  uploads: PreparedPhotoUpload[];
}

export class LeadHubRequestError extends Error {
  constructor(
    public readonly code: 'configuration_error' | 'request_failed' | 'invalid_response',
    public readonly status?: number,
  ) {
    super(code);
    this.name = 'LeadHubRequestError';
  }
}

export function classifyDeliveryFailure(
  stage: 'hub' | 'telegram_bridge',
  error: unknown,
) {
  if (stage === 'telegram_bridge') {
    if (
      error instanceof LeadHubRequestError &&
      (error.status === 401 || error.status === 403)
    ) {
      return 'telegram_bridge_authentication_failed';
    }
    return 'telegram_bridge_unavailable';
  }

  if (!(error instanceof LeadHubRequestError)) return 'hub_unavailable';
  if (error.code === 'configuration_error') return 'hub_configuration_invalid';
  if (error.status === 401 || error.status === 403) return 'hub_authentication_failed';
  if (error.status === 404) return 'hub_endpoint_unavailable';
  if (error.code === 'invalid_response') return 'hub_response_invalid';
  return 'hub_unavailable';
}

export function getLeadRuntimeEnv(): RuntimeEnv {
  const runtime = typeof process === 'undefined' ? {} : process.env;
  return {
    LEAD_DELIVERY_MODE:
      runtime.LEAD_DELIVERY_MODE || import.meta.env.LEAD_DELIVERY_MODE,
    LEAD_HUB_URL: runtime.LEAD_HUB_URL || import.meta.env.LEAD_HUB_URL,
    LEAD_HUB_TIMEOUT_MS:
      runtime.LEAD_HUB_TIMEOUT_MS || import.meta.env.LEAD_HUB_TIMEOUT_MS,
    WEB_INGEST_API_KEY:
      runtime.WEB_INGEST_API_KEY || import.meta.env.WEB_INGEST_API_KEY,
    TELEGRAM_BOT_TOKEN:
      runtime.TELEGRAM_BOT_TOKEN || import.meta.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID:
      runtime.TELEGRAM_CHAT_ID || import.meta.env.TELEGRAM_CHAT_ID,
  };
}

export function resolveLeadDeliveryMode(env: RuntimeEnv): LeadDeliveryMode {
  const configured = cleanText(env.LEAD_DELIVERY_MODE).toLowerCase();
  if (
    configured === 'legacy' ||
    configured === 'hub' ||
    configured === 'hub-with-legacy-telegram'
  ) {
    return configured;
  }

  if (!cleanText(env.WEB_INGEST_API_KEY)) return 'legacy';
  return cleanText(env.TELEGRAM_BOT_TOKEN) && cleanText(env.TELEGRAM_CHAT_ID)
    ? 'hub-with-legacy-telegram'
    : 'hub';
}

export function normalizeSubmissionId(value: string) {
  const cleaned = value.trim();
  return /^[A-Za-z0-9_-]{8,160}$/.test(cleaned) ? cleaned : '';
}

export function buildWebLeadPayload(
  fields: LeadFields,
  submissionId: string,
  photoCount = 0,
  photoRefs: string[] = [],
): WebLeadPayload {
  const service = limit(fields.service, 160);
  const rawVin = cleanText(fields.vin).toUpperCase().replace(/\s+/g, '');
  const validVin = /^[A-HJ-NPR-Z0-9]{17}$/.test(rawVin) ? rawVin : '';
  const messageParts = [
    limit(fields.comment, 4_000),
    fields.decoded_vehicle ? `Автомобиль по VIN: ${limit(fields.decoded_vehicle, 500)}` : '',
    fields.contact_method ? `Предпочтительный способ связи: ${limit(fields.contact_method, 80)}` : '',
    fields.glass_type ? `Тип стекла: ${limit(fields.glass_type, 120)}` : '',
    rawVin && !validVin ? `VIN как введён: ${limit(rawVin, 80)}` : '',
    photoCount ? `Фото приложено: ${photoCount}` : '',
  ].filter(Boolean);

  const attribution = compact({
    utmSource: limit(fields.utm_source, 255),
    utmMedium: limit(fields.utm_medium, 255),
    utmCampaign: limit(fields.utm_campaign, 255),
    utmContent: limit(fields.utm_content, 255),
    utmTerm: limit(fields.utm_term, 255),
    gclid: limit(fields.gclid, 255),
    gbraid: limit(fields.gbraid, 255),
    wbraid: limit(fields.wbraid, 255),
    yclid: limit(fields.yclid, 255),
    fbclid: limit(fields.fbclid, 255),
    landingUrl: limit(fields.landing_url || fields.page_url, 2_048),
    referrer: limit(fields.referrer, 2_048),
  });

  return {
    sourceDetail: limit(fields.form_source || service || 'site_form', 160) || undefined,
    externalLeadId: submissionId,
    name: limit(fields.name, 120) || undefined,
    phone: limit(fields.phone, 40),
    carMake: limit(fields.make, 100) || undefined,
    carModel: limit(fields.model, 160) || undefined,
    carYear: parseYear(fields.year),
    vin: validVin || undefined,
    serviceType: service || undefined,
    message: limit(messageParts.join('\n'), 4_000) || undefined,
    photoRefs: photoRefs.length ? photoRefs : undefined,
    attribution: Object.keys(attribution).length ? attribution : undefined,
  };
}

export async function sendLeadToHub(options: {
  fields: LeadFields;
  idempotencyKey: string;
  photoCount?: number;
  photoRefs?: string[];
  env?: RuntimeEnv;
  fetchImpl?: typeof fetch;
}): Promise<LeadHubResult> {
  const env = options.env ?? getLeadRuntimeEnv();
  const config = getLeadHubConfig(env);
  const payload = buildWebLeadPayload(
    options.fields,
    options.idempotencyKey,
    options.photoCount ?? options.photoRefs?.length ?? 0,
    options.photoRefs,
  );
  const response = await request(
    `${config.baseUrl}/api/v1/leads/web`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
        'idempotency-key': options.idempotencyKey,
      },
      body: JSON.stringify(payload),
    },
    config.timeoutMs,
    options.fetchImpl,
  );

  if (!response.ok) {
    throw new LeadHubRequestError('request_failed', response.status);
  }

  const body = (await response.json().catch(() => null)) as Partial<LeadHubResult> | null;
  if (
    !body ||
    typeof body.leadId !== 'string' ||
    typeof body.publicId !== 'string' ||
    typeof body.deduplicated !== 'boolean'
  ) {
    throw new LeadHubRequestError('invalid_response');
  }

  return {
    leadId: body.leadId,
    publicId: body.publicId,
    deduplicated: body.deduplicated,
  };
}

export async function preparePhotoUploads(options: {
  submissionId: string;
  files: PhotoUploadDescriptor[];
  env?: RuntimeEnv;
  fetchImpl?: typeof fetch;
}): Promise<PreparePhotoUploadsResult> {
  const env = options.env ?? getLeadRuntimeEnv();
  const config = getLeadHubConfig(env);
  const submissionId = normalizeSubmissionId(options.submissionId);
  if (!submissionId) throw new LeadHubRequestError('configuration_error');

  const response = await request(
    `${config.baseUrl}/api/v1/uploads/presign`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ submissionId, files: options.files }),
    },
    config.timeoutMs,
    options.fetchImpl,
  );

  if (!response.ok) {
    throw new LeadHubRequestError('request_failed', response.status);
  }

  const body = (await response.json().catch(() => null)) as {
    uploads?: unknown;
  } | null;
  if (!body || !Array.isArray(body.uploads) || body.uploads.length !== options.files.length) {
    throw new LeadHubRequestError('invalid_response');
  }

  const uploads = body.uploads.map(parsePreparedPhotoUpload);
  if (uploads.some((upload) => !upload)) {
    throw new LeadHubRequestError('invalid_response');
  }

  return { uploads: uploads as PreparedPhotoUpload[] };
}

export async function getLeadPhotoUrls(options: {
  leadId: string;
  env?: RuntimeEnv;
  fetchImpl?: typeof fetch;
}) {
  const env = options.env ?? getLeadRuntimeEnv();
  const config = getLeadHubConfig(env);
  const response = await request(
    `${config.baseUrl}/api/v1/leads/${encodeURIComponent(options.leadId)}/photo-downloads`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
      },
    },
    Math.min(config.timeoutMs, 10_000),
    options.fetchImpl,
  );

  if (!response.ok) {
    throw new LeadHubRequestError('request_failed', response.status);
  }

  const body = (await response.json().catch(() => null)) as {
    photoUrls?: unknown;
  } | null;
  if (!body || !Array.isArray(body.photoUrls) || !body.photoUrls.every(isHttpsUrl)) {
    throw new LeadHubRequestError('invalid_response');
  }

  return body.photoUrls as string[];
}

export async function updateLegacyTelegramDelivery(options: {
  leadId: string;
  action: 'claim' | 'complete' | 'release';
  env?: RuntimeEnv;
  fetchImpl?: typeof fetch;
}) {
  const env = options.env ?? getLeadRuntimeEnv();
  const config = getLeadHubConfig(env);
  const response = await request(
    `${config.baseUrl}/api/v1/leads/${encodeURIComponent(options.leadId)}/legacy-telegram-delivery`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ action: options.action }),
    },
    Math.min(config.timeoutMs, 10_000),
    options.fetchImpl,
  );

  if (!response.ok) {
    throw new LeadHubRequestError('request_failed', response.status);
  }

  if (options.action !== 'claim') return true;

  const body = (await response.json().catch(() => null)) as { claimed?: unknown } | null;
  if (!body || typeof body.claimed !== 'boolean') {
    throw new LeadHubRequestError('invalid_response');
  }

  return body.claimed;
}

function parsePreparedPhotoUpload(value: unknown): PreparedPhotoUpload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entry = value as Record<string, unknown>;
  if (typeof entry.ref !== 'string' || !entry.ref.startsWith('b2://') || entry.ref.length > 2_048) {
    return null;
  }
  if (!isHttpsUrl(entry.uploadUrl)) return null;
  if (!entry.headers || typeof entry.headers !== 'object' || Array.isArray(entry.headers)) return null;

  const headerEntries = Object.entries(entry.headers);
  if (!headerEntries.length || !headerEntries.every(([, header]) => typeof header === 'string')) {
    return null;
  }
  const headers = Object.fromEntries(headerEntries) as Record<string, string>;
  if (!headers['content-type']) return null;

  return { ref: entry.ref, uploadUrl: entry.uploadUrl, headers };
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 16_384) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function getLeadHubConfig(env: RuntimeEnv) {
  const apiKey = cleanText(env.WEB_INGEST_API_KEY);
  if (!apiKey) throw new LeadHubRequestError('configuration_error');

  const rawBaseUrl = cleanText(env.LEAD_HUB_URL) || defaultLeadHubUrl;
  let baseUrl: string;
  try {
    const url = new URL(rawBaseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error('Unsupported protocol.');
    }
    baseUrl = url.toString().replace(/\/+$/, '');
  } catch {
    throw new LeadHubRequestError('configuration_error');
  }

  const parsedTimeout = Number(env.LEAD_HUB_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(parsedTimeout)
    ? Math.min(30_000, Math.max(5_000, Math.round(parsedTimeout)))
    : defaultTimeoutMs;

  return { apiKey, baseUrl, timeoutMs };
}

async function request(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  fetchImpl = fetch,
) {
  try {
    return await fetchImpl(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new LeadHubRequestError('request_failed');
  }
}

function parseYear(value: string) {
  const year = Number.parseInt(value, 10);
  return Number.isInteger(year) && year >= 1886 && year <= 2100 ? year : undefined;
}

function cleanText(value: string | undefined) {
  return typeof value === 'string' ? value.trim() : '';
}

function limit(value: string | undefined, maxLength: number) {
  return cleanText(value).slice(0, maxLength);
}

function compact<T extends Record<string, string>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => Boolean(entry))) as Partial<T>;
}
