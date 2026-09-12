import {
  COUPON_AUDIENCES,
  COUPON_BIRTHDAY_SUBJECTS,
  COUPON_ELIGIBILITY_KINDS,
  COUPON_USAGE_LIMIT_KINDS,
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
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { TENANT_RLS_USING } from './_rls';
import { sqlInList } from './_sqlLiteral';
import { customers } from './customers';
import { dailyReports } from './dailyReports';
import { tenants } from './tenants';

/**
 * 割引クーポン(金額引き/率引き)。doc/14 §9。
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
 * 【「誰が・いつ使えるか」を3つの列で表す】
 * - audience        誰に配ってあるか('all' / 'assigned' = customer_coupons で割り当てた顧客だけ)
 * - eligibilityKind どの日に使えるか('manual' = 条件なし / 'birthday_month' = 対象者の誕生月)
 * - usageLimitKind  何回使えるか('unlimited' / 'once_per_customer' / 'once_per_customer_per_year')
 * この3つは互いに独立で、組み合わせて「誕生月に年1回、全顧客が使える」「特定の顧客にだけ
 * 配った1回限りのクーポン」のどちらも表せる。汎用の条件式をJSONで持つルールエンジンには
 * しない(DBが中身を検証できない列を増やすだけになるため。doc/14 §2と同じ理由)。
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

    /**
     * 対象者の決め方。'all'=全顧客、'assigned'=customer_couponsで割り当てた顧客だけ。
     * 既定を'all'にしているのは、割り当てを忘れたクーポンが「誰も使えない」方向ではなく
     * 従来どおりの挙動になるようにするため(既存のクーポンは全て'all'相当だった)。
     */
    audience: text().notNull().default('all'),
    /** 適用条件。'manual'=条件なし、'birthday_month'=対象者の誕生月のみ。 */
    eligibilityKind: text().notNull().default('manual'),
    /**
     * eligibilityKind='birthday_month'のとき、誰の誕生日を見るか。
     * 'customer'=世帯代表(customers.dob_date)、'family_member'=世帯構成員
     * (family_members.dob_date)、'any'=どちらか一方でも誕生月に当たれば可。
     * それ以外のeligibilityKindではnull(CHECK制約で強制)。
     */
    birthdaySubject: text(),
    /** 同じ顧客が何回使えるか。'unlimited' | 'once_per_customer' | 'once_per_customer_per_year'。 */
    usageLimitKind: text().notNull().default('unlimited'),

    active: boolean().notNull().default(true),
    note: text(),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    unique('coupons_tenant_code_uidx').on(t.tenantId, t.code),
    // coupon_redemptions.coupon_id / customer_coupons.coupon_id からの複合外部キー
    // (tenant_id, coupon_id)の参照先。dailyReports.ts の daily_reports_tenant_id_uk と同じ理由。
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
    // 許可値は @katahimo/shared の contracts が正(doc/14 §4・§8.1)。
    check('coupons_audience_check', sql`${t.audience} IN ${sqlInList(COUPON_AUDIENCES)}`),
    check(
      'coupons_eligibility_kind_check',
      sql`${t.eligibilityKind} IN ${sqlInList(COUPON_ELIGIBILITY_KINDS)}`,
    ),
    check(
      'coupons_usage_limit_kind_check',
      sql`${t.usageLimitKind} IN ${sqlInList(COUPON_USAGE_LIMIT_KINDS)}`,
    ),
    // 誕生月クーポンは対象者が必須、それ以外は指定できない。
    //
    // 最初の枝の `IS NOT NULL` を省いてはいけない(doc/14 §8.3)。birthday_subject が NULL だと
    // `NULL IN (...)` は FALSE ではなく NULL になり、式全体が `NULL OR FALSE` = NULL に評価されて
    // CHECK が「通った」ことになる。つまり「誕生月クーポンなのに対象者が無い」行、
    // すなわち条件を判定できない行がDBに入ってしまう(実際にこれで一度素通りさせた)。
    check(
      'coupons_birthday_subject_check',
      sql`(${t.eligibilityKind} = 'birthday_month' AND ${t.birthdaySubject} IS NOT NULL
           AND ${t.birthdaySubject} IN ${sqlInList(COUPON_BIRTHDAY_SUBJECTS)})
        OR (${t.eligibilityKind} <> 'birthday_month' AND ${t.birthdaySubject} IS NULL)`,
    ),
  ],
).enableRLS();

