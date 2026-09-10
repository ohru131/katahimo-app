import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  numeric,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { TENANT_RLS_USING } from './_rls';
import { tenants } from './tenants';

/**
 * 顧客(利用世帯の代表者)。GAS版の「顧客DB_New」シートに対応。
 *
 * RESERVA(外部予約システム)の顧客CSVを1件も情報を落とさず取り込めるよう、CSVの全列に
 * 対応するカラムを持つ(packages/ingestion の reservaCsv パーサー参照)。
 *
 * 【保存方針(2026-09 データベース暗号化の見直し)】
 * 本テーブルの列は全て平文で保存する。以前は緊急連絡先・避難場所・メモ・Benefit会員ID・
 * 緯度経度をアプリ層で暗号化(ciphertext+keyVersion)していたが、フィールド単位の暗号化を
 * 資格情報(app_settings のAPIキー・Webhook URL)だけに縮小した。
 * - 保護はDB/バックアップの保存時暗号化(Cloud SQL等)+ TLS + RLS + アクセス制御で行う。
 *   秘密保持契約が求める「アクセス制限、通信および保存時の暗号化」はこの組み合わせで満たす。
 * - 平文にする理由は検索性と、将来の分析・AI活用でSQLから直接扱えるようにするため。
 * - 既存の暗号化済みデータは引き継がない(DBは作り直す前提)。
 *
 * 唯一の例外: CSVの「パスワード」列(RESERVA側のログインパスワード)は取り込まない。
 * この値は本アプリの認証に一切使わず、他システムの認証情報を不必要に複製する理由がないため
 * (漏洩時の被害範囲を広げるだけになる)。
 *
 * 氏名は「苗字だけで検索する」現場運用があるため、familyName/givenNameを別カラムに持つ
 * (packages/core/src/domain/pii/japaneseName.ts の splitJapaneseFullName で分割し、
 * normalizeStaffNameで正規化済みの値を保存する)。
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

    name: text().notNull(),
    /** 苗字だけの完全一致検索用(normalizeStaffNameで正規化済み)。表示にはnameを使う。 */
    familyName: text().notNull(),
    givenName: text().notNull(),

    familyNameKana: text(),
    givenNameKana: text(),

    email: text(),
    phone: text(),

    /** 番地・建物名等、市区町村より詳細な住所。 */
    addressDetail: text(),
    city: text(),

    /** 駐車場(位置)。RESERVA CSVの「駐車場」列。 */
    parkingArea: text(),
    /** 駐車場番号・指定場所の詳細など。 */
    parkingDetail: text(),

    /** 緊急連絡先(氏名・電話番号等)。RESERVA CSVの「緊急連絡先」列。 */
    emergencyContact: text(),
    /** 緊急連絡先の方(申請者との関係性)。例: "父"。 */
    emergencyContactRelation: text(),

    /** 災害時の避難場所(最寄りの小中学校)。 */
    evacuationSite: text(),

    /** 自由記述のメモ。 */
    memo: text(),

    /** Benefit会員ID(他システムの会員証番号)。 */
    benefitMemberId: text(),

    /** 住所2(単身赴任先等、期間限定の別住所)。 */
    address2: text(),
    address2StartDate: date(),
    address2EndDate: date(),

    // doc/14 G項: "38.26, 140.87"のような1本の文字列のままでは計算(距離・ジオフェンス・
    // 座標化しての仙台市報告)に使えないため、数値2列に分ける。浮動小数(double precision)を
    // 避けてnumeric(9,6)にするのは、金額(doc/14 A項)と同じく丸め誤差を持ち込まないため。
    // 小数第6位(約10cm)まで保持でき、日本国内の座標には十分。
    /** 緯度。RESERVA CSVの「緯度・経度」列から解析できた場合のみ。 */
    lat: numeric({ precision: 9, scale: 6 }),
    /** 経度。 */
    lng: numeric({ precision: 9, scale: 6 }),
    /** 緯度・経度の元表記。latLngRawはlat/lngの解析成否によらず常に保持する。 */
    latLngRaw: text(),

    // ── 以下は運用・分類情報 ──
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
    /** 年代(例: "30代")。生年月日そのものではなく既に丸められた区分。 */
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
    // daily_reports等からの複合外部キー(tenant_id, customer_id)の参照先。RLSはSELECTしか
    // 絞り込まずFK制約はRLSを常にバイパスするため、単一列PKだけでは他テナントのcustomer_idを
    // 誤って参照してもDBが検知できない。この複合UNIQUEにより「そのidが本当にそのtenant_idの
    // 顧客か」をFK制約自体で強制できるようにする。
    unique('customers_tenant_id_uk').on(t.tenantId, t.id),
    // 苗字だけの完全一致検索(searchCustomersByFamilyName)用。同姓の顧客が複数いる前提のため
    // UNIQUEにはしない。
    index('customers_tenant_family_name_idx').on(t.tenantId, t.familyName),
    // 入口(API)・TypeScriptの型では値域を見ていなかった箇所(doc/14 D項と同じ考え方)。
    // 解析に失敗した場合はlat/lngをnullにする方針(parseLatLng)のため、DB側はNULLのみ許容し、
    // 数値が入っているときだけ実在する座標の範囲かを見る。
    check('customers_lat_range', sql`${t.lat} IS NULL OR ${t.lat} BETWEEN -90 AND 90`),
    check('customers_lng_range', sql`${t.lng} IS NULL OR ${t.lng} BETWEEN -180 AND 180`),
  ],
).enableRLS();
