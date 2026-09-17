import crypto from 'node:crypto';
import { graphVersion } from './config.mjs';

const META_HOST = 'graph.facebook.com';
const MAX_RETRIES = 3;

export class MetaApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'MetaApiError';
    this.details = details;
  }
}

function requireToken(write) {
  const name = write ? 'META_WRITE_ACCESS_TOKEN' : 'META_READ_ACCESS_TOKEN';
  const token = process.env[name]?.trim();
  if (!token) throw new MetaApiError(`${name} is not available to the MCP process.`);
  return token;
}

function maybeAppSecretProof(token) {
  const secret = process.env.META_APP_SECRET?.trim();
  return secret ? crypto.createHmac('sha256', secret).update(token).digest('hex') : null;
}

function cleanParams(params = {}) {
  const out = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) out[key] = value.join(',');
    else if (typeof value === 'object') out[key] = JSON.stringify(value);
    else out[key] = String(value);
  }
  return out;
}

function buildUrl(pathname, params = {}) {
  if (typeof pathname !== 'string' || /^https?:/i.test(pathname)) {
    throw new MetaApiError('Only relative Meta Graph paths are allowed.');
  }
  const normalized = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const url = new URL(`https://${META_HOST}/${graphVersion()}${normalized}`);
  for (const [key, value] of Object.entries(cleanParams(params))) url.searchParams.set(key, value);
  return url;
}

async function parseResponse(response) {
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new MetaApiError(`Meta returned non-JSON HTTP ${response.status}.`, { status: response.status });
  }
  if (!response.ok || data?.error) {
    const error = data?.error || {};
    throw new MetaApiError(error.message || `Meta Graph API HTTP ${response.status}.`, {
      status: response.status,
      type: error.type,
      code: error.code,
      error_subcode: error.error_subcode,
      is_transient: Boolean(error.is_transient),
    });
  }
  return {
    data,
    usage: {
      app: response.headers.get('x-app-usage') || undefined,
      account: response.headers.get('x-ad-account-usage') || undefined,
      business: response.headers.get('x-business-use-case-usage') || undefined,
    },
  };
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function graphRequest(method, pathname, { params = {}, body = {}, write = false } = {}) {
  const token = requireToken(write);
  const proof = maybeAppSecretProof(token);
  if (write && !proof) {
    throw new MetaApiError('META_APP_SECRET is required for every write-token request.');
  }
  const url = buildUrl(pathname, proof ? { ...params, appsecret_proof: proof } : params);
  const normalizedMethod = method.toUpperCase();
  const attempts = normalizedMethod === 'GET' ? MAX_RETRIES : 1;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let response;
    try {
      response = await fetch(url, {
        method: normalizedMethod,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(normalizedMethod === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        },
        body: normalizedMethod === 'POST' ? new URLSearchParams(cleanParams(body)) : undefined,
        signal: AbortSignal.timeout(45_000),
      });
      return await parseResponse(response);
    } catch (error) {
      const retryable =
        normalizedMethod === 'GET' &&
        attempt < attempts &&
        (error instanceof TypeError ||
          (error instanceof MetaApiError &&
            (error.details.is_transient || error.details.status === 429 || error.details.status >= 500)));
      if (!retryable) {
        if (error instanceof MetaApiError) throw error;
        throw new MetaApiError(`Network error calling Meta Graph API: ${error.message}`);
      }
      await delay(250 * 2 ** (attempt - 1) + Math.floor(Math.random() * 150));
    }
  }
  throw new MetaApiError('Meta Graph API request failed.');
}

export async function graphGet(pathname, params = {}) {
  return (await graphRequest('GET', pathname, { params })).data;
}

export async function graphGetWithWriteToken(pathname, params = {}) {
  return (await graphRequest('GET', pathname, { params, write: true })).data;
}

export async function graphPost(pathname, body = {}) {
  return (await graphRequest('POST', pathname, { body, write: true })).data;
}

async function graphListWith(getPage, pathname, params = {}, options = {}) {
  const maxPages = Math.min(Math.max(Number(options.maxPages || 5), 1), 50);
  const maxItems = Math.min(Math.max(Number(options.maxItems || 500), 1), 5000);
  const pageLimit = Math.min(Math.max(Number(options.pageLimit || 100), 1), 500);
  const rows = [];
  let after;
  let pages = 0;

  while (pages < maxPages && rows.length < maxItems) {
    const page = await getPage(pathname, {
      ...params,
      limit: Math.min(pageLimit, maxItems - rows.length),
      after,
    });
    const pageRows = Array.isArray(page?.data) ? page.data : [];
    rows.push(...pageRows);
    pages += 1;
    after = page?.paging?.cursors?.after;
    if (!after || pageRows.length === 0) break;
  }

  return {
    data: rows.slice(0, maxItems),
    meta: {
      pages_fetched: pages,
      items_returned: Math.min(rows.length, maxItems),
      truncated: Boolean(after),
      truncation_reason: after
        ? rows.length >= maxItems
          ? 'max_items'
          : 'max_pages'
        : undefined,
    },
  };
}

export async function graphList(pathname, params = {}, options = {}) {
  return graphListWith(graphGet, pathname, params, options);
}

export async function graphListWithWriteToken(pathname, params = {}, options = {}) {
  return graphListWith(graphGetWithWriteToken, pathname, params, options);
}

function sumByActionType(items = []) {
  const result = {};
  for (const item of items) {
    if (!item?.action_type) continue;
    result[item.action_type] = (result[item.action_type] || 0) + Number(item.value || 0);
  }
  return result;
}

export function normalizeInsightRow(row) {
  const copy = { ...row };
  delete copy.actions;
  delete copy.action_values;
  delete copy.cost_per_action_type;
  return {
    ...copy,
    actions_by_type: sumByActionType(row?.actions),
    action_values_by_type: sumByActionType(row?.action_values),
    cost_per_action_by_type: sumByActionType(row?.cost_per_action_type),
  };
}

export function safeError(error) {
  const redact = (message) => {
    let result = String(message);
    for (const name of ['META_READ_ACCESS_TOKEN', 'META_WRITE_ACCESS_TOKEN', 'META_APP_SECRET']) {
      const value = process.env[name]?.trim();
      if (value) result = result.replaceAll(value, `[redacted-${name.toLowerCase()}]`);
    }
    return result
      .replace(/EAA[A-Za-z0-9_-]{12,}/g, '[redacted-token]')
      .replace(/act_\d+/g, '[redacted-account-id]')
      .replace(/\b\d{8,}\b/g, '[redacted-id]');
  };
  if (error instanceof MetaApiError) {
    return { error: redact(error.message), details: error.details, graph_version: graphVersion() };
  }
  return { error: redact(error instanceof Error ? error.message : String(error)), graph_version: graphVersion() };
}