/**
 * 顧客へのクーポン割当(「この顧客が使えるクーポン」)。doc/14 §9。
 *
 * 【クーポンを顧客ごとに複製しない理由】
 * 「紹介してくれた世帯にだけ500円引きを配る」のようなクーポンを coupons テーブルだけで
 * 表そうとすると、顧客の数だけ同じ内容のクーポン行(とコード)を作ることになる。
 * 種別(何円引きか)と配布先(誰が使えるか)は別の情報なので、テーブルを分ける。
 * coupons.audience='all' のクーポンは全顧客が使えるため、ここに行を作る必要はない。
 *
 * 【顧客ごとの有効期間を持つ理由】
 * 配布日から起算した期限(「配ってから3ヶ月」)はクーポンマスタ側では表せない。
 * nullのときはマスタ(coupons.valid_from/valid_to)の期間に従い、両方入っている場合は
 * 「両方の期間が重なっている日」だけ使える(usecases/coupons.ts)。
 *
 * 【取り消しをフラグではなく行の削除で表す理由】
 * この表は「今この顧客が使えるか」を引くためのもので、履歴ではない。使った事実は
 * coupon_redemptions 側に残り、そちらは coupon_id を直接参照していてこの表を経由しない。
 * そのため割当を消しても過去の適用記録は壊れない(coupons.active のように行を残す必要がない)。
 */
export const customerCoupons = pgTable(
  'customer_coupons',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    customerId: uuid().notNull(),
    couponId: uuid().notNull(),

    /** この顧客に限った有効期間の下限。nullはマスタ(coupons.valid_from)に従う。 */
    validFrom: date(),
    /** この顧客に限った有効期間の上限。nullはマスタ(coupons.valid_to)に従う。 */
    validTo: date(),
    note: text(),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    // dailyReports.ts等と同じ理由(RLSはFK制約をバイパスするため、単一列FKでは他テナントの
    // customer_id/coupon_idを誤って参照してもDBが検知できない)。
    foreignKey({
      name: 'customer_coupons_tenant_customer_fk',
      columns: [t.tenantId, t.customerId],
      foreignColumns: [customers.tenantId, customers.id],
    }),
    foreignKey({
      name: 'customer_coupons_tenant_coupon_fk',
      columns: [t.tenantId, t.couponId],
      foreignColumns: [coupons.tenantId, coupons.id],
    }),
    // 同じ顧客に同じクーポンを2回割り当てない(2行あるとどちらの有効期間が正か決まらない)。
    // 「この顧客に配ってあるクーポン一覧」(tenant_id + customer_id)の絞り込みも、この
    // 一意制約の索引が先頭2列で支える(別に索引は張らない。doc/14 §8.5)。
    unique('customer_coupons_tenant_customer_coupon_uk').on(t.tenantId, t.customerId, t.couponId),
    check(
      'customer_coupons_valid_period_check',
      sql`${t.validTo} IS NULL OR ${t.validFrom} IS NULL OR ${t.validTo} >= ${t.validFrom}`,
    ),
  ],
).enableRLS();

