import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const leads = pgTable(
  'leads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    publicId: varchar('public_id', { length: 40 }).notNull(),
    source: varchar('source', { length: 40 }).notNull(),
    sourceDetail: varchar('source_detail', { length: 160 }),
    externalLeadId: varchar('external_lead_id', { length: 255 }),
    idempotencyKey: varchar('idempotency_key', { length: 160 }).notNull(),
    requestHash: varchar('request_hash', { length: 64 }).notNull(),
    status: varchar('status', { length: 32 }).notNull().default('new'),
    name: varchar('name', { length: 120 }),
    phoneNormalized: varchar('phone_normalized', { length: 20 }),
    emailNormalized: varchar('email_normalized', { length: 254 }),
    carMake: varchar('car_make', { length: 100 }),
    carModel: varchar('car_model', { length: 160 }),
    carYear: integer('car_year'),
    vin: varchar('vin', { length: 17 }),
    vehicleType: varchar('vehicle_type', { length: 80 }),
    serviceType: varchar('service_type', { length: 120 }),
    damageType: varchar('damage_type', { length: 120 }),
    sensors: text('sensors'),
    heating: text('heating'),
    adas: text('adas'),
    district: varchar('district', { length: 120 }),
    visitType: varchar('visit_type', { length: 80 }),
    preferredAt: timestamp('preferred_at', { withTimezone: true, mode: 'date' }),
    message: text('message'),
    sourceActionUrl: text('source_action_url'),
    sourceMetadata: jsonb('source_metadata').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    acquisitionCode: varchar('acquisition_code', { length: 160 }),
    photoRefs: jsonb('photo_refs').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    utmSource: varchar('utm_source', { length: 255 }),
    utmMedium: varchar('utm_medium', { length: 255 }),
    utmCampaign: varchar('utm_campaign', { length: 255 }),
    utmContent: varchar('utm_content', { length: 255 }),
    utmTerm: varchar('utm_term', { length: 255 }),
    gclid: varchar('gclid', { length: 255 }),
    gbraid: varchar('gbraid', { length: 255 }),
    wbraid: varchar('wbraid', { length: 255 }),
    yclid: varchar('yclid', { length: 255 }),
    fbclid: varchar('fbclid', { length: 255 }),
    ymClientId: varchar('ym_client_id', { length: 255 }),
    gaClientId: varchar('ga_client_id', { length: 255 }),
    landingUrl: text('landing_url'),
    referrer: text('referrer'),
    consentAt: timestamp('consent_at', { withTimezone: true, mode: 'date' }),
    privacyVersion: varchar('privacy_version', { length: 80 }),
    assignedTo: varchar('assigned_to', { length: 120 }),
    firstResponseAt: timestamp('first_response_at', { withTimezone: true, mode: 'date' }),
    qualifiedAt: timestamp('qualified_at', { withTimezone: true, mode: 'date' }),
    bookedAt: timestamp('booked_at', { withTimezone: true, mode: 'date' }),
    arrivedAt: timestamp('arrived_at', { withTimezone: true, mode: 'date' }),
    wonAt: timestamp('won_at', { withTimezone: true, mode: 'date' }),
    lostAt: timestamp('lost_at', { withTimezone: true, mode: 'date' }),
    quoteAmount: numeric('quote_amount', { precision: 12, scale: 2 }),
    revenue: numeric('revenue', { precision: 12, scale: 2 }),
    cost: numeric('cost', { precision: 12, scale: 2 }),
    grossProfit: numeric('gross_profit', { precision: 12, scale: 2 }),
    lostReason: varchar('lost_reason', { length: 160 }),
    telegramChatId: varchar('telegram_chat_id', { length: 40 }),
    telegramMessageId: integer('telegram_message_id'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('leads_public_id_uq').on(table.publicId),
    uniqueIndex('leads_idempotency_key_uq').on(table.idempotencyKey),
    uniqueIndex('leads_source_external_id_uq')
      .on(table.source, table.externalLeadId)
      .where(sql`${table.externalLeadId} is not null`),
    index('leads_status_created_idx').on(table.status, table.createdAt),
    index('leads_phone_created_idx').on(table.phoneNormalized, table.createdAt),
    index('leads_source_acquisition_created_idx').on(
      table.source,
      table.acquisitionCode,
      table.createdAt,
    ),
  ],
);

export const leadEvents = pgTable(
  'lead_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    eventType: varchar('event_type', { length: 80 }).notNull(),
    source: varchar('source', { length: 80 }).notNull(),
    externalEventId: varchar('external_event_id', { length: 255 }),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('lead_events_source_external_id_uq')
      .on(table.source, table.externalEventId)
      .where(sql`${table.externalEventId} is not null`),
    index('lead_events_lead_created_idx').on(table.leadId, table.createdAt),
  ],
);

export const integrationOutbox = pgTable(
  'integration_outbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    destination: varchar('destination', { length: 80 }).notNull(),
    eventType: varchar('event_type', { length: 80 }).notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    idempotencyKey: varchar('idempotency_key', { length: 255 }).notNull(),
    status: varchar('status', { length: 32 }).notNull().default('pending'),
    attemptCount: integer('attempt_count').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    lastError: text('last_error'),
    processedAt: timestamp('processed_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('integration_outbox_idempotency_key_uq').on(table.idempotencyKey),
    index('integration_outbox_pending_idx').on(table.status, table.nextAttemptAt, table.createdAt),
  ],
);

export const integrationInbox = pgTable(
  'integration_inbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    source: varchar('source', { length: 80 }).notNull(),
    eventType: varchar('event_type', { length: 80 }).notNull(),
    externalEventId: varchar('external_event_id', { length: 255 }).notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: varchar('status', { length: 32 }).notNull().default('pending'),
    attemptCount: integer('attempt_count').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    lastError: text('last_error'),
    processedAt: timestamp('processed_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('integration_inbox_source_external_event_uq').on(
      table.source,
      table.externalEventId,
    ),
    index('integration_inbox_pending_idx').on(
      table.status,
      table.nextAttemptAt,
      table.createdAt,
    ),
  ],
);

export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
export type LeadEvent = typeof leadEvents.$inferSelect;
export type OutboxJob = typeof integrationOutbox.$inferSelect;
export type InboxEvent = typeof integrationInbox.$inferSelect;
