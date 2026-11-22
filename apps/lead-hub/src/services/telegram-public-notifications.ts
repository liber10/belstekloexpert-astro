import { and, eq, isNull } from 'drizzle-orm';
import type { LeadHubTransaction } from '../db/client.js';
import { telegramPublicOutbox, telegramPublicSubscriptions, type Lead } from '../db/schema.js';
import type { LeadStatus } from '../domain/status.js';

const notices: Partial<Record<LeadStatus, string>> = {
  contacted: 'Специалист связался с вами.',
  booked: 'Запись подтверждена. Уточнить детали можно у специалиста.',
  won: 'Мастер отметил работу выполненной.',
};

export async function enqueuePublicStatusNotice(tx: LeadHubTransaction, lead: Lead, status: LeadStatus, eventId: string) {
  const text = notices[status];
  if (!text || lead.source !== 'telegram' || lead.sourceDetail !== 'public_bot') return;
  const [subscription] = await tx.select().from(telegramPublicSubscriptions)
    .where(and(eq(telegramPublicSubscriptions.leadId, lead.id), isNull(telegramPublicSubscriptions.revokedAt)));
  if (!subscription) return;
  await tx.insert(telegramPublicOutbox).values({
    chatId: subscription.chatId, subscriptionLeadId: lead.id,
    idempotencyKey: `telegram-public:status:${lead.id}:${eventId}`,
    payload: { text: `Заявка #${lead.publicId}. ${text}\nОтключить уведомления: /stop_notifications.` },
  }).onConflictDoNothing({ target: telegramPublicOutbox.idempotencyKey });
}
