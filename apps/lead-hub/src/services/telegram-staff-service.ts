import { and, asc, count, eq, gte, isNotNull, sql } from 'drizzle-orm';
import type { LeadHubDatabase } from '../db/client.js';
import { integrationInbox, integrationOutbox, leadEvents, leads, telegramPublicActivity, telegramPublicOutbox } from '../db/schema.js';
import { LeadAccessError, LeadNotFoundError, LeadValidationError } from './lead-service.js';

export type StaffRole = 'admin' | 'manager' | 'master';
export type StaffOperation =
  | { kind: 'assigned'; assignee: string }
  | { kind: 'note_added'; text: string }
  | { kind: 'price_set'; amount: string }
  | { kind: 'payment_recorded' };

export function parseStaffRoster(value: string) {
  return new Map(value.split(',').filter(Boolean).map((entry) => {
    const [id, role] = entry.split(':') as [string, StaffRole];
    return [id, role] as const;
  }));
}

export class TelegramStaffService {
  constructor(private readonly db: LeadHubDatabase, private readonly roles: ReadonlyMap<string, StaffRole>) {}

  async find(reference: string, actorId: string) {
    const [lead] = await this.db.select().from(leads).where(eq(leads.publicId, reference)).limit(1);
    if (!lead) throw new LeadNotFoundError();
    const role = this.roles.get(actorId);
    if (!role || (role === 'master' && actorId !== lead.assignedTo)) throw new LeadAccessError();
    return lead;
  }

  async apply(reference: string, operation: StaffOperation, actorId: string, externalEventId: string) {
    const role = this.roles.get(actorId);
    if (!role) throw new LeadAccessError();
    return this.db.transaction(async (tx) => {
      const byReference = /^BSE-/i.test(reference) ? eq(leads.publicId, reference) : eq(leads.id, reference);
      const [lead] = await tx.select().from(leads).where(byReference).for('update');
      if (!lead) throw new LeadNotFoundError();
      if (operation.kind === 'assigned') {
        if (!this.roles.has(operation.assignee) ||
          (role === 'manager' && operation.assignee !== actorId && this.roles.get(operation.assignee) !== 'master') ||
          (role === 'master' && (operation.assignee !== actorId || (lead.assignedTo && lead.assignedTo !== actorId)))) {
          throw new LeadAccessError();
        }
      } else if (role === 'master' && (lead.assignedTo !== actorId || operation.kind !== 'note_added')) {
        throw new LeadAccessError();
      }
      const source = 'telegram_staff';
      const [existing] = await tx.select({ id: leadEvents.id }).from(leadEvents)
        .where(and(eq(leadEvents.source, source), eq(leadEvents.externalEventId, externalEventId))).limit(1);
      if (existing) return lead;

      const now = new Date();
      const patch: Partial<typeof leads.$inferInsert> = { updatedAt: now };
      if (operation.kind === 'assigned') patch.assignedTo = operation.assignee;
      if (operation.kind === 'price_set') {
        if (lead.paidAt || !/^\d{1,10}(?:\.\d{1,2})?$/.test(operation.amount) || Number(operation.amount) <= 0) {
          throw new LeadValidationError('Укажите положительную сумму в BYN. После оплаты сумма закрыта.');
        }
        patch.finalAmount = operation.amount;
      }
      if (operation.kind === 'payment_recorded') {
        if (lead.paidAt) return lead;
        if (lead.status !== 'won' || !lead.finalAmount) throw new LeadValidationError('Сначала отметьте выполнение и внесите итоговую сумму.');
        patch.paidAt = now;
        patch.revenue = lead.finalAmount;
      }
      if (operation.kind === 'note_added' && (!operation.text || operation.text.length > 1_000)) {
        throw new LeadValidationError('Комментарий должен содержать от 1 до 1 000 символов.');
      }
      const [updated] = await tx.update(leads).set(patch).where(eq(leads.id, lead.id)).returning();
      await tx.insert(leadEvents).values({
        leadId: lead.id, source, eventType: operation.kind, externalEventId, payload: { ...operation, actorId },
      });
      if (operation.kind !== 'note_added') {
        await tx.insert(integrationOutbox).values({
          leadId: lead.id, destination: 'telegram', eventType: 'lead.details_changed',
          payload: {}, idempotencyKey: `telegram:staff:${externalEventId}`,
        });
      }
      return updated ?? lead;
    });
  }

  async notes(leadId: string) {
    const rows = await this.db.select({ text: sql<string>`${leadEvents.payload}->>'text'` }).from(leadEvents)
      .where(and(eq(leadEvents.leadId, leadId), eq(leadEvents.eventType, 'note_added')))
      .orderBy(sql`${leadEvents.createdAt} desc`).limit(3);
    return rows.map((row) => row.text);
  }

  async queue(actorId: string) {
    const role = this.roles.get(actorId);
    if (!role) throw new LeadAccessError();
    return this.db.select({ publicId: leads.publicId, service: leads.serviceType, status: leads.status }).from(leads)
      .where(and(sql`${leads.status} not in ('won', 'lost', 'spam', 'duplicate')`,
        role === 'master' ? eq(leads.assignedTo, actorId) : undefined))
      .orderBy(asc(leads.createdAt)).limit(20);
  }

  async report(since: Date) {
    const activity = await this.db.select({
      code: telegramPublicActivity.acquisitionCode, kind: telegramPublicActivity.kind, total: count(),
    }).from(telegramPublicActivity).where(gte(telegramPublicActivity.createdAt, since))
      .groupBy(telegramPublicActivity.acquisitionCode, telegramPublicActivity.kind);
    const leadMetrics = await this.db.select({
      source: leads.source, code: leads.acquisitionCode, total: count(),
      qualified: count(leads.qualifiedAt), assigned: count(leads.assignedTo), completed: count(leads.wonAt),
      paid: count(leads.paidAt), revenue: sql<string>`coalesce(sum(${leads.revenue}) filter (where ${isNotNull(leads.paidAt)}), 0)`,
    }).from(leads).where(gte(leads.createdAt, since)).groupBy(leads.source, leads.acquisitionCode);
    return { activity, leadMetrics };
  }

  async delivery(actorId: string) {
    if (this.roles.get(actorId) !== 'admin') throw new LeadAccessError();
    const [staff, publicReplies, incoming] = await Promise.all([
      this.db.select({ status: integrationOutbox.status, total: count() }).from(integrationOutbox)
        .where(and(eq(integrationOutbox.destination, 'telegram'), sql`${integrationOutbox.status} in ('pending','retry','processing','dead')`))
        .groupBy(integrationOutbox.status),
      this.db.select({ status: telegramPublicOutbox.status, total: count() }).from(telegramPublicOutbox)
        .where(sql`${telegramPublicOutbox.status} in ('pending','retry','processing','dead')`).groupBy(telegramPublicOutbox.status),
      this.db.select({ source: integrationInbox.source, status: integrationInbox.status, total: count() }).from(integrationInbox)
        .where(sql`${integrationInbox.source} in ('telegram_staff','telegram_public') and ${integrationInbox.status} in ('pending','retry','processing','dead')`)
        .groupBy(integrationInbox.source, integrationInbox.status),
    ]);
    return { staff, publicReplies, incoming };
  }
}
