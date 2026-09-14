-- 世帯構成員のアレルギーを、自由記述(info)とは別の列で持つ(doc/db/guidelines.md §11)。
--
-- allergy_status は 'unknown'(未確認・既定) / 'none'(確認して無し) / 'present'(あり)。
-- GAS版は家族DBの「アレルギー情報」列が空のとき画面に「アレルギー: なし」と出しており、
-- 聞いていないだけの状態と確認して無かった状態が区別できなかった。既定を未確認にして分ける。
--
-- 'present' の行は内容(allergy_note)が必ず入る。空白だけの値も btrim で弾く
-- (入口のzodはtrim済みの値しか通さないが、取込や移行スクリプトは入口を通らないため)。
--
-- 既存行は DEFAULT 'unknown' で埋まる。info に「卵アレルギーあり」等が書かれている行があっても
-- 機械的な移送はしない。書き方が揃っておらず(「卵×」「アレルギーなし」)、
-- 取り違えると命に関わる項目を推測で埋めることになるため、現場で確認して入れ直す。
--
-- 新しいテーブルは無いため、FORCE ROW LEVEL SECURITY と set_updated_at トリガーの
-- 手作業での追記は不要(family_members はどちらも 0000 で既に付いている)。

ALTER TABLE "family_members" ADD COLUMN "allergy_status" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "family_members" ADD COLUMN "allergy_note" text;--> statement-breakpoint
ALTER TABLE "family_members" ADD CONSTRAINT "family_members_allergy_status_check" CHECK ("family_members"."allergy_status" IN ('unknown', 'none', 'present'));--> statement-breakpoint
ALTER TABLE "family_members" ADD CONSTRAINT "family_members_allergy_note_required" CHECK ("family_members"."allergy_status" <> 'present' OR NULLIF(btrim("family_members"."allergy_note"), '') IS NOT NULL);