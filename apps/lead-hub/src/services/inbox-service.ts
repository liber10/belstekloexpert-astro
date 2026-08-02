import { and, eq } from 'drizzle-orm';
import type { LeadHubDatabase } from '../db/client.js';
import { integrationInbox } from '../db/schema.js';

export class InboxService {
  constructor(private readonly db: LeadHubDatabase) {}

  async accept(source: string, eventType: string, externalEventId: string, payload: Record<string, unknown>) {
    const inserted = await this.db
      .insert(integrationInbox)
      .values({ source, eventType, externalEventId, payload })
      .onConflictDoNothing({
        target: [integrationInbox.source, integrationInbox.externalEventId],
      })
      .returning({ id: integrationInbox.id });

    if (inserted[0]) return { id: inserted[0].id, deduplicated: false };
    const [existing] = await this.db
      .select({ id: integrationInbox.id })
      .from(integrationInbox)
      .where(and(eq(integrationInbox.source, source), eq(integrationInbox.externalEventId, externalEventId)))
      .limit(1);
    if (!existing) throw new Error('Inbox deduplication lookup failed.');
    return { id: existing.id, deduplicated: true };
  }
}
