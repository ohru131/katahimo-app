/**
 * ミラー(DB → Googleスプレッドシート等)のポート。
 *
 * 新システムでは PostgreSQL が唯一の正データで、スプレッドシートは互換維持のための
 * 書き戻し先でしかない。ドメインは「ミラー要求をoutboxに積む」ところまでしか知らず、
 * 実際にどのスプレッドシートのどのセルに書くかは実装側(@katahimo/integrations)が持つ。
 *
 * スプレッドシート脱却時は、ミラーワーカー側でアダプタを無効化するだけでよい。
 */

import type { TransactionScope } from './unitOfWork';

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
  /**
   * 冪等キー。同じキーのジョブは1回だけ適用されればよい。
   * `buildMirrorIdempotencyKey`(domain/mirror)で「レコードIDとその版」から組み立てる。
   */
  idempotencyKey: string;
}

export interface MirrorPort {
  /**
   * ミラー要求をoutboxに積む。
   *
   * ドメインの書き込みと**同一トランザクションで**呼ぶこと。片方だけが確定すると、
   * 保存はできたのにスプレッドシートへ永久に反映されない(しかも取り残されたことに
   * 気づけない)行が生まれる。そのため `scope` は省略可能ではあるが、ドメインの
   * 書き込みと対で呼ぶ通常の経路では必ず渡す(呼び出し側は UnitOfWorkPort.run の中で
   * 書き込みとenqueueを揃える)。実際の送信は非同期のワーカーが行う。
   */
  enqueue(job: MirrorJob, scope?: TransactionScope): Promise<void>;
}

/** ミラーワーカー(packages/worker)がoutbox_jobsから取り出す1件分。 */
export interface OutboxJobRecord {
  id: string;
  tenantId: string;
  kind: MirrorKind;
  targetId: string;
  /**
   * 取得(claim)のたびに1増える。再試行の待ち時間と、デッドレターに落とす上限の判定に使う
   * (packages/core/src/domain/mirror/retry.ts)。
   */
  attempts: number;
}

/**
 * outbox_jobsテーブルへのアクセス(積む側のMirrorPortに加え、ワーカーが処理するための取得・
 * 完了/失敗マークまでを含む)。実装は@katahimo/dbに置く(DrizzleOutboxRepository)。
 */
export interface OutboxRepositoryPort extends MirrorPort {
  /**
   * pending状態のジョブを最大limit件、processingへ遷移させながら取得する。
   * ワーカーはテナントごとにポーリングする(outbox_jobsはRLS対象のため、
   * テナントを跨いで一度に取得することはできない。packages/worker/src/main.ts参照)。
   */
  claimPending(tenantId: string, limit: number): Promise<OutboxJobRecord[]>;
  markDone(tenantId: string, id: string): Promise<void>;
  /**
   * 失敗を記録する。`nextAttemptAt` を渡すとその時刻以降に再度claimされる(pendingへ戻す)。
   * nullを渡すと `failed`(デッドレター)で終端させ、以後は自動では拾わない。
   * どちらにするかは再試行ポリシー(domain/mirror/retry.ts)が決める。
   */
  markFailed(tenantId: string, id: string, error: string, nextAttemptAt: Date | null): Promise<void>;
}
