ALTER TABLE "accident_reports" ADD COLUMN "target_dob_date" date;--> statement-breakpoint
ALTER TABLE "accident_reports" ADD COLUMN "target_dob_raw" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "lat" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "lng" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "lat_lng_raw" text;--> statement-breakpoint
ALTER TABLE "daily_reports" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "daily_reports" ADD COLUMN "ended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "family_members" ADD COLUMN "dob_date" date;--> statement-breakpoint
ALTER TABLE "family_members" ADD COLUMN "dob_raw" text;--> statement-breakpoint
-- CodeRabbit指摘対応: PostgreSQLのマイグレーションはその場で適用されるため
-- (REBUILD_REQUIRED_MIGRATIONSはブラウザ内IndexedDBのデモにしか効かない)、下のDROP COLUMNで
-- 消える前に、生年月日・緯度経度・開始/終了時刻を新しい列へ移す。
--
-- 生年月日(dob/target_dob → dob_date/target_dob_date)。
-- packages/core/src/domain/legacyImport/parseDateOnly.ts と完全に一致させること。
-- 年だけ・年月だけの不完全な表記(例: "1990"、"1990/1")に1月1日等を勝手に補ってはいけない
-- (parseDateOnly.tsのコメント参照)。正規表現で年月日が3つとも揃っている表記だけを対象にし、
-- 実在しない暦日(2/30等)はmake_date()が例外を投げるのでEXCEPTION WHEN othersでNULLに落とす
-- (make_date()はうるう年判定も含めて実在する暦日かどうかを検証してくれるため、JS版のように
-- Date.UTC()の結果を年月日それぞれ突き合わせる手間が要らない)。
CREATE FUNCTION "parse_date_only"("v" text) RETURNS date AS $$
DECLARE
  m text[];
BEGIN
  IF "v" IS NULL THEN
    RETURN NULL;
  END IF;
  m := regexp_match(btrim("v"), '^(\d{1,4})[/-](\d{1,2})[/-](\d{1,2})$');
  IF m IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN make_date(m[1]::integer, m[2]::integer, m[3]::integer);
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
-- 緯度経度(lat_lng → lat/lng)。packages/core/src/domain/legacyImport/parseLatLng.ts と
-- 完全に一致させること。区切りは半角/全角カンマ、要素数2、値域-90..90/-180..180を外れたら
-- 両方NULLにする。lat/lngの2値を同時に返す必要があるため配列(numeric[2])で返し、
-- 呼び出し側で[1]/[2]を取り出す(2回呼ぶより関数を分けた方が愚直だが、判定ロジックが
-- 分裂して食い違うリスクの方を避けた)。
CREATE FUNCTION "parse_lat_lng"("v" text) RETURNS numeric[] AS $$
DECLARE
  trimmed text;
  parts text[];
  lat_str text;
  lng_str text;
  lat_num numeric;
  lng_num numeric;
BEGIN
  IF "v" IS NULL THEN
    RETURN ARRAY[NULL::numeric, NULL::numeric];
  END IF;
  trimmed := btrim("v");
  IF trimmed = '' THEN
    RETURN ARRAY[NULL::numeric, NULL::numeric];
  END IF;
  parts := regexp_split_to_array(trimmed, '[,，]');
  IF array_length(parts, 1) IS DISTINCT FROM 2 THEN
    RETURN ARRAY[NULL::numeric, NULL::numeric];
  END IF;
  lat_str := btrim(parts[1]);
  lng_str := btrim(parts[2]);
  IF lat_str !~ '^-?\d+(\.\d+)?$' OR lng_str !~ '^-?\d+(\.\d+)?$' THEN
    RETURN ARRAY[NULL::numeric, NULL::numeric];
  END IF;
  lat_num := lat_str::numeric;
  lng_num := lng_str::numeric;
  IF lat_num < -90 OR lat_num > 90 OR lng_num < -180 OR lng_num > 180 THEN
    RETURN ARRAY[NULL::numeric, NULL::numeric];
  END IF;
  RETURN ARRAY[lat_num, lng_num];
