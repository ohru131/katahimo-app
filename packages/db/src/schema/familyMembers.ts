import { sql } from 'drizzle-orm';
import { date, foreignKey, index, pgPolicy, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { TENANT_RLS_USING } from './_rls';
import { customers } from './customers';
import { tenants } from './tenants';

/**
 * 世帯構成員(子ども・配偶者等)。GAS版の「家族DB_New」シートに対応。
 *
 * RESERVA CSVの「世帯全員の情報」欄(自由記述)を parseFamilyInfo() で構造化した結果を
 * そのまま保存する(packages/core/src/domain/legacyImport/parseFamilyInfo.ts)。
 *
 * 【保存方針(2026-09 データベース暗号化の見直し)】
 * 氏名・生年月日・付帯情報は平文列で保存する(以前はアプリ層で暗号化していたが、フィールド
 * 単位の暗号化は app_settings の資格情報だけに縮小した)。保護はDB/バックアップの保存時暗号化
 * + RLS + アクセス制御で行い、平文にすることで検索や将来の分析・AI活用にSQLから直接使える。
 * 既存の暗号化済みデータは引き継がない(DBは作り直す前提)。
 */
export const familyMembers = pgTable(
  'family_members',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    customerId: uuid().notNull(),

    /** 氏名。DEFAULT '' は行が残っているDBでも ADD COLUMN ... NOT NULL が失敗しないようにするため。 */
    name: text().notNull().default(''),

    // doc/14 §6: 生年月日を日付型にする。dob(text)は廃止し、date型のdobDateと元表記のdobRawに分ける。
    /**
     * 生年月日(parseDateOnlyで解析できた場合のみ)。'YYYY/M/D'のうち年だけ・年月だけの
     * ような不完全な表記は、1月1日等を勝手に補わずnullのままにする(dobRawにだけ残す)。
     */
    dobDate: date(),
    /**
     * 生年月日の元表記(normalizeDateStrで正規化済みの"YYYY/M/D"形式)。dobDateが
     * 解析できてもできなくても常にここへ保存する(自由記述由来で解析できない値も
     * 捨てると情報を失うため)。
     */
    dobRaw: text(),

    /** 職業・アレルギー・その他共有事項などの自由記述(parseFamilyInfoのinfo)。 */
    info: text(),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    // dailyReports.tsと同じ理由。
    foreignKey({
      name: 'family_members_tenant_customer_fk',
      columns: [t.tenantId, t.customerId],
      foreignColumns: [customers.tenantId, customers.id],
    }),
    // listByCustomer(WHERE tenant_id=? AND customer_id=?)を索引だけで返すため(doc/14 §3)。
    index('family_members_tenant_customer_idx').on(t.tenantId, t.customerId),
  ],
).enableRLS();
