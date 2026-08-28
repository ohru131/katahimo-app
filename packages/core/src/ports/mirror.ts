/**
 * ミラー(DB → Googleスプレッドシート等)のポート。
 *
 * 新システムでは PostgreSQL が唯一の正データで、スプレッドシートは互換維持のための
 * 書き戻し先でしかない。ドメインは「ミラー要求をoutboxに積む」ところまでしか知らず、
 * 実際にどのスプレッドシートのどのセルに書くかは実装側(@katahimo/integrations)が持つ。
 *
 * スプレッドシート脱却時は、ミラーワーカー側でアダプタを無効化するだけでよい。
 */

/** ミラー対象の種類。outbox_jobs.kind に対応する。 */
export type MirrorKind =
  /** 個別出勤簿スプレッドシートの1日分の行(入力列のみ・値のみ。数式セルには触れない) */
  | 'attendance_day'
  /** 「勤怠集計」スプレッドシートの集約行 */
  | 'attendance_aggregate'
  /** 「日報」シートへの追記 */
  | 'daily_report'
  /** 「事故報告」シートへの追記 */
  | 'accident_report'
  /** 領収書ログシート + Driveフォルダへの保存 */
  | 'receipt'
  /** Googleカレンダーの予定 */
  | 'calendar_event';

export interface MirrorJob {
  tenantId: string;
  kind: MirrorKind;
  /** ミラー対象のドメインレコードID。ワーカーはこれを元にDBから最新値を読み直す。 */
  targetId: string;
  /** 冪等キー。同じキーのジョブは1回だけ適用されればよい。 */
  idempotencyKey: string;
}

export interface MirrorPort {
  /**
   * ミラー要求をoutboxに積む。ドメインの書き込みと同一トランザクションで呼ぶこと
   * (積み損ね・二重積みを防ぐため)。実際の送信は非同期のワーカーが行う。
   */
  enqueue(job: MirrorJob): Promise<void>;
}
