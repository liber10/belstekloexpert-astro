CREATE TABLE "telegram_public_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "telegram_user_id" varchar(40) NOT NULL,
  "telegram_chat_id" varchar(40) NOT NULL,
  "telegram_username" varchar(64),
  "stage" varchar(32) DEFAULT 'service' NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "acquisition_code" varchar(64),
  "last_update_id" varchar(40),
  "submitted_lead_id" uuid,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "telegram_public_sessions_submitted_lead_id_leads_id_fk"
    FOREIGN KEY ("submitted_lead_id") REFERENCES "public"."leads"("id") ON DELETE set null
);
CREATE UNIQUE INDEX "telegram_public_sessions_chat_uq" ON "telegram_public_sessions" ("telegram_chat_id");
CREATE INDEX "telegram_public_sessions_expiry_idx" ON "telegram_public_sessions" ("stage", "expires_at");

CREATE TABLE "telegram_public_outbox" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid,
  "chat_id" varchar(40) NOT NULL,
  "payload" jsonb NOT NULL,
  "idempotency_key" varchar(255) NOT NULL,
  "status" varchar(32) DEFAULT 'pending' NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_error" text,
  "processed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "telegram_public_outbox_session_id_telegram_public_sessions_id_fk"
    FOREIGN KEY ("session_id") REFERENCES "public"."telegram_public_sessions"("id") ON DELETE cascade
);
CREATE UNIQUE INDEX "telegram_public_outbox_idempotency_uq" ON "telegram_public_outbox" ("idempotency_key");
CREATE INDEX "telegram_public_outbox_pending_idx" ON "telegram_public_outbox" ("status", "next_attempt_at", "created_at");
