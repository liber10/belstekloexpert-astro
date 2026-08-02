import type { KufarEmailEvent } from '../contracts/kufar-email.js';
import type { ExternalLeadInput } from '../contracts/external-lead.js';

const allowedHosts = new Set(['kufar.by', 'www.kufar.by']);
const conversationPath = /^\/account\/messaging\/[A-Za-z0-9-]+(?:\/.*)?$/;

export function validateKufarConversationUrl(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      !allowedHosts.has(url.hostname.toLowerCase()) ||
      !conversationPath.test(url.pathname)
    ) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function mapKufarEmailToLead(event: KufarEmailEvent): ExternalLeadInput {
  const safeUrl = validateKufarConversationUrl(event.conversationUrl);
  const message = normalizeKufarText(event.customerMessage);
  if (!message) throw new Error('Kufar event has no customer message.');

  return {
    source: 'kufar',
    sourceDetail: 'gmail_notification',
    externalLeadId: event.externalMessageId,
    externalEventId: event.externalMessageId,
    serviceType: event.itemTitle || 'Сообщение Kufar',
    message,
    ...(event.customerName ? { name: event.customerName.trim() } : {}),
    ...(safeUrl ? { sourceActionUrl: safeUrl } : {}),
    sourceMetadata: {
      ...(event.conversationId ? { conversationId: event.conversationId } : {}),
      ...(event.itemTitle ? { itemTitle: event.itemTitle } : {}),
      ...(safeItemUrl(event.itemUrl) ? { itemUrl: safeItemUrl(event.itemUrl)! } : {}),
      conversationUrlValid: Boolean(safeUrl),
    },
    ...(event.receivedAt ? { receivedAt: event.receivedAt } : {}),
  };
}

export function normalizeKufarText(value: string) {
  return String(value || '')
    .replace(/\r/g, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 3_500);
}

function safeItemUrl(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || !allowedHosts.has(url.hostname)) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}
