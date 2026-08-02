ALTER TABLE "leads" ALTER COLUMN "phone_normalized" DROP NOT NULL;
ALTER TABLE "leads" ADD COLUMN "source_action_url" text;
ALTER TABLE "leads" ADD COLUMN "source_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE "leads" ADD COLUMN "acquisition_code" varchar(160);

CREATE INDEX "leads_source_acquisition_created_idx"
  ON "leads" USING btree ("source", "acquisition_code", "created_at");

CREATE TABLE "integration_inbox" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source" varchar(80) NOT NULL,
  "event_type" varchar(80) NOT NULL,
  "external_event_id" varchar(255) NOT NULL,
  "payload" jsonb NOT NULL,
  "status" varchar(32) DEFAULT 'pending' NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_error" text,
  "processed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX "integration_inbox_source_external_event_uq"
  ON "integration_inbox" USING btree ("source", "external_event_id");
CREATE INDEX "integration_inbox_pending_idx"
  ON "integration_inbox" USING btree ("status", "next_attempt_at", "created_at");
