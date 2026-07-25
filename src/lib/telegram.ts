type LeadFields = Record<string, string>;

export interface TelegramLead {
  leadId: string;
  fields: LeadFields;
  photos: File[];
  photoUrls?: string[];
}

const labels: Record<string, string> = {
  service: 'Услуга',
  phone: 'Телефон',
  name: 'Имя',
  contact_method: 'Способ связи',
  make: 'Марка',
  model: 'Модель',
  year: 'Год',
  glass_type: 'Тип стекла',
  vin: 'VIN',
  comment: 'Комментарий',
  page_url: 'Страница',
  utm_source: 'UTM source',
  utm_medium: 'UTM medium',
  utm_campaign: 'UTM campaign',
  utm_content: 'UTM content',
  utm_term: 'UTM term',
};

const imagePhotoTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function buildTelegramMessage({ leadId, fields, photos: uploadedPhotos, photoUrls = [] }: TelegramLead) {
  const photos = [...uploadedPhotos, ...photoUrls];
  const lines = [
    '🚗 Новая заявка BelStekloExpert',
    '',
    `ID: ${leadId}`,
  ];

  Object.entries(labels).forEach(([key, label]) => {
    const value = fields[key];
    if (value) lines.push(`${label}: ${value}`);
  });

  lines.push(`Фото: ${photos.length ? `${photos.length} файл(а)` : 'нет'}`);

  return lines.join('\n');
}

export async function sendLeadToTelegram(lead: TelegramLead) {
  const token = import.meta.env.TELEGRAM_BOT_TOKEN;
  const chatId = import.meta.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    throw new Error('Telegram is not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID.');
  }

  const apiUrl = `https://api.telegram.org/bot${token}`;
  const text = buildTelegramMessage(lead);
  const totalPhotoCount = lead.photos.length + (lead.photoUrls?.length || 0);

  await postTelegramJson(`${apiUrl}/sendMessage`, {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  });

  for (const [index, photo] of lead.photos.entries()) {
    const formData = new FormData();
    formData.set('chat_id', chatId);
    formData.set('caption', `Фото к заявке ${lead.leadId} (${index + 1}/${lead.photos.length})`);

    const method = imagePhotoTypes.has(photo.type) ? 'sendPhoto' : 'sendDocument';
    formData.set(method === 'sendPhoto' ? 'photo' : 'document', photo, safeFileName(photo.name, index));

    await postTelegramForm(`${apiUrl}/${method}`, formData);
  }

  for (const [index, photoUrl] of (lead.photoUrls || []).entries()) {
    await postTelegramJson(`${apiUrl}/sendPhoto`, {
      chat_id: chatId,
      photo: photoUrl,
      caption: `#${lead.leadId} (${lead.photos.length + index + 1}/${totalPhotoCount})`,
    });
  }
}

async function postTelegramJson(url: string, payload: Record<string, unknown>) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Telegram sendMessage failed: ${await response.text()}`);
  }
}

async function postTelegramForm(url: string, formData: FormData) {
  const response = await fetch(url, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Telegram file upload failed: ${await response.text()}`);
  }
}

function safeFileName(name: string, index: number) {
  const fallback = `photo-${index + 1}`;
  return (name || fallback).replace(/[^\w.\-а-яА-ЯёЁ]/g, '_');
}
