import {
  COMPATIBILITY_SCORE_MAX,
  COMPATIBILITY_SCORE_MIN,
  COMPATIBILITY_SOURCES,
  TRAIT_SUBJECT_KINDS,
  TRAIT_VALUE_TYPES,
  TRANSPORT_MODES,
  TRAVEL_ESTIMATE_SOURCES,
} from '@katahimo/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { TENANT_RLS_USING } from './_rls';
import { sqlInList, sqlNumber } from './_sqlLiteral';
import { customers } from './customers';
import { staff } from './staff';
import { tenants } from './tenants';

/**
 * 特性項目のマスタ。「スタッフをどの顧客に割り当てると良いか」を計算するための
 * パラメータの定義を持つ。
 *
 * 【項目を列にせずマスタ+値テーブルにする理由】
 * 何を見て最適化するかは今後のヒアリングで決まる(現時点で確定していない)。
 * 項目を customers / staff の列として足す設計にすると、項目が1つ増えるたびに
 * マイグレーションと画面の作り直しが必要になり、現場からの「これも見てほしい」に
 * 追従できない。項目自体をデータにすることで、運用側で足せるようにする。
 *
 * 【それでも値をjsonbの塊にしない理由】
 * 「この特性を持つ顧客の一覧」「この項目の分布」をSQLで素直に書けるようにするため。
 * 値の型ごとに列を分け(value_bool / value_int / value_text)、どの列に入れるかを
 * value_type とのCHECK制約で1つに縛る。
 *
 * 【match_weight を持つ理由】
 * 相性計算での重み。「アレルギー対応の可否」と「好みの遊びの傾向」を同じ重さで
 * 扱ってはいけない。重みをコードの定数にすると変更にデプロイが必要になるため、
 * 項目マスタ側にデータとして持つ。
 */
export const traitDefinitions = pgTable(
  'trait_definitions',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),

    /** 'customer' | 'staff'。この項目がどちら側の特性かを表す。 */
    subjectKind: text().notNull(),
    /** 運用上の識別子(例 'has_pet')。 */
    code: text().notNull(),
    name: text().notNull(),
    description: text().notNull().default(''),

    /** 'bool' | 'scale' | 'int' | 'choice' | 'text'。 */
    valueType: text().notNull(),
    /** valueType='scale' のときの範囲。それ以外はnull。 */
    scaleMin: integer(),
    scaleMax: integer(),
    /** valueType='choice' のときの選択肢(文字列の配列)。それ以外はnull。 */
    choices: jsonb().$type<string[]>(),

    /** 相性計算での重み。0はスコアに影響させない(記録だけする項目)。 */
    matchWeight: numeric({ precision: 5, scale: 2 }).notNull().default('1'),
    active: boolean().notNull().default(true),
    sortOrder: integer().notNull().default(0),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    unique('trait_definitions_tenant_subject_code_uk').on(t.tenantId, t.subjectKind, t.code),
    // customer_traits / staff_traits からの複合FKの参照先。
    unique('trait_definitions_tenant_id_uk').on(t.tenantId, t.id),
    check('trait_definitions_subject_kind_check', sql`${t.subjectKind} IN ${sqlInList(TRAIT_SUBJECT_KINDS)}`),
    check('trait_definitions_value_type_check', sql`${t.valueType} IN ${sqlInList(TRAIT_VALUE_TYPES)}`),
    // 'scale' のときだけ範囲を持ち、かつ下限より上限が大きい。範囲の無い段階評価は
    // 入力欄を作れず、範囲だけある真偽値は読めない。
    check(
      'trait_definitions_scale_check',
      sql`(${t.valueType} = 'scale' AND ${t.scaleMin} IS NOT NULL AND ${t.scaleMax} IS NOT NULL AND ${t.scaleMax} > ${t.scaleMin})
        OR (${t.valueType} <> 'scale' AND ${t.scaleMin} IS NULL AND ${t.scaleMax} IS NULL)`,
    ),
    // 'choice' のときだけ選択肢を持ち、かつ空配列ではない。
    check(
      'trait_definitions_choices_check',
      sql`(${t.valueType} = 'choice' AND jsonb_typeof(${t.choices}) = 'array' AND jsonb_array_length(${t.choices}) > 0)
        OR (${t.valueType} <> 'choice' AND ${t.choices} IS NULL)`,
    ),
    // 負の重みは「その特性を持つほど相性が良くなる」という逆向きの意味になり、
    // スコアの解釈が項目ごとに変わってしまう。逆向きにしたい場合は項目自体を
    // 反対の意味('犬が苦手')で定義する。
    check('trait_definitions_match_weight_check', sql`${t.matchWeight} >= 0`),
    check('trait_definitions_sort_order_check', sql`${t.sortOrder} >= 0`),
    index('trait_definitions_tenant_subject_idx').on(t.tenantId, t.subjectKind, t.sortOrder),
  ],
).enableRLS();

