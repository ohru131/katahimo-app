import type {
  AccidentReportRepositoryPort,
  AppSettingsRepositoryPort,
  AttendanceDayRepositoryPort,
  AuditLogPort,
  CouponRedemptionRepositoryPort,
  CouponRepositoryPort,
  CryptoPort,
  CustomerRepositoryPort,
  DailyReportRepositoryPort,
  FamilyMemberRepositoryPort,
  MailerPort,
  MapsPort,
  MirrorPort,
  NotifierPort,
  PasswordResetCodeRepositoryPort,
  ReceiptRepositoryPort,
  ReportAiPort,
  ReportAiPortFactory,
  SchedulePort,
  SessionRepositoryPort,
  StaffRepositoryPort,
  StoragePort,
  TenantRepositoryPort,
  UnitOfWorkPort,
} from '@katahimo/core/ports';
import type { PasswordHasherPort } from '@katahimo/core/usecases';

export interface GeminiModelInfo {
  name: string;
  displayName: string;
}

/**
 * ルートハンドラに配る依存一式。usecases(@katahimo/core)にそのまま渡す形。
 *
 * 型は必ずポート(インターフェース)で書くこと。DrizzleXxxRepositoryのような具象クラスで
 * 書くと「Node上でPostgresに繋いだ構成」以外を組み立てられなくなり、ヘキサゴナル構成の
 * 意味がなくなる。実際、ブラウザ上でPGliteを使う公開デモ(packages/demo)は同じ`createApp`に
 * 別の実装を差し込んで動いている。
 *
 * このファイルは型だけを持ち、実行時importを一切持たない。ルート群がここをimportしても
 * argon2(ネイティブバインディング)やpostgres-jsがバンドルに引きずり込まれないようにする
 * ためで、Node向けの組み立ては ./nodeContainer に分けてある。
 */
export interface Container {
  tenants: TenantRepositoryPort;
  staff: StaffRepositoryPort;
  sessions: SessionRepositoryPort;
  passwordResetCodes: PasswordResetCodeRepositoryPort;
  customers: CustomerRepositoryPort;
  familyMembers: FamilyMemberRepositoryPort;
  attendanceDays: AttendanceDayRepositoryPort;
  dailyReports: DailyReportRepositoryPort;
  accidentReports: AccidentReportRepositoryPort;
  receipts: ReceiptRepositoryPort;
  /** 割引クーポンの種別マスタ・適用記録(doc/14 §9)。 */
  coupons: CouponRepositoryPort;
  couponRedemptions: CouponRedemptionRepositoryPort;
  appSettings: AppSettingsRepositoryPort;
  /**
   * app_settingsの資格情報(Gemini APIキー・Google Chat Webhook URL)の暗号化/復号にだけ使う。
   * 顧客・日報等の業務データは平文列なので、ここを通らない(packages/core/src/ports/crypto.ts)。
   */
  crypto: CryptoPort;
  /** 資格情報の復号と、認証・権限まわりのイベントの監査ログ(packages/core/src/ports/audit.ts)。 */
  audit: AuditLogPort;
  passwordHasher: PasswordHasherPort;
  storage: StoragePort;
  notifier: NotifierPort;
  mailer: MailerPort;
  /** パスワード再設定コードの検証子を計算する鍵(環境変数 PASSWORD_RESET_PEPPER)。 */
  resetCodePepper: string;
  /** テナントがapp_settingsに独自キーを設定していない場合のフォールバック(.env設定 or Noop)。 */
  reportAi: ReportAiPort;
  /** テナント固有のGemini APIキー/モデルで都度ReportAiPortを組み立てるためのファクトリ。 */
  reportAiFactory: ReportAiPortFactory;
  /** 管理者設定画面の「最新モデル一覧を取得」用。保存前の入力中キーでも確認できるよう独立させている。 */
  listGeminiModels: (apiKey: string) => Promise<GeminiModelInfo[]>;
  /**
   * ジオコーディング/ルート計算。GAS_BRIDGE_URL/GAS_BRIDGE_SECRETが設定されていれば
   * gas-childcare-visit-appのWeb App(Bridge.js)をプロキシとして使い、未設定ならNoopMapsPort
   * (常にnull)にフォールバックする。
   */
  maps: MapsPort;
  /**
   * 「今日/明日の予定」閲覧。GAS_BRIDGE_URL/GAS_BRIDGE_SECRETが設定されていれば
   * gas-childcare-visit-appのWeb App(Bridge.js、既存のカレンダー解析・ルート計算ロジックを
   * そのまま使う)をプロキシとして使い、未設定ならNoopSchedulePort(常に予定なし)に
   * フォールバックする。
   */
  schedule: SchedulePort;
  /**
   * 日報/事故報告/領収書/勤怠のミラー書き込み要求をoutboxに積む(Phase 5)。実際の送信
   * (GAS版スプレッドシート/Driveへの反映)はAPIサーバーではなくワーカー(packages/worker)が行う。
   */
  mirror: MirrorPort;
  /**
   * 勤怠の保存時に「勤怠集計」シートの再計算(`attendance_aggregate`)も積むか
   * (`MIRROR_ATTENDANCE_AGGREGATE`、既定false)。ジョブ1件ごとにGAS側でMapsのルート計算が
   * 走るため、既定では積まない(packages/core/src/usecases/attendance.ts の AttendanceDeps 参照)。
   */
  mirrorAttendanceAggregate: boolean;
  /**
   * 複数リポジトリにまたがる書き込みを1つのトランザクションにまとめる。
   * ドメインの行とoutbox_jobsのように、揃って確定しなければ意味がない書き込みで使う
   * (packages/core/src/ports/unitOfWork.ts)。
   */
  unitOfWork: UnitOfWorkPort;
  /** GAS版 Script Properties AUTH_SALT と同じ値。移行済みスタッフのログインにのみ使う。 */
  legacyAuthSalt?: string;
}
