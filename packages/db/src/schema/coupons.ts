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
import { dailyReports } from './dailyReports';
import { tenants } from './tenants';

/**
 * 割引クーポン(金額引き/率引き)。doc/14 4.1章。
 *
 * 回数券(枚数を発行して減らしていくもの)は運用に無いことを確認済みのため持たない
 * (残枚数を管理する列も、消費履歴から残数を算出するロジックも不要)。
 *
 * 【種別マスタと適用記録(coupon_redemptions)を分ける理由】
 * 割引額はここ(マスタ)にあるが、マスタを書き換えたときに過去の適用記録の金額まで
 * 動いてしまってはいけない(請求に使う値のため)。そのため適用記録側には、適用時点の
 * discount_kind/discount_amount_yen/discount_percentをスナップショットとして複製して持たせる
 * (coupon_redemptions側のコメント参照)。
 *
 * 【廃止時に行を消さない理由】
 * activeをfalseにするだけで、行自体は削除しない。過去の適用記録(coupon_redemptions)から
 * 複合FKで参照されているため、消すと履歴が壊れる。
 */
export const coupons = pgTable(
  'coupons',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),

    /** 運用上の識別子(例 'INTRO500')。 */
    code: text().notNull(),
    /** 表示名(例 '紹介キャンペーン 500円引き')。 */
    name: text().notNull(),
    /** 'amount'(金額引き) | 'percent'(率引き)。 */
    discountKind: text().notNull(),
    /** discountKind='amount'のとき必須。 */
    discountAmountYen: integer(),
    /** discountKind='percent'のとき必須(1〜100)。 */
    discountPercent: integer(),
    /** 有効期間の下限。nullは下限なし。 */
    validFrom: date(),
    /** 有効期間の上限。nullは無期限。 */
    validTo: date(),
    active: boolean().notNull().default(true),
    note: text(),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    unique('coupons_tenant_code_uidx').on(t.tenantId, t.code),
    // coupon_redemptions.coupon_id からの複合外部キー(tenant_id, coupon_id)の参照先。
    // dailyReports.ts の daily_reports_tenant_id_uk と同じ理由。
    unique('coupons_tenant_id_uk').on(t.tenantId, t.id),
    check('coupons_discount_kind_check', sql`${t.discountKind} IN ('amount', 'percent')`),
    // 種別と値の組み合わせを縛る。片方だけ入れ替えて「率引きなのに金額が入っている」
    // (またはその逆)状態を作れないようにする。
    check(
      'coupons_discount_value_check',
      sql`(${t.discountKind} = 'amount'  AND ${t.discountAmountYen} IS NOT NULL AND ${t.discountPercent} IS NULL)
        OR (${t.discountKind} = 'percent' AND ${t.discountPercent} IS NOT NULL AND ${t.discountAmountYen} IS NULL)`,
    ),
    check(
      'coupons_discount_amount_yen_check',
      sql`${t.discountAmountYen} IS NULL OR ${t.discountAmountYen} >= 0`,
    ),
    check(
      'coupons_discount_percent_check',
      sql`${t.discountPercent} IS NULL OR ${t.discountPercent} BETWEEN 1 AND 100`,
    ),
    check(
      'coupons_valid_period_check',
      sql`${t.validTo} IS NULL OR ${t.validFrom} IS NULL OR ${t.validTo} >= ${t.validFrom}`,
    ),
  ],
).enableRLS();

/**
 * 日報1件(サービス提供1件)への割引クーポン適用記録。doc/14 4.1章。
 *
 * 【日報1件に紐付ける理由】
 * 領収書を日報の画面から登録している今の運用と同じ粒度で追えるようにするため。
 *
 * 【顧客IDを持たせない理由】
 * 日報(daily_report_id)から引ける。coupon_redemptions側にも顧客IDを持たせると、
 * 日報側の顧客と食い違う状態(二重管理の不整合)を作れてしまう。
 *
 * 【適用時点の割引条件をスナップショットする理由】
 * discount_kind/discount_amount_yen/discount_percentは、適用した瞬間のcouponsマスタの値を
 * 複製して持つ。請求に使う値なので、マスタの書き換え(値の変更・廃止)で過去の適用記録が
 * 後から動いてしまってはいけない。
 *
 * 【割引後の請求額を保存しない理由】
 * 算定基礎(単価・時間)を持つ請求機能(invoice_lines)がまだ無い。無い値を列にしても
 * 埋まらないため保存しない。請求機能の導入時に、この2テーブルを入力として計算する。
 */
export const couponRedemptions = pgTable(
  'coupon_redemptions',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    dailyReportId: uuid().notNull(),
    couponId: uuid().notNull(),

    appliedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),

    // 適用時点のスナップショット(coupons.ts と同じ形。マスタの書き換えで過去の記録が
    // 動かないようにするため、コピーして保持する)。
    discountKind: text().notNull(),
    discountAmountYen: integer(),
    discountPercent: integer(),
    note: text(),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    // dailyReports.ts/staff.ts等と同じ理由(RLSはFK制約をバイパスするため、単一列PKだけでは
    // 他テナントのdaily_report_id/coupon_idを誤って参照してもDBが検知できない)。
    foreignKey({
      name: 'coupon_redemptions_tenant_daily_report_fk',
      columns: [t.tenantId, t.dailyReportId],
      foreignColumns: [dailyReports.tenantId, dailyReports.id],
    }),
    foreignKey({
      name: 'coupon_redemptions_tenant_coupon_fk',
      columns: [t.tenantId, t.couponId],
      foreignColumns: [coupons.tenantId, coupons.id],
    }),
    // 二重送信・二重クリックで同じクーポンが同じ日報に2回付くのを止める。
    unique('coupon_redemptions_report_coupon_uidx').on(t.tenantId, t.dailyReportId, t.couponId),
    // invoice_lines.coupon_redemption_id からの複合外部キー(tenant_id, coupon_redemption_id)の
    // 参照先。coupons_tenant_id_uk と同じ理由。
    unique('coupon_redemptions_tenant_id_uk').on(t.tenantId, t.id),
    check('coupon_redemptions_discount_kind_check', sql`${t.discountKind} IN ('amount', 'percent')`),
    check(
      'coupon_redemptions_discount_value_check',
      sql`(${t.discountKind} = 'amount'  AND ${t.discountAmountYen} IS NOT NULL AND ${t.discountPercent} IS NULL)
        OR (${t.discountKind} = 'percent' AND ${t.discountPercent} IS NOT NULL AND ${t.discountAmountYen} IS NULL)`,
    ),
    // couponsマスタと同じ値域の制約(coupons_discount_amount_yen_check/
    // coupons_discount_percent_check参照)。適用記録は請求に使うスナップショットであり、
    // 種別と組み合わせだけを縛っても値域外(負の金額・0や100超の率)がDBレベルでは
    // 拒否できていなかった。マスタ側と同じ理由でこちらにも足す。
    check(
      'coupon_redemptions_discount_amount_yen_check',
      sql`${t.discountAmountYen} IS NULL OR ${t.discountAmountYen} >= 0`,
    ),
    check(
      'coupon_redemptions_discount_percent_check',
      sql`${t.discountPercent} IS NULL OR ${t.discountPercent} BETWEEN 1 AND 100`,
    ),
    // クーポンごとの適用状況集計(「今月このクーポンが何回使われたか」)を索引だけで返すため。
    index('coupon_redemptions_tenant_coupon_idx').on(t.tenantId, t.couponId),
  ],
).enableRLS();
