DROP INDEX "outbox_jobs_tenant_status_created_at_idx";--> statement-breakpoint
ALTER TABLE "outbox_jobs" ADD COLUMN "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "outbox_jobs" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "outbox_jobs_tenant_status_next_attempt_idx" ON "outbox_jobs" USING btree ("tenant_id","status","next_attempt_at","created_at");