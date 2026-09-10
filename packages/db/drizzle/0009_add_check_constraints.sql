ALTER TABLE "accident_reports" ADD CONSTRAINT "accident_reports_report_type_check" CHECK ("accident_reports"."report_type" IN ('事故報告', 'ヒヤリハット'));--> statement-breakpoint
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_risk_rating_check" CHECK ("daily_reports"."risk_rating" IS NULL OR "daily_reports"."risk_rating" BETWEEN 1 AND 5);--> statement-breakpoint
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_es_rating_check" CHECK ("daily_reports"."es_rating" IS NULL OR "daily_reports"."es_rating" BETWEEN 1 AND 5);--> statement-breakpoint
ALTER TABLE "outbox_jobs" ADD CONSTRAINT "outbox_jobs_status_check" CHECK ("outbox_jobs"."status" IN ('pending', 'processing', 'done', 'failed'));--> statement-breakpoint
ALTER TABLE "outbox_jobs" ADD CONSTRAINT "outbox_jobs_kind_check" CHECK ("outbox_jobs"."kind" IN ('attendance_day', 'attendance_aggregate', 'daily_report', 'accident_report', 'receipt'));--> statement-breakpoint
ALTER TABLE "outbox_jobs" ADD CONSTRAINT "outbox_jobs_attempts_check" CHECK ("outbox_jobs"."attempts" >= 0);--> statement-breakpoint
ALTER TABLE "password_reset_codes" ADD CONSTRAINT "password_reset_codes_failed_attempts_check" CHECK ("password_reset_codes"."failed_attempts" >= 0);--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_failed_login_attempts_check" CHECK ("staff"."failed_login_attempts" >= 0);--> statement-breakpoint
ALTER TABLE "tenant_keys" ADD CONSTRAINT "tenant_keys_version_check" CHECK ("tenant_keys"."dek_version" >= 1 AND "tenant_keys"."kek_version" >= 1);