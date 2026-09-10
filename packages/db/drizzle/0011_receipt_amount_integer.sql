ALTER TABLE "receipts" ADD COLUMN "amount_yen" integer;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "amount_raw" text;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "billing_type" text DEFAULT 'company_expense' NOT NULL;--> statement-breakpoint
ALTER TABLE "receipts" DROP COLUMN "amount";--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_amount_yen_nonneg" CHECK ("receipts"."amount_yen" IS NULL OR "receipts"."amount_yen" >= 0);--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_billing_type_check" CHECK ("receipts"."billing_type" IN ('customer_billable', 'company_expense'));--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_billable_requires_customer" CHECK ("receipts"."billing_type" = 'company_expense' OR "receipts"."customer_id" IS NOT NULL);