EXCEPTION WHEN others THEN
  RETURN ARRAY[NULL::numeric, NULL::numeric];
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
-- 開始/終了時刻(start_time/end_time + occurred_at → started_at/ended_at)。
-- packages/core/src/usecases/reports.ts の computeDailyReportTimes()/parseJstDateTime() と
-- 完全に一致させること。
--
-- reportDateStr(computeDailyReportTimesの第1引数)自体はDBに保存されていないが、
-- saveDailyReport()を辿ると、保存時に使われたreportDateStrのJST日付は常にoccurredAtの
-- JST日付と一致する(reportDate指定時はoccurredAt=startedAtかreportDateStrのmidnight、
-- 未指定時はoccurredAt=now()かつreportDateStr=formatJstDateKey(now())になるため、
-- どちらの経路でも作り直せる)。そのためoccurred_atのJST日付をreportDateStr代わりに使う。
--
-- start_time/end_timeに生値の列を足さない理由: 入力元のReportModal.tsx(HOURS/MINUTESの
-- <select>で組み立てる)を確認したところ、値は常に"HH:mm"(24時間表記のプルダウン2つの組)
-- になり、自由記述が入ることは無い。保存しておく価値のある「元の表記」がそもそも存在しない
-- (0013で捨てるstart_time/end_time自体がDEFAULT ''のNOT NULL列で、常に"HH:mm"か空文字しか
-- 入っていない)ため、amount_raw/dob_raw等と違いrawの保持は不要と判断した。
CREATE FUNCTION "daily_report_started_at"("occurred_at" timestamptz, "start_time" text)
RETURNS timestamptz AS $$
BEGIN
  IF "start_time" IS NULL OR "start_time" = '' THEN
    RETURN NULL;
  END IF;
  RETURN (to_char("occurred_at" AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD') || ' ' || "start_time")::timestamp
    AT TIME ZONE 'Asia/Tokyo';
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE FUNCTION "daily_report_ended_at"("occurred_at" timestamptz, "start_time" text, "end_time" text)
RETURNS timestamptz AS $$
DECLARE
  s timestamptz;
  e timestamptz;
BEGIN
  IF "end_time" IS NULL OR "end_time" = '' THEN
    RETURN NULL;
  END IF;
  s := "daily_report_started_at"("occurred_at", "start_time");
  e := (to_char("occurred_at" AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD') || ' ' || "end_time")::timestamp
    AT TIME ZONE 'Asia/Tokyo';
  -- computeDailyReportTimes: 終了が開始より前なら日跨ぎ勤務とみなし終了を翌日にする
  -- (daily_reports_time_orderのCHECKを満たすため)。
  IF s IS NOT NULL AND e < s THEN
    e := e + interval '1 day';
  END IF;
  RETURN e;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
UPDATE "family_members" SET
  "dob_raw" = "dob",
  "dob_date" = "parse_date_only"("dob");--> statement-breakpoint
UPDATE "accident_reports" SET
  "target_dob_raw" = "target_dob",
  "target_dob_date" = "parse_date_only"("target_dob");--> statement-breakpoint
UPDATE "customers" SET
  "lat_lng_raw" = "lat_lng",
  "lat" = ("parse_lat_lng"("lat_lng"))[1],
  "lng" = ("parse_lat_lng"("lat_lng"))[2];--> statement-breakpoint
UPDATE "daily_reports" SET
  "started_at" = "daily_report_started_at"("occurred_at", "start_time"),
  "ended_at" = "daily_report_ended_at"("occurred_at", "start_time", "end_time");--> statement-breakpoint
DROP FUNCTION "daily_report_ended_at"("occurred_at" timestamptz, "start_time" text, "end_time" text);--> statement-breakpoint
DROP FUNCTION "daily_report_started_at"("occurred_at" timestamptz, "start_time" text);--> statement-breakpoint
DROP FUNCTION "parse_lat_lng"("v" text);--> statement-breakpoint
DROP FUNCTION "parse_date_only"("v" text);--> statement-breakpoint
ALTER TABLE "accident_reports" DROP COLUMN "target_dob";--> statement-breakpoint
ALTER TABLE "customers" DROP COLUMN "lat_lng";--> statement-breakpoint
ALTER TABLE "daily_reports" DROP COLUMN "start_time";--> statement-breakpoint
ALTER TABLE "daily_reports" DROP COLUMN "end_time";--> statement-breakpoint
ALTER TABLE "family_members" DROP COLUMN "dob";--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_lat_range" CHECK ("customers"."lat" IS NULL OR "customers"."lat" BETWEEN -90 AND 90);--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_lng_range" CHECK ("customers"."lng" IS NULL OR "customers"."lng" BETWEEN -180 AND 180);--> statement-breakpoint
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_time_order" CHECK ("daily_reports"."ended_at" IS NULL OR "daily_reports"."started_at" IS NULL OR "daily_reports"."ended_at" >= "daily_reports"."started_at");
