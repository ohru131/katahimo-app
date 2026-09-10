-- katahimo-app の初期スキーマ(唯一のマイグレーション)。
--
-- 【1本にまとめてある理由】
-- 本アプリはまだ実運用前で、過去のデータベースとの互換性・既存データの引き継ぎが不要に
-- なった(2026-09の方針決定)。以前は 0000〜0015 の16本を順に当てる形で、途中に
-- 「暗号化列を平文列に置き換える」「領収書の金額textを整数列に分ける」「勤怠row_dataの
-- キーを列記号から意味のある名前に変える」といった破壊的変更と、そのためのバックフィル用
-- plpgsql関数が含まれていた。移行対象のデータが存在しない以上、それらは
-- 「読む人が最終形を把握するのを妨げるだけの履歴」でしかないため、最終形のDDLだけを
-- 残した1本に置き換えた。
--
-- 【この先スキーマを変えるとき】
-- このファイルを手で書き換えてはいけない。`pnpm db:generate` を実行して 0001_*.sql を
-- 追加する(drizzle-kitは meta/0000_snapshot.json との差分で次のマイグレーションを作る)。
-- ただし下記の「drizzle-kitが生成できない部分」は、生成後に手で追記する必要がある。
--
-- 【drizzle-kitが生成できず手で追記している部分】(このファイル末尾)
-- 1. ALTER TABLE ... FORCE ROW LEVEL SECURITY
--    drizzle-kit は ENABLE までしか出さない。FORCE が無いとテーブル所有者ロール
--    (=本番のマイグレーション実行ユーザ、かつアプリの接続ユーザ)でRLSが素通りし、
--    テナント分離が丸ごと無効になる。追記漏れは packages/db/src/rlsPolicies.test.ts が検出する。
-- 2. set_updated_at() 関数と BEFORE UPDATE トリガー
--    drizzleのスキーマ定義ではトリガーを表現できない。追記漏れは
--    packages/db/src/updatedAtTriggers.test.ts が検出する。
--
-- 【注意1】CREATE FUNCTION の本体($$ 〜 $$)の内側に `--> statement-breakpoint` を
-- 入れてはいけない。本番のマイグレータ(drizzle-orm/postgres-js/migrator)はこの目印で
-- SQLを単純に文字列分割するため、関数定義が途中で切断されて壊れる。
--
-- 【注意2】CHECK制約に定数を入れるときは、schema/_sqlLiteral.ts の sqlNumber()/sqlInList()
-- を通すこと。drizzleの sql テンプレートにJavaScriptの値を直接埋めるとバインドパラメータ
-- ($1)になり、DDLとしては適用できない(「there is no parameter $1」で落ちる)。

