-- 領収書の締め日をテナントごとの管理者設定にする(doc/14 §10)。
--
-- 追加列はすべてDEFAULT付き、またはNULL許容なので既存行があっても当たる。
-- 新しいテーブルは無いため、FORCE ROW LEVEL SECURITY と set_updated_at トリガーの
-- 手作業での追記は不要(app_settings には 0000 で既に付いている)。

ALTER TABLE "app_settings" ADD COLUMN "receipt_closing_day" integer;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "receipt_mirror_lead_days" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "receipt_cancellable_days" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_receipt_closing_day_check" CHECK ("app_settings"."receipt_closing_day" IS NULL
        OR ("app_settings"."receipt_closing_day" >= 1 AND "app_settings"."receipt_closing_day" <= 28));--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_receipt_mirror_lead_days_check" CHECK ("app_settings"."receipt_mirror_lead_days" >= 0 AND "app_settings"."receipt_mirror_lead_days" <= 10);--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_receipt_cancellable_days_check" CHECK ("app_settings"."receipt_cancellable_days" >= 0 AND "app_settings"."receipt_cancellable_days" <= 14);