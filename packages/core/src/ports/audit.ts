/**
 * 監査ログのポート。
 *
 * 「暗号化に本当に価値を持たせるには、鍵管理の分離だけでなく“誰が・いつ・どのテナントの
 * データを触ったか”を追跡できることが必要」という2026-08 データベース構造レビューの指摘に
 * 対応するための仕組み。
 *
 * 記録するのは次の2種類:
 *
 * - 復号(`recordDecrypt`)。CryptoPort.decrypt が呼ばれるたびに、対象テナントと発生時刻を記録する。
 *   decrypt(tenantId, value) というシグネチャには呼び出し元(どのスタッフのどの操作か)が
 *   渡ってきておらず、usecases配下の全呼び出し箇所に配線するのは影響範囲が大きいため、
 *   ここでは「誰が」までは残さない。
 * - 認証・権限まわりのイベント(`record`)。ログインの成否、パスワードの変更・再設定、
 *   管理者によるスタッフ操作。こちらは呼び出し箇所が限られていて、かつ「誰が」が
 *   最も重要になる領域なので actorStaffId を持たせている。
 *
 * 氏名・住所・電話は平文列で持っているため、それらの参照は復号を経由せず、この監査の
 * 網には入らない。網羅的なデータアクセス監査が必要になった場合は、DB側の監査
 * (pgaudit等)と組み合わせる前提。
 *
 * 実装はCloud Run上ではstdout/stderrがそのままCloud Loggingに取り込まれるため、
 * ローカル開発・本番共通で `ConsoleAuditLogPort`(@katahimo/integrations)をそのまま使える。
 */

export interface AuditLogEntry {
  tenantId: string;
  /** 呼び出し元を辿るための最小限の手がかり(例: 'customer.name')。無くても記録自体は行う。 */
  context?: string;
}

/**
 * 認証・権限まわりの監査イベント。
 * 「いつ誰が入れた/入れなかったか」「誰がパスワードや権限を変えたか」を後から辿れるようにする。
 */
export type AuditEventType =
  | 'login_succeeded'
  | 'login_failed'
  | 'logout'
  | 'password_changed'
  | 'password_reset_requested'
  | 'password_reset_completed'
  | 'staff_created'
  | 'staff_updated'
  | 'staff_password_reset_by_admin';

export interface AuditEvent {
  type: AuditEventType;
  tenantId: string;
  /** 操作の主体。ログイン失敗など、主体を特定できない場合は省略する。 */
  actorStaffId?: string;
  /** 操作の対象になったスタッフ(管理者が他人を操作した場合)。 */
  targetStaffId?: string;
  /** 補足(失敗理由など)。個人情報やパスワードそのものは入れないこと。 */
  context?: string;
}

export interface AuditLogPort {
  recordDecrypt(entry: AuditLogEntry): void;
  /** 認証・権限まわりのイベントを記録する。 */
  record(event: AuditEvent): void;
}
