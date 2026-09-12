import type { APIRoute } from 'astro';
import { createHash } from 'node:crypto';
import { legal } from '@/config/legal';
import {
  classifyDeliveryFailure,
  getLeadRuntimeEnv,
  getLeadPhotoUrls,
  LeadHubRequestError,
  normalizeSubmissionId,
  recordSubmissionAudit,
  resolveLeadDeliveryMode,
  sendLeadToHub,
  updateLegacyTelegramDelivery,
} from '@/lib/lead-hub';
import { sendLeadToTelegram } from '@/lib/telegram';
import {
  getFormString,
  getPhotoRefs,
  maxPhotoCount,
  getUploadedPhotos,
  isValidPhone,
  validatePhotos,
  validatePhotoRefs,
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
  'privacy_consent',
  'privacy_version',
  'consent_version',
  'consent_text_hash',
  'consent_at',
];

export const POST: APIRoute = async ({ request, redirect }) => {
  const wantsJson = request.headers.get('accept')?.includes('application/json') ?? false;
  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return json({ ok: false, error: 'invalid_form' }, 400);
  }

  const submissionId = normalizeSubmissionId(getFormString(formData, 'submission_id')) || createLeadId();
  formData.set('submission_id', submissionId);
  const formType = getFormString(formData, 'form_source') || getFormString(formData, 'service') || 'site_form';
  const env = getLeadRuntimeEnv();
  const deliveryMode = resolveLeadDeliveryMode(env);
  await auditSubmission({ correlationId: submissionId, event: 'received', formType, env });

  if (getFormString(formData, 'company')) {
    await auditSubmission({ correlationId: submissionId, event: 'honeypot_rejected', reason: 'honeypot', formType, env });
    return wantsJson ? json({ ok: true, spam: true, correlationId: submissionId }) : redirect('/spasibo/', 303);
  }

  const phone = getFormString(formData, 'phone');
  if (!isValidPhone(phone)) {
    await auditSubmission({ correlationId: submissionId, event: 'validation_rejected', reason: 'invalid_phone', formType, env });
    return json({ ok: false, error: 'invalid_phone', correlationId: submissionId }, 400);
  }

  if (getFormString(formData, 'privacy_consent') !== 'accepted') {
    await auditSubmission({ correlationId: submissionId, event: 'validation_rejected', reason: 'privacy_consent_required', formType, env });
    return json({ ok: false, error: 'privacy_consent_required', correlationId: submissionId }, 400);
  }

  const photos = getUploadedPhotos(formData);
  const photoError = validatePhotos(photos);
  if (photoError) {
    await auditSubmission({ correlationId: submissionId, event: 'validation_rejected', reason: 'invalid_photo', formType, env });
    return json({ ok: false, error: 'invalid_photo', message: photoError, correlationId: submissionId }, 400);
  }
  const photoRefs = getPhotoRefs(formData);
  const photoRefError = validatePhotoRefs(photoRefs);
  if (photoRefError || (photos.length && photoRefs.length) || photos.length + photoRefs.length > maxPhotoCount) {
    await auditSubmission({ correlationId: submissionId, event: 'validation_rejected', reason: 'invalid_photo', formType, env });
    return json({ ok: false, error: 'invalid_photo', correlationId: submissionId }, 400);
  }

  const fields = Object.fromEntries(
    leadFieldKeys.map((key) => [key, getFormString(formData, key)]),
  );
  fields.privacy_version = legal.policyVersion;
  fields.consent_version = legal.consentVersion;
  fields.consent_text_hash = createHash('sha256').update(legal.consentText, 'utf8').digest('hex');
  fields.consent_at = new Date().toISOString();
  let deliveryStage: 'hub' | 'telegram_bridge' = 'hub';

  try {
    if (deliveryMode === 'legacy') {
      const leadId = createLeadId();
      if (photoRefs.length) {
        return deliveryError(
          wantsJson,
          'Photo storage is temporarily unavailable.',
          503,
          undefined,
          submissionId,
        );
      }
      await sendLeadToTelegram({ leadId, fields, photos });
      return wantsJson ? json({ ok: true, leadId, correlationId: submissionId }) : redirect(`/spasibo/?leadId=${leadId}`, 303);
    }

    if (deliveryMode === 'hub' && photos.length) {
      return deliveryError(
        wantsJson,
        'Фото сейчас нельзя надёжно сохранить. Отправьте заявку без фото или позвоните нам.',
        503,
        undefined,
        submissionId,
      );
    }

    const hubLead = await sendLeadToHub({
      fields,
      idempotencyKey: submissionId,
      photoCount: photos.length + photoRefs.length,
      photoRefs,
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
          const photoUrls = photoRefs.length
            ? await getLeadPhotoUrls({ leadId: hubLead.leadId, env })
            : [];
          await sendLeadToTelegram({
            leadId: hubLead.publicId,
            fields,
            photos,
            photoUrls,
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
      ? json({ ok: true, leadId: hubLead.publicId, deduplicated: hubLead.deduplicated, correlationId: submissionId })
      : redirect(`/spasibo/?leadId=${encodeURIComponent(hubLead.publicId)}`, 303);
  } catch (error) {
    const diagnosticCode = classifyDeliveryFailure(deliveryStage, error);
    console.error('Lead delivery failed.', {
      correlationId: submissionId,
      stage: deliveryStage,
      code: diagnosticCode,
      upstreamStatus: error instanceof LeadHubRequestError ? error.status : undefined,
    });
    await auditSubmission({ correlationId: submissionId, event: 'hub_request_failed', reason: diagnosticCode, formType, env });
    return deliveryError(
      wantsJson,
      'Не удалось отправить заявку. Попробуйте ещё раз или позвоните нам.',
      502,
      diagnosticCode,
      submissionId,
    );
  }
};

async function auditSubmission(options: Parameters<typeof recordSubmissionAudit>[0]) {
  try {
    await recordSubmissionAudit(options);
  } catch {
    console.warn('Submission audit unavailable.', {
      correlationId: options.correlationId,
      event: options.event,
    });
  }
}

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
  correlationId?: string,
) {
  return wantsJson
    ? json({ ok: false, error: 'delivery_failed', ...(code ? { code } : {}), ...(correlationId ? { correlationId } : {}), message }, status)
    : new Response(message, {
        status,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
}