/**
 * value_bool / value_int / value_text のうちちょうど1つだけが入っていることを見るCHECK式。
 *
 * customer_traits と staff_traits で同じ条件を2度書くと、片方だけ直したときに
 * 「顧客側は縛られているのにスタッフ側は素通り」というズレが生まれる。
 * 型の組み合わせは同じものなので、式を1箇所に置いて両方から使う。
 *
 * value_type との対応(bool→value_bool、scale/int→value_int、choice/text→value_text)は
 * trait_definitions を参照しないと判定できず、1行のCHECK制約では書けない。
 * 入口(usecase)で担保し、DB側は「どれか1つだけ」までを保証する。
 */
function exactlyOneTraitValue(t: {
  valueBool: unknown;
  valueInt: unknown;
  valueText: unknown;
}): ReturnType<typeof sql> {
  return sql`(CASE WHEN ${t.valueBool} IS NULL THEN 0 ELSE 1 END)
    + (CASE WHEN ${t.valueInt} IS NULL THEN 0 ELSE 1 END)
    + (CASE WHEN ${t.valueText} IS NULL THEN 0 ELSE 1 END) = 1`;
}

/**
 * 顧客側の特性の値。
 *
 * 【スタッフ側(staff_traits)と1テーブルにまとめない理由】
 * subject_id を顧客IDとスタッフIDの兼用にすると、行ごとに参照先のテーブルが変わるため
 * 外部キーを張れない。この設計ではRLSがFK制約をバイパスする前提で、テナント越えの
 * 取り違えを複合FKで検知させているので、FKを張れない形は採れない。
 */
export const customerTraits = pgTable(
  'customer_traits',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    customerId: uuid().notNull(),
    definitionId: uuid().notNull(),

    valueBool: boolean(),
    valueInt: integer(),
    valueText: text(),
    /** 補足(「小型犬。吠えないが玄関に出てくる」など)。 */
    note: text().notNull().default(''),

    /** 誰が記録したか。ヒアリングした人を残す。 */
    recordedByStaffId: uuid(),
    recordedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    foreignKey({
      name: 'customer_traits_tenant_customer_fk',
      columns: [t.tenantId, t.customerId],
      foreignColumns: [customers.tenantId, customers.id],
    }),
    foreignKey({
      name: 'customer_traits_tenant_definition_fk',
      columns: [t.tenantId, t.definitionId],
      foreignColumns: [traitDefinitions.tenantId, traitDefinitions.id],
    }),
    foreignKey({
      name: 'customer_traits_tenant_recorded_by_fk',
      columns: [t.tenantId, t.recordedByStaffId],
      foreignColumns: [staff.tenantId, staff.id],
    }),
    // 1顧客1項目1行。2行あるとどちらが現在の値か決まらない(履歴が必要になったら
    // 別途 *_history を足す。ここは「今の値」だけを持つ)。
    unique('customer_traits_customer_definition_uk').on(t.tenantId, t.customerId, t.definitionId),
    check('customer_traits_exactly_one_value_check', exactlyOneTraitValue(t)),
    index('customer_traits_tenant_definition_idx').on(t.tenantId, t.definitionId),
  ],
).enableRLS();

