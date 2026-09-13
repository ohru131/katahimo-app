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

/**
 * ミラー対象の種類。outbox_jobs.kind に対応する。
 *
 * Googleカレンダーへのミラー(旧 `calendar_event`)は**対象外**として外した。GAS版は
 * カレンダーを読むだけで一度も書き込んでいない(`RouteSearch.js` の `CalendarApp` 呼び出しは
 * `getEvents`/`getMyStatus` のみ)。予定の作り手はRESERVAの予約連携とスタッフの手動操作で、
 * 書き戻し先そのものが存在しない。
 */
export type MirrorKind =
  /** 個別出勤簿スプレッドシートの1日分の行(入力列のみ・値のみ。数式セルには触れない) */
  | 'attendance_day'
  /**
   * 「勤怠集計」スプレッドシートの集約行。他の種別と違い、DBの値をそのまま書き写すのではなく
   * GAS側にカレンダー+Mapsからの再計算をやり直させる(RouteSearch.js の
   * `computeAttendanceRowDataForStaffOnDate_` + `writeAttendanceAggregateRows_`)。
   * 詳細は MirrorSenderPort の AttendanceAggregateMirrorPayload 参照。
   */
  | 'attendance_aggregate'
  /** 「日報」シートへの追記 */
  | 'daily_report'
  /** 「事故報告」シートへの追記 */
  | 'accident_report'
  /** 領収書ログシート + Driveフォルダへの保存 */
  | 'receipt';

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
  /**
   * この時刻まで送信を始めない(outbox_jobs.next_attempt_at)。省略すると即座に対象になる。
   *
   * 領収書がこれを使う(doc/14 §10)。スプレッドシートへの追記は送ってしまうと取り消せないため、
   * 取り消せる期間が終わるまで送信を遅らせて、「送ったあとに取り消された」状態そのものを作らない。
   */
  notBefore?: Date;
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
  /**
   * 指定した種別・対象IDのジョブの状態を返す(画面に「まだ外部へ送っていない」を出すため)。
   *
   * 領収書はミラー送信を取り消し期限まで遅らせるので、管理者が「いつ送られるのか」「送信に
   * 失敗して止まっていないか」を見られないと、締めのときに気付けない(doc/14 §10)。
   */
  listStatusByTargets(tenantId: string, kind: MirrorKind, targetIds: string[]): Promise<MirrorJobStatus[]>;
}

/** ミラー送信の状態1件。画面表示用。 */
export interface MirrorJobStatus {
  targetId: string;
  status: 'pending' | 'processing' | 'done' | 'failed';
  /** pendingのとき、この時刻以降に送信される。 */
  nextAttemptAt: Date;
  /** 最後の失敗理由(failed/再試行待ちのとき)。 */
  lastError: string | null;
}
