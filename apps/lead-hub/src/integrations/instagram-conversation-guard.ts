export type ConversationVerdict = 'first' | 'existing' | 'unverified';

export interface InstagramConversationGuard {
  inspectFirstMessage(senderId: string, messageId: string): Promise<ConversationVerdict>;
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Read-only Instagram Login history check. Any incomplete or failed read denies an automatic reply. */
export class InstagramConversationHistory implements InstagramConversationGuard {
  private readonly base: string;
  constructor(private readonly options: {
    accessToken: string; accountId: string; graphVersion: string; timeoutMs: number; fetchImpl?: typeof fetch;
  }) {
    if (!/^\d+$/.test(options.accountId) || !/^v\d+\.0$/.test(options.graphVersion)
      || options.accessToken.length < 16) throw new Error('Invalid Instagram conversation configuration.');
    this.base = `https://graph.instagram.com/${options.graphVersion}`;
  }

  async inspectFirstMessage(senderId: string, messageId: string): Promise<ConversationVerdict> {
    if (!/^\d+$/.test(senderId) || !messageId || messageId.length > 4_096) return 'unverified';
    try {
      const lookup = new URL(`${this.base}/${this.options.accountId}/conversations`);
      lookup.searchParams.set('user_id', senderId);
      lookup.searchParams.set('fields', 'id');
      const conversations = object(await this.get(lookup));
      const list = conversations?.data;
      if (!Array.isArray(list) || list.length !== 1) return 'unverified';
      const conversation = object(list[0]);
      // Conversation IDs are opaque, unlike numeric Instagram user IDs.
      if (typeof conversation?.id !== 'string' || !/^[A-Za-z0-9_-]{1,255}$/.test(conversation.id)) return 'unverified';

      const history = new URL(`${this.base}/${conversation.id}`);
      history.searchParams.set('fields', 'messages.limit(2){id,from}');
      const details = object(await this.get(history));
      const messages = object(details?.messages);
      const entries = messages?.data;
      if (!Array.isArray(entries) || entries.length === 0) return 'unverified';
      if (entries.length > 1 || object(messages?.paging)?.next) return 'existing';
      const first = object(entries[0]);
      if (typeof first?.id !== 'string' || first.id !== messageId) return 'existing';
      const from = object(first.from);
      return from?.id === senderId ? 'first' : 'unverified';
    } catch {
      // Never log the URL (contains an Instagram-scoped sender ID), response, or token.
      return 'unverified';
    }
  }

  private async get(url: URL): Promise<unknown> {
    const response = await (this.options.fetchImpl || fetch)(url, {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(this.options.timeoutMs),
      headers: { accept: 'application/json', authorization: `Bearer ${this.options.accessToken}` },
    });
    if (!response.ok) return null;
    return response.json().catch(() => null);
  }
}
