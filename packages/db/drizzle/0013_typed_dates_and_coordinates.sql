ALTER TABLE "accident_reports" ADD COLUMN "target_dob_date" date;--> statement-breakpoint
ALTER TABLE "accident_reports" ADD COLUMN "target_dob_raw" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "lat" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "lng" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "lat_lng_raw" text;--> statement-breakpoint
ALTER TABLE "daily_reports" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "daily_reports" ADD COLUMN "ended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "family_members" ADD COLUMN "dob_date" date;--> statement-breakpoint
ALTER TABLE "family_members" ADD COLUMN "dob_raw" text;--> statement-breakpoint
ALTER TABLE "accident_reports" DROP COLUMN "target_dob";--> statement-breakpoint
ALTER TABLE "customers" DROP COLUMN "lat_lng";--> statement-breakpoint
ALTER TABLE "daily_reports" DROP COLUMN "start_time";--> statement-breakpoint
ALTER TABLE "daily_reports" DROP COLUMN "end_time";--> statement-breakpoint
ALTER TABLE "family_members" DROP COLUMN "dob";--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_lat_range" CHECK ("customers"."lat" IS NULL OR "customers"."lat" BETWEEN -90 AND 90);--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_lng_range" CHECK ("customers"."lng" IS NULL OR "customers"."lng" BETWEEN -180 AND 180);--> statement-breakpoint
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_time_order" CHECK ("daily_reports"."ended_at" IS NULL OR "daily_reports"."started_at" IS NULL OR "daily_reports"."ended_at" >= "daily_reports"."started_at");