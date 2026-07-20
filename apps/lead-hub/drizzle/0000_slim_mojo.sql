CREATE TABLE "integration_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"destination" varchar(80) NOT NULL,
	"event_type" varchar(80) NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"event_type" varchar(80) NOT NULL,
	"source" varchar(80) NOT NULL,
	"external_event_id" varchar(255),
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_id" varchar(40) NOT NULL,
	"source" varchar(40) NOT NULL,
	"source_detail" varchar(160),
	"external_lead_id" varchar(255),
	"idempotency_key" varchar(160) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"status" varchar(32) DEFAULT 'new' NOT NULL,
	"name" varchar(120),
	"phone_normalized" varchar(20) NOT NULL,
	"email_normalized" varchar(254),
	"car_make" varchar(100),
	"car_model" varchar(160),
	"car_year" integer,
	"vin" varchar(17),
	"vehicle_type" varchar(80),
	"service_type" varchar(120),
	"damage_type" varchar(120),
	"sensors" text,
	"heating" text,
	"adas" text,
	"district" varchar(120),
	"visit_type" varchar(80),
	"preferred_at" timestamp with time zone,
	"message" text,
	"photo_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"utm_source" varchar(255),
	"utm_medium" varchar(255),
	"utm_campaign" varchar(255),
	"utm_content" varchar(255),
	"utm_term" varchar(255),
	"gclid" varchar(255),
	"gbraid" varchar(255),
	"wbraid" varchar(255),
	"yclid" varchar(255),
	"fbclid" varchar(255),
	"ym_client_id" varchar(255),
	"ga_client_id" varchar(255),
	"landing_url" text,
	"referrer" text,
	"consent_at" timestamp with time zone,
	"privacy_version" varchar(80),
	"assigned_to" varchar(120),
	"first_response_at" timestamp with time zone,
	"qualified_at" timestamp with time zone,
	"booked_at" timestamp with time zone,
	"arrived_at" timestamp with time zone,
	"won_at" timestamp with time zone,
	"lost_at" timestamp with time zone,
	"quote_amount" numeric(12, 2),
	"revenue" numeric(12, 2),
	"cost" numeric(12, 2),
	"gross_profit" numeric(12, 2),
	"lost_reason" varchar(160),
	"telegram_chat_id" varchar(40),
	"telegram_message_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "integration_outbox" ADD CONSTRAINT "integration_outbox_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_outbox_idempotency_key_uq" ON "integration_outbox" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "integration_outbox_pending_idx" ON "integration_outbox" USING btree ("status","next_attempt_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_events_source_external_id_uq" ON "lead_events" USING btree ("source","external_event_id") WHERE "lead_events"."external_event_id" is not null;--> statement-breakpoint
CREATE INDEX "lead_events_lead_created_idx" ON "lead_events" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "leads_public_id_uq" ON "leads" USING btree ("public_id");--> statement-breakpoint
CREATE UNIQUE INDEX "leads_idempotency_key_uq" ON "leads" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "leads_source_external_id_uq" ON "leads" USING btree ("source","external_lead_id") WHERE "leads"."external_lead_id" is not null;--> statement-breakpoint
CREATE INDEX "leads_status_created_idx" ON "leads" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "leads_phone_created_idx" ON "leads" USING btree ("phone_normalized","created_at");