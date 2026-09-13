import { addDaysToJstDateKey, jstEndOfDay, jstEndOfMonthDateKey } from './jstTime';

/**
 * 実費報告(領収書)の取り消し期限と、ミラー送信を始めてよい時刻(doc/14 §10)。
 *
 * この2つを同じ場所で決めているのは、**ずれると取り消し済みの領収書が外部へ出てしまう**ため。
 * ミラー送信はスプレッドシートへの追記で、送ってしまうと取り消しても向こう側には残る。
 * 送信開始を「取り消せる期間が終わった直後」に合わせることで、その競合そのものを無くす。
 */

/** 取り消せる期間(日)。訪問保育は土日祝日も訪問があるため暦日で数える。 */
const CANCELLABLE_DAYS = 2;

/**
 * その領収書を取り消せる最終日('YYYY-MM-DD'・JST)。
 *
 * 領収書の日付+2日。ただし**その月の末日を越えない**。月末で会計を締めるため、
 * 締めたあとに前月の記録が動くと合わなくなる(月末近くの領収書は、そのぶん取り消せる
 * 期間が短くなる)。
 */
export function receiptCancellableUntil(receiptDateStr: string): string {
  const byDays = addDaysToJstDateKey(receiptDateStr, CANCELLABLE_DAYS);
  const endOfMonth = jstEndOfMonthDateKey(receiptDateStr);
  return byDays < endOfMonth ? byDays : endOfMonth;
}

/**
 * その領収書のミラー送信を始めてよい時刻(outbox_jobs.next_attempt_at に入れる)。
 *
 * 取り消せる最終日の終わり = 翌日0時(JST)。ここまで送信を遅らせておけば、取り消しは
 * 必ず送信より前に起きるので、「送ったあとに取り消された」状態を作れない。
 *
 * 上の月末の打ち切りにより、9月の領収書が10月に送られることはない(月をまたいだ
 * ミラー送信をしない、という締めの要件をここで満たしている)。
 */
export function receiptMirrorSendAfter(receiptDateStr: string): Date {
  return jstEndOfDay(receiptCancellableUntil(receiptDateStr));
}
