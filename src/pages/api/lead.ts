import type { APIRoute } from 'astro';
import {
  classifyDeliveryFailure,
  getLeadRuntimeEnv,
  LeadHubRequestError,
  normalizeSubmissionId,
  resolveLeadDeliveryMode,
  sendLeadToHub,
  updateLegacyTelegramDelivery,
} from '@/lib/lead-hub';
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
  'decoded_vehicle',
  'form_source',
  'submission_id',
  'page_url',
  'landing_url',
  'referrer',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'gclid',
  'gbraid',
  'wbraid',
  'yclid',
  'fbclid',
];

export const POST: APIRoute = async ({ request, redirect }) => {
  const wantsJson = request.headers.get('accept')?.includes('application/json') ?? false;
  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return json({ ok: false, error: 'invalid_form' }, 400);
  }

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
  const submissionId = normalizeSubmissionId(fields.submission_id) || createLeadId();
  const env = getLeadRuntimeEnv();
  const deliveryMode = resolveLeadDeliveryMode(env);
  let deliveryStage: 'hub' | 'telegram_bridge' = 'hub';

  try {
    if (deliveryMode === 'legacy') {
      const leadId = createLeadId();
      await sendLeadToTelegram({ leadId, fields, photos });
      return wantsJson ? json({ ok: true, leadId }) : redirect(`/spasibo/?leadId=${leadId}`, 303);
    }

    if (deliveryMode === 'hub' && photos.length) {
      return deliveryError(
        wantsJson,
        'Фото сейчас нельзя надёжно сохранить. Отправьте заявку без фото или позвоните нам.',
        503,
      );
    }

    const hubLead = await sendLeadToHub({
      fields,
      idempotencyKey: submissionId,
      photoCount: photos.length,
      env,
    });

    if (deliveryMode === 'hub-with-legacy-telegram') {
      deliveryStage = 'telegram_bridge';
      const claimed = await updateLegacyTelegramDelivery({
        leadId: hubLead.leadId,
        action: 'claim',
        env,
      });

      if (claimed) {
        try {
          await sendLeadToTelegram({
            leadId: hubLead.publicId,
            fields,
            photos,
          });
        } catch {
          try {
            await updateLegacyTelegramDelivery({
              leadId: hubLead.leadId,
              action: 'release',
              env,
            });
          } catch {
            console.error('Legacy Telegram delivery release failed.', {
              leadId: hubLead.publicId,
            });
          }
          throw new Error('Legacy Telegram delivery failed.');
        }

        try {
          await updateLegacyTelegramDelivery({
            leadId: hubLead.leadId,
            action: 'complete',
            env,
          });
        } catch {
          console.error('Legacy Telegram delivery completion failed.', {
            leadId: hubLead.publicId,
          });
        }
      }
    }

    return wantsJson
      ? json({ ok: true, leadId: hubLead.publicId, deduplicated: hubLead.deduplicated })
      : redirect(`/spasibo/?leadId=${encodeURIComponent(hubLead.publicId)}`, 303);
  } catch (error) {
    const diagnosticCode = classifyDeliveryFailure(deliveryStage, error);
    console.error('Lead delivery failed.', {
      stage: deliveryStage,
      code: diagnosticCode,
      upstreamStatus: error instanceof LeadHubRequestError ? error.status : undefined,
    });
    return deliveryError(
      wantsJson,
      'Не удалось отправить заявку. Попробуйте ещё раз или позвоните нам.',
      502,
      diagnosticCode,
    );
  }
};

export const GET: APIRoute = async () => {
  const deliveryMode = resolveLeadDeliveryMode(getLeadRuntimeEnv());
  return json(
    {
      ok: false,
      error: 'method_not_allowed',
      version: 'lead-hub-v1',
      pipeline: deliveryMode === 'legacy' ? 'legacy' : 'hub',
    },
    405,
  );
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

function deliveryError(
  wantsJson: boolean,
  message: string,
  status = 502,
  code?: string,
) {
  return wantsJson
    ? json({ ok: false, error: 'delivery_failed', ...(code ? { code } : {}), message }, status)
    : new Response(message, {
        status,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
}
