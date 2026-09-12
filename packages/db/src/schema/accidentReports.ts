import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { TENANT_RLS_USING } from './_rls';
import { customers } from './customers';
import { staff } from './staff';
import { tenants } from './tenants';

/**
 * 事故報告/ヒヤリハット。GAS版の「事故報告」シート(ACCIDENT_SHEET_NAME)に対応
 * (Main.js saveAccidentReport/getCustomerReports)。
 *
 * occurredAtは保存日時(GAS版は常にnew Date()で、訪問日時の指定はできない)。reportTypeは
 * '事故報告'/'ヒヤリハット'の分類。
 *
 * 【保存方針(2026-09 データベース暗号化の見直し)】
 * 対象児の氏名・生年月日、発生状況・対応内容などの本文は packages/core/src/domain/reports/types.ts
 * の AccidentReportContent と1:1の平文 text 列に分けて保存する。以前はJSONにまとめて1本の暗号文に
 * していたが、フィールド単位の暗号化は app_settings の資格情報だけに縮小した。
 * - 項目ごとの列にするのは、SQLで直接検索・集計(将来は全文検索インデックス付与)できるようにするため。
 *   事故報告の本文も将来の分析・AI活用の対象で、平文でSQLから扱える方が匿名化・統計化も実装しやすい。
 * - 保護はDB/バックアップの保存時暗号化 + RLS + アクセス制御で行う。
 * - 各列の DEFAULT '' は、行が残っているDBでも ADD COLUMN ... NOT NULL が失敗しないようにするため
 *   (既存行の本文は空になる=既存の暗号化済みデータは引き継がない、という決定に沿う)。
 */
export const accidentReports = pgTable(
  'accident_reports',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    staffId: uuid().notNull(),
    customerId: uuid().notNull(),

    occurredAt: timestamp({ withTimezone: true }).notNull(),
    /** '事故報告' | 'ヒヤリハット'。GAS版のReportType列と同じ値をそのまま使う。 */
    reportType: text().notNull(),

    /** 対象児(世帯構成員)の氏名。GAS版のTargetName列。 */
    targetName: text().notNull().default(''),
    // doc/14 §6: family_membersのdobと同じ理由でtargetDob(text)を分割する。
    /** 対象児の生年月日(parseDateOnlyで解析できた場合のみ)。不完全な表記はnullのまま。 */
    targetDobDate: date(),
    /** 対象児の生年月日の元表記('yyyy/MM/dd'。GAS版のTargetDob列と同じ)。常に保持する。 */
    targetDobRaw: text().notNull().default(''),
    occurrenceTime: text().notNull().default(''),
    location: text().notNull().default(''),
    accidentContent: text().notNull().default(''),
    situation: text().notNull().default(''),
    immediateResponse: text().notNull().default(''),
    parentCorrespondence: text().notNull().default(''),
    diagnosisTreatment: text().notNull().default(''),
    prevention: text().notNull().default(''),
    /** 元のメモ(口語入力)。GAS版のOriginalInput列。 */
    inputText: text().notNull().default(''),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    // dailyReports.tsと同じ理由(複合FKでテナント跨ぎの取り違えを構造的に防ぐ)。
    foreignKey({
      name: 'accident_reports_tenant_staff_fk',
      columns: [t.tenantId, t.staffId],
      foreignColumns: [staff.tenantId, staff.id],
    }),
    foreignKey({
      name: 'accident_reports_tenant_customer_fk',
      columns: [t.tenantId, t.customerId],
      foreignColumns: [customers.tenantId, customers.id],
    }),
    // dailyReports.tsと同じ理由(顧客の履歴表示が同じ形のクエリで走る)。
    index('accident_reports_tenant_customer_occurred_idx').on(t.tenantId, t.customerId, t.occurredAt.desc()),
    // 入口(API)・TypeScriptの型では値域を見ていなかった箇所(doc/14 §4)。GAS版と同じ表示文字列
    // をそのまま値として使う方針は変えず(上のコメント参照)、値域だけDBで縛る。
    check('accident_reports_report_type_check', sql`${t.reportType} IN ('事故報告', 'ヒヤリハット')`),
  ],
).enableRLS();
