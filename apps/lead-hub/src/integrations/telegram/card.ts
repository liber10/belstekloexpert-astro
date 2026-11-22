import { InlineKeyboard } from 'grammy';
import type { Lead } from '../../db/schema.js';
import { statusLabels, type LeadStatus } from '../../domain/status.js';

export const telegramTextLimit = 4096;
const safeTelegramTextLimit = 4000;

const buttonStatuses: Array<[LeadStatus, string]> = [
  ['contacted', 'Связались'],
  ['qualified', 'Квалифицирован'],
  ['quote_sent', 'Цена озвучена'],
  ['booked', 'Записан'],
  ['arrived', 'Доехал / выезд'],
  ['won', 'Выполнено'],
  ['lost', 'Потерян'],
  ['spam', 'Спам'],
  ['duplicate', 'Дубль'],
];

export function buildLeadCard(lead: Lead, staffEnabled = false) {
  const body = lead.source === 'kufar' ? buildKufarLeadCard(lead)
    : lead.source === 'meta' ? buildMetaLeadCard(lead)
    : lead.source === 'telegram' && lead.sourceDetail === 'public_bot' ? buildTelegramPublicLeadCard(lead)
    : buildDefaultLeadCard(lead);
  return guardTelegramText([
    staffEnabled && lead.source === 'kufar' && `Заявка #${lead.publicId}`,
    body, lead.assignedTo && 'Ответственный назначен',
    lead.finalAmount && `Итого: ${lead.finalAmount} BYN`, lead.paidAt && 'Оплачено',
  ].filter(Boolean).join('\n'));
}

export function guardTelegramText(value: string) {
  if (value.length <= safeTelegramTextLimit) return value;
  return `${value.slice(0, safeTelegramTextLimit - 24).trimEnd()}\n… [текст сокращён]`;
}

function buildDefaultLeadCard(lead: Lead) {
  const car = [lead.carMake, lead.carModel, lead.carYear].filter(Boolean).join(' ');
  const lines = [
    `Новый лид #${lead.publicId}`,
    `Статус: ${statusLabels[lead.status as LeadStatus] || lead.status}`,
    `Источник: ${[lead.source, lead.sourceDetail].filter(Boolean).join(' / ')}`,
    `Услуга: ${lead.serviceType || 'не указана'}`,
    `Клиент: ${[lead.name, lead.phoneNormalized].filter(Boolean).join(' / ')}`,
  ];

  if (car) lines.push(`Авто: ${car}`);
  if (lead.vin) lines.push(`VIN: ${lead.vin}`);
  if (lead.damageType) lines.push(`Повреждение: ${lead.damageType}`);
  if (lead.district) lines.push(`Район: ${lead.district}`);
  if (lead.message) lines.push(`Комментарий: ${lead.message}`);
  if (lead.photoRefs.length) lines.push(`Фото: ${lead.photoRefs.length}`);
  if (lead.utmCampaign) lines.push(`Кампания: ${lead.utmCampaign}`);
  lines.push(`Получен: ${formatMinskTime(lead.createdAt)}`);

  return lines.join('\n');
}

function buildKufarLeadCard(lead: Lead) {
  const lines = [lead.message || '⚠️ Не удалось автоматически выделить текст сообщения Kufar.'];
  if (lead.status !== 'new') lines.push(`Статус: ${statusLabels[lead.status as LeadStatus] || lead.status}`);
  return lines.join('\n\n');
}

function buildMetaLeadCard(lead: Lead) {
  const car = [lead.carMake, lead.carModel, lead.carYear].filter(Boolean).join(' ');
  return [
    lead.sourceDetail === 'instagram' ? `🔵 Instagram DM #${lead.publicId}` : '🔵 Новая заявка Meta',
    lead.sourceDetail === 'instagram' && `Статус: ${statusLabels[lead.status as LeadStatus] || lead.status}. Требует внимания менеджера.`,
    lead.name && `Имя: ${lead.name}`,
    lead.phoneNormalized && `Телефон: ${lead.phoneNormalized}`,
    lead.emailNormalized && `Email: ${lead.emailNormalized}`,
    car && `Автомобиль: ${car}`,
    lead.serviceType && `Услуга: ${lead.serviceType}`,
    lead.message && `Комментарий: ${lead.message}`,
  ].filter(Boolean).join('\n');
}

function buildTelegramPublicLeadCard(lead: Lead) {
  return [
    `Заявка из Telegram #${lead.publicId}`,
    `Статус: ${statusLabels[lead.status as LeadStatus] ?? lead.status}`,
    lead.name && `Клиент: ${lead.name}`,
    lead.phoneNormalized && `Телефон: ${lead.phoneNormalized}`,
    lead.serviceType && `Услуга: ${lead.serviceType}`,
    lead.carMake && `Авто: ${[lead.carMake, lead.carModel, lead.carYear].filter(Boolean).join(' ')}`,
    lead.damageType && `Стекло: ${lead.damageType}`,
    lead.photoRefs.length > 0 && `Фото: ${lead.photoRefs.length}`,
    lead.message && `Комментарий: ${lead.message}`,
    lead.acquisitionCode && `Кампания: ${lead.acquisitionCode}`,
  ].filter(Boolean).join('\n');
}

export function buildLeadKeyboard(lead: Lead, staffEnabled = false) {
  const keyboard = new InlineKeyboard();
  const action = sourceAction(lead);
  if (action) keyboard.url(action.label, action.url).row();
  if (staffEnabled && !lead.assignedTo) keyboard.text('Взять заявку', `take:${lead.id}`).row();
  if (staffEnabled && lead.assignedTo && /^\d{1,16}$/.test(lead.assignedTo)) {
    keyboard.url('Ответственный', `tg://user?id=${lead.assignedTo}`).row();
  }
  buttonStatuses.forEach(([status, label], index) => {
    keyboard.text(label, `status:${status}:${lead.id}`);
    if (index % 2 === 1) keyboard.row();
  });
  return keyboard;
}

function sourceAction(lead: Lead) {
  if (!lead.sourceActionUrl) return null;
  try {
    const url = new URL(lead.sourceActionUrl);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    if (lead.source === 'kufar' && ['kufar.by', 'www.kufar.by'].includes(url.hostname)) {
      return { label: 'Ответить на Kufar', url: url.toString() };
    }
    if (lead.source === 'meta') return { label: 'Открыть в Meta', url: url.toString() };
    if (lead.source === 'onliner') return { label: 'Ответить на Onliner', url: url.toString() };
  } catch {
    return null;
  }
  return null;
}

function formatMinskTime(value: Date) {
  return new Intl.DateTimeFormat('ru-BY', {
    timeZone: 'Europe/Minsk',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value);
}
