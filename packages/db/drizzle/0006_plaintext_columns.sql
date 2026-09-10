ALTER TABLE "accident_reports" ADD COLUMN "target_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "accident_reports" ADD COLUMN "target_dob" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "accident_reports" ADD COLUMN "occurrence_time" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "accident_reports" ADD COLUMN "location" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "accident_reports" ADD COLUMN "accident_content" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "accident_reports" ADD COLUMN "situation" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "accident_reports" ADD COLUMN "immediate_response" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "accident_reports" ADD COLUMN "parent_correspondence" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "accident_reports" ADD COLUMN "diagnosis_treatment" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "accident_reports" ADD COLUMN "prevention" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "accident_reports" ADD COLUMN "input_text" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_days" ADD COLUMN "row_data" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "emergency_contact" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "emergency_contact_relation" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "evacuation_site" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "memo" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "benefit_member_id" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "lat_lng" text;--> statement-breakpoint
ALTER TABLE "daily_reports" ADD COLUMN "start_time" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_reports" ADD COLUMN "end_time" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_reports" ADD COLUMN "input_text" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_reports" ADD COLUMN "internal_text" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_reports" ADD COLUMN "customer_text" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "family_members" ADD COLUMN "name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "family_members" ADD COLUMN "dob" text;--> statement-breakpoint
ALTER TABLE "family_members" ADD COLUMN "info" text;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "dedupe_key" text;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "amount" text;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "store_name" text;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "handoff_text" text;--> statement-breakpoint
CREATE INDEX "receipts_tenant_dedupe_key_idx" ON "receipts" USING btree ("tenant_id","dedupe_key");