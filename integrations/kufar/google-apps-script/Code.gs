const KUFAR_LABEL = 'kufar';
const MAX_SEEN_IDS = 300;
const LOOKBACK_MS = 24 * 60 * 60 * 1000;
const MAX_CUSTOMER_MESSAGE = 3500;

function initializeKufar() {
  const label = requireKufarLabel();
  const ids = [];
  label.getThreads(0, 100).forEach(function (thread) {
    thread.getMessages().forEach(function (message) { ids.push(message.getId()); });
  });
  const props = PropertiesService.getScriptProperties();
  props.setProperty('KUFAR_SEEN_IDS', JSON.stringify(ids.slice(-MAX_SEEN_IDS)));
  props.setProperty('KUFAR_LAST_TS', String(Date.now()));
}

function processKufarMail() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;

  try {
    const label = requireKufarLabel();
    const props = PropertiesService.getScriptProperties();
    let seenIds = JSON.parse(props.getProperty('KUFAR_SEEN_IDS') || '[]');
    const seen = new Set(seenIds);
    let lastTimestamp = Number(props.getProperty('KUFAR_LAST_TS') || 0);
    const messages = [];

    label.getThreads(0, 50).forEach(function (thread) {
      thread.getMessages().forEach(function (message) {
        const id = message.getId();
        const date = message.getDate().getTime();
        const isKufar = /noreply@kufar\.by/i.test(message.getFrom()) && /новое сообщение/i.test(message.getSubject());
        if (isKufar && date >= lastTimestamp - LOOKBACK_MS && !seen.has(id)) messages.push(message);
      });
    });

    messages.sort(function (a, b) { return a.getDate() - b.getDate(); });
    messages.forEach(function (message) {
      const event = buildKufarEvent(message);
      const result = sendToLeadHub(event);
      if (!result.accepted) throw new Error('Lead Hub did not durably accept the Kufar event.');

      const id = message.getId();
      seen.add(id);
      seenIds.push(id);
      seenIds = seenIds.slice(-MAX_SEEN_IDS);
      lastTimestamp = Math.max(lastTimestamp, message.getDate().getTime());
      props.setProperty('KUFAR_SEEN_IDS', JSON.stringify(seenIds));
      props.setProperty('KUFAR_LAST_TS', String(lastTimestamp));
    });
  } finally {
    lock.releaseLock();
  }
}

function buildKufarEvent(message) {
  const html = String(message.getBody() || '');
  const plain = String(message.getPlainBody() || '');
  const conversationUrl = extractConversationUrl(html, plain);
  const customerMessage = extractCustomerMessage(plain, html);
  const metadata = extractSubjectMetadata(message.getSubject());
  const event = {
    externalMessageId: message.getId(),
    subject: String(message.getSubject() || '').slice(0, 500),
    customerMessage: customerMessage,
    receivedAt: message.getDate().toISOString()
  };
  if (conversationUrl) event.conversationUrl = conversationUrl;
  if (metadata.customerName) event.customerName = metadata.customerName;
  if (metadata.itemTitle) event.itemTitle = metadata.itemTitle;
  return event;
}

function sendToLeadHub(event) {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('LEAD_HUB_KUFAR_INGEST_URL');
  const apiKey = props.getProperty('KUFAR_INGEST_API_KEY');
  if (!url || !apiKey) throw new Error('Missing LEAD_HUB_KUFAR_INGEST_URL or KUFAR_INGEST_API_KEY.');

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + apiKey },
    payload: JSON.stringify(event),
    muteHttpExceptions: true
  });
  const code = response.getResponseCode();
  if (code !== 200 && code !== 202) throw new Error('Lead Hub Kufar ingest failed with HTTP ' + code + '.');
  const result = JSON.parse(response.getContentText() || '{}');
  return { accepted: result.accepted === true, deduplicated: result.deduplicated === true };
}

function extractConversationUrl(html, plain) {
  const anchorRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  let fallback = '';
  while ((match = anchorRegex.exec(String(html || ''))) !== null) {
    const href = decodeHtml(match[1]);
    const text = normalizeKufarText(match[2].replace(/<[^>]+>/g, ' '));
    if (!validateKufarUrl(href)) continue;
    if (/ответить|открыть диалог/i.test(text)) return href;
    if (!fallback) fallback = href;
  }
  const plainMatches = String(plain || '').match(/https:\/\/(?:www\.)?kufar\.by\/account\/messaging\/[A-Za-z0-9-]+[^\s<>]*/gi) || [];
  for (let index = 0; index < plainMatches.length; index += 1) {
    const candidate = plainMatches[index].replace(/[),.;]+$/, '');
    if (validateKufarUrl(candidate)) return candidate;
  }
  return fallback;
}

function validateKufarUrl(value) {
  const candidate = decodeHtml(String(value || '')).trim();
  return /^https:\/\/(?:www\.)?kufar\.by\/account\/messaging\/[A-Za-z0-9-]+(?:[/?#][^\s<>]*)?$/i.test(candidate);
}

function extractCustomerMessage(plain, html) {
  const raw = String(plain || '').replace(/\r\n?/g, '\n');
  const replyMarker = raw.search(/^\s*Ответить\s*$/mi);
  if (replyMarker >= 0) {
    const beforeReply = raw.slice(0, replyMarker).trim();
    const paragraphs = beforeReply.split(/\n\s*\n/)
      .map(function (value) { return normalizeKufarText(value); })
      .filter(function (value) {
        return value && !/^<?https?:\/\//i.test(value) &&
          !/у вас новое сообщение о товаре/i.test(value);
      });
    if (paragraphs.length) return paragraphs[paragraphs.length - 1].slice(0, MAX_CUSTOMER_MESSAGE);
  }

  let text = raw;
  text = text.replace(/Нажмите, чтобы открыть диалог на Куфаре/gi, '');
  const footer = text.search(/Это автоматическое уведомление/i);
  if (footer >= 0) text = text.slice(0, footer);
  text = normalizeKufarText(text);
  if (text) return text.slice(0, MAX_CUSTOMER_MESSAGE);

  const fragment = normalizeKufarText(String(html || '').replace(/<[^>]+>/g, ' '));
  return ('⚠️ Не удалось автоматически выделить текст сообщения Kufar.\n' + fragment)
    .slice(0, MAX_CUSTOMER_MESSAGE);
}

function extractSubjectMetadata(subject) {
  const normalized = normalizeKufarText(subject);
  const result = {};
  const fromMatch = normalized.match(/(?:от|пользователь)\s+([^—|-]+)/i);
  if (fromMatch) result.customerName = fromMatch[1].trim().slice(0, 120);
  return result;
}

function normalizeKufarText(value) {
  return decodeHtml(String(value || ''))
    .replace(/\r/g, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeHtml(value) {
  return String(value || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function requireKufarLabel() {
  const label = GmailApp.getUserLabelByName(KUFAR_LABEL);
  if (!label) throw new Error('В Gmail не найден ярлык: ' + KUFAR_LABEL);
  return label;
}
