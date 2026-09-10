/**
 * DBアクセスのポート。実装はDrizzleスキーマを持つ @katahimo/db に置く
 * (このパッケージはDBクライアントに依存しないという境界を守るため、インターフェースだけ持つ)。
 */

import type { CouponDiscountKind } from '@katahimo/shared';
import type { AttendanceRowData } from '../domain/attendance/types';
import type { LoginThrottlePolicy } from '../domain/auth/loginThrottle';
import type { AccidentReportContent, DailyReportContent } from '../domain/reports/types';
import type { TransactionScope } from './unitOfWork';

// CouponDiscountKind(型)とCOUPON_DISCOUNT_KINDS(許可値の配列)は @katahimo/shared が正
// (doc/14 4.1章。DB・core・APIルート・画面の全てが同じ配列を参照することで許可値のズレを
// 防ぐ、attendance.tsのMAX_VISITS/MAX_OFFICE_WORKと同じ方針)。ここでは型だけ再exportし、
// このファイル内の他の型定義から従来通り `CouponDiscountKind` として参照できるようにする。
export type { CouponDiscountKind } from '@katahimo/shared';

/**
 * アプリ層で暗号化して保存する値(CryptoPort.encryptの結果)。使うのは app_settings の
 * 資格情報(Gemini APIキー・Webhook URL)だけで、顧客・日報等の業務データは平文列で持つ
 * (packages/core/src/ports/crypto.ts のヘッダー参照)。
 */
export interface EncryptedField {
  ciphertext: string;
  keyVersion: number;
}

export interface StaffRecord {
  id: string;
  tenantId: string;
  /**
   * 氏名・メール・電話は平文で保持する(2026-08のデータベース構造レビューを踏まえ、要配慮性の
   * 低い通常の個人情報はフィールド暗号化の対象から外し、DB/バックアップの透過的暗号化(TDE)+
   * Row Level Security+アクセス制御に委ねる方針へ変更。doc/09参照)。emailは大文字小文字・
   * 前後空白を無視できるよう、書き込み時に`normalizeEmailForIndex`で正規化した値を保存する
   * (ログイン時の検索キーとして使うため、表記ゆれで一致しないと困る)。
   */
  name: string;
  email: string;
  phone: string | null;
  /** argon2id。GAS版から移行し未ログインのスタッフはnull(legacyPasswordHashのみ持つ)。 */
  passwordHash: string | null;
  /** GAS版のsha256(password+AUTH_SALT)。argon2idへの再ハッシュが完了したらnullに戻す。 */
  legacyPasswordHash: string | null;
  isAdmin: boolean;
  retirementDate: string | null;
  /** 初期パスワードのまま。trueの間は本人がパスワードを変更するまで他の操作をさせない。 */
  mustChangePassword: boolean /** 連続ログイン失敗回数。ログイン成功で0に戻る(domain/auth/loginThrottle.ts)。 */;
  failedLoginAttempts: number;
  /** この時刻まではログインを受け付けない。過ぎていれば通常どおり。 */
  lockedUntil: Date | null;
}

export interface NewStaffInput {
  tenantId: string;
  name: string;
  email: string;
  phone?: string | null;
  /** 新規登録は必ずargon2idを渡す。GAS版からの移行はlegacyPasswordHashを渡し、こちらはnullにする。 */
  passwordHash?: string | null;
  legacyPasswordHash?: string | null;
  isAdmin: boolean;
  /** 管理者が初期パスワードを発行して作った場合はtrue。 */
  mustChangePassword?: boolean;
}

/** 管理者向け「対象スタッフ」セレクタ用の最小情報。 */
export interface ActiveStaffRecord {
  id: string;
  name: string;
}

/** 管理者のスタッフ管理画面が扱う情報。退職済みも含む全件を並べるために使う。 */
export interface StaffAdminRecord {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
  retirementDate: string | null;
  mustChangePassword: boolean;
}

/** 管理者によるスタッフ情報の更新。渡された項目だけを書き換える。 */
export interface UpdateStaffInput {
  name?: string;
  isAdmin?: boolean;
  /** 退職日。nullを渡すと在籍中に戻す。 */
  retirementDate?: string | null;
}

/**
 * パスワードの差し替え。認証(現在のパスワード確認・再設定コードの消費)が済んだ
 * あとの書き込みを1トランザクションにまとめるための入力。
 */
