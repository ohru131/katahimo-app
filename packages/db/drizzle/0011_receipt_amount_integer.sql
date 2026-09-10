ALTER TABLE "receipts" ADD COLUMN "amount_yen" integer;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "amount_raw" text;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "billing_type" text DEFAULT 'company_expense' NOT NULL;--> statement-breakpoint
-- CodeRabbit指摘対応: PostgreSQLのマイグレーションはその場で適用される
-- (REBUILD_REQUIRED_MIGRATIONSによる作り直しはブラウザ内IndexedDBのデモにしか効かず、
-- 開発者のローカルPostgreSQLには通用しない)。DROP COLUMN "amount" で消える前に、
-- 既存行の金額を amount_raw/amount_yen へ移しておく。
--
-- packages/core/src/domain/reports/receiptAmount.ts の computeReceiptAmount() と
-- 完全に同じ規則で変換する一時関数。単純な ::numeric キャストだと、"1000円" のような
-- 数値化できない文字列に当たった時点で例外が飛び移行全体が失敗するため、
-- EXCEPTION WHEN others で受けてNULLに落とす関数にする(0010の冒頭コメントの通り、
-- 関数本体の$$...$$の中に --> statement-breakpoint を入れてはいけない)。
CREATE FUNCTION "parse_receipt_amount_yen"("v" text) RETURNS integer AS $$
DECLARE
  cleaned text;
  n numeric;
BEGIN
  -- computeReceiptAmount()の「未入力(null/undefined/空文字)」および「空白だけの文字列」は
  -- 両方nullを返す分岐と同じ扱いにする(空白だけの文字列をNumber()に渡すと0円と解釈されて
  -- しまい、未入力と区別できなくなるため、normalizeAmount()を経由させる前にここで弾く)。
  IF v IS NULL OR btrim(v) = '' THEN
    RETURN NULL;
  END IF;
  -- normalizeAmount(): カンマを除去してtrimしてからNumber()相当の変換を試みる。
  cleaned := btrim(replace(v, ',', ''));
  BEGIN
    n := cleaned::numeric;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
  -- Math.round()相当。四捨五入(円未満の端数を切り捨てず丸める)。
  n := round(n);
  -- 負の金額は amount_yen に入れない。入れるとこの直後に足す CHECK
  -- (receipts_amount_yen_nonneg)が ADD CONSTRAINT 自体で失敗し、マイグレーション全体が
  -- 止まってしまう。値域外を NULL にして生値を amount_raw に残すのは、0013 の
  -- parse_lat_lng(値域外は両方 NULL)・parse_date_only(実在しない暦日は NULL)と同じ扱い。
  -- 情報は amount_raw に残るので失われない(領収書の金額は OCR 由来で負にはならない想定だが、
  -- 想定外の値でマイグレーションを止めるより、拾える形で残す方を選ぶ)。
  IF n < 0 THEN
    RETURN NULL;
  END IF;
  RETURN n::integer;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
-- amount_raw は normalizeText(String(amount)) || null と同じ(trimして空文字ならnull)。
-- amountが元々null/空文字/空白だけの場合もtrim結果が空文字になりnullになるので、
-- computeReceiptAmount()の早期returnぶんを別途分岐する必要はない。
UPDATE "receipts" SET
  "amount_raw" = NULLIF(btrim("amount"), ''),
  "amount_yen" = "parse_receipt_amount_yen"("amount");--> statement-breakpoint
DROP FUNCTION "parse_receipt_amount_yen"("v" text);--> statement-breakpoint
ALTER TABLE "receipts" DROP COLUMN "amount";--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_amount_yen_nonneg" CHECK ("receipts"."amount_yen" IS NULL OR "receipts"."amount_yen" >= 0);--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_billing_type_check" CHECK ("receipts"."billing_type" IN ('customer_billable', 'company_expense'));--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_billable_requires_customer" CHECK ("receipts"."billing_type" = 'company_expense' OR "receipts"."customer_id" IS NOT NULL);
