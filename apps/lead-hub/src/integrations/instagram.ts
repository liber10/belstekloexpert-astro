const INSTAGRAM_GRAPH_URL = 'https://graph.instagram.com/me';

type JsonRecord = Record<string, unknown>;

export interface InstagramIdentity {
  id: string;
  username: string;
  userId?: string;
}

export class InstagramGraphApiError extends Error {
  readonly status: number;
  readonly providerCode: string | null;

  constructor(status: number, message: string, providerCode: string | null = null) {
    super(message);
    this.name = 'InstagramGraphApiError';
    this.status = status;
    this.providerCode = providerCode;
  }
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function safeProviderMessage(value: unknown, accessToken: string): string {
  const message = stringValue(value) || 'Instagram Graph API request failed.';
  return message.replaceAll(accessToken, '[redacted-token]').slice(0, 500);
}

export class InstagramGraphClient {
  private readonly accessToken: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: { accessToken: string; fetchImpl?: typeof fetch }) {
    const accessToken = options.accessToken.trim();
    if (accessToken.length < 16) throw new Error('META_INSTAGRAM_ACCESS_TOKEN is invalid or missing.');
    this.accessToken = accessToken;
    this.fetchImpl = options.fetchImpl || fetch;
  }

  async getIdentity(): Promise<InstagramIdentity> {
    const url = new URL(INSTAGRAM_GRAPH_URL);
    url.searchParams.set('fields', 'id,user_id,username');
    const response = await this.fetchImpl(url, {
      redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${this.accessToken}`,
      },
    });
    const body = await response.json().catch(() => null);
    const record = asRecord(body);
    if (!response.ok) {
      const error = asRecord(record?.error);
      throw new InstagramGraphApiError(
        response.status,
        safeProviderMessage(error?.message, this.accessToken),
        stringValue(error?.code),
      );
    }

    const id = stringValue(record?.id);
    const username = stringValue(record?.username);
    if (!id || !username) {
      throw new InstagramGraphApiError(response.status, 'Instagram identity response is incomplete.');
    }
    const userId = stringValue(record?.user_id);
    return { id, username, ...(userId ? { userId } : {}) };
  }
}

export function createInstagramGraphClient(accessToken: string | undefined): InstagramGraphClient {
  if (!accessToken) throw new Error('META_INSTAGRAM_ACCESS_TOKEN is not configured.');
  return new InstagramGraphClient({ accessToken });
}