export interface ReplacePasswordInput {
  tenantId: string;
  staffId: string;
  passwordHash: string;
  mustChangePassword: boolean;
  /**
   * このスタッフの既存セッションを同じトランザクションで破棄するか。
   *
   * 別トランザクションに分けると、破棄だけ失敗したときに「パスワードは変わったのに
   * 攻撃者のログインは生きている」状態が残る。再設定の目的そのものが失われるため、
   * 破棄できないなら書き換えも巻き戻す。
   */
  revokeSessions: boolean;
  /**
   * 楽観ロック。渡した場合、現在のpassword_hashがこの値と一致するときだけ書き換える。
   *
   * 認証してから書き込むまでの間に別経路がパスワードを差し替えていたら、こちらの
   * 書き込みを捨てるために使う(管理者による初期パスワードの再発行を、生きている
   * 再設定コードで巻き戻せてしまうのを防ぐ)。
   */
  expect?: { passwordHash: string | null };
}

/** `stale` は`expect`と一致せず(または対象の行が無く)何も書かなかったことを表す。 */
export type ReplacePasswordResult = 'applied' | 'stale';

export interface StaffRepositoryPort {
  /** emailは呼び出し側が`normalizeEmailForIndex`で正規化済みの値を渡す前提(ログイン時の検索キー)。 */
  findByEmail(tenantId: string, email: string): Promise<StaffRecord | null>;
  findById(tenantId: string, staffId: string): Promise<StaffRecord | null>;
  create(input: NewStaffInput): Promise<StaffRecord>;
  /**
   * ログイン成功時、レガシーハッシュ(sha256+salt)をargon2idへサイレント再ハッシュする。
   * 本人の意思によるパスワード変更ではないので `mustChangePassword` には触れない。
   */
  upgradeToArgon2Hash(tenantId: string, staffId: string, passwordHash: string): Promise<void>;
  /**
   * パスワードを設定し直す(本人による変更・コードによる再設定・管理者による初期パスワード発行)。
   * レガシーハッシュは常にクリアし、`mustChangePassword` は呼び出し側が明示的に指定する。
   */
  replacePassword(input: ReplacePasswordInput, scope?: TransactionScope): Promise<ReplacePasswordResult>;
  /**
   * ログイン失敗を1回記録する。**加算とロック判定を行ロックの中でまとめて行うこと**。
   * 呼び出し側が現在値を読んでから絶対値を書き戻す形にすると、同時に届いた失敗が
   * 揃って加算前の値を読み、加算が消えて上限を回避できてしまう。
   *
   * 実際の遷移は `applyFailedLogin`(domain/auth/loginThrottle.ts)が決める。
   * ここにはその判断材料としてポリシーだけを渡す。
   */
  recordFailedLogin(tenantId: string, staffId: string, policy: LoginThrottlePolicy): Promise<void>;
  /** ログイン成功時に失敗回数とロックを消す。 */
  clearLoginFailures(tenantId: string, staffId: string): Promise<void>;
  /** 管理者のスタッフ管理画面用。退職済みも含む全件を返す。 */
  listAll(tenantId: string): Promise<StaffAdminRecord[]>;
  update(tenantId: string, staffId: string, input: UpdateStaffInput): Promise<void>;
  /**
   * 退職済み(retirementDateが今日以前)を除いた全スタッフ。GAS版PastSchedule.js
   * getActiveStaffNames_に対応(管理者が「対象スタッフ」を選ぶセレクタ用)。
   * 並び替えは呼び出し側(usecase)で行う。
   */
  listActive(tenantId: string): Promise<ActiveStaffRecord[]>;
}

export interface NewSessionInput {
  tenantId: string;
  staffId: string;
  tokenHash: string;
  expiresAt: Date;
}

export interface SessionRecord {
  id: string;
  tenantId: string;
  staffId: string;
  expiresAt: Date;
}

