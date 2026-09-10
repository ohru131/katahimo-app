import { TRANSPORT_ALLOWANCE_CALC_KINDS, TRANSPORT_MODES, TRAVEL_LEG_KINDS } from '@katahimo/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { TENANT_RLS_USING } from './_rls';
import { sqlInList } from './_sqlLiteral';
import { customers } from './customers';
import { dailyReports } from './dailyReports';
import { staff } from './staff';
import { tenants } from './tenants';

/**
 * 移動手当の単価マスタ。移動手段ごとに「何を根拠にいくら払うか」を持つ。
 *
 * 【背景】
 * これまで移動は自動車前提で、距離から「基準距離超過回数」(勤怠計算の中間値)を
 * 出すところまでしか実装が無く、金額への換算はアプリにもGAS版にも存在しなかった。
 * 公共交通機関・自転車も選べるようにすると、手段ごとに計算方法自体が変わる
 * (距離比例/1回あたり定額/実費)ため、計算方法をコードの定数ではなくデータで持つ。
 *
 * 【単価をコードの定数にしない理由】
 * 単価は年度替わりや燃料費で変わる。定数にすると値上げのたびにデプロイが必要で、
 * しかも過去分を再計算すると支給済みの手当額が変わってしまう。
 *
 * 【有効期間(effective_from/to)を持つ理由】
 * 「4月から単価を上げる」を、行の書き換えではなく新しい行の追加で表せるようにする。
 * 3月分の再計算は3月時点の行を引くので、過去の支給額が動かない。
 *
 * 【期間の重なりをDBで禁止していない理由】
 * 同一(tenant, transport_mode)で期間が重なる行が2つあると、どちらの単価かが決まらない。
 * これを厳密に禁じるにはPostgreSQLの排他制約(EXCLUDE USING gist)が要るが、
 * btree_gist拡張に依存する。公開デモとテストはPGlite(PostgreSQL/WASM)で動いており
 * この拡張を読み込めないため、DB側では (tenant, mode, effective_from) の一意制約までとし、
 * 重なりの検査は登録時(usecase)で行う。
 */
export const transportAllowanceRules = pgTable(
  'transport_allowance_rules',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),

    /** 移動手段。@katahimo/shared の TRANSPORT_MODES のいずれか。 */
    transportMode: text().notNull(),
    /** 計算方法。'per_km' | 'per_trip' | 'per_day' | 'actual_cost'。 */
    calcKind: text().notNull(),
    /**
     * 単価(円)。calcKind='per_km' なら1kmあたり、'per_trip' なら1移動あたり、
     * 'per_day' なら1日あたり。'actual_cost'(実費精算)では使わないためnull。
     */
    unitAmountYen: integer(),
    /** 1日あたりの下限(円)。nullなら下限なし。 */
    minAmountYen: integer(),
    /** 1日あたりの上限(円)。nullなら上限なし。定期券区間の頭打ち等に使う。 */
    maxAmountYen: integer(),

    /** 適用開始日(この日から有効)。 */
    effectiveFrom: date().notNull(),
    /** 適用終了日(この日まで有効)。nullなら現在も有効。 */
    effectiveTo: date(),
    active: boolean().notNull().default(true),
    note: text().notNull().default(''),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    unique('transport_allowance_rules_mode_from_uk').on(t.tenantId, t.transportMode, t.effectiveFrom),
    // travel_legs からの複合FK(tenant_id, allowance_rule_id)の参照先。
    unique('transport_allowance_rules_tenant_id_uk').on(t.tenantId, t.id),
    check(
      'transport_allowance_rules_transport_mode_check',
      sql`${t.transportMode} IN ${sqlInList(TRANSPORT_MODES)}`,
    ),
    check(
      'transport_allowance_rules_calc_kind_check',
      sql`${t.calcKind} IN ${sqlInList(TRANSPORT_ALLOWANCE_CALC_KINDS)}`,
    ),
    // 計算方法と単価の対応。実費精算に単価が入っている行は、どちらで計算されるのか
    // 読めない(クーポンの coupons_discount_value_check と同じ考え方)。
    check(
      'transport_allowance_rules_unit_amount_check',
      sql`(${t.calcKind} = 'actual_cost' AND ${t.unitAmountYen} IS NULL)
        OR (${t.calcKind} <> 'actual_cost' AND ${t.unitAmountYen} IS NOT NULL AND ${t.unitAmountYen} >= 0)`,
    ),
    check(
      'transport_allowance_rules_min_max_check',
      sql`(${t.minAmountYen} IS NULL OR ${t.minAmountYen} >= 0)
        AND (${t.maxAmountYen} IS NULL OR ${t.maxAmountYen} >= 0)
        AND (${t.minAmountYen} IS NULL OR ${t.maxAmountYen} IS NULL OR ${t.maxAmountYen} >= ${t.minAmountYen})`,
    ),
    check(
      'transport_allowance_rules_effective_order_check',
      sql`${t.effectiveTo} IS NULL OR ${t.effectiveTo} >= ${t.effectiveFrom}`,
    ),
    // 「この日に有効な単価」を移動手段ごとに引くため。
    index('transport_allowance_rules_tenant_mode_from_idx').on(
      t.tenantId,
      t.transportMode,
      t.effectiveFrom.desc(),
    ),
  ],
).enableRLS();

