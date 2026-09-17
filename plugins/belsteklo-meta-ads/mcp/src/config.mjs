import path from 'node:path';

export const DEFAULT_GRAPH_VERSION = 'v25.0';
const GRAPH_VERSION_PATTERN = /^v\d{1,2}\.\d{1,2}$/;
const ACCOUNT_PATTERN = /^act_\d+$/;
const WRITE_MODES = new Set(['off', 'dry-run', 'guarded', 'autopilot']);

export class ConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

export function graphVersion() {
  const candidate = String(process.env.META_GRAPH_VERSION || DEFAULT_GRAPH_VERSION).trim();
  const normalized = candidate.startsWith('v') ? candidate : `v${candidate}`;
  if (!GRAPH_VERSION_PATTERN.test(normalized)) {
    throw new ConfigurationError('META_GRAPH_VERSION must match vN.N.');
  }
  return normalized;
}

export function normalizeAdAccountId(value) {
  if (value === undefined || value === null || value === '') return null;
  const raw = String(value).trim();
  const normalized = raw.startsWith('act_') ? raw : `act_${raw}`;
  if (!ACCOUNT_PATTERN.test(normalized)) {
    throw new ConfigurationError('Meta ad account IDs must contain digits only.');
  }
  return normalized;
}

export function allowedAdAccounts() {
  const configured = String(process.env.META_ALLOWED_AD_ACCOUNT_IDS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map(normalizeAdAccountId);
  const defaultAccount = normalizeAdAccountId(process.env.META_AD_ACCOUNT_ID);
  if (defaultAccount) configured.push(defaultAccount);
  return new Set(configured);
}

export function resolveAdAccountId(value) {
  const account = normalizeAdAccountId(value || process.env.META_AD_ACCOUNT_ID);
  if (!account) {
    throw new ConfigurationError('Set META_AD_ACCOUNT_ID or pass an allowed account.');
  }
  const allowed = allowedAdAccounts();
  if (allowed.size === 0 || !allowed.has(account)) {
    throw new ConfigurationError('The requested Meta ad account is not allow-listed.');
  }
  return account;
}

function numberFromEnv(name, fallback, { min, max, integer = false } = {}) {
  const raw = process.env[name];
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isFinite(value) || (integer && !Number.isInteger(value))) {
    throw new ConfigurationError(`${name} must be ${integer ? 'an integer' : 'a number'}.`);
  }
  if (min !== undefined && value < min) throw new ConfigurationError(`${name} is below its minimum.`);
  if (max !== undefined && value > max) throw new ConfigurationError(`${name} is above its maximum.`);
  return value;
}

export function loadPolicy() {
  const writeMode = String(process.env.META_WRITE_MODE || 'off').trim().toLowerCase();
  if (!WRITE_MODES.has(writeMode)) {
    throw new ConfigurationError('META_WRITE_MODE must be off, dry-run, guarded, or autopilot.');
  }
  const maxDailyBudgetRaw = process.env.META_MAX_DAILY_BUDGET_MINOR;
  const maxDailyBudgetMinor = maxDailyBudgetRaw
    ? numberFromEnv('META_MAX_DAILY_BUDGET_MINOR', undefined, { min: 1, integer: true })
    : null;

  return {
    writeMode,
    maxBudgetChangePct: numberFromEnv('META_MAX_BUDGET_CHANGE_PCT', 20, { min: 1, max: 50 }),
    maxDailyBudgetMinor,
    changeTtlMinutes: numberFromEnv('META_CHANGE_TTL_MINUTES', 15, { min: 1, max: 60, integer: true }),
    cooldownHours: numberFromEnv('META_CHANGE_COOLDOWN_HOURS', 6, { min: 0, max: 168 }),
    auditLogPath: path.resolve(
      process.env.META_AUDIT_LOG_PATH || path.join(process.cwd(), '.runtime', 'meta-ads-audit.jsonl'),
    ),
  };
}

export function tokenStatus() {
  return {
    read_token_configured: Boolean(process.env.META_READ_ACCESS_TOKEN?.trim()),
    write_token_configured: Boolean(process.env.META_WRITE_ACCESS_TOKEN?.trim()),
    app_secret_proof_enabled: Boolean(process.env.META_APP_SECRET?.trim()),
  };
}