export interface SessionRepositoryPort {
  create(input: NewSessionInput): Promise<SessionRecord>;
  /**
   * そのスタッフのセッションを全て削除する。パスワードの再設定・変更時に呼び、
   * 乗っ取られていた場合に既存のログインを道連れで無効化する
   * (GAS版はセッションを残したままだった)。
   */
  deleteAllForStaff(tenantId: string, staffId: string): Promise<void>;
  /**
   * セッションCookieには `tenantId.rawToken` の形でテナントIDを含める(usecases/auth.ts の
   * encodeSessionCookie/decodeSessionCookie参照)ため、この検索は常にtenantIdが先に分かっている
   * 前提で呼ぶ。sessionsテーブルはRLS対象であり、tenantIdが分からないまま検索しようとすると
   * (app.tenant_idが未設定のため)常に0件になる、というRLSの設計上の制約に対応するための構造。
   */
  findByTokenHash(tenantId: string, tokenHash: string): Promise<SessionRecord | null>;
}

export interface IssuePasswordResetCodeInput {
  tenantId: string;
  staffId: string;
  /**
   * 6桁コードの検証子。サーバー側のペッパーを鍵にしたHMAC-SHA256(hex)。
   * 単純なハッシュにしないのは、6桁=100万通りしかなく、DBが漏れた時点で
   * オフラインで全パターンを試せば有効なコードを復元できてしまうため。
   */
  codeVerifier: string;
  expiresAt: Date;
}

export type ConsumeResetCodeResult =
  /** 検証子が一致し、その場で使用済みにした。 */
  | 'consumed'
  /** 有効なコードはあったが検証子が違う。試行回数を1つ加算した。 */
  | 'mismatch'
  /** 有効なコードが無い(未発行・期限切れ・使用済み・試行回数の上限に到達)。 */
  | 'unavailable';

export interface VerifyPasswordResetCodeInput {
  tenantId: string;
  staffId: string;
  codeVerifier: string;
  /** この回数の誤入力に達したコードは、期限内でも無効として扱う。 */
  maxFailedAttempts: number;
}

/**
 * パスワード再設定コードの保管。
 *
 * 「読んで、判定して、書く」を呼び出し側に分けて持たせない形にしている。分けると、
 * 同時に走ったリクエストが揃って古い試行回数を読み、上限をすり抜けて何度でも
 * 推測できてしまう(6桁しかないので、これは実際に効く攻撃になる)。
 * 発行と検証をそれぞれ1つの操作にまとめ、実装側がトランザクション+行ロックで守る。
 */
export interface PasswordResetCodeRepositoryPort {
  /**
   * 新しいコードを発行する。同じスタッフの未使用コードは同時に無効化する
   * (有効なコードが複数あると、総当たりの的がその数だけ増える)。
   */
  issue(input: IssuePasswordResetCodeInput): Promise<void>;
  /**
   * 有効なコードを行ロックしたうえで検証子を突き合わせ、一致すればその場で使用済みにする。
   * 一致しなければ試行回数を加算する。判定と更新が同じロックの中で完結する。
   */
  verifyAndConsume(
    input: VerifyPasswordResetCodeInput,
    scope?: TransactionScope,
  ): Promise<ConsumeResetCodeResult>;
  /** そのスタッフの未使用コードを全て使用済みにする。パスワードが別経路で変わったときに呼ぶ。 */
  consumeAllForStaff(tenantId: string, staffId: string): Promise<void>;
}

export interface TenantRecord {
  id: string;
  name: string;
  slug: string;
}

export interface NewTenantInput {
  name: string;
  slug: string;
}

export interface TenantRepositoryPort {
  findBySlug(slug: string): Promise<TenantRecord | null>;
  create(input: NewTenantInput): Promise<TenantRecord>;
  /** ミラーワーカー(packages/worker)がテナントごとにoutboxをポーリングするための全件取得。 */
  listAll(): Promise<TenantRecord[]>;
}

/**
 * 顧客プロファイル。RESERVA CSVの全列(パスワード列を除く)に対応するフィールドを持つ
 * (packages/db/src/schema/customers.ts参照)。
 *
 * 全項目を平文の文字列として保持する。個人情報はDB/バックアップの保存時暗号化(TDE相当)+
 * Row Level Security+アクセス制御で保護し、アプリ層のフィールド暗号化は掛けない
 * (2026-09の見直し。検索性と将来の分析・AI活用を優先。doc/09_データベース構造解説.md 1.3節参照)。
 */