/** スタッフ側の特性の値。customer_traits と対になる(分けた理由はそちらのコメント参照)。 */
export const staffTraits = pgTable(
  'staff_traits',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    staffId: uuid().notNull(),
    definitionId: uuid().notNull(),

    valueBool: boolean(),
    valueInt: integer(),
    valueText: text(),
    note: text().notNull().default(''),

    recordedByStaffId: uuid(),
    recordedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    foreignKey({
      name: 'staff_traits_tenant_staff_fk',
      columns: [t.tenantId, t.staffId],
      foreignColumns: [staff.tenantId, staff.id],
    }),
    foreignKey({
      name: 'staff_traits_tenant_definition_fk',
      columns: [t.tenantId, t.definitionId],
      foreignColumns: [traitDefinitions.tenantId, traitDefinitions.id],
    }),
    foreignKey({
      name: 'staff_traits_tenant_recorded_by_fk',
      columns: [t.tenantId, t.recordedByStaffId],
      foreignColumns: [staff.tenantId, staff.id],
    }),
    unique('staff_traits_staff_definition_uk').on(t.tenantId, t.staffId, t.definitionId),
    check('staff_traits_exactly_one_value_check', exactlyOneTraitValue(t)),
    index('staff_traits_tenant_definition_idx').on(t.tenantId, t.definitionId),
  ],
).enableRLS();

/**
 * スタッフと顧客の相性。
 *
 * 【スコアと「絶対に組ませない」を分ける理由】
 * score は割当の優先度に使う連続的な値、avoid は候補から外す二値の判断。
 * 1つの数値に混ぜると「スコアが低いだけ(空きが無ければ許容)」と
 * 「絶対不可(空きが無くても割り当ててはいけない)」を区別できなくなる。
 * 苦情や事故が理由の avoid を、人員が足りない日に自動割当が押し通してしまうのは
 * 起こしてはいけない事故なので、意味の違う2列にする。
 *
 * 【行が無い組み合わせの扱い】
 * 「まだ組んだことがない」は行が無い状態で表す(score=3 の行を全組み合わせ分
 * 作らない)。テナントの顧客数×スタッフ数の行を先に作ると、実際に評価された組み合わせと
 * 未評価の組み合わせを区別できなくなる。
 */
export const staffCustomerCompatibilities = pgTable(
  'staff_customer_compatibilities',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    staffId: uuid().notNull(),
    customerId: uuid().notNull(),

    /** 1(組ませたくない)〜5(積極的に組ませたい)。未評価はnull。 */
    score: integer(),
    /** trueなら自動割当の候補から必ず外す。スコアとは別の判断。 */
    avoid: boolean().notNull().default(false),
    /** 理由(avoidのときは必須にしたいが、1行のCHECKで空文字を弾く形にする)。 */
    reason: text().notNull().default(''),
    /** 'manual'(人が入力) | 'derived'(実績から算出)。 */
    source: text().notNull().default('manual'),

    ratedByStaffId: uuid(),
    ratedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    foreignKey({
      name: 'staff_customer_compatibilities_tenant_staff_fk',
      columns: [t.tenantId, t.staffId],
      foreignColumns: [staff.tenantId, staff.id],
    }),
    foreignKey({
      name: 'staff_customer_compatibilities_tenant_customer_fk',
      columns: [t.tenantId, t.customerId],
      foreignColumns: [customers.tenantId, customers.id],
    }),
    foreignKey({
      name: 'staff_customer_compatibilities_tenant_rated_by_fk',
      columns: [t.tenantId, t.ratedByStaffId],
      foreignColumns: [staff.tenantId, staff.id],
    }),
    unique('staff_customer_compatibilities_pair_uk').on(t.tenantId, t.staffId, t.customerId),
    check(
      'staff_customer_compatibilities_score_check',
      sql`${t.score} IS NULL OR ${t.score} BETWEEN ${sqlNumber(COMPATIBILITY_SCORE_MIN)} AND ${sqlNumber(COMPATIBILITY_SCORE_MAX)}`,
    ),
    check(
      'staff_customer_compatibilities_source_check',
      sql`${t.source} IN ${sqlInList(COMPATIBILITY_SOURCES)}`,
    ),
    // 「絶対に組ませない」は理由なしで残してはいけない。後任者が理由を知らずに
    // 解除してしまうと、避けていた事故が再発する。
    check('staff_customer_compatibilities_avoid_reason_check', sql`${t.avoid} = false OR ${t.reason} <> ''`),
    // 「この顧客に割り当てられるスタッフ」の抽出用。
    index('staff_customer_compatibilities_tenant_customer_idx').on(t.tenantId, t.customerId),
  ],
).enableRLS();

