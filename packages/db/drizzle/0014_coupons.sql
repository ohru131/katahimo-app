CREATE TABLE "coupon_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"daily_report_id" uuid NOT NULL,
	"coupon_id" uuid NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"discount_kind" text NOT NULL,
	"discount_amount_yen" integer,
	"discount_percent" integer,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupon_redemptions_report_coupon_uidx" UNIQUE("tenant_id","daily_report_id","coupon_id"),
	CONSTRAINT "coupon_redemptions_discount_kind_check" CHECK ("coupon_redemptions"."discount_kind" IN ('amount', 'percent')),
	CONSTRAINT "coupon_redemptions_discount_value_check" CHECK (("coupon_redemptions"."discount_kind" = 'amount'  AND "coupon_redemptions"."discount_amount_yen" IS NOT NULL AND "coupon_redemptions"."discount_percent" IS NULL)
        OR ("coupon_redemptions"."discount_kind" = 'percent' AND "coupon_redemptions"."discount_percent" IS NOT NULL AND "coupon_redemptions"."discount_amount_yen" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- drizzle-kitはENABLEしか出力しないため手で追加(0001_password_reset_and_initial_passwordの
-- 冒頭コメント参照)。FORCEが無いとテーブル所有者ロールで繋いだときにRLSが効かない。
ALTER TABLE "coupon_redemptions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "coupons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"discount_kind" text NOT NULL,
	"discount_amount_yen" integer,
	"discount_percent" integer,
	"valid_from" date,
	"valid_to" date,
	"active" boolean DEFAULT true NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupons_tenant_code_uidx" UNIQUE("tenant_id","code"),
	CONSTRAINT "coupons_tenant_id_uk" UNIQUE("tenant_id","id"),
	CONSTRAINT "coupons_discount_kind_check" CHECK ("coupons"."discount_kind" IN ('amount', 'percent')),
	CONSTRAINT "coupons_discount_value_check" CHECK (("coupons"."discount_kind" = 'amount'  AND "coupons"."discount_amount_yen" IS NOT NULL AND "coupons"."discount_percent" IS NULL)
        OR ("coupons"."discount_kind" = 'percent' AND "coupons"."discount_percent" IS NOT NULL AND "coupons"."discount_amount_yen" IS NULL)),
	CONSTRAINT "coupons_discount_amount_yen_check" CHECK ("coupons"."discount_amount_yen" IS NULL OR "coupons"."discount_amount_yen" >= 0),
	CONSTRAINT "coupons_discount_percent_check" CHECK ("coupons"."discount_percent" IS NULL OR "coupons"."discount_percent" BETWEEN 1 AND 100),
	CONSTRAINT "coupons_valid_period_check" CHECK ("coupons"."valid_to" IS NULL OR "coupons"."valid_from" IS NULL OR "coupons"."valid_to" >= "coupons"."valid_from")
);
--> statement-breakpoint
ALTER TABLE "coupons" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "coupons" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- coupon_redemptions_tenant_daily_report_fk(次の文)がこのUNIQUE制約を参照するため、
-- FKより先に当てる必要がある(生成順のままだと「there is no unique constraint matching
-- given keys for referenced table "daily_reports"」で失敗する)。
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_tenant_id_uk" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_tenant_daily_report_fk" FOREIGN KEY ("tenant_id","daily_report_id") REFERENCES "public"."daily_reports"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_tenant_coupon_fk" FOREIGN KEY ("tenant_id","coupon_id") REFERENCES "public"."coupons"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "coupon_redemptions_tenant_coupon_idx" ON "coupon_redemptions" USING btree ("tenant_id","coupon_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "coupon_redemptions" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "coupons" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
-- 0010_updated_at_triggerで作った set_updated_at() を、updated_at列を持つこの2テーブルにも
-- 張る(updatedAtTriggers.test.tsの静的検査対象。drizzleのスキーマ定義ではトリガーを
-- 表現できないため手で書く)。
CREATE TRIGGER "coupons_set_updated_at" BEFORE UPDATE ON "coupons"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "coupon_redemptions_set_updated_at" BEFORE UPDATE ON "coupon_redemptions"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();