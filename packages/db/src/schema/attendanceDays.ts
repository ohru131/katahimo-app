import type { AttendanceRowData } from '@katahimo/core/domain';
import { sql } from 'drizzle-orm';
import {
  date,
  foreignKey,
  jsonb,
  pgPolicy,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { TENANT_RLS_USING } from './_rls';
import { staff } from './staff';
import { tenants } from './tenants';

/**
 * 勤怠(出勤簿)の1日分。GAS版の個別出勤簿スプレッドシートの入力列(数式列は含まない)に対応。
 *
 * 【保存方針(2026-09 データベース暗号化の見直し)】
 * rowDataは packages/core/src/domain/attendance/types.ts の AttendanceRowData を平文の
 * jsonb 列でそのまま持つ(以前は1本の暗号文にしていたが、フィールド単位の暗号化は app_settings の
 * 資格情報だけに縮小した)。保護はDB/バックアップの保存時暗号化 + RLS + アクセス制御で行う。
 *
 * 日報・事故報告のように項目ごとの列に分けず JSON オブジェクトのままにしているのは、キーが
 * スプレッドシートの列記号(C/D/E…)の動的なオブジェクトで、常に「1日分をまるごと読み書きする」
 * 用途しか無いため。jsonb なので必要になれば SQL 側から個別キーを参照することもできる。
 * DEFAULT '{}' は、行が残っているDBでも ADD COLUMN ... NOT NULL が失敗しないようにするため
 * (既存の暗号化済みデータは引き継がない)。
 *
 * 労働時間・残業・移動距離・基準距離超過回数などの派生値は一切保存しない。常に
 * computeDayDerived/computeMonthlyTotals(attendanceCalc.ts)でrowDataから都度計算する
 * (出勤簿テンプレートの数式列に相当。GAS版・webapp-poc版と同じ「入力列だけを保持し
 * 数式は都度計算」という設計をそのまま踏襲する)。
 */
export const attendanceDays = pgTable(
  'attendance_days',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    staffId: uuid().notNull(),
    businessDate: date().notNull(),

    rowData: jsonb().$type<AttendanceRowData>().notNull().default({}),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    uniqueIndex('attendance_days_tenant_staff_date_idx').on(t.tenantId, t.staffId, t.businessDate),
    // dailyReports.tsと同じ理由。給与直結のテーブルのため特に取り違えを防ぐ効果が大きい。
    foreignKey({
      name: 'attendance_days_tenant_staff_fk',
      columns: [t.tenantId, t.staffId],
      foreignColumns: [staff.tenantId, staff.id],
    }),
  ],
).enableRLS();
