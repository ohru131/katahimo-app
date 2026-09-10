import {
  RESERVATION_ASSIGNMENT_ROLES,
  RESERVATION_SOURCES,
  RESERVATION_STATUSES,
  STAFF_AVAILABILITY_KINDS,
} from '@katahimo/shared';
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
  time,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { TENANT_RLS_USING } from './_rls';
import { sqlInList } from './_sqlLiteral';
import { customers } from './customers';
import { staff } from './staff';
import { tenants } from './tenants';

/**
 * サービスメニュー。予約時に顧客が選ぶ「何をどれだけ頼むか」の単位。
 * RESERVA(現行の外部予約システム)の「サービス」に対応する。
 *
 * 【基本料金を持たせて請求と繋げる理由】
 * 請求明細(invoice_lines)の 'service' 行は「単価×時間」で作る。その単価の出どころを
 * メニュー側に持たせておかないと、請求のたびに人が単価を入力することになり、
 * 顧客ごとに違う値が入る事故が起きる。
 *
 * 【値上げのときに行を書き換えない運用】
 * 過去の請求明細は invoice_lines 側に単価をスナップショットして持つため、ここを
 * 書き換えても過去の金額は動かない(coupons/coupon_redemptions と同じ考え方)。
 */
export const serviceMenus = pgTable(
  'service_menus',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),

    /** 運用上の識別子(例 'VISIT60')。 */
    code: text().notNull(),
    name: text().notNull(),
    description: text().notNull().default(''),
    /** 標準の所要時間(分)。予約枠の長さの既定値に使う。 */
    durationMinutes: integer().notNull(),
    /** 基本料金(円)。時間単価ではなくこのメニュー1回あたりの金額。 */
    basePriceYen: integer().notNull(),
    active: boolean().notNull().default(true),
    sortOrder: integer().notNull().default(0),

    /** 取込元システム識別子(例 'reserva')。自社で作ったメニューはnull。 */
    externalSource: text(),
    /** 取込元システムでのメニューID。 */
    externalId: text(),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    unique('service_menus_tenant_code_uk').on(t.tenantId, t.code),
    // reservations からの複合FK(tenant_id, service_menu_id)の参照先。
    unique('service_menus_tenant_id_uk').on(t.tenantId, t.id),
    uniqueIndex('service_menus_tenant_external_uidx')
      .on(t.tenantId, t.externalSource, t.externalId)
      .where(sql`${t.externalId} IS NOT NULL`),
    // 0分のメニューは予約枠を作れず、上限を設けないと入力ミス(6000分等)がそのまま
    // カレンダーを埋めてしまう。1日を超える訪問は運用に無い。
    check(
      'service_menus_duration_minutes_check',
      sql`${t.durationMinutes} > 0 AND ${t.durationMinutes} <= 1440`,
    ),
    check('service_menus_base_price_yen_check', sql`${t.basePriceYen} >= 0`),
    check('service_menus_sort_order_check', sql`${t.sortOrder} >= 0`),
  ],
).enableRLS();

/**
 * 予約1件。エンドユーザ(顧客)向け予約システムの中心テーブル。
 * 状態遷移は @katahimo/shared の contracts/reservations.ts のコメント参照。
 *
 * 【日報(実施記録)と分ける理由】
 * 予約は「これから行う約束」、日報は「実際に行ったことの記録」で、片方だけ存在する状態が
 * 正常にあり得る(予約なしの緊急訪問、キャンセルで日報が無い予約)。1テーブルにまとめると
 * 「約束の時刻」と「実際の時刻」がどちらの意味なのか列ごとに変わり、集計を書けなくなる。
 * 紐付けは daily_reports.reservation_id(null許容)で持つ。
 *
 * 【開始・終了を timestamptz で持つ理由】
 * 予約は日付+時刻の1点で決まるため、日付と時刻を別々の文字列で持つ必要がない
 * (日報の start_time/end_time を timestamptz に寄せたのと同じ理由。doc/14 F項)。
 *
 * 【訪問場所を住所文字列でも持つ理由】
 * 通常は顧客の登録住所だが、「今日は祖父母宅に来てほしい」という依頼が実際にある。
 * customers の住所を書き換えて戻す運用は事故になるため、予約側に上書き用の住所を持つ。
 */
