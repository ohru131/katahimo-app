-- 誕生月クーポン(顧客ごとの配布・使用上限)と、実費報告(領収書)の取り消し。
--
-- ベースライン(0000)以降の最初の差分マイグレーション。0000 は作り直さず固定し、
-- 以後はこのファイルのように積み増す(doc/09 第1.9節)。稼働中のDBに当てられる形にしておく
-- ため、既存行があっても通るように書いてある(NOT NULL 列は「追加 → 埋める → NOT NULL」の順)。
--
-- 【drizzle-kitが生成できず手で追記している部分】(このファイル末尾)
-- 0000 と同じく FORCE ROW LEVEL SECURITY と set_updated_at トリガーは生成されないため、
-- 新設した customer_coupons のぶんを手で足している。追記漏れは
-- packages/db/src/rlsPolicies.test.ts / updatedAtTriggers.test.ts が検出する。

CREATE TABLE "customer_coupons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"coupon_id" uuid NOT NULL,
	"valid_from" date,
	"valid_to" date,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_coupons_tenant_customer_coupon_uk" UNIQUE("tenant_id","customer_id","coupon_id"),
	CONSTRAINT "customer_coupons_valid_period_check" CHECK ("customer_coupons"."valid_to" IS NULL OR "customer_coupons"."valid_from" IS NULL OR "customer_coupons"."valid_to" >= "customer_coupons"."valid_from")
);
--> statement-breakpoint
ALTER TABLE "customer_coupons" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" DROP CONSTRAINT "coupon_redemptions_tenant_daily_report_fk";
--> statement-breakpoint
DROP INDEX "receipts_tenant_dedupe_key_uidx";--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD COLUMN "customer_id" uuid;--> statement-breakpoint
-- 既存の適用記録には顧客が入っていないので、紐付いている日報から埋めてからNOT NULLにする
-- (複合FK coupon_redemptions_tenant_report_customer_fk がこの一致を以後は物理的に保証する)。
UPDATE "coupon_redemptions" AS r
  SET "customer_id" = d."customer_id"
  FROM "daily_reports" AS d
  WHERE d."id" = r."daily_report_id" AND d."tenant_id" = r."tenant_id";--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ALTER COLUMN "customer_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD COLUMN "usage_limit_kind" text DEFAULT 'unlimited' NOT NULL;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD COLUMN "usage_scope_key" text;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD COLUMN "birthday_subject_name" text;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD COLUMN "birthday_subject_dob" date;--> statement-breakpoint
ALTER TABLE "coupons" ADD COLUMN "audience" text DEFAULT 'all' NOT NULL;--> statement-breakpoint
ALTER TABLE "coupons" ADD COLUMN "eligibility_kind" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "coupons" ADD COLUMN "birthday_subject" text;--> statement-breakpoint
ALTER TABLE "coupons" ADD COLUMN "usage_limit_kind" text DEFAULT 'unlimited' NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "dob_date" date;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "dob_raw" text;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "cancellation_reason" text;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "cancelled_by_staff_id" uuid;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "mirror_claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customer_coupons" ADD CONSTRAINT "customer_coupons_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_coupons" ADD CONSTRAINT "customer_coupons_tenant_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_coupons" ADD CONSTRAINT "customer_coupons_tenant_coupon_fk" FOREIGN KEY ("tenant_id","coupon_id") REFERENCES "public"."coupons"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- 複合FKの参照先には一致するUNIQUEが要る。drizzle-kitはこのUNIQUEをFKより後に出すため、
-- ここへ手で繰り上げている(順番のまま当てると「no unique constraint matching given keys」で落ちる)。
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_tenant_id_customer_uk" UNIQUE("tenant_id","id","customer_id");--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_tenant_report_customer_fk" FOREIGN KEY ("tenant_id","daily_report_id","customer_id") REFERENCES "public"."daily_reports"("tenant_id","id","customer_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_tenant_cancelled_by_fk" FOREIGN KEY ("tenant_id","cancelled_by_staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "coupon_redemptions_usage_scope_uidx" ON "coupon_redemptions" USING btree ("tenant_id","coupon_id","customer_id","usage_scope_key") WHERE "coupon_redemptions"."usage_scope_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "coupon_redemptions_tenant_customer_idx" ON "coupon_redemptions" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "outbox_jobs_tenant_kind_target_idx" ON "outbox_jobs" USING btree ("tenant_id","kind","target_id");--> statement-breakpoint
CREATE INDEX "receipts_tenant_staff_timestamp_idx" ON "receipts" USING btree ("tenant_id","staff_id","receipt_timestamp" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "receipts_tenant_dedupe_key_uidx" ON "receipts" USING btree ("tenant_id","dedupe_key") WHERE "receipts"."dedupe_key" IS NOT NULL AND "receipts"."cancelled_at" IS NULL;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_usage_limit_kind_check" CHECK ("coupon_redemptions"."usage_limit_kind" IN ('unlimited', 'once_per_customer', 'once_per_customer_per_year'));--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_usage_scope_key_check" CHECK (("coupon_redemptions"."usage_limit_kind" = 'unlimited' AND "coupon_redemptions"."usage_scope_key" IS NULL)
        OR ("coupon_redemptions"."usage_limit_kind" <> 'unlimited' AND "coupon_redemptions"."usage_scope_key" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_audience_check" CHECK ("coupons"."audience" IN ('all', 'assigned'));--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_eligibility_kind_check" CHECK ("coupons"."eligibility_kind" IN ('manual', 'birthday_month'));--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_usage_limit_kind_check" CHECK ("coupons"."usage_limit_kind" IN ('unlimited', 'once_per_customer', 'once_per_customer_per_year'));--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_birthday_subject_check" CHECK (("coupons"."eligibility_kind" = 'birthday_month' AND "coupons"."birthday_subject" IS NOT NULL
           AND "coupons"."birthday_subject" IN ('customer', 'family_member', 'any'))
        OR ("coupons"."eligibility_kind" <> 'birthday_month' AND "coupons"."birthday_subject" IS NULL));--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_cancellation_pair_check" CHECK (("receipts"."cancelled_at" IS NULL AND "receipts"."cancelled_by_staff_id" IS NULL AND "receipts"."cancellation_reason" IS NULL)
        OR ("receipts"."cancelled_at" IS NOT NULL AND "receipts"."cancelled_by_staff_id" IS NOT NULL));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "customer_coupons" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint
-- ▼ ここから下は drizzle-kit が生成しない。手で追記している(ファイル冒頭のコメント参照)。
ALTER TABLE "customer_coupons" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TRIGGER "customer_coupons_set_updated_at" BEFORE UPDATE ON "customer_coupons"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
