import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { TENANT_RLS_USING } from './_rls';
import { customers } from './customers';
import { staff } from './staff';
import { tenants } from './tenants';

/**
 * 領収書登録。GAS版のMain.js processReceiptImages/uploadReceiptsOnly(領収書ログスプレッドシート
 * IMAGE_LOG_SS_ID + Driveフォルダ RECEIPT_FOLDER_ID)に対応。
 *
 * receiptTimestampはOCRで読み取った領収書日時(無ければ登録時刻にフォールバック)。
 *
 * 【保存方針(2026-09 データベース暗号化の見直し)】
 * 金額・店舗名・申し送りは平文列で保存する(以前はアプリ層で暗号化していたが、フィールド単位の
 * 暗号化は app_settings の資格情報だけに縮小した)。保護はDB/バックアップの保存時暗号化 + RLS +
 * アクセス制御で行い、平文にすることで検索や将来の分析・AI活用にSQLから直接使える。
 *
 * dedupeKeyは「同一スタッフ・同一顧客・同一日時・同一金額・同一店舗名」の重複登録を検出する
 * ためのキーで、buildReceiptDedupeKey()(packages/core/src/domain/reports/receiptDedupe.ts)の
 * 正規化済み文字列をそのまま入れる(等値一致で照合。GAS版processReceiptImagesのbuildKeyと同じ挙動)。
 * 金額または店舗名が空の場合はGAS版と同様に重複判定自体を行わないためnullになる。
 *
 * 【doc/14 §1】金額はamountYen(集計・請求用の整数)とamountRaw(OCRの生文字列)の2列で持つ。
 * dedupeKeyはamountYenではなくnormalizeAmount()の出力から作る(GAS版buildKeyと1文字も
 * 違えてはいけないため。移行期に同じ領収書を重複と判定できなくなる)。amountYenはこのキーの材料に
 * 使い替えない。
 *
 * 【doc/14 §10】billingTypeは「顧客に請求する分/会社が立て替える分」を区別する。既定を
 * company_expense にしているのは、取りこぼし(スタッフが選び忘れた場合)が「うっかり顧客に
 * 請求してしまう」方向に転ばないようにするため。顧客に紐付かない領収書はcustomer_billableに
 * できない(receipts_billable_requires_customer)。
 *
 * fileKeyはStoragePort(領収書画像の実体。ローカル開発はファイルシステム、本番はGCS想定)の
 * 保存キー。GAS版のDriveアップロードに相当するが、正の保存先はオブジェクトストレージ側に変わる。
 */
export const receipts = pgTable(
  'receipts',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    staffId: uuid().notNull(),
    /** 顧客に紐付かない経費領収書(駐車場代等)もあり得るためnull許容。 */
    customerId: uuid(),

    receiptTimestamp: timestamp({ withTimezone: true }).notNull(),
    dedupeKey: text(),

    /** 金額(円)。集計・請求に使う整数。OCRが読めなかった/数値化できなかった場合はnull。 */
    amountYen: integer(),
    /** OCRが返した金額の生文字列。人が後から直すときの参照用(amountYenがnullでも残る)。 */
    amountRaw: text(),
    /** 店舗名(正規化済み文字列)。 */
    storeName: text(),
    /** 申し送り(自由記述)。 */
    handoffText: text(),

    fileKey: text().notNull(),
    contentType: text().notNull(),

    /**
     * 請求区分。'customer_billable'=顧客に請求する、'company_expense'=会社が立て替える。
     * 既定はcompany_expense(理由は上記コメント参照)。
     */
    billingType: text().notNull().default('company_expense'),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    check('receipts_amount_yen_nonneg', sql`${t.amountYen} IS NULL OR ${t.amountYen} >= 0`),
    check('receipts_billing_type_check', sql`${t.billingType} IN ('customer_billable', 'company_expense')`),
    // 顧客に紐付かない領収書(駐車場代等の会社経費)は、顧客請求にできない。
    check(
      'receipts_billable_requires_customer',
      sql`${t.billingType} = 'company_expense' OR ${t.customerId} IS NOT NULL`,
    ),
    // dailyReports.tsと同じ理由。customerIdがnullの行はPostgreSQLのMATCH SIMPLE(既定)により
    // FK制約の対象外になる(顧客に紐付かない経費領収書を許容する仕様と両立する)。
    foreignKey({
      name: 'receipts_tenant_staff_fk',
      columns: [t.tenantId, t.staffId],
      foreignColumns: [staff.tenantId, staff.id],
    }),
    foreignKey({
      name: 'receipts_tenant_customer_fk',
      columns: [t.tenantId, t.customerId],
      foreignColumns: [customers.tenantId, customers.id],
    }),
    // invoice_lines.receipt_id からの複合外部キー(tenant_id, receipt_id)の参照先。
    // customers.ts の customers_tenant_id_uk と同じ理由(RLSはFK制約をバイパスするため)。
    unique('receipts_tenant_id_uk').on(t.tenantId, t.id),
    // findExistingDedupeKeys()の絞り込み(tenant_id + dedupe_key)を支えるインデックス。
    // 同時に同じ領収書が2リクエストで登録された場合にfindExistingDedupeKeysをすり抜けても
    // DB側で止めるため、dedupeKeyがある行に限定した一意インデックスにしている
    // (null同士は重複とみなさない=金額/店舗名が空でdedupeKeyがnullの行は複数許容)。
    uniqueIndex('receipts_tenant_dedupe_key_uidx')
      .on(t.tenantId, t.dedupeKey)
      .where(sql`${t.dedupeKey} IS NOT NULL`),
    // 顧客の領収書一覧を新しい順に返すクエリを索引だけで返すため(doc/14 §3)。
    // customerIdはnull許容だが、それでも(tenant_id, customer_id, ...)の複合索引として作る
    // (customerIdがnullの行はこの索引の対象外になるだけで、絞り込み自体は害にならない)。
    index('receipts_tenant_customer_timestamp_idx').on(t.tenantId, t.customerId, t.receiptTimestamp.desc()),
  ],
).enableRLS();
