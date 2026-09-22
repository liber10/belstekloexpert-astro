export interface InstagramDelivery {
  sendText(recipientId: string, text: string): Promise<{ messageId: string }>;
}
function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export class InstagramDeliveryError extends Error {
  constructor(readonly reason: string, readonly outcome: 'retryable' | 'permanent' | 'unknown',
    readonly retryAfterMs = 0) {
    super(reason);
    this.name = 'InstagramDeliveryError';
  }
}

/** Instagram Login only. No Ads/Page token, URL override, or implicit retry. */
export class InstagramMessagingAdapter implements InstagramDelivery {
  private readonly url: string;
  constructor(private readonly options: {
    accessToken: string; accountId: string; graphVersion: string; timeoutMs: number; fetchImpl?: typeof fetch;
  }) {
    if (!/^\d+$/.test(options.accountId) || !/^v\d+\.0$/.test(options.graphVersion)
      || options.accessToken.length < 16) throw new Error('Invalid Instagram messaging configuration.');
    this.url = `https://graph.instagram.com/${options.graphVersion}/${options.accountId}/messages`;
  }

  async sendText(recipientId: string, text: string): Promise<{ messageId: string }> {
    if (!/^\d+$/.test(recipientId) || !text.trim() || text.length > 1000) {
      throw new InstagramDeliveryError('invalid_payload', 'permanent');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await (this.options.fetchImpl || fetch)(this.url, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { authorization: `Bearer ${this.options.accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ recipient: { id: recipientId }, message: { text } }),
      });
      const body: unknown = await response.json().catch(() => null);
      const data = record(body);
      if (response.ok && typeof data?.message_id === 'string' && data.message_id.length > 0) {
        return { messageId: data.message_id };
      }
      const error = record(data?.error);
      const code = typeof error?.code === 'number' ? error.code : 0;
      // A known Graph rejection is safe to retry; 5xx/network/invalid success
      // may have accepted the message, so they require human reconciliation.
      const retryable = response.status < 500 && Boolean(error)
        && (response.status === 429 || error?.is_transient === true || [4, 17, 32, 613].includes(code));
      const outcome = retryable ? 'retryable' : response.status >= 400 && response.status < 500 && error
        ? 'permanent' : 'unknown';
      const retryAfter = Number(response.headers.get('retry-after') || 0);
      throw new InstagramDeliveryError(`graph_http_${response.status}_code_${code}`, outcome,
        Number.isFinite(retryAfter) ? Math.max(0, Math.min(retryAfter * 1000, 86_400_000)) : 0);
    } catch (error) {
      if (error instanceof InstagramDeliveryError) throw error;
      // Never include raw Graph response, URL, token, message text, or transport error.
      throw new InstagramDeliveryError('transport_outcome_unknown', 'unknown');
    } finally {
      clearTimeout(timer);
    }
  }
}
