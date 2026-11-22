ALTER TABLE "leads" ADD COLUMN "final_amount" numeric(12,2);
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "paid_at" timestamp with time zone;
--> statement-breakpoint
CREATE TABLE "telegram_public_activity" (
  "update_id" varchar(40) PRIMARY KEY,
  "kind" varchar(24) NOT NULL,
  "acquisition_code" varchar(64),
  "created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "telegram_public_activity_created_idx" ON "telegram_public_activity" ("created_at");
--> statement-breakpoint
CREATE TABLE "telegram_public_subscriptions" (
  "lead_id" uuid PRIMARY KEY REFERENCES "leads" ("id") ON DELETE CASCADE,
  "chat_id" varchar(40) NOT NULL,
  "opted_in_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "telegram_public_subscriptions_chat_idx" ON "telegram_public_subscriptions" ("chat_id");
--> statement-breakpoint
ALTER TABLE "telegram_public_outbox" ADD COLUMN "subscription_lead_id" uuid REFERENCES "leads" ("id") ON DELETE CASCADE;
