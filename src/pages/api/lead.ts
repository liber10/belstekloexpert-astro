import type { APIRoute } from 'astro';
import { sendLeadToTelegram } from '@/lib/telegram';
import {
  getFormString,
  getUploadedPhotos,
  isValidPhone,
  validatePhotos,
} from '@/lib/validation';

export const prerender = false;

const leadFieldKeys = [
  'service',
  'phone',
  'name',
  'contact_method',
  'make',
  'model',
  'year',
  'glass_type',
  'vin',
  'comment',
  'page_url',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
];

export const POST: APIRoute = async ({ request, redirect }) => {
  const formData = await request.formData();
  const wantsJson = request.headers.get('accept')?.includes('application/json') ?? false;

  if (getFormString(formData, 'company')) {
    return wantsJson ? json({ ok: true, spam: true }) : redirect('/spasibo/', 303);
  }

  const phone = getFormString(formData, 'phone');
  if (!isValidPhone(phone)) {
    return json({ ok: false, error: 'invalid_phone' }, 400);
  }

  const photos = getUploadedPhotos(formData);
  const photoError = validatePhotos(photos);
  if (photoError) {
    return json({ ok: false, error: 'invalid_photo', message: photoError }, 400);
  }

  const fields = Object.fromEntries(
    leadFieldKeys.map((key) => [key, getFormString(formData, key)]),
  );
  const leadId = createLeadId();

  try {
    await sendLeadToTelegram({
      leadId,
      fields,
      photos,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Telegram delivery failed.';
    return wantsJson
      ? json({ ok: false, error: 'telegram_delivery_failed', message }, 502)
      : new Response(`Не удалось отправить заявку в Telegram: ${message}`, {
          status: 502,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        });
  }

  return wantsJson ? json({ ok: true, leadId }) : redirect(`/spasibo/?leadId=${leadId}`, 303);
};

export const GET: APIRoute = async () => {
  return json({ ok: false, error: 'method_not_allowed' }, 405);
};

function createLeadId() {
  const time = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `lead_${time}_${random}`;
}

function json(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
  });
}