export interface CustomerProfileFields {
  externalSource: string | null;
  externalId: string | null;
  familyNameKana: string | null;
  givenNameKana: string | null;
  email: string | null;
  phone: string | null;
  addressDetail: string | null;
  city: string | null;
  parkingArea: string | null;
  parkingDetail: string | null;
  emergencyContact: string | null;
  emergencyContactRelation: string | null;
  evacuationSite: string | null;
  memo: string | null;
  benefitMemberId: string | null;
  address2: string | null;
  address2StartDate: string | null;
  address2EndDate: string | null;
  /**
   * 緯度・経度(doc/14 G項)。DBの型はnumeric(9,6)(drizzle-orm上はstring)だが、
   * ポート層ではnumberにしている。numeric(9,6)の値域(整数部最大3桁+小数第6位)は
   * 倍精度浮動小数点が誤差なく表現できる有効桁数(約15〜17桁)に余裕で収まるため、
   * 金額(整数)のような丸め誤差の心配が無く、呼び出し側(usecase・API・画面)での
   * 扱いやすさを優先した。string<->numberの変換はリポジトリ実装(DrizzleCustomerRepository)
   * が担う。
   */
  lat: number | null;
  lng: number | null;
  /** 緯度・経度の元表記(RESERVA CSVの「緯度・経度」列)。lat/lngの解析成否によらず常に保持する。 */
  latLngRaw: string | null;
  memberType: string | null;
  memberStatus: string | null;
  paymentMethod: string | null;
  paymentStatus: string | null;
  gender: string | null;
  ageBracket: string | null;
  registeredAt: Date | null;
  externalLastUpdatedAt: Date | null;
}

export interface CustomerRecord extends CustomerProfileFields {
  id: string;
  tenantId: string;
  name: string;
  /** 苗字だけの完全一致検索用(`normalizeStaffName`で正規化済み)。表示にはnameを使う。 */
  familyName: string;
  givenName: string;
  deactivatedAt: Date | null;
}

export interface NewCustomerInput extends Partial<CustomerProfileFields> {
  tenantId: string;
  name: string;
  familyName: string;
  givenName: string;
}

/** 顧客の更新は「渡されたフィールドだけ上書きする」部分更新(PATCH)方式。 */
export type CustomerPatchInput = Partial<NewCustomerInput>;

export interface CustomerRepositoryPort {
  create(input: NewCustomerInput): Promise<CustomerRecord>;
  findById(tenantId: string, customerId: string): Promise<CustomerRecord | null>;
  /** 苗字(正規化済み)の完全一致検索。呼び出し側は`normalizeStaffName`で正規化済みの値を渡す前提。 */
  findByFamilyName(tenantId: string, familyName: string): Promise<CustomerRecord[]>;
  findByExternalId(
    tenantId: string,
    externalSource: string,
    externalId: string,
  ): Promise<CustomerRecord | null>;
  /** 差分取込の比較対象にする、有効(未deactivate)な外部ID一覧。 */
  listActiveExternalIds(tenantId: string, externalSource: string): Promise<string[]>;
  /**
   * 有効(未deactivate)な顧客を全件返す。GAS版Main.js fetchDataFromSheetが顧客DB全件を
   * 一度にクライアントへ返し、以後は絞り込み/並び替えをすべてブラウザ側で行っていたのと
   * 同じ「訪問先一覧」画面用の一覧取得に使う。
   */
  listActive(tenantId: string): Promise<CustomerRecord[]>;
  update(tenantId: string, customerId: string, patch: CustomerPatchInput): Promise<CustomerRecord>;
  /** 物理削除はせず、deactivatedAtを設定するソフトデリート。 */
  deactivate(tenantId: string, customerId: string): Promise<void>;
}

export interface FamilyMemberRecord {
  id: string;
  tenantId: string;
  customerId: string;
  name: string;
  /** 生年月日(parseDateOnlyで解析できた場合のみ。'YYYY-MM-DD')。doc/14 F項。 */
  dobDate: string | null;
  /** 生年月日の元表記('YYYY/M/D'。normalizeDateStrで正規化済み)。dobDateの解析成否によらず
   * 常に保持する(未取得ならnull)。 */
  dobRaw: string | null;
  /** 職業・アレルギー等の自由記述。 */
  info: string | null;
}

export interface NewFamilyMemberInput {
  tenantId: string;
  customerId: string;
  name: string;
  dobDate: string | null;
  dobRaw: string | null;
  info: string | null;
}

