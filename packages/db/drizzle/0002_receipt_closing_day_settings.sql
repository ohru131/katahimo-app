-- 領収書の締め日をテナントごとの管理者設定にする(doc/db/guidelines.md §10)。
--
-- app_settings の3列が取り消し期限とミラー送信の開始時刻を決め、receipts.cancellable_until が
-- その計算結果を登録時点で固定する(設定を後から変えても既存の領収書の期限は動かさない)。
--
-- 追加列はすべてDEFAULT付き、またはNULL許容なので既存行があっても当たる。
-- 既存行の cancellable_until はNULLのままにする。バックフィルすると「当時の設定」ではなく
-- 「いまの設定」で埋めることになり、固定したい値と違うものが入る。読み出し側は
-- NULLのときだけ現在の設定から計算してフォールバックする(receipts.ts の resolveCancellableUntil)。
--
-- 新しいテーブルは無いため、FORCE ROW LEVEL SECURITY と set_updated_at トリガーの
-- 手作業での追記は不要(どちらのテーブルも 0000 で既に付いている)。

ALTER TABLE "app_settings" ADD COLUMN "receipt_closing_day" integer;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "receipt_mirror_lead_days" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "receipt_cancellable_days" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "cancellable_until" date;--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_receipt_closing_day_check" CHECK ("app_settings"."receipt_closing_day" IS NULL
        OR ("app_settings"."receipt_closing_day" >= 1 AND "app_settings"."receipt_closing_day" <= 28));--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_receipt_mirror_lead_days_check" CHECK ("app_settings"."receipt_mirror_lead_days" >= 0 AND "app_settings"."receipt_mirror_lead_days" <= 10);--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_receipt_cancellable_days_check" CHECK ("app_settings"."receipt_cancellable_days" >= 0 AND "app_settings"."receipt_cancellable_days" <= 14);