CREATE TABLE IF NOT EXISTS "form_submission_audits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"correlation_id" varchar(160) NOT NULL,
	"event" varchar(80) NOT NULL,
	"reason" varchar(80),
	"form_type" varchar(160) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "form_submission_audits_correlation_created_idx"
	ON "form_submission_audits" USING btree ("correlation_id", "created_at");