export interface FamilyMemberRepositoryPort {
  createMany(inputs: NewFamilyMemberInput[]): Promise<FamilyMemberRecord[]>;
  listByCustomerId(tenantId: string, customerId: string): Promise<FamilyMemberRecord[]>;
  /** 更新時は全件入れ替え(現在の世帯構成員一覧で置き換える)。誰が増減したかの追跡はしない。 */
  replaceForCustomer(
    tenantId: string,
    customerId: string,
    inputs: NewFamilyMemberInput[],
  ): Promise<FamilyMemberRecord[]>;
}

/**
 * 勤怠(出勤簿)1日分。rowDataは @katahimo/shared の attendanceRowDataSchema が定める
 * 永続形式(訪問・事務作業の配列 + 日次の距離/件数/備考。doc/14 B項)をそのままJSON(jsonb列)で
 * 持つ。労働時間・残業・距離集計等の派生値は保存しない(常にrowDataから都度計算する。
 * packages/db/src/schema/attendanceDays.ts参照。計算自体は列記号形式(AttendanceColumnRow)で
 * 行うため、呼び出し側でtoColumnRow()を通す)。
 */
export interface AttendanceDayRecord {
  id: string;
  tenantId: string;
  staffId: string;
  /** 'YYYY-MM-DD' */
  businessDate: string;
  rowData: AttendanceRowData;
  /** ミラーの冪等キーに使うレコードの版(buildMirrorIdempotencyKey参照)。 */
  updatedAt: Date;
}

export interface AttendanceDayRepositoryPort {
  findByStaffAndDate(
    tenantId: string,
    staffId: string,
    businessDate: string,
  ): Promise<AttendanceDayRecord | null>;
  /** 指定日のrowDataを丸ごと置き換える(無ければ作成)。入力列だけを持つ設計のため部分更新の概念が無い。 */
  upsert(
    tenantId: string,
    staffId: string,
    businessDate: string,
    rowData: AttendanceRowData,
    scope?: TransactionScope,
  ): Promise<AttendanceDayRecord>;
  /** ミラーワーカー(packages/worker)がoutbox_jobs.targetIdから対象レコードを読み直すために使う。 */
  findById(tenantId: string, id: string): Promise<AttendanceDayRecord | null>;
  /** yearMonthは 'YYYY-MM'。月次集計(computeMonthlyTotals)の入力に使う。 */
  listByStaffAndMonth(tenantId: string, staffId: string, yearMonth: string): Promise<AttendanceDayRecord[]>;
  /** startDate〜endDateは両端とも 'YYYY-MM-DD' で含む。週間予定UI(Googleカレンダー風表示)の入力に使う。 */
  listByStaffAndDateRange(
    tenantId: string,
    staffId: string,
    startDate: string,
    endDate: string,
  ): Promise<AttendanceDayRecord[]>;
}

/**
 * 保育日報1件。contentは packages/core/src/domain/reports/types.ts の DailyReportContent
 * (開始/終了時刻・メモ・社内向け/保護者向けレポート本文)。DB上は項目ごとの平文列で持ち、
 * SQLからの検索・集計や将来のAI活用(日報からの傾向分析)にそのまま使える形にしている
 * (packages/db/src/schema/dailyReports.ts参照)。
 */
export interface DailyReportRecord {
  id: string;
  tenantId: string;
  staffId: string;
  customerId: string;
  occurredAt: Date;
  riskRating: number | null;
  esRating: number | null;
  /**
   * 開始/終了時刻(doc/14 F項)。未入力はnull。occurredAtとの関係は
   * packages/db/src/schema/dailyReports.tsのヘッダーコメント参照。
   */
  startedAt: Date | null;
  endedAt: Date | null;
  content: DailyReportContent;
  /** ミラーの冪等キーに使うレコードの版(buildMirrorIdempotencyKey参照)。 */
  updatedAt: Date;
}

export interface NewDailyReportInput {
  tenantId: string;
  staffId: string;
  customerId: string;
  occurredAt: Date;
  riskRating: number | null;
  esRating: number | null;
  startedAt: Date | null;
  endedAt: Date | null;
  content: DailyReportContent;
}

