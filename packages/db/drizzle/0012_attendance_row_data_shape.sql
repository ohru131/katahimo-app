-- CodeRabbit指摘対応: PostgreSQLのマイグレーションはその場で適用されるため
-- (REBUILD_REQUIRED_MIGRATIONSはブラウザ内IndexedDBのデモにしか効かない)、CHECK制約を
-- 足す前に、列記号形式(C/D/E…)の古い行を新形式(visits/officeWork)へ移し替える。
--
-- 変換規則は packages/core/src/domain/attendance/columnRow.ts の fromColumnRow() と
-- 完全に一致させること(このマイグレーションを書くにあたって git show HEAD:packages/core/
-- src/domain/attendance/columnRow.ts でコミット済みの版を読んで写した。同ファイルは
-- 別作業者が同時に編集している可能性があるため、このマイグレーションのコメント自体は
-- そこへの追随を約束しない)。
--
-- 数値へ変換する列(H/Q/AG/AH/AI/AJ/AN)は columnStringToNum() と同じ規則: 未入力(null/空文字)
-- はキー自体を省く。数値化できない文字列も同様にキーを省く(例外は投げない。呼び出し側で
-- 「保存してよい値か」を判定する場所ではない、というfromColumnRow()側のコメントと同じ判断)。
-- ただしJSのNumber()と ::numeric キャストは細部で解釈が食い違う(例: 空白だけの文字列は
-- Number(' ')===0だが ::numeric は例外になる)。実データは列記号形式ではGAS版由来の
-- 数値文字列のみでこの手の値は来ない想定のため、この差分は許容する。
CREATE FUNCTION "attendance_parse_column_num"("v" text) RETURNS numeric AS $$
BEGIN
  IF "v" IS NULL OR "v" = '' THEN
    RETURN NULL;
  END IF;
  BEGIN
    RETURN "v"::numeric;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
-- fromColumnRow()本体の移植。isPresent()相当の判定(NULLでも空文字でもない)、
-- trimTrailingEmpty()相当(配列の末尾から空要素だけを取り除く)、3件目の訪問には
-- 対応する移動列が無いことをそのまま写している。
CREATE FUNCTION "attendance_column_row_to_row_data"("rd" jsonb) RETURNS jsonb AS $$
DECLARE
  v0 jsonb := '{}'::jsonb;
  v1 jsonb := '{}'::jsonb;
  v2 jsonb := '{}'::jsonb;
  o0 jsonb := '{}'::jsonb;
  o1 jsonb := '{}'::jsonb;
  visits jsonb;
  office_work jsonb;
  result jsonb := '{}'::jsonb;
  num numeric;