export const reservations = pgTable(
  'reservations',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    customerId: uuid().notNull(),
    serviceMenuId: uuid().notNull(),

    status: text().notNull().default('requested'),
    /** 予約の受付経路。 */
    source: text().notNull(),

    /** 約束の開始時刻。 */
    startAt: timestamp({ withTimezone: true }).notNull(),
    /** 約束の終了時刻。メニューのdurationMinutesから既定値を作るが、個別に伸縮できる。 */
    endAt: timestamp({ withTimezone: true }).notNull(),

    /** 対象人数(兄弟同時など)。 */
    headcount: integer().notNull().default(1),
    /** 顧客の登録住所と違う場所に行く場合の上書き住所。nullなら顧客の登録住所。 */
    visitAddressOverride: text(),
    /** 顧客からの要望(自由記述)。 */
    requestNote: text().notNull().default(''),
    /** 社内メモ(顧客には見せない)。 */
    internalNote: text().notNull().default(''),

    /** 受付(confirmed)にした時刻。 */
    confirmedAt: timestamp({ withTimezone: true }),
    /** 実施済み(completed)にした時刻。 */
    completedAt: timestamp({ withTimezone: true }),
    /** 取消(cancelled)/無連絡不来訪(no_show)にした時刻。 */
    cancelledAt: timestamp({ withTimezone: true }),
    /** 取消の理由。取消時のみ入る。 */
    cancelReason: text(),

    /** 取込元システム識別子(例 'reserva')。 */
    externalSource: text(),
    /** 取込元システムでの予約ID。再取込を冪等にするためのキー。 */
    externalId: text(),

    /** 社内から代理登録した場合のスタッフ。顧客が自分で取った予約はnull。 */
    createdByStaffId: uuid(),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    foreignKey({
      name: 'reservations_tenant_customer_fk',
      columns: [t.tenantId, t.customerId],
      foreignColumns: [customers.tenantId, customers.id],
    }),
    foreignKey({
      name: 'reservations_tenant_service_menu_fk',
      columns: [t.tenantId, t.serviceMenuId],
      foreignColumns: [serviceMenus.tenantId, serviceMenus.id],
    }),
    foreignKey({
      name: 'reservations_tenant_created_by_fk',
      columns: [t.tenantId, t.createdByStaffId],
      foreignColumns: [staff.tenantId, staff.id],
    }),
    // reservation_assignments / daily_reports からの複合FKの参照先。
    unique('reservations_tenant_id_uk').on(t.tenantId, t.id),
    // RESERVAからの再取込を冪等にする(同じ予約が二重に入らない)。
    uniqueIndex('reservations_tenant_external_uidx')
      .on(t.tenantId, t.externalSource, t.externalId)
      .where(sql`${t.externalId} IS NOT NULL`),
    check('reservations_status_check', sql`${t.status} IN ${sqlInList(RESERVATION_STATUSES)}`),
    check('reservations_source_check', sql`${t.source} IN ${sqlInList(RESERVATION_SOURCES)}`),
    // 終了が開始以前の予約は枠の長さが0以下になり、空き枠の計算が壊れる。
    // 日報(daily_reports_time_order)と違い「未入力」が無いので、無条件に > で縛れる。
    check('reservations_time_order_check', sql`${t.endAt} > ${t.startAt}`),
    check('reservations_headcount_check', sql`${t.headcount} >= 1`),
    // 状態とタイムスタンプの整合。状態だけ進めてタイムスタンプを入れ忘れた行は、
    // 「いつ確定したか」が分からず売上の計上月を決められなくなる。
    check(
      'reservations_cancelled_at_check',
      sql`(${t.status} IN ('cancelled', 'no_show')) = (${t.cancelledAt} IS NOT NULL)`,
    ),
    check(
      'reservations_completed_at_check',
      sql`(${t.status} = 'completed') = (${t.completedAt} IS NOT NULL)`,
    ),
    // 「この日の予約一覧」(WHERE tenant_id=? AND start_at BETWEEN ? AND ?)用。
    index('reservations_tenant_start_at_idx').on(t.tenantId, t.startAt),
    // 「この顧客の予約履歴を新しい順に」用。
    index('reservations_tenant_customer_start_idx').on(t.tenantId, t.customerId, t.startAt.desc()),
    // 「受付待ちの予約」の抽出用。対象行が少ないので部分索引にする。
    index('reservations_tenant_requested_idx')
      .on(t.tenantId, t.startAt)
      .where(sql`${t.status} = 'requested'`),
  ],
).enableRLS();

/**
 * 予約へのスタッフ割当。1予約に複数人(主担当+同行)が付く運用があるため別テーブルにする。
 *
 * 【予約テーブルの列(staff_id)にしない理由】
 * 同行者を持てなくなる。列を staff_id_1 / staff_id_2 と増やすのは、人数が変わるたびに
 * マイグレーションが必要になり、「何人まで」をスキーマが勝手に決めてしまう
 * (勤怠row_dataが訪問3件までに縛られているのと同じ失敗を繰り返さない)。
 */
