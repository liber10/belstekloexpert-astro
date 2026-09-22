import { createHash } from 'node:crypto';
import type { ExternalLeadInput } from '../contracts/external-lead.js';

export interface MetaMessageEvent {
  externalEventId: string;
  platform: 'instagram' | 'facebook' | 'meta';
  pageId: string;
  senderId: string;
  recipientId: string;
  conversationId: string;
  timestamp?: number;
  text?: string;
  attachmentTypes: string[];
  adId?: string;
  messageId?: string;
}

/**
 * Reduce Meta's webhook envelope to an allow-listed, PII-minimal event.
 * Attachment URLs are intentionally not persisted: they are provider URLs
 * with short/unstable lifetime and must be fetched through a later approved
 * media flow if the business decides to retain a client photo.
 */
export function parseMetaMessageEvents(payload: unknown, allowedRecipientIds: readonly string[]) {
  if (!isRecord(payload) || !Array.isArray(payload.entry)) return [];
  const events: MetaMessageEvent[] = [];
  const allowed = new Set(allowedRecipientIds);

  for (const entryValue of payload.entry) {
    if (!isRecord(entryValue) || !Array.isArray(entryValue.messaging)) continue;
    const entryId = text(entryValue.id);
    const entryTime = number(entryValue.time);
    for (const messagingValue of entryValue.messaging) {
      const event = normalizeMessage(messagingValue, entryId, entryTime, payload.object, allowed);
      if (event) events.push(event);
    }
  }

  return events;
}

export function parseMetaMessageEvent(payload: unknown): MetaMessageEvent | null {
  if (!isRecord(payload)) return null;
  if (typeof payload.externalEventId !== 'string'
    || typeof payload.platform !== 'string'
    || typeof payload.pageId !== 'string'
    || typeof payload.senderId !== 'string'
    || typeof payload.recipientId !== 'string'
    || typeof payload.conversationId !== 'string'
    || !Array.isArray(payload.attachmentTypes)) return null;
  if (!payload.attachmentTypes.every((value) => typeof value === 'string')) return null;
  const platform = payload.platform === 'instagram' || payload.platform === 'facebook'
    ? payload.platform
    : 'meta';
  return {
    externalEventId: payload.externalEventId,
    platform,
    pageId: payload.pageId,
    senderId: payload.senderId,
    recipientId: payload.recipientId,
    conversationId: payload.conversationId,
    ...(typeof payload.timestamp === 'number' ? { timestamp: payload.timestamp } : {}),
    ...(typeof payload.text === 'string' && payload.text ? { text: payload.text } : {}),
    attachmentTypes: payload.attachmentTypes,
    ...(typeof payload.adId === 'string' ? { adId: payload.adId } : {}),
    ...(typeof payload.messageId === 'string' ? { messageId: payload.messageId } : {}),
  };
}

export function metaMessageToLeadInput(event: MetaMessageEvent): ExternalLeadInput {
  const attachmentSummary = event.attachmentTypes.length
    ? `Входящее вложение: ${event.attachmentTypes.join(', ')}`
    : undefined;
  return {
    source: 'meta',
    sourceDetail: event.platform,
    externalLeadId: event.conversationId,
    externalEventId: event.externalEventId,
    message: event.text || attachmentSummary || 'Входящее сообщение из Meta.',
    sourceMetadata: {
      platform: event.platform,
      pageId: event.pageId,
      senderId: event.senderId,
      recipientId: event.recipientId,
      conversationId: event.conversationId,
      messageId: event.externalEventId,
      hasAttachments: event.attachmentTypes.length > 0,
      attachmentTypes: event.attachmentTypes.join(','),
      ...(event.timestamp === undefined ? {} : { timestamp: event.timestamp }),
    },
    ...(event.timestamp === undefined ? {} : { receivedAt: new Date(event.timestamp).toISOString() }),
  };
}

function normalizeMessage(
  value: unknown,
  entryId: string,
  entryTime: number | undefined,
  object: unknown,
  allowedRecipientIds: ReadonlySet<string>,
): MetaMessageEvent | null {
  if (!isRecord(value)) return null;
  const senderId = isRecord(value.sender) ? text(value.sender.id) : '';
  const recipientId = isRecord(value.recipient) ? text(value.recipient.id) : entryId;
  if (!senderId || !recipientId || (allowedRecipientIds.size > 0 && !allowedRecipientIds.has(recipientId))) return null;
  if (!isRecord(value.message)) return null;
  if (value.message.is_echo === true || value.message.is_deleted === true || senderId === recipientId) return null;
  const messageId = typeof value.message.mid === 'string' ? value.message.mid.trim() : '';
  if (object === 'instagram' && (!messageId || messageId.length > 4096)) return null;
  const textValue = limitText(value.message.text, 4_000);
  const attachmentTypes = normalizeAttachmentTypes(value.message.attachments);
  if (!messageId && !textValue && !attachmentTypes.length) return null;
  const timestamp = number(value.timestamp) ?? entryTime;
  const externalEventId = messageId.length > 255 ? `igmid:${hashForEvent(messageId)}` : messageId || `meta:${hashForEvent(value)}`;
  const platform = object === 'instagram' ? 'instagram' : object === 'page' ? 'facebook' : 'meta';
  const referral = isRecord(value.message.referral) ? value.message.referral : isRecord(value.referral) ? value.referral : null;
  const adId = referral?.source === 'ADS' ? text(referral.ad_id) : '';
  return {
    externalEventId,
    platform,
    pageId: entryId || recipientId,
    senderId,
    recipientId,
    conversationId: `${recipientId}:${senderId}`,
    ...(timestamp === undefined ? {} : { timestamp }),
    ...(textValue ? { text: textValue } : {}),
    attachmentTypes,
    ...(messageId.length > 255 ? { messageId } : {}),
    ...(adId && /^\d+$/.test(adId) ? { adId } : {}),
  };
}

function normalizeAttachmentTypes(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((attachment) => isRecord(attachment) ? text(attachment.type) : '')
    .filter(Boolean)
    .map((type) => type.slice(0, 40))
    .slice(0, 10);
}

function hashForEvent(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 48);
}

function limitText(value: unknown, max: number) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim().slice(0, 255) : '';
}

function number(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