BEGIN
  -- #1訪問(C/D/E/I/H/AG)。
  IF "rd"->>'C' IS NOT NULL AND "rd"->>'C' <> '' THEN v0 := v0 || jsonb_build_object('place', "rd"->>'C'); END IF;
  IF "rd"->>'D' IS NOT NULL AND "rd"->>'D' <> '' THEN v0 := v0 || jsonb_build_object('start', "rd"->>'D'); END IF;
  IF "rd"->>'E' IS NOT NULL AND "rd"->>'E' <> '' THEN v0 := v0 || jsonb_build_object('end', "rd"->>'E'); END IF;
  IF "rd"->>'I' IS NOT NULL AND "rd"->>'I' <> '' THEN
    v0 := v0 || jsonb_build_object('weatherAfter', "rd"->>'I');
  END IF;
  num := "attendance_parse_column_num"("rd"->>'H');
  IF num IS NOT NULL THEN v0 := v0 || jsonb_build_object('plannedMoveMin', num); END IF;
  num := "attendance_parse_column_num"("rd"->>'AG');
  IF num IS NOT NULL THEN v0 := v0 || jsonb_build_object('distanceKm', num); END IF;

  -- #2訪問(L/M/N/R/Q/AH)。
  IF "rd"->>'L' IS NOT NULL AND "rd"->>'L' <> '' THEN v1 := v1 || jsonb_build_object('place', "rd"->>'L'); END IF;
  IF "rd"->>'M' IS NOT NULL AND "rd"->>'M' <> '' THEN v1 := v1 || jsonb_build_object('start', "rd"->>'M'); END IF;
  IF "rd"->>'N' IS NOT NULL AND "rd"->>'N' <> '' THEN v1 := v1 || jsonb_build_object('end', "rd"->>'N'); END IF;
  IF "rd"->>'R' IS NOT NULL AND "rd"->>'R' <> '' THEN
    v1 := v1 || jsonb_build_object('weatherAfter', "rd"->>'R');
  END IF;
  num := "attendance_parse_column_num"("rd"->>'Q');
  IF num IS NOT NULL THEN v1 := v1 || jsonb_build_object('plannedMoveMin', num); END IF;
  num := "attendance_parse_column_num"("rd"->>'AH');
  IF num IS NOT NULL THEN v1 := v1 || jsonb_build_object('distanceKm', num); END IF;

  -- #3訪問(U/V/W)。toColumnRow()のコメントの通り、対応する移動列(H/I/AGに相当)がそもそも
  -- 無いため、weatherAfter/plannedMoveMin/distanceKmは作らない。
  IF "rd"->>'U' IS NOT NULL AND "rd"->>'U' <> '' THEN v2 := v2 || jsonb_build_object('place', "rd"->>'U'); END IF;
  IF "rd"->>'V' IS NOT NULL AND "rd"->>'V' <> '' THEN v2 := v2 || jsonb_build_object('start', "rd"->>'V'); END IF;
  IF "rd"->>'W' IS NOT NULL AND "rd"->>'W' <> '' THEN v2 := v2 || jsonb_build_object('end', "rd"->>'W'); END IF;

  -- trimTrailingEmpty([v0,v1,v2], isVisitEmpty): 末尾から空オブジェクトだけを取り除く。
  visits := jsonb_build_array(v0, v1, v2);
  WHILE jsonb_array_length(visits) > 0 AND visits -> (jsonb_array_length(visits) - 1) = '{}'::jsonb LOOP
    visits := visits - (jsonb_array_length(visits) - 1);
  END LOOP;

  -- 事務作業1(X/Y/Z)・事務作業2(AA/AB/AC)。
  IF "rd"->>'X' IS NOT NULL AND "rd"->>'X' <> '' THEN o0 := o0 || jsonb_build_object('name', "rd"->>'X'); END IF;
  IF "rd"->>'Y' IS NOT NULL AND "rd"->>'Y' <> '' THEN o0 := o0 || jsonb_build_object('start', "rd"->>'Y'); END IF;
  IF "rd"->>'Z' IS NOT NULL AND "rd"->>'Z' <> '' THEN o0 := o0 || jsonb_build_object('end', "rd"->>'Z'); END IF;
  IF "rd"->>'AA' IS NOT NULL AND "rd"->>'AA' <> '' THEN
    o1 := o1 || jsonb_build_object('name', "rd"->>'AA');
  END IF;
  IF "rd"->>'AB' IS NOT NULL AND "rd"->>'AB' <> '' THEN
    o1 := o1 || jsonb_build_object('start', "rd"->>'AB');
  END IF;
  IF "rd"->>'AC' IS NOT NULL AND "rd"->>'AC' <> '' THEN
    o1 := o1 || jsonb_build_object('end', "rd"->>'AC');
  END IF;

  office_work := jsonb_build_array(o0, o1);
  WHILE jsonb_array_length(office_work) > 0
    AND office_work -> (jsonb_array_length(office_work) - 1) = '{}'::jsonb LOOP
    office_work := office_work - (jsonb_array_length(office_work) - 1);
  END LOOP;

  IF jsonb_array_length(visits) > 0 THEN result := result || jsonb_build_object('visits', visits); END IF;
  IF jsonb_array_length(office_work) > 0 THEN
    result := result || jsonb_build_object('officeWork', office_work);
  END IF;

  num := "attendance_parse_column_num"("rd"->>'AI');
  IF num IS NOT NULL THEN result := result || jsonb_build_object('commuteDistanceKm', num); END IF;
  num := "attendance_parse_column_num"("rd"->>'AJ');
  IF num IS NOT NULL THEN result := result || jsonb_build_object('returnDistanceKm', num); END IF;
  num := "attendance_parse_column_num"("rd"->>'AN');
  IF num IS NOT NULL THEN result := result || jsonb_build_object('shoppingErrandCount', num); END IF;

  IF "rd"->>'AO' IS NOT NULL AND "rd"->>'AO' <> '' THEN
    result := result || jsonb_build_object('note', "rd"->>'AO');
  END IF;

  RETURN result;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
-- 変換対象を絞り込む: 既に新形式(visits/officeWorkキーを持つ)の行、列記号キーを1つも
-- 持たない行({}等)は触らない。jsonb_typeof <> 'object' の行(配列・スカラ)は本来アプリの
-- 書き込み経路(rowData: jsonb().$type<AttendanceRowData>())からは生まれないはずだが、
-- 念のためWHERE句でも除外し、直後のRAISE EXCEPTIONで気付けるようにする。
UPDATE "attendance_days"
SET "row_data" = "attendance_column_row_to_row_data"("row_data")
WHERE jsonb_typeof("row_data") = 'object'
  AND NOT ("row_data" ? 'visits' OR "row_data" ? 'officeWork')
  AND ("row_data" ?| ARRAY['C','D','E','H','I','L','M','N','Q','R','U','V','W','X','Y','Z',
                            'AA','AB','AC','AG','AH','AI','AJ','AN','AO']);--> statement-breakpoint
DROP FUNCTION "attendance_column_row_to_row_data"("rd" jsonb);--> statement-breakpoint
DROP FUNCTION "attendance_parse_column_num"("v" text);--> statement-breakpoint
-- jsonb_typeof(row_data) <> 'object' の行が実在すると、この直後に足すCHECK制約
-- (attendance_days_row_data_object)がADD CONSTRAINT自体で失敗する。それ自体は「気付ける」
-- という意味で正しい挙動だが、素のCHECK違反メッセージだけでは何件・何が原因か分からないため、
-- 先に件数を数えて分かりやすい文言で止める(黙って行を捨てたり無理やり変換したりはしない)。
DO $$
DECLARE
  bad_count integer;
BEGIN
  SELECT count(*) INTO bad_count FROM "attendance_days" WHERE jsonb_typeof("row_data") <> 'object';
  IF bad_count > 0 THEN
    RAISE EXCEPTION
      'attendance_days.row_data がobjectでない行が%件あります。CHECK制約(attendance_days_row_data_object)を追加する前に手動で確認・修正してください。',
      bad_count;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_row_data_object" CHECK (jsonb_typeof("attendance_days"."row_data") = 'object');
