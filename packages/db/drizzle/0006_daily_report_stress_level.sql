-- 保育日報のストレス度(PSI評価)の列名を stress_level にする。
--
-- 日報AIは「子の年齢帯 × 家庭の教育関心度 × 保護者のストレス度」の3軸で文面を組み替える
-- (doc/db/new-domains.md 第6章)。3軸目のストレス度は report_stress_levels / report_keywords /
-- report_phrases が stress_level という名前で持っており、日報側の列名もこれに揃える。
-- 列はそのまま改名するだけで、値の意味(1〜5。低いほど負担が大きい。未評価は NULL)は変わらない。
--
-- GASスプレッドシートへのミラー送信の項目名は Risk 列のままなので、そちら側は変えない
-- (packages/core/src/ports/mirrorSender.ts)。

ALTER TABLE "daily_reports" RENAME COLUMN "risk_rating" TO "stress_level";--> statement-breakpoint
ALTER TABLE "daily_reports" DROP CONSTRAINT "daily_reports_risk_rating_check";--> statement-breakpoint
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_stress_level_check" CHECK ("daily_reports"."stress_level" IS NULL OR "daily_reports"."stress_level" BETWEEN 1 AND 5);
