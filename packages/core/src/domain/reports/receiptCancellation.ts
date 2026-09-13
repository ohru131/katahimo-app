import { addDaysToJstDateKey, jstDateKeyWithDayOfMonth, jstEndOfDay, jstEndOfMonthDateKey } from './jstTime';

/**
 * 実費報告(領収書)の取り消し期限と、ミラー送信を始めてよい時刻(doc/14 §10)。
 *
 * この2つを同じ場所で決めているのは、**ずれると取り消し済みの領収書が外部へ出てしまう**ため。
 * ミラー送信はスプレッドシートへの追記で、送ってしまうと取り消しても向こう側には残る。
 * 送信開始を「取り消せる期間が終わった直後」に合わせることで、その競合そのものを無くす。
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
  /**
   * ミラー送信を終える日を、締め日の何日前にするか。
   *
   * 0 なら締め日当日が送信日。既定の1は「締め日の前日に送り終える」= 締める時点では
   * 全部シートに出ている状態。0でも動くが、締め処理と同じ日に送ることになる。
   */
  mirrorLeadDays: number;
  /** 領収書を取り消せる日数(暦日)。訪問保育は土日祝日も訪問があるため営業日では数えない。 */
  cancellableDays: number;
}

/**
 * 設定が未登録のテナントで使う既定値。月末締め・締め日の1日前までに送信・取り消しは2日間。
 *
 * `mirrorLeadDays: 1` により、月末近くの領収書も**その月のうちに**送信が始まる
 * (前月分が翌月に送られることが無い)。
 */
export const DEFAULT_RECEIPT_DEADLINE_POLICY: ReceiptDeadlinePolicy = {
  closingDay: null,
  mirrorLeadDays: 1,
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
 * その領収書のミラー送信を行う日('YYYY-MM-DD'・JST)。締め日の `mirrorLeadDays` 日前。
 *
 * 「この日のうちに送り終える」という意味なので、送信開始はこの日の0時。
 * 取り消せるのはその**前日まで**になる(`receiptCancellableUntil`)。
 */
export function receiptMirrorFlushBy(receiptDateStr: string, policy: ReceiptDeadlinePolicy): string {
  return addDaysToJstDateKey(receiptClosingDate(receiptDateStr, policy), -policy.mirrorLeadDays);
}

/**
 * その領収書を取り消せる最終日('YYYY-MM-DD'・JST)。
 *
 * 「領収書の日付 + cancellableDays」と「送信日の前日」の早いほう。締めるまでにシートへ
 * 出ていることを優先するので、締め間際の領収書はそのぶん取り消せる期間が短くなる。
 *
 * **送信日そのものは取り消せる期間に含めない。** 含めると送信開始(取り消せる最終日の翌日0時)が
 * 送信日の翌日になり、「送信日のうちに送り終える」という `receiptMirrorFlushBy` の約束を破る。
 * 前日で切ることで、送信は**遅くとも**送信日の0時には始まり、その日のうちに終わる
 * (通常は「領収書の日付 + cancellableDays」のほうが先に来るので、もっと早く始まる。
 * 送信日は上限であって、毎回そこまで待つわけではない)。
 *
 * **締め間際に登録された領収書では、領収書の日付より前の日が返りうる**(取り消せる期間が
 * ゼロ、という意味)。呼び出し側はその場合、取り消しを受け付けず・送信を即座に始める。
 * 締め処理より後に記録が動くのを避けるため、意図してこうしている。
 */
export function receiptCancellableUntil(receiptDateStr: string, policy: ReceiptDeadlinePolicy): string {
  const byDays = addDaysToJstDateKey(receiptDateStr, policy.cancellableDays);
  const lastCancellableDay = addDaysToJstDateKey(receiptMirrorFlushBy(receiptDateStr, policy), -1);
  return byDays < lastCancellableDay ? byDays : lastCancellableDay;
}

/**
 * その領収書のミラー送信を始めてよい時刻(outbox_jobs.next_attempt_at に入れる)。
 *
 * 取り消せる最終日の終わり = 翌日0時(JST)。ここまで送信を遅らせておけば、期限内の
 * 取り消しは必ず送信より前に起きるので、「送ったあとに取り消された」状態を作れない。
 *
 * 締め間際の領収書は取り消せる最終日が送信日の前日になるので、送信開始が送信日の0時ちょうど
 * になる。それ以外は「領収書の日付 + cancellableDays」で決まり、もっと早く始まる。
 *
 * 取り消せる期間がゼロのとき(上記のとおり過去の日付が返るとき)は過去の時刻になり、
 * ワーカーが次の巡回で即座に拾う。締め間際は「取り消せること」より「締めるまでに
 * 出ていること」を優先する、という判断がここに出る。
 */
export function receiptMirrorSendAfter(receiptDateStr: string, policy: ReceiptDeadlinePolicy): Date {
  return jstEndOfDay(receiptCancellableUntil(receiptDateStr, policy));
}
