import { InlineKeyboard } from 'grammy';
import type { Lead } from '../../db/schema.js';
import { statusLabels, type LeadStatus } from '../../domain/status.js';

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

export function buildLeadCard(lead: Lead) {
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

export function buildLeadKeyboard(leadId: string) {
  const keyboard = new InlineKeyboard();
  buttonStatuses.forEach(([status, label], index) => {
    keyboard.text(label, `status:${status}:${leadId}`);
    if (index % 2 === 1) keyboard.row();
  });
  return keyboard;
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
