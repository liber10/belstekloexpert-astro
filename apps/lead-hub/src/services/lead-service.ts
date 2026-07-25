import { randomUUID } from 'node:crypto';
import { and, count, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { WebLeadBody } from '../contracts/web-lead.js';
import type { LeadHubDatabase } from '../db/client.js';
import { integrationOutbox, leadEvents, leads, type Lead } from '../db/schema.js';
import { hashPayload, IdempotencyConflictError } from '../domain/idempotency.js';
import { normalizeBelarusPhone } from '../domain/phone.js';
import type { LeadStatus } from '../domain/status.js';

export class LeadValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LeadValidationError';
  }
}

export class LeadNotFoundError extends Error {
  constructor() {
    super('Lead not found.');
    this.name = 'LeadNotFoundError';
  }
}

export interface CreateLeadResult {
  lead: Lead;
  deduplicated: boolean;
}

interface CreateLeadOptions {
  source: string;
  idempotencyKey: string;
  externalLeadId?: string;
  sourceDetail?: string;
}

interface ChangeStatusOptions {
  source: string;
  externalEventId?: string;
  actorId?: string;
}

export class LeadService {
  constructor(private readonly db: LeadHubDatabase) {}

  async createWebLead(body: WebLeadBody, idempotencyKey: string) {
    const sourceDetail = cleanText(body.sourceDetail);
    const externalLeadId = cleanText(body.externalLeadId);
    return this.createLead(body, {
      source: 'web',
      idempotencyKey,
      ...(sourceDetail ? { sourceDetail } : {}),
      ...(externalLeadId ? { externalLeadId } : {}),
    });
  }

  async createManualLead(input: { phone: string; serviceType?: string }, idempotencyKey: string) {
    return this.createLead(
      {
        phone: input.phone,
        serviceType: cleanText(input.serviceType) || 'Ручная заявка',
      },
      {
        source: 'telegram_manual',
        sourceDetail: 'telegram_command',
        idempotencyKey,
      },
    );
  }

  async claimLegacyTelegramDelivery(leadId: string) {
    const now = new Date();
    const claimed = await this.db
      .update(integrationOutbox)
      .set({
        status: 'processing',
        updatedAt: now,
      })
      .where(
        and(
          eq(integrationOutbox.leadId, leadId),
          eq(integrationOutbox.destination, 'telegram'),
          eq(integrationOutbox.eventType, 'lead.created'),
          inArray(integrationOutbox.status, ['pending', 'retry']),
        ),
      )
      .returning({ id: integrationOutbox.id });

    return claimed.length > 0;
  }

  async completeLegacyTelegramDelivery(leadId: string) {
    const now = new Date();
    await this.db
      .update(integrationOutbox)
      .set({
        status: 'sent',
        processedAt: now,
        lastError: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(integrationOutbox.leadId, leadId),
          eq(integrationOutbox.destination, 'telegram'),
          eq(integrationOutbox.eventType, 'lead.created'),
          eq(integrationOutbox.status, 'processing'),
        ),
      );
  }

  async releaseLegacyTelegramDelivery(leadId: string) {
    const now = new Date();
    await this.db
      .update(integrationOutbox)
      .set({
        status: 'retry',
        nextAttemptAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(integrationOutbox.leadId, leadId),
          eq(integrationOutbox.destination, 'telegram'),
          eq(integrationOutbox.eventType, 'lead.created'),
          eq(integrationOutbox.status, 'processing'),
        ),
      );
  }