/**
 * スタッフ自宅↔顧客宅の所要時間・距離。移動手段ごとに1行。
 *
 * 【毎回Maps APIを引かずに保存する理由】
 * 割当の最適化は「全スタッフ×その日の全訪問先」の総当たりになるため、その場で
 * 経路検索を呼ぶと呼び出し回数と待ち時間が実用にならない。住所が変わらなければ
 * 距離も変わらないので、算出結果を持つ。
 *
 * 【移動手段ごとに行を分ける理由】
 * 自動車で15分の距離が公共交通機関では50分になる、というのが割当判断の要点そのもの。
 * 1行に car の距離だけを持つと、公共交通機関で通うスタッフの割当を誤る。
 *
 * 【'manual' を再計算で上書きしない】
 * 実測値(現場が実際に測った所要時間)は経路検索より正確なことがある。source を見て、
 * 'manual' の行は再計算の対象外にする(この規則はDBでは表せないため usecase 側で守る)。
 */
export const staffCustomerTravelEstimates = pgTable(
  'staff_customer_travel_estimates',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    staffId: uuid().notNull(),
    customerId: uuid().notNull(),

    /** 移動手段。@katahimo/shared の TRANSPORT_MODES のいずれか。 */
    transportMode: text().notNull(),
    /** 距離(メートル)。kmの小数にしないのは丸め誤差を持ち込まないため(金額と同じ方針)。 */
    distanceMeters: integer().notNull(),
    /** 所要時間(分)。 */
    durationMinutes: integer().notNull(),
    /** 'google_maps' | 'straight_line' | 'manual'。 */
    source: text().notNull(),
    /** 算出した時刻。住所変更後に古い値を使わないための判断材料。 */
    computedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    foreignKey({
      name: 'staff_customer_travel_estimates_tenant_staff_fk',
      columns: [t.tenantId, t.staffId],
      foreignColumns: [staff.tenantId, staff.id],
    }),
    foreignKey({
      name: 'staff_customer_travel_estimates_tenant_customer_fk',
      columns: [t.tenantId, t.customerId],
      foreignColumns: [customers.tenantId, customers.id],
    }),
    unique('staff_customer_travel_estimates_pair_mode_uk').on(
      t.tenantId,
      t.staffId,
      t.customerId,
      t.transportMode,
    ),
    check(
      'staff_customer_travel_estimates_transport_mode_check',
      sql`${t.transportMode} IN ${sqlInList(TRANSPORT_MODES)}`,
    ),
    check(
      'staff_customer_travel_estimates_source_check',
      sql`${t.source} IN ${sqlInList(TRAVEL_ESTIMATE_SOURCES)}`,
    ),
    check('staff_customer_travel_estimates_distance_check', sql`${t.distanceMeters} >= 0`),
    check('staff_customer_travel_estimates_duration_check', sql`${t.durationMinutes} >= 0`),
    // 「この顧客に近いスタッフ」を移動手段ごとに近い順で引くため。
    index('staff_customer_travel_estimates_tenant_customer_mode_idx').on(
      t.tenantId,
      t.customerId,
      t.transportMode,
      t.durationMinutes,
    ),
  ],
).enableRLS();
