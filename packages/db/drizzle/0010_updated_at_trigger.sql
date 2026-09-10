-- doc/14 E項: updated_at はアプリのコードが毎回SETする方針だったが、customers.update()/deactivate() が
-- 書き忘れていて実際に壊れていた(customers.updated_at は行を作った時刻のまま進まない)。
-- アプリ側の書き忘れは今後も起こり得るので、唯一の真実をDBに置き、トリガーで強制的に now() を入れる。
--
-- drizzleのスキーマ定義ではトリガーを表現できないため、このファイルは手で書いている
-- (生成は `drizzle-kit generate --custom` の空ファイルのみ)。
--
-- 各文の区切りに `--> statement-breakpoint` を入れているが、CREATE FUNCTION の本体
-- ($$ ... $$ の中)には入れないこと。drizzle-orm の migrator はこのマーカーで文字列を
-- 分割してから1文ずつ実行するため、本体の途中に入れると関数定義が途中で切れて壊れる。
CREATE OR REPLACE FUNCTION "set_updated_at"() RETURNS trigger AS $$
BEGIN
  NEW."updated_at" = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
-- 以下、updated_at列を持つ全テーブル(9個)。schema/*.ts を実際に調べて集めたもので、
-- 増減があったら updatedAtTriggers.test.ts の静的検査が落ちる。
CREATE TRIGGER "customers_set_updated_at" BEFORE UPDATE ON "customers"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "staff_set_updated_at" BEFORE UPDATE ON "staff"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "daily_reports_set_updated_at" BEFORE UPDATE ON "daily_reports"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "accident_reports_set_updated_at" BEFORE UPDATE ON "accident_reports"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "family_members_set_updated_at" BEFORE UPDATE ON "family_members"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "attendance_days_set_updated_at" BEFORE UPDATE ON "attendance_days"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "app_settings_set_updated_at" BEFORE UPDATE ON "app_settings"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "tenant_keys_set_updated_at" BEFORE UPDATE ON "tenant_keys"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "outbox_jobs_set_updated_at" BEFORE UPDATE ON "outbox_jobs"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