  async changeStatus(leadId: string, status: LeadStatus, options: ChangeStatusOptions) {
    if (options.externalEventId) {
      const [existingEvent] = await this.db
        .select({ leadId: leadEvents.leadId })
        .from(leadEvents)
        .where(
          and(
            eq(leadEvents.source, options.source),
            eq(leadEvents.externalEventId, options.externalEventId),
          ),
        )
        .limit(1);

      if (existingEvent) return this.getLead(existingEvent.leadId);
    }

    return this.db.transaction(async (transaction) => {
      const [current] = await transaction.select().from(leads).where(eq(leads.id, leadId)).limit(1);
      if (!current) throw new LeadNotFoundError();
      if (current.status === status) return current;

      const now = new Date();
      const statusTimes = getStatusTimestamps(status, current, now);
      const [updated] = await transaction
        .update(leads)
        .set({ status, updatedAt: now, ...statusTimes })
        .where(eq(leads.id, leadId))
        .returning();

      if (!updated) throw new LeadNotFoundError();

      const eventId = options.externalEventId || randomUUID();
      await transaction.insert(leadEvents).values({
        leadId,
        eventType: 'status_changed',
        source: options.source,
        externalEventId: options.externalEventId,
        payload: {
          from: current.status,
          to: status,
          actorId: options.actorId,
        },
      });

      await transaction
        .insert(integrationOutbox)
        .values({
          leadId,
          destination: 'telegram',
          eventType: 'lead.status_changed',
          payload: { status },
          idempotencyKey: `telegram:lead.status_changed:${leadId}:${eventId}`,
        })
        .onConflictDoNothing({ target: integrationOutbox.idempotencyKey });

      return updated;
    });
  }

  async getLead(leadId: string) {
    const [lead] = await this.db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
    if (!lead) throw new LeadNotFoundError();
    return lead;
  }

  async getTodaySummary() {
    return this.db
      .select({ status: leads.status, total: count() })
      .from(leads)
      .where(
        sql`${leads.createdAt} >= (date_trunc('day', now() at time zone 'Europe/Minsk') at time zone 'Europe/Minsk')`,
      )
      .groupBy(leads.status);
  }

  async getSlaBreaches(minutes = 5) {
    const threshold = new Date(Date.now() - minutes * 60_000);
    return this.db
      .select({
        id: leads.id,
        publicId: leads.publicId,
        phoneNormalized: leads.phoneNormalized,
        serviceType: leads.serviceType,
        createdAt: leads.createdAt,
      })
      .from(leads)
      .where(and(eq(leads.status, 'new'), lte(leads.createdAt, threshold)))
      .orderBy(leads.createdAt)
      .limit(20);
  }

