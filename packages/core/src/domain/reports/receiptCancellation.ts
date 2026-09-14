import { addDaysToJstDateKey, jstDateKeyWithDayOfMonth, jstEndOfMonthDateKey } from './jstTime';

/**
 * 実費報告(領収書)の取り消し期限(doc/db/guidelines.md §10)。
 *
 * 期限の意味は**会計上のもの**で、「締めたあとに記録を動かさない」ためにある。
 * スプレッドシートへのミラー送信のスケジュールとは切り離してある(送信は登録と同時に始まる)。
 */

/**
 * 締め日まわりのテナント設定(app_settings)。値の検証はDBのCHECK制約と
 * packages/api/src/routes/settings.ts が行う。
 */
export interface ReceiptDeadlinePolicy {
  /**
   * 会計の締め日(1〜28)。nullは「月末」。
   *
   * 29〜31を選べないのは、2月に存在しない日ができてDB側で値を検証できなくなるため。
   * 月末で締める運用はnullで表す(「31日」ではない。31日締めは30日までの月で意味が変わる)。
   */
  closingDay: number | null;
  /** 領収書を取り消せる日数(暦日)。訪問保育は土日祝日も訪問があるため営業日では数えない。 */
  cancellableDays: number;
}

/** 設定が未登録のテナントで使う既定値。月末締め・取り消しは2日間。 */
export const DEFAULT_RECEIPT_DEADLINE_POLICY: ReceiptDeadlinePolicy = {
  closingDay: null,
  cancellableDays: 2,
};

/**
 * その領収書が属する締め期間の締め日('YYYY-MM-DD'・JST)。
 *
 * 締め日が月末(null)なら、その月の末日。日付指定(1〜28)なら、領収書の日付以降で
 * 最初に来るその日。20日締めなら 9/5 の領収書は 9/20、9/25 の領収書は 10/20 になる。
 */
export function receiptClosingDate(receiptDateStr: string, policy: ReceiptDeadlinePolicy): string {
  if (policy.closingDay === null) return jstEndOfMonthDateKey(receiptDateStr);
  const thisMonth = jstDateKeyWithDayOfMonth(receiptDateStr, policy.closingDay);
  // 締め日を過ぎて登録された領収書は、次の締め期間に入る。
  return receiptDateStr <= thisMonth
    ? thisMonth
    : jstDateKeyWithDayOfMonth(receiptDateStr, policy.closingDay, 1);
}

/**
 * その領収書を取り消せる最終日('YYYY-MM-DD'・JST)。
 *
 * 「領収書の日付 + cancellableDays」と「締め日」の早いほう。締めたあとに当期の記録が動くと
 * 会計が合わなくなるので、締め間際の領収書はそのぶん取り消せる期間が短くなる。
 *
 * 締め日を過ぎて登録された領収書は次の締め期間に入る(`receiptClosingDate`)ので、
 * この関数が領収書の日付より前の日を返すことはない。
 */
export function receiptCancellableUntil(receiptDateStr: string, policy: ReceiptDeadlinePolicy): string {
  const byDays = addDaysToJstDateKey(receiptDateStr, policy.cancellableDays);
  const closingDate = receiptClosingDate(receiptDateStr, policy);
  return byDays < closingDate ? byDays : closingDate;
}