/**
 * 移動区間1件。「誰が・いつ・どこからどこへ・何で移動したか」と、その手当額を持つ。
 *
 * 【勤怠(attendance_days.row_data)と別に持つ理由】
 * row_data は旧テンプレート(列記号A,B,C…)由来の形をJSONにしたもので、
 * 移動を「通勤の距離」「訪問1の距離」…と最大2区間の固定枠でしか表せない
 * (doc/14 B項。訪問3件・移動2区間の上限がGAS版から引き継がれている)。
 * 移動手段を手段ごとに記録し、区間ごとに手当を算定するには、区間を行にする必要がある。
 * doc/14 B項の第2段階(勤怠の正規化)で row_data の距離をこのテーブルへ寄せる。
 * それまでは、給与計算はこれまで通り row_data を入力に行い(GAS版との数値一致を
 * 崩さないため)、このテーブルは手当の算定と移動実績の記録に使う。
 *
 * 【attendance_days への外部キーを張らない理由】
 * 移動区間は「勤怠の行を作る前」に記録されうる(訪問の合間に入力する運用)。
 * 対応付けは (tenant_id, staff_id, business_date) で行う
 * (attendance_days 側の attendance_days_tenant_staff_date_idx がその組の一意索引)。
 *
 * 【手当額をスナップショットして持つ理由】
 * 単価マスタ(transport_allowance_rules)を後から書き換えても、支給済みの手当額が
 * 動いてはいけない(coupons/coupon_redemptions と同じ理由)。適用した規則のIDも
 * 併せて持ち、「なぜこの金額になったか」を後から辿れるようにする。
 */
