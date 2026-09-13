-- ミラー送信の遅延をやめたので receipt_mirror_lead_days を落とす(doc/14 §10)。
--
-- この列は「送信を取り消し期限の後ろにずらす」ために送信日を決める設定だった。
-- スプレッドシートは移行期の一時的な写しで正データではないため、遅らせる利得より
-- 「移行が済んでいない人が見ている間だけシートが空」という不利益のほうが大きい。
-- 送信は登録と同時に始める形へ戻し、取り消し期限は会計上のルール
-- (min(領収書の日付 + cancellable_days, 締め日))として締め日設定だけで決める。
--
-- receipts.cancellable_until は残す。設定変更で既存領収書の期限が動かないようにするためで、
-- 送信スケジュールとは無関係に意味がある。

ALTER TABLE "app_settings" DROP CONSTRAINT "app_settings_receipt_mirror_lead_days_check";--> statement-breakpoint
ALTER TABLE "app_settings" DROP COLUMN "receipt_mirror_lead_days";