export interface DailyReportRepositoryPort {
  create(input: NewDailyReportInput, scope?: TransactionScope): Promise<DailyReportRecord>;
  /** 既存行の上書き保存(GAS版saveReportのrowIndex指定更新に相当)。存在しない/他テナントのIDならnullを返す。 */
  update(
    tenantId: string,
    id: string,
    input: NewDailyReportInput,
    scope?: TransactionScope,
  ): Promise<DailyReportRecord | null>;
  findById(tenantId: string, id: string): Promise<DailyReportRecord | null>;
  /**
   * 指定顧客の日報を occurredAt 降順で取得する。beforeを渡した場合は occurredAt < before のみ
   * (カーソルページネーション。GAS版getCustomerReportsのstartAfterTimeに相当)。
   */
  listByCustomer(
    tenantId: string,
    customerId: string,
    before: Date | null,
    limit: number,
  ): Promise<DailyReportRecord[]>;
}

/**
 * 割引クーポンの種別マスタ1件(doc/14 4.1章)。回数券(枚数を発行して減らしていくもの)は
 * 運用に無いことを確認済みのため残枚数を持たない(packages/db/src/schema/coupons.ts参照)。
 */
export interface CouponRecord {
  id: string;
  tenantId: string;
  /** 運用上の識別子(例 'INTRO500')。テナント内で一意。 */
  code: string;
  name: string;
  discountKind: CouponDiscountKind;
  /** discountKind='amount'のときのみ値を持つ。 */
  discountAmountYen: number | null;
  /** discountKind='percent'のときのみ値を持つ(1〜100)。 */
  discountPercent: number | null;
  /** 有効期間の下限('YYYY-MM-DD')。nullは下限なし。 */
  validFrom: string | null;
  /** 有効期間の上限('YYYY-MM-DD')。nullは無期限。 */
  validTo: string | null;
  /**
   * false=廃止済み。廃止しても行は消さない(過去の適用記録coupon_redemptionsから
   * 複合FKで参照されているため。消すと履歴が壊れる)。
   */
  active: boolean;
  note: string | null;
}

export interface NewCouponInput {
  tenantId: string;
  code: string;
  name: string;
  discountKind: CouponDiscountKind;
  discountAmountYen: number | null;
  discountPercent: number | null;
  validFrom: string | null;
  validTo: string | null;
  active: boolean;
  note: string | null;
}

/** 管理者によるクーポンの更新は「渡された項目だけ上書きする」部分更新(PATCH)方式。 */
export type CouponPatchInput = Partial<Omit<NewCouponInput, 'tenantId'>>;

export interface CouponRepositoryPort {
  /** 管理者向けクーポン管理画面用。廃止済み(active=false)も含む全件。 */
  listAll(tenantId: string): Promise<CouponRecord[]>;
  findById(tenantId: string, couponId: string): Promise<CouponRecord | null>;
  create(input: NewCouponInput): Promise<CouponRecord>;
  /** 存在しない/他テナントのIDならnullを返す。 */
  update(tenantId: string, couponId: string, patch: CouponPatchInput): Promise<CouponRecord | null>;
}

/**
 * 日報1件への割引クーポン適用記録1件(doc/14 4.1章)。discountKind/discountAmountYen/
 * discountPercentは、適用した瞬間のcouponsマスタの値を複製したスナップショット
 * (あとでマスタの割引額を書き換えても、ここは動かない。packages/db/src/schema/coupons.ts
 * のヘッダーコメント参照)。顧客IDは持たない(日報から引ける。二重に持つと日報側の顧客と
 * 食い違う状態を作れてしまうため)。
 */
export interface CouponRedemptionRecord {
  id: string;
  tenantId: string;
  dailyReportId: string;
  couponId: string;
  appliedAt: Date;
  discountKind: CouponDiscountKind;
  discountAmountYen: number | null;
  discountPercent: number | null;
  note: string | null;
}

export interface NewCouponRedemptionInput {
  tenantId: string;
  dailyReportId: string;
  couponId: string;
  /** usecase側(saveDailyReport)がcouponsマスタから写して渡す。呼び出し側で改変しないこと。 */
  discountKind: CouponDiscountKind;
  discountAmountYen: number | null;
  discountPercent: number | null;
  note?: string | null;
}

