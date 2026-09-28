import { and, eq } from 'drizzle-orm';
import type { AppConfig } from '../config.js';
import type { LeadHubDatabase } from '../db/client.js';
import { integrationOutbox, leadEvents, leads } from '../db/schema.js';
import type { MetaMessageEvent } from '../integrations/meta-messaging.js';
import type { InstagramConversationGuard } from '../integrations/instagram-conversation-guard.js';
import type { LeadService } from './lead-service.js';

// Leave a margin before the standard 24-hour messaging window closes.
export const INSTAGRAM_REPLY_WINDOW_MS = 24 * 60 * 60 * 1000 - 60_000;

export class InstagramMessageService {
  constructor(private readonly db: LeadHubDatabase, private readonly leadService: LeadService,
    private readonly config: AppConfig['instagramMessaging'], private readonly history: InstagramConversationGuard | null) {}

  async accept(message: MetaMessageEvent, ingestedAt: Date) {
    // This transaction persists the lead and its human notification first.
    // If the process dies between transactions, the durable inbox retries and
    // getOrCreate returns the same lead; nothing can be sent before the next commit.
    const { lead } = await this.leadService.getOrCreateInstagramConversation(message);
    const now = Date.now();
    const start = this.config.startAt ? Date.parse(this.config.startAt) : Infinity;
    const timestamp = message.timestamp;
    const preliminarySkip = !this.config.enabled ? 'disabled'
      : message.recipientId !== this.config.accountId ? 'account_not_allowed'
      : !timestamp || !Number.isSafeInteger(timestamp) || timestamp > now + 60_000 ? 'invalid_timestamp'
      : timestamp < start || ingestedAt.getTime() < start ? 'before_rollout'
      : now - timestamp >= INSTAGRAM_REPLY_WINDOW_MS ? 'window_expired' : null;
    const historyVerdict = preliminarySkip || lead.sourceMetadata.messageId !== message.externalEventId
      ? null : await this.history?.inspectFirstMessage(message.senderId, message.messageId || message.externalEventId)
        .catch(() => 'unverified' as const) || 'unverified';
    await this.db.transaction(async (tx) => {
      await tx.select({ id: leads.id }).from(leads).where(eq(leads.id, lead.id)).for('update');
      const inserted = await tx.insert(leadEvents).values({
        leadId: lead.id, eventType: 'instagram_message_received', source: 'instagram_inbound',
        externalEventId: message.externalEventId, payload: { ...message },
      }).onConflictDoNothing().returning({ id: leadEvents.id });
      if (!inserted.length) return;
      const [decision] = await tx.select({ id: leadEvents.id }).from(leadEvents)
        .where(and(eq(leadEvents.source, 'instagram_reply_policy'), eq(leadEvents.externalEventId, lead.id))).limit(1);
      if (decision) return;
      // A later DM can win the row lock before the first one. Persist it, but
      // leave the first-reply decision to the message that created the lead.
      if (lead.sourceMetadata.messageId !== message.externalEventId) return;

      const scenario = message.adId ? this.config.adScenarios[message.adId] || 'general' : 'general';
      const text = this.config.replies[scenario];
      const skipped = preliminarySkip
        || (historyVerdict === 'existing' ? 'existing_conversation'
        : historyVerdict !== 'first' ? 'history_unverified'
        : !text ? 'text_not_configured' : null);
      await tx.insert(leadEvents).values({
        leadId: lead.id, source: 'instagram_reply_policy', eventType: 'instagram_first_reply_decision',
        externalEventId: lead.id, payload: { scenario, skipped, inboundEventId: message.externalEventId },
      });
      if (skipped) return;
      await tx.insert(integrationOutbox).values({
        leadId: lead.id, destination: 'instagram', eventType: 'instagram.first_reply',
        idempotencyKey: `instagram:first:${lead.id}`,
        payload: { accountId: message.recipientId, recipientId: message.senderId, text, scenario,
          inboundMessageId: message.messageId || message.externalEventId,
          inboundEventId: message.externalEventId, timestamp, expiresAt: timestamp! + INSTAGRAM_REPLY_WINDOW_MS },
      }).onConflictDoNothing({ target: integrationOutbox.idempotencyKey });
      // Do not change lead.status or firstResponseAt: those represent human work.
    });
  }
}