export const reservationAssignments = pgTable(
  'reservation_assignments',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    reservationId: uuid().notNull(),
    staffId: uuid().notNull(),

    /** 'primary'(主担当) | 'support'(同行・応援)。 */
    role: text().notNull().default('primary'),
    assignedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** 割当を外した時刻。行は消さない(誰が一度割り当てられたかを追えるようにするため)。 */
    unassignedAt: timestamp({ withTimezone: true }),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    foreignKey({
      name: 'reservation_assignments_tenant_reservation_fk',
      columns: [t.tenantId, t.reservationId],
      foreignColumns: [reservations.tenantId, reservations.id],
    }),
    foreignKey({
      name: 'reservation_assignments_tenant_staff_fk',
      columns: [t.tenantId, t.staffId],
      foreignColumns: [staff.tenantId, staff.id],
    }),
    // 同じスタッフを同じ予約に2回割り当てられないようにする(二重クリック対策)。
    unique('reservation_assignments_reservation_staff_uk').on(t.tenantId, t.reservationId, t.staffId),
    // 主担当は1予約に1人まで。外した行(unassigned_at IS NOT NULL)は数えない。
    // これを入れないと、複数人が「自分が主担当」と表示される状態を作れてしまう。
    uniqueIndex('reservation_assignments_primary_uidx')
      .on(t.tenantId, t.reservationId)
      .where(sql`${t.role} = 'primary' AND ${t.unassignedAt} IS NULL`),
    check('reservation_assignments_role_check', sql`${t.role} IN ${sqlInList(RESERVATION_ASSIGNMENT_ROLES)}`),
    check(
      'reservation_assignments_unassigned_order_check',
      sql`${t.unassignedAt} IS NULL OR ${t.unassignedAt} >= ${t.assignedAt}`,
    ),
    // 「このスタッフの担当予約」用。
    index('reservation_assignments_tenant_staff_idx').on(t.tenantId, t.staffId),
  ],
).enableRLS();

/**
 * スタッフの受付枠(空き枠)。予約を受け付けられる時間帯と、受け付けられない時間帯を持つ。
 *
 * 【繰り返し(曜日)と特定日を1テーブルで持つ理由】
 * 「毎週火曜9:00-17:00は受付可」という繰り返しの枠に対して、「今週の火曜だけ不可」という
 * 例外を重ねる運用になる。テーブルを分けると、判定のたびに2テーブルを突き合わせる
 * 問い合わせを書くことになり、しかも「どちらが優先か」がコードの読み手に伝わらない。
 * 同じテーブルに入れ、kind='unavailable' が1件でも重なれば不可、という1つの規則にする。
 *
 * 【weekday と specific_date のどちらか一方だけを持つ理由】
 * 両方入った行は「毎週火曜の、2026-04-20だけ」という読めない意味になる。CHECK制約で
 * ちょうど一方だけを許す。
 */
export const staffAvailabilities = pgTable(
  'staff_availabilities',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    staffId: uuid().notNull(),

    /** 'available'(受付可) | 'unavailable'(受付不可。availableに重ねる例外)。 */
    kind: text().notNull(),
    /** 繰り返しの曜日(0=日曜〜6=土曜)。特定日の枠ならnull。 */
    weekday: integer(),
    /** 特定日の枠。繰り返しの枠ならnull。 */
    specificDate: date(),
    /** 開始時刻(JSTの時計時刻)。日付と組み合わせて使うためtime型。 */
    startTime: time().notNull(),
    endTime: time().notNull(),
    note: text().notNull().default(''),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    foreignKey({
      name: 'staff_availabilities_tenant_staff_fk',
      columns: [t.tenantId, t.staffId],
      foreignColumns: [staff.tenantId, staff.id],
    }),
    check('staff_availabilities_kind_check', sql`${t.kind} IN ${sqlInList(STAFF_AVAILABILITY_KINDS)}`),
    // 曜日の繰り返しか特定日か、ちょうど一方。
    check('staff_availabilities_target_check', sql`(${t.weekday} IS NULL) <> (${t.specificDate} IS NULL)`),
    check('staff_availabilities_weekday_check', sql`${t.weekday} IS NULL OR ${t.weekday} BETWEEN 0 AND 6`),
    // 終了が開始以前の枠は長さが0以下になり、空き枠の計算が壊れる。日跨ぎの枠
    // (22:00-01:00)は「その日の22:00-24:00」と「翌日の00:00-01:00」の2行で表す
    // (time型に日付が無いため、1行では表せない)。
    check('staff_availabilities_time_order_check', sql`${t.endTime} > ${t.startTime}`),
    // 空き枠の判定(WHERE tenant_id=? AND staff_id=? で全件引いてから時刻で絞る)用。
    index('staff_availabilities_tenant_staff_idx').on(t.tenantId, t.staffId),
    index('staff_availabilities_tenant_date_idx')
      .on(t.tenantId, t.specificDate)
      .where(sql`${t.specificDate} IS NOT NULL`),
  ],
).enableRLS();
