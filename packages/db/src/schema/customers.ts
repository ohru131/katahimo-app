import { sql } from 'drizzle-orm';
import { date, integer, pgPolicy, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { TENANT_RLS_USING } from './_rls';
import { tenants } from './tenants';

/**
 * 顧客(利用世帯の代表者)。GAS版の「顧客DB_New」シートに対応。
 *
 * RESERVA(外部予約システム)の顧客CSVを1件も情報を落とさず取り込めるよう、CSVの全列に
 * 対応するカラムを持つ(packages/ingestion の reservaCsv パーサー参照)。個人特定につながる
 * 項目は全てランダム化暗号(ciphertext+keyVersion)で保存し、検索が必要な項目だけ別途
 * blindIndex(HMAC)を持つ(packages/core/src/ports/crypto.ts参照)。
 *
 * 唯一の例外: CSVの「パスワード」列(RESERVA側のログインパスワード)は取り込まない。
 * この値は本アプリの認証に一切使わず、他システムの認証情報を不必要に複製する理由がないため
 * (漏洩時の被害範囲を広げるだけになる)。
 *
 * 氏名は「苗字だけで検索する」現場運用があるため、familyName/givenNameのblindIndexを持つ
 * (packages/core/src/domain/pii/japaneseName.ts の splitJapaneseFullName で分割)。
 * externalSource/externalIdは、氏名の文字列一致ではなく外部システムのIDで顧客を一意に
 * 追跡するためのもの(doc/07 第5章の方針)。取込元に存在しなくなった顧客はdeactivatedAtを
 * 立てるソフトデリートとし、物理削除はしない。
 */
export const customers = pgTable(
  'customers',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),

    /** 取込元システム識別子(例: 'reserva')。手動登録の場合はnull。 */
    externalSource: text(),
    /** 取込元システムでの顧客ID(RESERVA CSVの「顧客ID」列)。 */
    externalId: text(),

    nameCiphertext: text().notNull(),
    nameKeyVersion: integer().notNull(),
    familyNameBlindIndex: text().notNull(),
    givenNameBlindIndex: text().notNull(),

    familyNameKanaCiphertext: text(),
    familyNameKanaKeyVersion: integer(),
    givenNameKanaCiphertext: text(),
    givenNameKanaKeyVersion: integer(),

    emailCiphertext: text(),
    emailKeyVersion: integer(),
    emailBlindIndex: text(),

    phoneCiphertext: text(),
    phoneKeyVersion: integer(),
    phoneBlindIndex: text(),

    /** 番地・建物名等、市区町村より詳細な住所。検索対象外なので暗号化のみでよい。 */
    addressDetailCiphertext: text(),
    addressDetailKeyVersion: integer(),

    cityCiphertext: text(),
    cityKeyVersion: integer(),
    cityBlindIndex: text(),

    /** 駐車場(位置)。RESERVA CSVの「駐車場」列。 */
    parkingAreaCiphertext: text(),
    parkingAreaKeyVersion: integer(),
    /** 駐車場番号・指定場所の詳細など。 */
    parkingDetailCiphertext: text(),
    parkingDetailKeyVersion: integer(),

    emergencyContactCiphertext: text(),
    emergencyContactKeyVersion: integer(),
    /** 緊急連絡先の方(申請者との関係性)。例: "父"。 */
    emergencyContactRelationCiphertext: text(),
    emergencyContactRelationKeyVersion: integer(),

    /** 災害時の避難場所(最寄りの小中学校)。場所を特定する情報のため暗号化する。 */
    evacuationSiteCiphertext: text(),
    evacuationSiteKeyVersion: integer(),

    memoCiphertext: text(),
    memoKeyVersion: integer(),

    /** Benefit会員ID。他システムの会員証番号のため、識別子として保守的に暗号化する。 */
    benefitMemberIdCiphertext: text(),
    benefitMemberIdKeyVersion: integer(),

    /** 住所2(単身赴任先等、期間限定の別住所)。 */
    address2Ciphertext: text(),
    address2KeyVersion: integer(),
    address2StartDate: date(),
    address2EndDate: date(),

    /** 緯度・経度。自宅の正確な位置情報のため、検索対象にはせず暗号化のみで保持する。 */
    latLngCiphertext: text(),
    latLngKeyVersion: integer(),

    // ── 以下は個人特定に直結しない運用・分類情報のため、暗号化せず平文で保持する ──
    /** 会員種別(例: Family Sitter 会員)。 */
    memberType: text(),
    /** 会員状況(有効／無効)。 */
    memberStatus: text(),
    /** 会費支払方法(現地決済／銀行振込／口座振替／請求書払い)。 */
    paymentMethod: text(),
    /** 会費支払状況(未払／支払済み)。 */
    paymentStatus: text(),
    /** 性別。 */
    gender: text(),
    /** 年代(例: "30代")。生年月日そのものではなく既に丸められた区分のため平文で扱う。 */
    ageBracket: text(),

    /** RESERVA側の登録日時(CSVのExcelシリアル日時から変換)。 */
    registeredAt: timestamp({ withTimezone: true }),
    /** RESERVA側の最終更新日時。このアプリ内でのupdatedAtとは別物。 */
    externalLastUpdatedAt: timestamp({ withTimezone: true }),

    /** 取込元に存在しなくなった場合に設定するソフトデリートのタイムスタンプ。nullなら有効。 */
    deactivatedAt: timestamp({ withTimezone: true }),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    uniqueIndex('customers_tenant_external_idx').on(t.tenantId, t.externalSource, t.externalId),
  ],
).enableRLS();