export const travelLegs = pgTable(
  'travel_legs',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    staffId: uuid().notNull(),
    /** 業務日(JST)。attendance_days.business_date と同じ意味。 */
    businessDate: date().notNull(),
    /** その日の中での順番(1から)。 */
    sequence: integer().notNull(),

    /** 区間の種別。'commute' | 'to_visit' | 'between_visits' | 'return'。 */
    legKind: text().notNull(),
    /** 移動手段。@katahimo/shared の TRANSPORT_MODES のいずれか。 */
    transportMode: text().notNull(),

    /** 出発地の表示名(「自宅」「事業所」「〇〇様宅」)。 */
    fromLabel: text().notNull().default(''),
    toLabel: text().notNull().default(''),
    /** 到着先が顧客宅の場合の顧客。事業所・自宅への移動はnull。 */
    toCustomerId: uuid(),
    /** この移動が紐づく訪問(日報)。訪問と対応しない移動(通勤等)はnull。 */
    dailyReportId: uuid(),

    /** 距離(メートル)。手段によらず記録する(自転車・徒歩でも距離は残す)。 */
    distanceMeters: integer(),
    /** 所要時間(分)。 */
    durationMinutes: integer(),
    /** 公共交通機関の運賃実費(円)。実費精算の手当額の根拠になる。 */
    fareYen: integer(),

    /** 算定した手当額(円)。 */
    allowanceYen: integer(),
    /** 算定に使った単価マスタの行。手当を算定していない区間はnull。 */
    allowanceRuleId: uuid(),
    note: text().notNull().default(''),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    foreignKey({
      name: 'travel_legs_tenant_staff_fk',
      columns: [t.tenantId, t.staffId],
      foreignColumns: [staff.tenantId, staff.id],
    }),
    foreignKey({
      name: 'travel_legs_tenant_to_customer_fk',
      columns: [t.tenantId, t.toCustomerId],
      foreignColumns: [customers.tenantId, customers.id],
    }),
    foreignKey({
      name: 'travel_legs_tenant_daily_report_fk',
      columns: [t.tenantId, t.dailyReportId],
      foreignColumns: [dailyReports.tenantId, dailyReports.id],
    }),
    foreignKey({
      name: 'travel_legs_tenant_allowance_rule_fk',
      columns: [t.tenantId, t.allowanceRuleId],
      foreignColumns: [transportAllowanceRules.tenantId, transportAllowanceRules.id],
    }),
    // 同じ日に同じ順番の区間が2行あると、経路の順序が決まらない(二重送信対策も兼ねる)。
    unique('travel_legs_staff_date_sequence_uk').on(t.tenantId, t.staffId, t.businessDate, t.sequence),
    check('travel_legs_leg_kind_check', sql`${t.legKind} IN ${sqlInList(TRAVEL_LEG_KINDS)}`),
    check('travel_legs_transport_mode_check', sql`${t.transportMode} IN ${sqlInList(TRANSPORT_MODES)}`),
    check('travel_legs_sequence_check', sql`${t.sequence} >= 1`),
    // 負の距離・時間・金額は入力ミスであり、そのまま合計すると手当が目減りする
    // (給与に直結するため、気付かないまま集計されるのを防ぐ)。
    check('travel_legs_distance_check', sql`${t.distanceMeters} IS NULL OR ${t.distanceMeters} >= 0`),
    check('travel_legs_duration_check', sql`${t.durationMinutes} IS NULL OR ${t.durationMinutes} >= 0`),
    check('travel_legs_fare_check', sql`${t.fareYen} IS NULL OR ${t.fareYen} >= 0`),
    check('travel_legs_allowance_check', sql`${t.allowanceYen} IS NULL OR ${t.allowanceYen} >= 0`),
    // 手当額と、その根拠になった単価マスタは必ず揃う。金額だけある行は「なぜその額か」を
    // 後から説明できず、規則だけある行は算定し忘れと区別できない。
    check(
      'travel_legs_allowance_pair_check',
      sql`(${t.allowanceYen} IS NULL AND ${t.allowanceRuleId} IS NULL)
        OR (${t.allowanceYen} IS NOT NULL AND ${t.allowanceRuleId} IS NOT NULL)`,
    ),
    // 「このスタッフのこの月の移動」を月次の手当集計で引くため。
    index('travel_legs_tenant_staff_date_idx').on(t.tenantId, t.staffId, t.businessDate),
    // 「この訪問に紐づく移動」を請求明細(invoice_lines の transport_allowance)から引くため。
    index('travel_legs_tenant_daily_report_idx')
      .on(t.tenantId, t.dailyReportId)
      .where(sql`${t.dailyReportId} IS NOT NULL`),
  ],
).enableRLS();