export interface CouponRedemptionRepositoryPort {
  /**
   * 指定日報の適用記録を「削除して入れ直す」。familyMembers.replaceForCustomerと同じ方針
   * (usecases/reports.tsのsaveDailyReportのコメント参照)。差分更新(元々ある行を維持しつつ
   * 増減だけ反映する)にしないのは、編集でクーポンを外した場合にその行が残ってしまう事故を
   * 構造的に起こせなくするため。
   *
   * 日報の作成/更新と同じトランザクション(scope)で呼ぶこと。片方だけ確定する状態を
   * 作らないため(unitOfWork.ts参照)。
   */
  replaceForDailyReport(
    tenantId: string,
    dailyReportId: string,
    inputs: NewCouponRedemptionInput[],
    scope?: TransactionScope,
  ): Promise<CouponRedemptionRecord[]>;
  listByDailyReportId(tenantId: string, dailyReportId: string): Promise<CouponRedemptionRecord[]>;
  /** 日報履歴一覧のようにN件まとめて表示する画面向け(1件ずつ引くN+1を避ける)。 */
  listByDailyReportIds(tenantId: string, dailyReportIds: string[]): Promise<CouponRedemptionRecord[]>;
}

/**
 * 事故報告/ヒヤリハット1件。contentは AccidentReportContent(DB上は項目ごとの平文列。
 * daily_reportsと同じ設計)。
 */
export interface AccidentReportRecord {
  id: string;
  tenantId: string;
  staffId: string;
  customerId: string;
  occurredAt: Date;
  reportType: string;
  content: AccidentReportContent;
  /** ミラーの冪等キーに使うレコードの版(buildMirrorIdempotencyKey参照)。 */
  updatedAt: Date;
}

export interface NewAccidentReportInput {
  tenantId: string;
  staffId: string;
  customerId: string;
  occurredAt: Date;
  reportType: string;
  content: AccidentReportContent;
}

export interface AccidentReportRepositoryPort {
  create(input: NewAccidentReportInput, scope?: TransactionScope): Promise<AccidentReportRecord>;
  update(
    tenantId: string,
    id: string,
    input: NewAccidentReportInput,
    scope?: TransactionScope,
  ): Promise<AccidentReportRecord | null>;
  findById(tenantId: string, id: string): Promise<AccidentReportRecord | null>;
  listByCustomer(
    tenantId: string,
    customerId: string,
    before: Date | null,
    limit: number,
  ): Promise<AccidentReportRecord[]>;
}

/**
 * 領収書の請求区分。'customer_billable'=顧客に請求する、'company_expense'=会社が立て替える
 * (doc/14 第4章)。DB(receipts_billing_type_check)と画面の両方でこの配列を使い回すことで、
 * 許可値がズレることを防ぐ。
 */
export const RECEIPT_BILLING_TYPES = ['customer_billable', 'company_expense'] as const;
export type ReceiptBillingType = (typeof RECEIPT_BILLING_TYPES)[number];

/**
 * 領収書登録1件。GAS版processReceiptImagesの1画像分に相当。amountYen/storeNameは未入力ならnull。
 */
export interface ReceiptRecord {
  id: string;
  tenantId: string;
  staffId: string;
  customerId: string | null;
  receiptTimestamp: Date;
  /** 金額(円)。集計・請求用の整数。OCRが読めなかった/数値化できなかった場合はnull。 */
  amountYen: number | null;
  /** OCRが返した金額の生文字列。amountYenがnullでも参照用に残す。 */
  amountRaw: string | null;
  storeName: string | null;
  handoffText: string | null;
  fileKey: string;
  contentType: string;
  /** 請求区分(doc/14 第4章)。 */
  billingType: ReceiptBillingType;
  /**
   * ミラーの冪等キーに使うレコードの版(buildMirrorIdempotencyKey参照)。
   * 領収書は追記しかしないため作成時刻。
   */
  createdAt: Date;
}

export interface NewReceiptInput {
  tenantId: string;
  staffId: string;
  customerId: string | null;
  receiptTimestamp: Date;
  /**
   * 重複登録検出用のキー(buildReceiptDedupeKeyの戻り値そのまま)。金額または店舗名が空で
   * 重複判定の対象外ならnull。dedupe_keyはamountYenではなく、従来どおりnormalizeAmount()の
   * 出力から作る(GAS版buildKeyと1文字も違えてはいけないため)。
   */
  dedupeKey: string | null;
  /** 金額(円)。集計・請求用の整数。数値化できなかった場合はnull(amountRawに生値を残す)。 */
  amountYen: number | null;
  /** OCRが返した金額の生文字列。未入力ならnull。 */
  amountRaw: string | null;
  storeName: string | null;
  handoffText: string | null;
  fileKey: string;
  contentType: string;
  /** 請求区分(doc/14 第4章)。customer_billableの場合customerIdがnullだとDB制約で拒否される。 */
  billingType: ReceiptBillingType;
}