CREATE TABLE "accident_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"report_type" text NOT NULL,
	"target_name" text DEFAULT '' NOT NULL,
	"target_dob_date" date,
	"target_dob_raw" text DEFAULT '' NOT NULL,
	"occurrence_time" text DEFAULT '' NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"accident_content" text DEFAULT '' NOT NULL,
	"situation" text DEFAULT '' NOT NULL,
	"immediate_response" text DEFAULT '' NOT NULL,
	"parent_correspondence" text DEFAULT '' NOT NULL,
	"diagnosis_treatment" text DEFAULT '' NOT NULL,
	"prevention" text DEFAULT '' NOT NULL,
	"input_text" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accident_reports_report_type_check" CHECK ("accident_reports"."report_type" IN ('事故報告', 'ヒヤリハット'))
);
--> statement-breakpoint
ALTER TABLE "accident_reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"gemini_api_key_ciphertext" text,
	"gemini_api_key_key_version" integer,
	"gemini_report_model" text,
	"gemini_ocr_model" text,
	"gchat_report_webhook_url_ciphertext" text,
	"gchat_report_webhook_url_key_version" integer,
	"gchat_receipt_webhook_url_ciphertext" text,
	"gchat_receipt_webhook_url_key_version" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "attendance_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"row_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_days_row_data_object" CHECK (jsonb_typeof("attendance_days"."row_data") = 'object')
);
--> statement-breakpoint
ALTER TABLE "attendance_days" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "customer_payment_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"default_payment_method_id" text,
	"default_payment_method_brand" text,
	"default_payment_method_last4" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_payment_profiles_tenant_customer_uk" UNIQUE("tenant_id","customer_id"),
	CONSTRAINT "customer_payment_profiles_tenant_stripe_customer_uk" UNIQUE("tenant_id","stripe_customer_id"),
	CONSTRAINT "customer_payment_profiles_last4_check" CHECK ("customer_payment_profiles"."default_payment_method_last4" IS NULL OR "customer_payment_profiles"."default_payment_method_last4" ~ '^[0-9]{4}$')
);
--> statement-breakpoint
ALTER TABLE "customer_payment_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"kind" text NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(10, 2) DEFAULT '1' NOT NULL,
	"unit_price_yen" integer,
	"amount_yen" integer NOT NULL,
	"daily_report_id" uuid,
	"receipt_id" uuid,
	"coupon_redemption_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_lines_invoice_line_no_uk" UNIQUE("tenant_id","invoice_id","line_no"),
	CONSTRAINT "invoice_lines_kind_check" CHECK ("invoice_lines"."kind" IN ('service', 'receipt_billable', 'transport_allowance', 'coupon_discount', 'adjustment')),
	CONSTRAINT "invoice_lines_line_no_check" CHECK ("invoice_lines"."line_no" >= 1),
	CONSTRAINT "invoice_lines_quantity_check" CHECK ("invoice_lines"."quantity" > 0),
	CONSTRAINT "invoice_lines_unit_price_check" CHECK ("invoice_lines"."unit_price_yen" IS NULL OR "invoice_lines"."unit_price_yen" >= 0),
	CONSTRAINT "invoice_lines_amount_sign_check" CHECK (("invoice_lines"."kind" = 'coupon_discount' AND "invoice_lines"."amount_yen" <= 0)
        OR ("invoice_lines"."kind" = 'adjustment')
        OR ("invoice_lines"."kind" NOT IN ('coupon_discount', 'adjustment') AND "invoice_lines"."amount_yen" >= 0)),
	CONSTRAINT "invoice_lines_source_check" CHECK (("invoice_lines"."kind" = 'receipt_billable' AND "invoice_lines"."receipt_id" IS NOT NULL)
        OR ("invoice_lines"."kind" = 'coupon_discount' AND "invoice_lines"."coupon_redemption_id" IS NOT NULL)
        OR "invoice_lines"."kind" NOT IN ('receipt_billable', 'coupon_discount'))
);
--> statement-breakpoint
ALTER TABLE "invoice_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"invoice_no" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"billing_period_start" date NOT NULL,
	"billing_period_end" date NOT NULL,
	"subtotal_yen" integer DEFAULT 0 NOT NULL,
	"discount_yen" integer DEFAULT 0 NOT NULL,
	"tax_yen" integer DEFAULT 0 NOT NULL,
	"total_yen" integer DEFAULT 0 NOT NULL,
	"due_date" date,
	"issued_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"stripe_invoice_id" text,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_tenant_invoice_no_uk" UNIQUE("tenant_id","invoice_no"),
	CONSTRAINT "invoices_tenant_id_uk" UNIQUE("tenant_id","id"),
	CONSTRAINT "invoices_status_check" CHECK ("invoices"."status" IN ('draft', 'open', 'paid', 'void', 'uncollectible')),
	CONSTRAINT "invoices_period_order_check" CHECK ("invoices"."billing_period_end" >= "invoices"."billing_period_start"),
	CONSTRAINT "invoices_amount_nonneg_check" CHECK ("invoices"."subtotal_yen" >= 0 AND "invoices"."discount_yen" >= 0 AND "invoices"."tax_yen" >= 0 AND "invoices"."total_yen" >= 0),
	CONSTRAINT "invoices_total_consistency_check" CHECK ("invoices"."total_yen" = "invoices"."subtotal_yen" - "invoices"."discount_yen" + "invoices"."tax_yen"),
	CONSTRAINT "invoices_issued_at_check" CHECK (("invoices"."status" = 'draft') = ("invoices"."issued_at" IS NULL)),
	CONSTRAINT "invoices_paid_at_check" CHECK (("invoices"."status" = 'paid') = ("invoices"."paid_at" IS NOT NULL)),
	CONSTRAINT "invoices_voided_at_check" CHECK (("invoices"."status" = 'void') = ("invoices"."voided_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"invoice_id" uuid,
	"status" text NOT NULL,
	"method_kind" text NOT NULL,
	"currency" text DEFAULT 'jpy' NOT NULL,
	"amount_yen" integer NOT NULL,
	"refunded_amount_yen" integer DEFAULT 0 NOT NULL,
	"stripe_payment_intent_id" text,
	"stripe_charge_id" text,
	"failure_code" text,
	"failure_message" text,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_status_check" CHECK ("payments"."status" IN ('requires_payment_method', 'requires_action', 'processing', 'succeeded', 'canceled', 'failed')),
	CONSTRAINT "payments_method_kind_check" CHECK ("payments"."method_kind" IN ('card', 'konbini', 'bank_transfer', 'onsite_cash')),
	CONSTRAINT "payments_currency_check" CHECK ("payments"."currency" IN ('jpy')),
	CONSTRAINT "payments_amount_check" CHECK ("payments"."amount_yen" > 0),
	CONSTRAINT "payments_refunded_amount_check" CHECK ("payments"."refunded_amount_yen" >= 0 AND "payments"."refunded_amount_yen" <= "payments"."amount_yen"),
	CONSTRAINT "payments_paid_at_check" CHECK (("payments"."status" = 'succeeded') = ("payments"."paid_at" IS NOT NULL)),
	CONSTRAINT "payments_stripe_id_presence_check" CHECK (("payments"."method_kind" = 'onsite_cash' AND "payments"."stripe_payment_intent_id" IS NULL)
        OR ("payments"."method_kind" <> 'onsite_cash' AND "payments"."stripe_payment_intent_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "stripe_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"stripe_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"api_version" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"processing_error" text,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stripe_webhook_events_tenant_event_uk" UNIQUE("tenant_id","stripe_event_id"),
	CONSTRAINT "stripe_webhook_events_payload_object_check" CHECK (jsonb_typeof("stripe_webhook_events"."payload") = 'object')
);
--> statement-breakpoint
ALTER TABLE "stripe_webhook_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
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
	CONSTRAINT "coupon_redemptions_tenant_id_uk" UNIQUE("tenant_id","id"),
	CONSTRAINT "coupon_redemptions_discount_kind_check" CHECK ("coupon_redemptions"."discount_kind" IN ('amount', 'percent')),
	CONSTRAINT "coupon_redemptions_discount_value_check" CHECK (("coupon_redemptions"."discount_kind" = 'amount'  AND "coupon_redemptions"."discount_amount_yen" IS NOT NULL AND "coupon_redemptions"."discount_percent" IS NULL)
        OR ("coupon_redemptions"."discount_kind" = 'percent' AND "coupon_redemptions"."discount_percent" IS NOT NULL AND "coupon_redemptions"."discount_amount_yen" IS NULL)),
	CONSTRAINT "coupon_redemptions_discount_amount_yen_check" CHECK ("coupon_redemptions"."discount_amount_yen" IS NULL OR "coupon_redemptions"."discount_amount_yen" >= 0),
	CONSTRAINT "coupon_redemptions_discount_percent_check" CHECK ("coupon_redemptions"."discount_percent" IS NULL OR "coupon_redemptions"."discount_percent" BETWEEN 1 AND 100)
);
--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
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
CREATE TABLE "customer_note_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"note_id" uuid NOT NULL,
	"uploaded_by_staff_id" uuid NOT NULL,
	"file_key" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"caption" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"captured_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_note_photos_sort_order_check" CHECK ("customer_note_photos"."sort_order" >= 0),
	CONSTRAINT "customer_note_photos_byte_size_check" CHECK ("customer_note_photos"."byte_size" > 0 AND "customer_note_photos"."byte_size" <= 10485760)
);
--> statement-breakpoint
ALTER TABLE "customer_note_photos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "customer_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"author_staff_id" uuid NOT NULL,
	"category" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by_staff_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_notes_tenant_id_uk" UNIQUE("tenant_id","id"),
	CONSTRAINT "customer_notes_category_check" CHECK ("customer_notes"."category" IN ('chart', 'handover', 'key_location', 'garage', 'carry_over', 'caution', 'other')),
	CONSTRAINT "customer_notes_resolved_pair_check" CHECK (("customer_notes"."resolved_at" IS NULL AND "customer_notes"."resolved_by_staff_id" IS NULL)
        OR ("customer_notes"."resolved_at" IS NOT NULL AND "customer_notes"."resolved_by_staff_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "customer_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"external_source" text,
	"external_id" text,
	"name" text NOT NULL,
	"family_name" text NOT NULL,
	"given_name" text NOT NULL,
	"family_name_kana" text,
	"given_name_kana" text,
	"email" text,
	"phone" text,
	"address_detail" text,
	"city" text,
	"parking_area" text,
	"parking_detail" text,
	"emergency_contact" text,
	"emergency_contact_relation" text,
	"evacuation_site" text,
	"memo" text,
	"benefit_member_id" text,
	"address2" text,
	"address2_start_date" date,
	"address2_end_date" date,
	"lat" numeric(9, 6),
	"lng" numeric(9, 6),
	"lat_lng_raw" text,
	"member_type" text,
	"member_status" text,
	"payment_method" text,
	"payment_status" text,
	"gender" text,
	"age_bracket" text,
	"registered_at" timestamp with time zone,
	"external_last_updated_at" timestamp with time zone,
	"deactivated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_tenant_id_uk" UNIQUE("tenant_id","id"),
	CONSTRAINT "customers_lat_range" CHECK ("customers"."lat" IS NULL OR "customers"."lat" BETWEEN -90 AND 90),
	CONSTRAINT "customers_lng_range" CHECK ("customers"."lng" IS NULL OR "customers"."lng" BETWEEN -180 AND 180)
);
--> statement-breakpoint
ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "daily_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"reservation_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"risk_rating" integer,
	"es_rating" integer,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"input_text" text DEFAULT '' NOT NULL,
	"internal_text" text DEFAULT '' NOT NULL,
	"customer_text" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_reports_tenant_id_uk" UNIQUE("tenant_id","id"),
	CONSTRAINT "daily_reports_risk_rating_check" CHECK ("daily_reports"."risk_rating" IS NULL OR "daily_reports"."risk_rating" BETWEEN 1 AND 5),
	CONSTRAINT "daily_reports_es_rating_check" CHECK ("daily_reports"."es_rating" IS NULL OR "daily_reports"."es_rating" BETWEEN 1 AND 5),
	CONSTRAINT "daily_reports_time_order" CHECK ("daily_reports"."ended_at" IS NULL OR "daily_reports"."started_at" IS NULL OR "daily_reports"."ended_at" >= "daily_reports"."started_at")
);
--> statement-breakpoint
ALTER TABLE "daily_reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "family_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"dob_date" date,
	"dob_raw" text,
	"info" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "family_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "customer_traits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"definition_id" uuid NOT NULL,
	"value_bool" boolean,
	"value_int" integer,
	"value_text" text,
	"note" text DEFAULT '' NOT NULL,
	"recorded_by_staff_id" uuid,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_traits_customer_definition_uk" UNIQUE("tenant_id","customer_id","definition_id"),
	CONSTRAINT "customer_traits_exactly_one_value_check" CHECK ((CASE WHEN "customer_traits"."value_bool" IS NULL THEN 0 ELSE 1 END)
    + (CASE WHEN "customer_traits"."value_int" IS NULL THEN 0 ELSE 1 END)
    + (CASE WHEN "customer_traits"."value_text" IS NULL THEN 0 ELSE 1 END) = 1)
);
--> statement-breakpoint
ALTER TABLE "customer_traits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "staff_customer_compatibilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"score" integer,
	"avoid" boolean DEFAULT false NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"rated_by_staff_id" uuid,
	"rated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_customer_compatibilities_pair_uk" UNIQUE("tenant_id","staff_id","customer_id"),
	CONSTRAINT "staff_customer_compatibilities_score_check" CHECK ("staff_customer_compatibilities"."score" IS NULL OR "staff_customer_compatibilities"."score" BETWEEN 1 AND 5),
	CONSTRAINT "staff_customer_compatibilities_source_check" CHECK ("staff_customer_compatibilities"."source" IN ('manual', 'derived')),
	CONSTRAINT "staff_customer_compatibilities_avoid_reason_check" CHECK ("staff_customer_compatibilities"."avoid" = false OR "staff_customer_compatibilities"."reason" <> '')
);
--> statement-breakpoint
ALTER TABLE "staff_customer_compatibilities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "staff_customer_travel_estimates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"transport_mode" text NOT NULL,
	"distance_meters" integer NOT NULL,
	"duration_minutes" integer NOT NULL,
	"source" text NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_customer_travel_estimates_pair_mode_uk" UNIQUE("tenant_id","staff_id","customer_id","transport_mode"),
	CONSTRAINT "staff_customer_travel_estimates_transport_mode_check" CHECK ("staff_customer_travel_estimates"."transport_mode" IN ('car', 'public_transit', 'bicycle', 'walk')),
	CONSTRAINT "staff_customer_travel_estimates_source_check" CHECK ("staff_customer_travel_estimates"."source" IN ('google_maps', 'straight_line', 'manual')),
	CONSTRAINT "staff_customer_travel_estimates_distance_check" CHECK ("staff_customer_travel_estimates"."distance_meters" >= 0),
	CONSTRAINT "staff_customer_travel_estimates_duration_check" CHECK ("staff_customer_travel_estimates"."duration_minutes" >= 0)
);
--> statement-breakpoint
ALTER TABLE "staff_customer_travel_estimates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "staff_traits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"definition_id" uuid NOT NULL,
	"value_bool" boolean,
	"value_int" integer,
	"value_text" text,
	"note" text DEFAULT '' NOT NULL,
	"recorded_by_staff_id" uuid,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_traits_staff_definition_uk" UNIQUE("tenant_id","staff_id","definition_id"),
	CONSTRAINT "staff_traits_exactly_one_value_check" CHECK ((CASE WHEN "staff_traits"."value_bool" IS NULL THEN 0 ELSE 1 END)
    + (CASE WHEN "staff_traits"."value_int" IS NULL THEN 0 ELSE 1 END)
    + (CASE WHEN "staff_traits"."value_text" IS NULL THEN 0 ELSE 1 END) = 1)
);
--> statement-breakpoint
ALTER TABLE "staff_traits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "trait_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"subject_kind" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"value_type" text NOT NULL,
	"scale_min" integer,
	"scale_max" integer,
	"choices" jsonb,
	"match_weight" numeric(5, 2) DEFAULT '1' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trait_definitions_tenant_subject_code_uk" UNIQUE("tenant_id","subject_kind","code"),
	CONSTRAINT "trait_definitions_tenant_id_uk" UNIQUE("tenant_id","id"),
	CONSTRAINT "trait_definitions_subject_kind_check" CHECK ("trait_definitions"."subject_kind" IN ('customer', 'staff')),
	CONSTRAINT "trait_definitions_value_type_check" CHECK ("trait_definitions"."value_type" IN ('bool', 'scale', 'int', 'choice', 'text')),
	CONSTRAINT "trait_definitions_scale_check" CHECK (("trait_definitions"."value_type" = 'scale' AND "trait_definitions"."scale_min" IS NOT NULL AND "trait_definitions"."scale_max" IS NOT NULL AND "trait_definitions"."scale_max" > "trait_definitions"."scale_min")
        OR ("trait_definitions"."value_type" <> 'scale' AND "trait_definitions"."scale_min" IS NULL AND "trait_definitions"."scale_max" IS NULL)),
	CONSTRAINT "trait_definitions_choices_check" CHECK (("trait_definitions"."value_type" = 'choice' AND jsonb_typeof("trait_definitions"."choices") = 'array' AND jsonb_array_length("trait_definitions"."choices") > 0)
        OR ("trait_definitions"."value_type" <> 'choice' AND "trait_definitions"."choices" IS NULL)),
	CONSTRAINT "trait_definitions_match_weight_check" CHECK ("trait_definitions"."match_weight" >= 0),
	CONSTRAINT "trait_definitions_sort_order_check" CHECK ("trait_definitions"."sort_order" >= 0)
);
--> statement-breakpoint
ALTER TABLE "trait_definitions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "outbox_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"target_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "outbox_jobs_status_check" CHECK ("outbox_jobs"."status" IN ('pending', 'processing', 'done', 'failed')),
	CONSTRAINT "outbox_jobs_kind_check" CHECK ("outbox_jobs"."kind" IN ('attendance_day', 'attendance_aggregate', 'daily_report', 'accident_report', 'receipt')),
	CONSTRAINT "outbox_jobs_attempts_check" CHECK ("outbox_jobs"."attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "outbox_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "password_reset_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"code_verifier" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "password_reset_codes_failed_attempts_check" CHECK ("password_reset_codes"."failed_attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "password_reset_codes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"customer_id" uuid,
	"receipt_timestamp" timestamp with time zone NOT NULL,
	"dedupe_key" text,
	"amount_yen" integer,
	"amount_raw" text,
	"store_name" text,
	"handoff_text" text,
	"file_key" text NOT NULL,
	"content_type" text NOT NULL,
	"billing_type" text DEFAULT 'company_expense' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipts_tenant_id_uk" UNIQUE("tenant_id","id"),
	CONSTRAINT "receipts_amount_yen_nonneg" CHECK ("receipts"."amount_yen" IS NULL OR "receipts"."amount_yen" >= 0),
	CONSTRAINT "receipts_billing_type_check" CHECK ("receipts"."billing_type" IN ('customer_billable', 'company_expense')),
	CONSTRAINT "receipts_billable_requires_customer" CHECK ("receipts"."billing_type" = 'company_expense' OR "receipts"."customer_id" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "reservation_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"role" text DEFAULT 'primary' NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unassigned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservation_assignments_reservation_staff_uk" UNIQUE("tenant_id","reservation_id","staff_id"),
	CONSTRAINT "reservation_assignments_role_check" CHECK ("reservation_assignments"."role" IN ('primary', 'support')),
	CONSTRAINT "reservation_assignments_unassigned_order_check" CHECK ("reservation_assignments"."unassigned_at" IS NULL OR "reservation_assignments"."unassigned_at" >= "reservation_assignments"."assigned_at")
);
--> statement-breakpoint
ALTER TABLE "reservation_assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"service_menu_id" uuid NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"source" text NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"headcount" integer DEFAULT 1 NOT NULL,
	"visit_address_override" text,
	"request_note" text DEFAULT '' NOT NULL,
	"internal_note" text DEFAULT '' NOT NULL,
	"confirmed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"external_source" text,
	"external_id" text,
	"created_by_staff_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservations_tenant_id_uk" UNIQUE("tenant_id","id"),
	CONSTRAINT "reservations_status_check" CHECK ("reservations"."status" IN ('requested', 'confirmed', 'completed', 'cancelled', 'no_show')),
	CONSTRAINT "reservations_source_check" CHECK ("reservations"."source" IN ('reserva', 'web', 'phone', 'admin')),
	CONSTRAINT "reservations_time_order_check" CHECK ("reservations"."end_at" > "reservations"."start_at"),
	CONSTRAINT "reservations_headcount_check" CHECK ("reservations"."headcount" >= 1),
	CONSTRAINT "reservations_cancelled_at_check" CHECK (("reservations"."status" IN ('cancelled', 'no_show')) = ("reservations"."cancelled_at" IS NOT NULL)),
	CONSTRAINT "reservations_completed_at_check" CHECK (("reservations"."status" = 'completed') = ("reservations"."completed_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "reservations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "service_menus" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"duration_minutes" integer NOT NULL,
	"base_price_yen" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"external_source" text,
	"external_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_menus_tenant_code_uk" UNIQUE("tenant_id","code"),
	CONSTRAINT "service_menus_tenant_id_uk" UNIQUE("tenant_id","id"),
	CONSTRAINT "service_menus_duration_minutes_check" CHECK ("service_menus"."duration_minutes" > 0 AND "service_menus"."duration_minutes" <= 1440),
	CONSTRAINT "service_menus_base_price_yen_check" CHECK ("service_menus"."base_price_yen" >= 0),
	CONSTRAINT "service_menus_sort_order_check" CHECK ("service_menus"."sort_order" >= 0)
);
--> statement-breakpoint
ALTER TABLE "service_menus" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "staff_availabilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"weekday" integer,
	"specific_date" date,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_availabilities_kind_check" CHECK ("staff_availabilities"."kind" IN ('available', 'unavailable')),
	CONSTRAINT "staff_availabilities_target_check" CHECK (("staff_availabilities"."weekday" IS NULL) <> ("staff_availabilities"."specific_date" IS NULL)),
	CONSTRAINT "staff_availabilities_weekday_check" CHECK ("staff_availabilities"."weekday" IS NULL OR "staff_availabilities"."weekday" BETWEEN 0 AND 6),
	CONSTRAINT "staff_availabilities_time_order_check" CHECK ("staff_availabilities"."end_time" > "staff_availabilities"."start_time")
);
--> statement-breakpoint
ALTER TABLE "staff_availabilities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "staff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"password_hash" text,
	"legacy_password_hash" text,
	"is_admin" boolean DEFAULT false NOT NULL,
	"retirement_date" date,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"failed_login_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"home_address" text,
	"home_lat" numeric(9, 6),
	"home_lng" numeric(9, 6),
	"preferred_transport_mode" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_tenant_id_uk" UNIQUE("tenant_id","id"),
	CONSTRAINT "staff_failed_login_attempts_check" CHECK ("staff"."failed_login_attempts" >= 0),
	CONSTRAINT "staff_home_lat_range" CHECK ("staff"."home_lat" IS NULL OR "staff"."home_lat" BETWEEN -90 AND 90),
	CONSTRAINT "staff_home_lng_range" CHECK ("staff"."home_lng" IS NULL OR "staff"."home_lng" BETWEEN -180 AND 180),
	CONSTRAINT "staff_preferred_transport_mode_check" CHECK ("staff"."preferred_transport_mode" IS NULL OR "staff"."preferred_transport_mode" IN ('car', 'public_transit', 'bicycle', 'walk'))
);
--> statement-breakpoint
ALTER TABLE "staff" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenant_keys" (
	"tenant_id" uuid NOT NULL,
	"dek_version" integer DEFAULT 1 NOT NULL,
	"wrapped_dek" text NOT NULL,
	"kek_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "tenant_keys_tenant_id_dek_version_pk" PRIMARY KEY("tenant_id","dek_version"),
	CONSTRAINT "tenant_keys_version_check" CHECK ("tenant_keys"."dek_version" >= 1 AND "tenant_keys"."kek_version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "tenant_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transport_allowance_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"transport_mode" text NOT NULL,
	"calc_kind" text NOT NULL,
	"unit_amount_yen" integer,
	"min_amount_yen" integer,
	"max_amount_yen" integer,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"active" boolean DEFAULT true NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transport_allowance_rules_mode_from_uk" UNIQUE("tenant_id","transport_mode","effective_from"),
	CONSTRAINT "transport_allowance_rules_tenant_id_uk" UNIQUE("tenant_id","id"),
	CONSTRAINT "transport_allowance_rules_transport_mode_check" CHECK ("transport_allowance_rules"."transport_mode" IN ('car', 'public_transit', 'bicycle', 'walk')),
	CONSTRAINT "transport_allowance_rules_calc_kind_check" CHECK ("transport_allowance_rules"."calc_kind" IN ('per_km', 'per_trip', 'per_day', 'actual_cost')),
	CONSTRAINT "transport_allowance_rules_unit_amount_check" CHECK (("transport_allowance_rules"."calc_kind" = 'actual_cost' AND "transport_allowance_rules"."unit_amount_yen" IS NULL)
        OR ("transport_allowance_rules"."calc_kind" <> 'actual_cost' AND "transport_allowance_rules"."unit_amount_yen" IS NOT NULL AND "transport_allowance_rules"."unit_amount_yen" >= 0)),
	CONSTRAINT "transport_allowance_rules_min_max_check" CHECK (("transport_allowance_rules"."min_amount_yen" IS NULL OR "transport_allowance_rules"."min_amount_yen" >= 0)
        AND ("transport_allowance_rules"."max_amount_yen" IS NULL OR "transport_allowance_rules"."max_amount_yen" >= 0)
        AND ("transport_allowance_rules"."min_amount_yen" IS NULL OR "transport_allowance_rules"."max_amount_yen" IS NULL OR "transport_allowance_rules"."max_amount_yen" >= "transport_allowance_rules"."min_amount_yen")),
	CONSTRAINT "transport_allowance_rules_effective_order_check" CHECK ("transport_allowance_rules"."effective_to" IS NULL OR "transport_allowance_rules"."effective_to" >= "transport_allowance_rules"."effective_from")
);
--> statement-breakpoint
ALTER TABLE "transport_allowance_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "travel_legs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"sequence" integer NOT NULL,
	"leg_kind" text NOT NULL,
	"transport_mode" text NOT NULL,
	"from_label" text DEFAULT '' NOT NULL,
	"to_label" text DEFAULT '' NOT NULL,
	"to_customer_id" uuid,
	"daily_report_id" uuid,
	"distance_meters" integer,
	"duration_minutes" integer,
	"fare_yen" integer,
	"allowance_yen" integer,
	"allowance_rule_id" uuid,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "travel_legs_staff_date_sequence_uk" UNIQUE("tenant_id","staff_id","business_date","sequence"),
	CONSTRAINT "travel_legs_leg_kind_check" CHECK ("travel_legs"."leg_kind" IN ('commute', 'to_visit', 'between_visits', 'return')),
	CONSTRAINT "travel_legs_transport_mode_check" CHECK ("travel_legs"."transport_mode" IN ('car', 'public_transit', 'bicycle', 'walk')),
	CONSTRAINT "travel_legs_sequence_check" CHECK ("travel_legs"."sequence" >= 1),
	CONSTRAINT "travel_legs_distance_check" CHECK ("travel_legs"."distance_meters" IS NULL OR "travel_legs"."distance_meters" >= 0),
	CONSTRAINT "travel_legs_duration_check" CHECK ("travel_legs"."duration_minutes" IS NULL OR "travel_legs"."duration_minutes" >= 0),
	CONSTRAINT "travel_legs_fare_check" CHECK ("travel_legs"."fare_yen" IS NULL OR "travel_legs"."fare_yen" >= 0),
	CONSTRAINT "travel_legs_allowance_check" CHECK ("travel_legs"."allowance_yen" IS NULL OR "travel_legs"."allowance_yen" >= 0),
	CONSTRAINT "travel_legs_allowance_pair_check" CHECK (("travel_legs"."allowance_yen" IS NULL AND "travel_legs"."allowance_rule_id" IS NULL)
        OR ("travel_legs"."allowance_yen" IS NOT NULL AND "travel_legs"."allowance_rule_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "travel_legs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "accident_reports" ADD CONSTRAINT "accident_reports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accident_reports" ADD CONSTRAINT "accident_reports_tenant_staff_fk" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accident_reports" ADD CONSTRAINT "accident_reports_tenant_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_tenant_staff_fk" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_payment_profiles" ADD CONSTRAINT "customer_payment_profiles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_payment_profiles" ADD CONSTRAINT "customer_payment_profiles_tenant_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_tenant_invoice_fk" FOREIGN KEY ("tenant_id","invoice_id") REFERENCES "public"."invoices"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_tenant_daily_report_fk" FOREIGN KEY ("tenant_id","daily_report_id") REFERENCES "public"."daily_reports"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_tenant_receipt_fk" FOREIGN KEY ("tenant_id","receipt_id") REFERENCES "public"."receipts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_tenant_coupon_redemption_fk" FOREIGN KEY ("tenant_id","coupon_redemption_id") REFERENCES "public"."coupon_redemptions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_invoice_fk" FOREIGN KEY ("tenant_id","invoice_id") REFERENCES "public"."invoices"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_webhook_events" ADD CONSTRAINT "stripe_webhook_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_tenant_daily_report_fk" FOREIGN KEY ("tenant_id","daily_report_id") REFERENCES "public"."daily_reports"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_tenant_coupon_fk" FOREIGN KEY ("tenant_id","coupon_id") REFERENCES "public"."coupons"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_note_photos" ADD CONSTRAINT "customer_note_photos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_note_photos" ADD CONSTRAINT "customer_note_photos_tenant_note_fk" FOREIGN KEY ("tenant_id","note_id") REFERENCES "public"."customer_notes"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_note_photos" ADD CONSTRAINT "customer_note_photos_tenant_uploaded_by_fk" FOREIGN KEY ("tenant_id","uploaded_by_staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_tenant_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_tenant_author_fk" FOREIGN KEY ("tenant_id","author_staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_tenant_resolved_by_fk" FOREIGN KEY ("tenant_id","resolved_by_staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_tenant_staff_fk" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_tenant_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_tenant_reservation_fk" FOREIGN KEY ("tenant_id","reservation_id") REFERENCES "public"."reservations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_members" ADD CONSTRAINT "family_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_members" ADD CONSTRAINT "family_members_tenant_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_traits" ADD CONSTRAINT "customer_traits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_traits" ADD CONSTRAINT "customer_traits_tenant_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_traits" ADD CONSTRAINT "customer_traits_tenant_definition_fk" FOREIGN KEY ("tenant_id","definition_id") REFERENCES "public"."trait_definitions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_traits" ADD CONSTRAINT "customer_traits_tenant_recorded_by_fk" FOREIGN KEY ("tenant_id","recorded_by_staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_customer_compatibilities" ADD CONSTRAINT "staff_customer_compatibilities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_customer_compatibilities" ADD CONSTRAINT "staff_customer_compatibilities_tenant_staff_fk" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_customer_compatibilities" ADD CONSTRAINT "staff_customer_compatibilities_tenant_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_customer_compatibilities" ADD CONSTRAINT "staff_customer_compatibilities_tenant_rated_by_fk" FOREIGN KEY ("tenant_id","rated_by_staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_customer_travel_estimates" ADD CONSTRAINT "staff_customer_travel_estimates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_customer_travel_estimates" ADD CONSTRAINT "staff_customer_travel_estimates_tenant_staff_fk" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_customer_travel_estimates" ADD CONSTRAINT "staff_customer_travel_estimates_tenant_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_traits" ADD CONSTRAINT "staff_traits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_traits" ADD CONSTRAINT "staff_traits_tenant_staff_fk" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_traits" ADD CONSTRAINT "staff_traits_tenant_definition_fk" FOREIGN KEY ("tenant_id","definition_id") REFERENCES "public"."trait_definitions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_traits" ADD CONSTRAINT "staff_traits_tenant_recorded_by_fk" FOREIGN KEY ("tenant_id","recorded_by_staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trait_definitions" ADD CONSTRAINT "trait_definitions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_jobs" ADD CONSTRAINT "outbox_jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_codes" ADD CONSTRAINT "password_reset_codes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_codes" ADD CONSTRAINT "password_reset_codes_tenant_staff_fk" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_tenant_staff_fk" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_tenant_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_assignments" ADD CONSTRAINT "reservation_assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_assignments" ADD CONSTRAINT "reservation_assignments_tenant_reservation_fk" FOREIGN KEY ("tenant_id","reservation_id") REFERENCES "public"."reservations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_assignments" ADD CONSTRAINT "reservation_assignments_tenant_staff_fk" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_tenant_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_tenant_service_menu_fk" FOREIGN KEY ("tenant_id","service_menu_id") REFERENCES "public"."service_menus"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_tenant_created_by_fk" FOREIGN KEY ("tenant_id","created_by_staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_menus" ADD CONSTRAINT "service_menus_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_availabilities" ADD CONSTRAINT "staff_availabilities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_availabilities" ADD CONSTRAINT "staff_availabilities_tenant_staff_fk" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_tenant_staff_fk" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_keys" ADD CONSTRAINT "tenant_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_allowance_rules" ADD CONSTRAINT "transport_allowance_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_legs" ADD CONSTRAINT "travel_legs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_legs" ADD CONSTRAINT "travel_legs_tenant_staff_fk" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_legs" ADD CONSTRAINT "travel_legs_tenant_to_customer_fk" FOREIGN KEY ("tenant_id","to_customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_legs" ADD CONSTRAINT "travel_legs_tenant_daily_report_fk" FOREIGN KEY ("tenant_id","daily_report_id") REFERENCES "public"."daily_reports"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_legs" ADD CONSTRAINT "travel_legs_tenant_allowance_rule_fk" FOREIGN KEY ("tenant_id","allowance_rule_id") REFERENCES "public"."transport_allowance_rules"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accident_reports_tenant_customer_occurred_idx" ON "accident_reports" USING btree ("tenant_id","customer_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_days_tenant_staff_date_idx" ON "attendance_days" USING btree ("tenant_id","staff_id","business_date");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_lines_tenant_receipt_uidx" ON "invoice_lines" USING btree ("tenant_id","receipt_id") WHERE "invoice_lines"."receipt_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_lines_tenant_coupon_redemption_uidx" ON "invoice_lines" USING btree ("tenant_id","coupon_redemption_id") WHERE "invoice_lines"."coupon_redemption_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "invoice_lines_tenant_invoice_idx" ON "invoice_lines" USING btree ("tenant_id","invoice_id","line_no");--> statement-breakpoint
CREATE INDEX "invoice_lines_tenant_daily_report_idx" ON "invoice_lines" USING btree ("tenant_id","daily_report_id") WHERE "invoice_lines"."daily_report_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_tenant_stripe_invoice_uidx" ON "invoices" USING btree ("tenant_id","stripe_invoice_id") WHERE "invoices"."stripe_invoice_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "invoices_tenant_customer_period_idx" ON "invoices" USING btree ("tenant_id","customer_id","billing_period_start" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "invoices_tenant_open_idx" ON "invoices" USING btree ("tenant_id","due_date") WHERE "invoices"."status" = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX "payments_tenant_stripe_payment_intent_uidx" ON "payments" USING btree ("tenant_id","stripe_payment_intent_id") WHERE "payments"."stripe_payment_intent_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "payments_tenant_customer_created_idx" ON "payments" USING btree ("tenant_id","customer_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "payments_tenant_invoice_idx" ON "payments" USING btree ("tenant_id","invoice_id") WHERE "payments"."invoice_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "stripe_webhook_events_tenant_unprocessed_idx" ON "stripe_webhook_events" USING btree ("tenant_id","received_at") WHERE "stripe_webhook_events"."processed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "coupon_redemptions_tenant_coupon_idx" ON "coupon_redemptions" USING btree ("tenant_id","coupon_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_note_photos_tenant_file_key_uidx" ON "customer_note_photos" USING btree ("tenant_id","file_key");--> statement-breakpoint
CREATE INDEX "customer_note_photos_tenant_note_idx" ON "customer_note_photos" USING btree ("tenant_id","note_id","sort_order");--> statement-breakpoint
CREATE INDEX "customer_notes_tenant_customer_created_idx" ON "customer_notes" USING btree ("tenant_id","customer_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "customer_notes_tenant_customer_category_idx" ON "customer_notes" USING btree ("tenant_id","customer_id","category");--> statement-breakpoint
CREATE INDEX "customer_notes_tenant_open_idx" ON "customer_notes" USING btree ("tenant_id","customer_id") WHERE "customer_notes"."resolved_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "customers_tenant_external_idx" ON "customers" USING btree ("tenant_id","external_source","external_id");--> statement-breakpoint
CREATE INDEX "customers_tenant_family_name_idx" ON "customers" USING btree ("tenant_id","family_name");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_reports_tenant_reservation_uidx" ON "daily_reports" USING btree ("tenant_id","reservation_id") WHERE "daily_reports"."reservation_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "daily_reports_tenant_customer_occurred_idx" ON "daily_reports" USING btree ("tenant_id","customer_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "family_members_tenant_customer_idx" ON "family_members" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "customer_traits_tenant_definition_idx" ON "customer_traits" USING btree ("tenant_id","definition_id");--> statement-breakpoint
CREATE INDEX "staff_customer_compatibilities_tenant_customer_idx" ON "staff_customer_compatibilities" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "staff_customer_travel_estimates_tenant_customer_mode_idx" ON "staff_customer_travel_estimates" USING btree ("tenant_id","customer_id","transport_mode","duration_minutes");--> statement-breakpoint
CREATE INDEX "staff_traits_tenant_definition_idx" ON "staff_traits" USING btree ("tenant_id","definition_id");--> statement-breakpoint
CREATE INDEX "trait_definitions_tenant_subject_idx" ON "trait_definitions" USING btree ("tenant_id","subject_kind","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_jobs_tenant_idempotency_key_idx" ON "outbox_jobs" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "outbox_jobs_tenant_status_next_attempt_idx" ON "outbox_jobs" USING btree ("tenant_id","status","next_attempt_at","created_at");--> statement-breakpoint
CREATE INDEX "password_reset_codes_staff_idx" ON "password_reset_codes" USING btree ("tenant_id","staff_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "receipts_tenant_dedupe_key_uidx" ON "receipts" USING btree ("tenant_id","dedupe_key") WHERE "receipts"."dedupe_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "receipts_tenant_customer_timestamp_idx" ON "receipts" USING btree ("tenant_id","customer_id","receipt_timestamp" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "reservation_assignments_primary_uidx" ON "reservation_assignments" USING btree ("tenant_id","reservation_id") WHERE "reservation_assignments"."role" = 'primary' AND "reservation_assignments"."unassigned_at" IS NULL;--> statement-breakpoint
CREATE INDEX "reservation_assignments_tenant_staff_idx" ON "reservation_assignments" USING btree ("tenant_id","staff_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reservations_tenant_external_uidx" ON "reservations" USING btree ("tenant_id","external_source","external_id") WHERE "reservations"."external_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "reservations_tenant_start_at_idx" ON "reservations" USING btree ("tenant_id","start_at");--> statement-breakpoint
CREATE INDEX "reservations_tenant_customer_start_idx" ON "reservations" USING btree ("tenant_id","customer_id","start_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "reservations_tenant_requested_idx" ON "reservations" USING btree ("tenant_id","start_at") WHERE "reservations"."status" = 'requested';--> statement-breakpoint
CREATE UNIQUE INDEX "service_menus_tenant_external_uidx" ON "service_menus" USING btree ("tenant_id","external_source","external_id") WHERE "service_menus"."external_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "staff_availabilities_tenant_staff_idx" ON "staff_availabilities" USING btree ("tenant_id","staff_id");--> statement-breakpoint
CREATE INDEX "staff_availabilities_tenant_date_idx" ON "staff_availabilities" USING btree ("tenant_id","specific_date") WHERE "staff_availabilities"."specific_date" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_idx" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_tenant_staff_idx" ON "sessions" USING btree ("tenant_id","staff_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_tenant_email_idx" ON "staff" USING btree ("tenant_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_slug_idx" ON "tenants" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "transport_allowance_rules_tenant_mode_from_idx" ON "transport_allowance_rules" USING btree ("tenant_id","transport_mode","effective_from" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "travel_legs_tenant_staff_date_idx" ON "travel_legs" USING btree ("tenant_id","staff_id","business_date");--> statement-breakpoint
CREATE INDEX "travel_legs_tenant_daily_report_idx" ON "travel_legs" USING btree ("tenant_id","daily_report_id") WHERE "travel_legs"."daily_report_id" IS NOT NULL;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "accident_reports" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "app_settings" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "attendance_days" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "customer_payment_profiles" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "invoice_lines" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "invoices" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "payments" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "stripe_webhook_events" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "coupon_redemptions" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "coupons" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "customer_note_photos" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "customer_notes" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "customers" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "daily_reports" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "family_members" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "customer_traits" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "staff_customer_compatibilities" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "staff_customer_travel_estimates" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "staff_traits" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "trait_definitions" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "outbox_jobs" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "password_reset_codes" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "receipts" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "reservation_assignments" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "reservations" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "service_menus" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "staff_availabilities" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sessions" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "staff" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenant_keys" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "transport_allowance_rules" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "travel_legs" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint
-- ここから下は drizzle-kit が生成しない手書き部分(理由はファイル冒頭のコメント参照)。
-- 1. テーブル所有者にもRLSを適用する(FORCE)。
ALTER TABLE "accident_reports" FORCE ROW LEVEL SECURITY;
ALTER TABLE "app_settings" FORCE ROW LEVEL SECURITY;
ALTER TABLE "attendance_days" FORCE ROW LEVEL SECURITY;
ALTER TABLE "customer_payment_profiles" FORCE ROW LEVEL SECURITY;
ALTER TABLE "invoice_lines" FORCE ROW LEVEL SECURITY;
ALTER TABLE "invoices" FORCE ROW LEVEL SECURITY;
ALTER TABLE "payments" FORCE ROW LEVEL SECURITY;
ALTER TABLE "stripe_webhook_events" FORCE ROW LEVEL SECURITY;
ALTER TABLE "coupon_redemptions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "coupons" FORCE ROW LEVEL SECURITY;
ALTER TABLE "customer_note_photos" FORCE ROW LEVEL SECURITY;
ALTER TABLE "customer_notes" FORCE ROW LEVEL SECURITY;
ALTER TABLE "customers" FORCE ROW LEVEL SECURITY;
ALTER TABLE "daily_reports" FORCE ROW LEVEL SECURITY;
ALTER TABLE "family_members" FORCE ROW LEVEL SECURITY;
ALTER TABLE "customer_traits" FORCE ROW LEVEL SECURITY;
ALTER TABLE "staff_customer_compatibilities" FORCE ROW LEVEL SECURITY;
ALTER TABLE "staff_customer_travel_estimates" FORCE ROW LEVEL SECURITY;
ALTER TABLE "staff_traits" FORCE ROW LEVEL SECURITY;
ALTER TABLE "trait_definitions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "outbox_jobs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "password_reset_codes" FORCE ROW LEVEL SECURITY;
ALTER TABLE "receipts" FORCE ROW LEVEL SECURITY;
ALTER TABLE "reservation_assignments" FORCE ROW LEVEL SECURITY;
ALTER TABLE "reservations" FORCE ROW LEVEL SECURITY;
ALTER TABLE "service_menus" FORCE ROW LEVEL SECURITY;
ALTER TABLE "staff_availabilities" FORCE ROW LEVEL SECURITY;
ALTER TABLE "sessions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "staff" FORCE ROW LEVEL SECURITY;
ALTER TABLE "tenant_keys" FORCE ROW LEVEL SECURITY;
ALTER TABLE "transport_allowance_rules" FORCE ROW LEVEL SECURITY;
ALTER TABLE "travel_legs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- 2. updated_at をDBトリガーで更新する。
--    アプリ側の更新漏れ(ある更新経路だけ updated_at を触らない)を構造的に防ぐため、
--    値の生成をDBに寄せる。NEWレコードの1列を書き換えるだけでテーブル参照も型解決も
--    行わないため、search_path の固定は不要。
CREATE OR REPLACE FUNCTION "set_updated_at"() RETURNS trigger AS $$
BEGIN
  NEW."updated_at" = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "accident_reports_set_updated_at" BEFORE UPDATE ON "accident_reports"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "app_settings_set_updated_at" BEFORE UPDATE ON "app_settings"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "attendance_days_set_updated_at" BEFORE UPDATE ON "attendance_days"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "customer_payment_profiles_set_updated_at" BEFORE UPDATE ON "customer_payment_profiles"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "invoice_lines_set_updated_at" BEFORE UPDATE ON "invoice_lines"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "invoices_set_updated_at" BEFORE UPDATE ON "invoices"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "payments_set_updated_at" BEFORE UPDATE ON "payments"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "stripe_webhook_events_set_updated_at" BEFORE UPDATE ON "stripe_webhook_events"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "coupon_redemptions_set_updated_at" BEFORE UPDATE ON "coupon_redemptions"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "coupons_set_updated_at" BEFORE UPDATE ON "coupons"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "customer_note_photos_set_updated_at" BEFORE UPDATE ON "customer_note_photos"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "customer_notes_set_updated_at" BEFORE UPDATE ON "customer_notes"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "customers_set_updated_at" BEFORE UPDATE ON "customers"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "daily_reports_set_updated_at" BEFORE UPDATE ON "daily_reports"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "family_members_set_updated_at" BEFORE UPDATE ON "family_members"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "customer_traits_set_updated_at" BEFORE UPDATE ON "customer_traits"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "staff_customer_compatibilities_set_updated_at" BEFORE UPDATE ON "staff_customer_compatibilities"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "staff_customer_travel_estimates_set_updated_at" BEFORE UPDATE ON "staff_customer_travel_estimates"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "staff_traits_set_updated_at" BEFORE UPDATE ON "staff_traits"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "trait_definitions_set_updated_at" BEFORE UPDATE ON "trait_definitions"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "outbox_jobs_set_updated_at" BEFORE UPDATE ON "outbox_jobs"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "reservation_assignments_set_updated_at" BEFORE UPDATE ON "reservation_assignments"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "reservations_set_updated_at" BEFORE UPDATE ON "reservations"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "service_menus_set_updated_at" BEFORE UPDATE ON "service_menus"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "staff_availabilities_set_updated_at" BEFORE UPDATE ON "staff_availabilities"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "staff_set_updated_at" BEFORE UPDATE ON "staff"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "tenant_keys_set_updated_at" BEFORE UPDATE ON "tenant_keys"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "transport_allowance_rules_set_updated_at" BEFORE UPDATE ON "transport_allowance_rules"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "travel_legs_set_updated_at" BEFORE UPDATE ON "travel_legs"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
