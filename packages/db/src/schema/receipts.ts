import { sql } from 'drizzle-orm';
import {
  foreignKey,
  index,
  pgPolicy,
  pgTable,
  text,
  timestamp,
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
 * 正規化済み文字列をそのまま入れる(等値一致で照合。GAS版processReceiptImagesのbuildKeyと同じ挙動。
 * 以前のHMACブラインドインデックスは廃止)。金額または店舗名が空の場合はGAS版と同様に
 * 重複判定自体を行わないためnullになる。
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

    /** 金額(正規化済み文字列)。OCRで読めなかった場合はnull。 */
    amount: text(),
    /** 店舗名(正規化済み文字列)。 */
    storeName: text(),
    /** 申し送り(自由記述)。 */
    handoffText: text(),

    fileKey: text().notNull(),
    contentType: text().notNull(),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
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
    // findExistingDedupeKeys()の絞り込み(tenant_id + dedupe_key)を支えるインデックス。
    // 同時に同じ領収書が2リクエストで登録された場合にfindExistingDedupeKeysをすり抜けても
    // DB側で止めるため、dedupeKeyがある行に限定した一意インデックスにしている
    // (null同士は重複とみなさない=金額/店舗名が空でdedupeKeyがnullの行は複数許容)。
    uniqueIndex('receipts_tenant_dedupe_key_uidx')
      .on(t.tenantId, t.dedupeKey)
      .where(sql`${t.dedupeKey} IS NOT NULL`),
    // 顧客の領収書一覧を新しい順に返すクエリを索引だけで返すため(doc/14 C項)。
    // customerIdはnull許容だが、それでも(tenant_id, customer_id, ...)の複合索引として作る
    // (customerIdがnullの行はこの索引の対象外になるだけで、絞り込み自体は害にならない)。
    index('receipts_tenant_customer_timestamp_idx').on(t.tenantId, t.customerId, t.receiptTimestamp.desc()),
  ],
).enableRLS();