  async getFunnel(days = 7) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1_000);
    return this.db
      .select({ status: leads.status, total: count() })
      .from(leads)
      .where(gte(leads.createdAt, since))
      .groupBy(leads.status);
  }

  private async createLead(body: WebLeadBody, options: CreateLeadOptions): Promise<CreateLeadResult> {
    const phoneNormalized = normalizeBelarusPhone(body.phone);
    const normalized = normalizeBody(body, phoneNormalized);
    const requestHash = hashPayload({ source: options.source, ...normalized });

    const duplicate = await this.findDuplicate(options, requestHash);
    if (duplicate) return duplicate;

    try {
      return await this.db.transaction(async (transaction) => {
        const id = randomUUID();
        const publicId = createPublicId(id);
        const [lead] = await transaction
          .insert(leads)
          .values({
            id,
            publicId,
            source: options.source,
            sourceDetail: options.sourceDetail,
            externalLeadId: options.externalLeadId,
            idempotencyKey: options.idempotencyKey,
            requestHash,
            status: 'new',
            ...normalized,
          })
          .returning();

        if (!lead) throw new Error('Lead insert did not return a row.');

        await transaction.insert(leadEvents).values({
          leadId: lead.id,
          eventType: 'lead_received',
          source: options.source,
          externalEventId: options.externalLeadId,
          payload: {
            sourceDetail: options.sourceDetail,
            hasPhotos: lead.photoRefs.length > 0,
            hasVin: Boolean(lead.vin),
          },
        });

        await transaction.insert(integrationOutbox).values({
          leadId: lead.id,
          destination: 'telegram',
          eventType: 'lead.created',
          payload: {},
          idempotencyKey: `telegram:lead.created:${lead.id}`,
        });

        return { lead, deduplicated: false };
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const racedDuplicate = await this.findDuplicate(options, requestHash);
      if (racedDuplicate) return racedDuplicate;
      throw error;
    }
  }

  private async findDuplicate(options: CreateLeadOptions, requestHash: string) {
    const [byIdempotency] = await this.db
      .select()
      .from(leads)
      .where(eq(leads.idempotencyKey, options.idempotencyKey))
      .limit(1);

    if (byIdempotency) {
      if (byIdempotency.requestHash !== requestHash) throw new IdempotencyConflictError();
      return { lead: byIdempotency, deduplicated: true };
    }

    if (!options.externalLeadId) return null;

    const [byExternalId] = await this.db
      .select()
      .from(leads)
      .where(
        and(
          eq(leads.source, options.source),
          eq(leads.externalLeadId, options.externalLeadId),
        ),
      )
      .limit(1);

    return byExternalId ? { lead: byExternalId, deduplicated: true } : null;
  }
}

function normalizeBody(body: WebLeadBody, phoneNormalized: string) {
  const preferredAt = parseOptionalDate(body.preferredAt, 'preferredAt');
  const consentAt = parseOptionalDate(body.consentAt, 'consentAt');
  const attribution = body.attribution;

  return {
    name: cleanText(body.name),
    phoneNormalized,
    emailNormalized: cleanText(body.email)?.toLowerCase(),
    carMake: cleanText(body.carMake),
    carModel: cleanText(body.carModel),
    carYear: body.carYear,
    vin: cleanText(body.vin)?.toUpperCase(),
    vehicleType: cleanText(body.vehicleType),
    serviceType: cleanText(body.serviceType),
    damageType: cleanText(body.damageType),
    sensors: cleanText(body.sensors),
    heating: cleanText(body.heating),
    adas: cleanText(body.adas),
    district: cleanText(body.district),
    visitType: cleanText(body.visitType),
    preferredAt,
    message: cleanText(body.message),
    photoRefs: body.photoRefs?.map((reference) => reference.trim()).filter(Boolean) || [],
    utmSource: cleanText(attribution?.utmSource),
    utmMedium: cleanText(attribution?.utmMedium),
    utmCampaign: cleanText(attribution?.utmCampaign),
    utmContent: cleanText(attribution?.utmContent),
    utmTerm: cleanText(attribution?.utmTerm),
    gclid: cleanText(attribution?.gclid),
    gbraid: cleanText(attribution?.gbraid),
    wbraid: cleanText(attribution?.wbraid),
    yclid: cleanText(attribution?.yclid),
    fbclid: cleanText(attribution?.fbclid),
    ymClientId: cleanText(attribution?.ymClientId),
    gaClientId: cleanText(attribution?.gaClientId),
    landingUrl: cleanText(attribution?.landingUrl),
    referrer: cleanText(attribution?.referrer),
    consentAt,
    privacyVersion: cleanText(body.privacyVersion),
  };
}

function parseOptionalDate(value: string | undefined, field: string) {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new LeadValidationError(`${field} must be an ISO date.`);
  return parsed;
}

function cleanText(value: string | undefined) {
  const cleaned = value?.trim();
  return cleaned || undefined;
}

function createPublicId(id: string) {
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  return `BSE-${date}-${id.slice(0, 8).toUpperCase()}`;
}

function getStatusTimestamps(status: LeadStatus, current: Lead, now: Date) {
  switch (status) {
    case 'contacted':
      return { firstResponseAt: current.firstResponseAt || now };
    case 'qualified':
      return { qualifiedAt: current.qualifiedAt || now };
    case 'booked':
      return { bookedAt: current.bookedAt || now };
    case 'arrived':
      return { arrivedAt: current.arrivedAt || now };
    case 'won':
      return { wonAt: current.wonAt || now };
    case 'lost':
      return { lostAt: current.lostAt || now };
    default:
      return {};
  }
}

function isUniqueViolation(error: unknown): error is { code: '23505' } {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === '23505');
}