export interface ReceiptRepositoryPort {
  create(input: NewReceiptInput, scope?: TransactionScope): Promise<ReceiptRecord>;
  /** ミラーワーカー(packages/worker)がoutbox_jobs.targetIdから対象レコードを読み直すために使う。 */
  findById(tenantId: string, id: string): Promise<ReceiptRecord | null>;
  /**
   * dedupeKeyの一致を確認する(GAS版processReceiptImagesの「シート上の既存データとの照合」
   * に相当)。バッチ内の重複は呼び出し側(usecase)がメモリ上で扱うため、ここはDBに既に永続化された
   * 行だけを対象にする。
   */
  findExistingDedupeKeys(tenantId: string, dedupeKeys: string[]): Promise<Set<string>>;
}

/**
 * テナント単位の管理者設定。GAS版Script Properties(GEMINI_API_KEY・GEMINI_MODEL_REPORT/OCR・
 * GCHAT_REPORT_WEBHOOK_URL/GCHAT_RECEIPT_WEBHOOK_URL)に対応する。値はAPIキー/Webhook URLの
 * ような機微情報のみ暗号化し、モデル名は平文(検索/表示にしか使わないため)。
 */
export interface AppSettingsRecord {
  tenantId: string;
  geminiApiKey: EncryptedField | null;
  geminiReportModel: string | null;
  geminiOcrModel: string | null;
  gchatReportWebhookUrl: EncryptedField | null;
  gchatReceiptWebhookUrl: EncryptedField | null;
}

/** 渡されたフィールドだけ上書きする部分更新(PATCH)。行が無ければ作成する(upsert)。 */
export type AppSettingsPatchInput = Partial<Omit<AppSettingsRecord, 'tenantId'>>;

export interface AppSettingsRepositoryPort {
  find(tenantId: string): Promise<AppSettingsRecord | null>;
  upsert(tenantId: string, patch: AppSettingsPatchInput): Promise<AppSettingsRecord>;
}

/**
 * テナントごとのDEK(データ暗号化鍵)。KeyManagementPort(./kms.ts)でラップされた状態でのみ
 * 保持し、平文DEKは常にCryptoPort実装のプロセス内メモリにしか存在しない
 * (packages/db/src/schema/tenantKeys.ts参照)。
 */
export interface TenantKeyRecord {
  tenantId: string;
  dekVersion: number;
  wrappedDek: string;
  kekVersion: number;
  revokedAt: Date | null;
}

export interface TenantKeyRepositoryPort {
  /** 現行世代(最新のdekVersion)を返す。新しい暗号化はこの鍵で行う。 */
  findCurrent(tenantId: string): Promise<TenantKeyRecord | null>;
  /**
   * 指定世代の鍵を返す。既存の暗号文は`*_key_version`にその世代を記録しているため、
   * ローテーション後もこの経路で復号できる。
   */
  findByVersion(tenantId: string, dekVersion: number): Promise<TenantKeyRecord | null>;
  /**
   * 新しい世代のDEKを追加する。初回(dekVersion=1)の生成と、ローテーションの両方に使う。
   * 既存の世代は残す(残さないと、その世代で暗号化した既存データが読めなくなる)。
   */
  create(
    tenantId: string,
    dekVersion: number,
    wrappedDek: string,
    kekVersion: number,
  ): Promise<TenantKeyRecord>;
  /** KEKローテーション時、DEK自体は変えずラップだけ新KEKバージョンで更新する(軽量操作)。 */
  updateWrappedDek(
    tenantId: string,
    dekVersion: number,
    wrappedDek: string,
    kekVersion: number,
  ): Promise<void>;
  /**
   * テナント解約時の暗号学的削除。全世代のDEKを失効させ、以後
   * (バックアップに残った暗号文も含め)復号を永久に不可能にする。
   */
  revoke(tenantId: string): Promise<void>;
}
