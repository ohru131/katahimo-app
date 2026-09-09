/**
 * ミラージョブの再試行ポリシー。
 *
 * 送信先(GAS Web App)は実行時間制限やクォータを持つ外部サービスなので、失敗は
 * 恒久的な誤りとは限らない。一度の失敗で終端状態にすると、一時的な不調のたびに
 * スプレッドシートへの反映が人手の介入なしには二度と行われなくなる。
 * そこで指数バックオフで再試行し、上限に達したものだけを `failed`(デッドレター)に
 * 落として、運用が気づけるようにする。
 */

/** これ以上は再試行せずデッドレターに落とす試行回数。 */
export const MAX_OUTBOX_ATTEMPTS = 8;

const BASE_DELAY_MS = 5_000;
const MAX_DELAY_MS = 60 * 60 * 1000;

/**
 * 次の再試行までの待ち時間。attemptsは「これまでに何回取り出したか」(claim時に加算済み)。
 * 5秒から倍々で増え、1時間で頭打ちにする。上限に達していたらnull(=デッドレター)。
 */
export function nextOutboxRetryDelayMs(attempts: number): number | null {
  if (attempts >= MAX_OUTBOX_ATTEMPTS) return null;
  const exponent = Math.max(0, attempts - 1);
  return Math.min(BASE_DELAY_MS * 2 ** exponent, MAX_DELAY_MS);
}