/**
 * 日報1件(サービス提供1件)への割引クーポン適用記録。doc/14 §9。
 *
 * 【日報1件に紐付ける理由】
 * 領収書を日報の画面から登録している今の運用と同じ粒度で追えるようにするため。
 *
 * 【顧客IDを持たせる理由と、二重管理にしない方法】
 * 「同じ顧客が同じクーポンを年1回まで」のような使用上限をDBの一意索引で縛るには、
 * 適用記録の行だけで顧客が分かる必要がある(一意索引は他テーブルを参照できない)。
 * 一方で顧客IDをただ複製すると、日報側の顧客と食い違う行を作れてしまう。そこで
 * (tenant_id, daily_report_id, customer_id) の3列で daily_reports を参照する複合FKを張り、
 * 「日報の顧客と違う値は物理的に入らない」状態にしている。
 *
 * 【適用時点の割引条件をスナップショットする理由】
 * discount_kind/discount_amount_yen/discount_percentは、適用した瞬間のcouponsマスタの値を
 * 複製して持つ。請求に使う値なので、マスタの書き換え(値の変更・廃止)で過去の適用記録が
 * 後から動いてしまってはいけない。usage_limit_kind も同じ理由で写す(下の一意索引が
 * 「この行は上限の対象か」を行の中だけで判定できるようにするためでもある)。
 *
 * 【誕生月クーポンの根拠を氏名と生年月日で写す理由】
 * 「なぜ3月の訪問に誕生月割引が付いたのか」に後から答えられるようにする(請求の問い合わせ対応)。
 * family_members への外部キーにしないのは、世帯構成員が顧客の更新・再取込のたびに
 * 全件入れ替え(delete + insert)される行で、IDが安定しないため
 * (packages/db/src/repositories/familyMemberRepository.ts の replaceForCustomer)。
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
    /** 日報の顧客と同じ値(複合FKで強制)。使用上限の一意索引に使う。 */
    customerId: uuid().notNull(),
    couponId: uuid().notNull(),

    appliedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),

    // 適用時点のスナップショット(coupons.ts と同じ形。マスタの書き換えで過去の記録が
    // 動かないようにするため、コピーして保持する)。
    discountKind: text().notNull(),
    discountAmountYen: integer(),
    discountPercent: integer(),

    /** 適用時点のcoupons.usage_limit_kind。 */
    usageLimitKind: text().notNull().default('unlimited'),
    /**
     * 使用上限を数える単位。'unlimited'ならnull、'once_per_customer'なら'lifetime'、
     * 'once_per_customer_per_year'なら対象年('2026')。下の部分一意索引が
     * (tenant_id, coupon_id, customer_id, usage_scope_key) で重複を弾く。
     *
     * 「年」をSQL側(EXTRACT(YEAR FROM applied_at))で求めず列に持つのは、applied_atが
     * 入力時刻であって訪問日ではないため(年末の訪問を年明けに入力すると別の年に数えられる)。
     * usecase側が日報の訪問日から決めて入れる。
     */
    usageScopeKey: text(),

    /** 誕生月クーポンのとき、根拠にした人の氏名(適用時点の値)。それ以外はnull。 */
    birthdaySubjectName: text(),
    /** 誕生月クーポンのとき、根拠にした人の生年月日(適用時点の値)。それ以外はnull。 */
    birthdaySubjectDob: date(),

    note: text(),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    // 日報とその顧客を1本のFKで縛る(このファイルのヘッダーコメント参照)。顧客IDだけを
    // customers へ別途参照しないのは、この複合FKが「日報の顧客であること」まで保証しており、
    // 日報側が既に customers への複合FKを持っているため。
    foreignKey({
      name: 'coupon_redemptions_tenant_report_customer_fk',
      columns: [t.tenantId, t.dailyReportId, t.customerId],
      foreignColumns: [dailyReports.tenantId, dailyReports.id, dailyReports.customerId],
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
    check(
      'coupon_redemptions_usage_limit_kind_check',
      sql`${t.usageLimitKind} IN ${sqlInList(COUPON_USAGE_LIMIT_KINDS)}`,
    ),
    // 上限のあるクーポンには必ず数える単位が入っている。ここが抜けると下の部分一意索引の
    // 対象外になり、上限が静かに効かなくなる(doc/14 §8.6)。usage_limit_kindがNOT NULLなので
    // この式がNULLに評価されて素通りすることはない(doc/14 §8.3)。
    check(
      'coupon_redemptions_usage_scope_key_check',
      sql`(${t.usageLimitKind} = 'unlimited' AND ${t.usageScopeKey} IS NULL)
        OR (${t.usageLimitKind} <> 'unlimited' AND ${t.usageScopeKey} IS NOT NULL)`,
    ),
    // 使用上限(「その顧客につき1回」「年1回」)をDB側で守る。usecase(listCouponsForSelection/
    // resolveCouponRedemptionSnapshots)も同じ判定をするが、同時リクエストは検索と登録の
    // 間をすり抜けるため、最後の砦としてここで弾く(doc/14 §8.4)。
    uniqueIndex('coupon_redemptions_usage_scope_uidx')
      .on(t.tenantId, t.couponId, t.customerId, t.usageScopeKey)
      .where(sql`${t.usageScopeKey} IS NOT NULL`),
    // クーポンごとの適用状況集計(「今月このクーポンが何回使われたか」)を索引だけで返すため。
    index('coupon_redemptions_tenant_coupon_idx').on(t.tenantId, t.couponId),
    // 「この顧客がこのクーポンをもう使ったか」を日報画面のたびに引く(listCouponsForSelection)。
    // 上の部分一意索引は usage_scope_key がある行だけを対象にするため、上限なしのクーポンも含めて
    // 顧客単位で引くにはこちらが要る(doc/14 §3)。
    index('coupon_redemptions_tenant_customer_idx').on(t.tenantId, t.customerId),
  ],
).enableRLS();
