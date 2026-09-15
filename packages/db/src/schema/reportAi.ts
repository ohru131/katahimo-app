import {
  AGE_MONTHS_MAX,
  EDUCATION_LEVEL_SHIFT_MIN,
  GENERATION_KEYWORD_ROLES,
  MAX_KEYWORDS_PER_REPORT_LIMIT,
  PROMPT_TEMPLATE_KEYS,
  REPORT_LEVEL_MAX,
  REPORT_LEVEL_MIN,
  REPORT_PHRASE_KINDS,
  REPORT_PHRASE_PLACEMENTS,
} from '@katahimo/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { TENANT_RLS_USING } from './_rls';
import { sqlInList, sqlNumber } from './_sqlLiteral';
import { customers } from './customers';
import { familyMembers } from './familyMembers';
import { staff } from './staff';
import { tenants } from './tenants';

/**
 * 日報AIのプロンプト調整(テナントごとの文面・キーワード表・判定基準)と、AI生成の記録。
 *
 * GAS版は「ＡＩプロンプト」シートに Key / Prompt Template の2列で文面を持ち、管理者が
 * シートを直接編集していた。本アプリではその置き場所をDBに移し(prompt_templates)、さらに
 * 保護者向け文面を次の3軸で組み替えられるようにする(doc/db/new-domains.md 第6章)。
 *
 *   1. 子の年齢帯   … 世帯構成員の生年月日から月齢を都度計算し、report_age_bands に当てる
 *   2. 教育関心度★ … 家庭ごとの値(customer_report_profiles.education_level)。高いほど教育語を使う
 *   3. ストレス度   … 訪問ごとにスタッフが評価する保護者の負担(daily_reports.risk_rating)。
 *                     低いほど負担が大きく、★より優先して文面を控えめにする
 *
 * 「どの語をどの条件で使えるか」は report_keywords の行に持たせ、絞り込みはコードで行う
 * (AIにキーワード表を丸ごと渡して選ばせない)。プロンプトが短く安定し、使える語の集合が
 * 決定的になるため、後から「この家庭にこの語を出したのは正しかったか」を検証できる。
 *
 * 【区分値・値域】@katahimo/shared の contracts/reportAi.ts。DBのCHECKはそこから組み立てる。
 * 【既定値】テナントの行が無いキーは packages/integrations の prompts.ts(GAS版の既定文面)へ
 * フォールバックする(GAS版 getPrompt の「シートに無ければ既定」と同じ挙動)。
 */

/**
 * プロンプト文面。1行=1キーの1版。
 *
 * 【追記のみ(版を積む)にする理由】
 * 文面を上書きすると「どの文面で生成した日報か」が辿れなくなる。日報1件は
 * report_ai_generations.prompt_template_id で使った版を指すため、版は消さない。
 * 有効な版は (tenant_id, key) ごとの最大 version。「既定に戻す」も既定文面を新しい版として積む。
 */
export const promptTemplates = pgTable(
  'prompt_templates',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    /** @katahimo/shared の PROMPT_TEMPLATE_KEYS のいずれか。GAS版 PROMPT_KEYS に対応。 */
    key: text().notNull(),
    /** 版番号。1から始め、同じキーに積むごとに+1。 */
    version: integer().notNull(),
    /** 文面。差し込み位置は PROMPT_PLACEHOLDERS の名前を `{...}` で書く。 */
    body: text().notNull(),
    /** この版を作った理由(「PSI3の文面を控えめに」等)。一覧で版の違いを読めるようにする。 */
    note: text().notNull().default(''),
    /** 作成した管理者。取込・移行スクリプトで作られた版は null。 */
    createdByStaffId: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    foreignKey({
      name: 'prompt_templates_tenant_created_by_fk',
      columns: [t.tenantId, t.createdByStaffId],
      foreignColumns: [staff.tenantId, staff.id],
    }),
    // 同じキーに同じ版番号を2つ作らせない。有効版の取得(ORDER BY version DESC LIMIT 1)もこの索引で返す。
    unique('prompt_templates_tenant_key_version_uk').on(t.tenantId, t.key, t.version),
    // report_ai_generations.prompt_template_id からの複合FKの参照先。
    unique('prompt_templates_tenant_id_uk').on(t.tenantId, t.id),
    check('prompt_templates_key_check', sql`${t.key} IN ${sqlInList(PROMPT_TEMPLATE_KEYS)}`),
    check('prompt_templates_version_check', sql`${t.version} >= 1`),
    // 空の文面を有効版にしてしまうと、AIに指示ゼロで生成させることになる。空白だけも弾く。
    check('prompt_templates_body_not_blank', sql`NULLIF(btrim(${t.body}), '') IS NOT NULL`),
  ],
).enableRLS();

/**
 * 教育関心度★(1〜5)ごとの、教育キーワードの使い方。テナントごとに5行。
 *
 * 「★4なら用語名を出してよい、1通1〜2語まで」のような運用ルールを文面ではなく列に持たせ、
 * コードが max_keywords / allow_term_names を読んで候補数と指示文を組み立てる。
 * prompt_instruction はレベル固有の言い回し(「観察→さりげない意味づけ」等)で、そのまま
 * {keywordGuide} に差し込まれる。
 */
export const reportEducationLevels = pgTable(
  'report_education_levels',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    /** ★の値(1〜5)。 */
    level: integer().notNull(),
    /** 呼称(「標準」「関心高い」等)。管理画面・顧客プロフィール編集で表示。 */
    label: text().notNull(),
    /** 想定する家庭像。管理者が★を付けるときの判断材料。 */
    description: text().notNull().default(''),
    /** このレベルでのAIへの指示文。{keywordGuide} に差し込む。 */
    promptInstruction: text().notNull().default(''),
    /** 1通に織り込む教育キーワード数の上限。0なら教育語を使わない。 */
    maxKeywords: integer().notNull().default(1),
    /** 用語名(「敏感期」等)をそのまま出してよいか。false なら親向け説明の言い換えだけを使う。 */
    allowTermNames: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    unique('report_education_levels_tenant_level_uk').on(t.tenantId, t.level),
    check(
      'report_education_levels_level_check',
      sql`${t.level} BETWEEN ${sqlNumber(REPORT_LEVEL_MIN)} AND ${sqlNumber(REPORT_LEVEL_MAX)}`,
    ),
    check(
      'report_education_levels_max_keywords_check',
      sql`${t.maxKeywords} BETWEEN 0 AND ${sqlNumber(MAX_KEYWORDS_PER_REPORT_LIMIT)}`,
    ),
  ],
).enableRLS();

/**
 * ストレス度(1〜5。daily_reports.risk_rating と同じ尺度)ごとの、判定基準と文面への効き方。
 * テナントごとに5行。
 *
 * 【★より優先する仕組みを列で持つ理由】
 * 「ストレス度3なら★を1〜2段下げる、2以下なら教育語を使わない、1なら管理者へ連絡」という
 * 安全弁を、文面の中の一節ではなく education_level_shift / keywords_enabled / escalation_required
 * の3列にする。コードが機械的に適用するので、文面をどう編集しても安全弁が外れない。
 *
 * criteria はスタッフが訪問後に評価するときの判定基準(表情・疲労・関わり等)で、日報入力画面に
 * 出す。判定基準が現場に見えていないと、評価がスタッフごとにぶれる。
 */
export const reportStressLevels = pgTable(
  'report_stress_levels',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    /** ストレス度の値(1〜5)。低いほど負担が大きい。 */
    level: integer().notNull(),
    /** 呼称(「安心・良好」「要観察」「危険・緊急」等)。 */
    label: text().notNull(),
    /** スタッフ向けの判定基準。日報入力画面に表示する。 */
    criteria: text().notNull().default(''),
    /** このレベルでのAIへの指示文。{keywordGuide} に差し込む。 */
    promptInstruction: text().notNull().default(''),
    /** 教育関心度★を何段下げて扱うか。0(下げない)〜-4。 */
    educationLevelShift: integer().notNull().default(0),
    /** 教育キーワードを使ってよいか。false なら候補を空にし、温かみ表現(report_phrases)に切り替える。 */
    keywordsEnabled: boolean().notNull().default(true),
    /** 管理者への連絡を要するか。true なら生成結果の warnings にその旨を必ず出す。 */
    escalationRequired: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    unique('report_stress_levels_tenant_level_uk').on(t.tenantId, t.level),
    check(
      'report_stress_levels_level_check',
      sql`${t.level} BETWEEN ${sqlNumber(REPORT_LEVEL_MIN)} AND ${sqlNumber(REPORT_LEVEL_MAX)}`,
    ),
    // 上げる方向(正の値)は許さない。負担が大きい家庭で文面をより教育的にする意味は無い。
    check(
      'report_stress_levels_shift_check',
      sql`${t.educationLevelShift} BETWEEN ${sqlNumber(EDUCATION_LEVEL_SHIFT_MIN)} AND 0`,
    ),
  ],
).enableRLS();

/**
 * 年齢帯。子の月齢を「0〜6ヶ月」「1歳」「4歳」のような帯に丸め、その時期によく描く行動語と
 * 発達のトピックを持つ。テナントごとに任意の本数。
 *
 * 月齢の範囲は半開区間 [age_from_months, age_to_months)。「6〜12ヶ月」は from=6, to=12 で、
 * 12ヶ月ちょうどは次の帯(1歳)に入る。境界の月齢が2つの帯に入らないようにするため。
 * 帯どうしの重なり禁止は1行のCHECKでは書けない(btree_gist の EXCLUDE は PGlite に無い。
 * doc/db/guidelines.md §8.7)ため、入口(usecase)で担保する。
 */
export const reportAgeBands = pgTable(
  'report_age_bands',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    /** 短い識別子(「m0_6」「y1」等)。管理画面での並べ替え・取込での突合に使う。 */
    code: text().notNull(),
    /** 表示名(「0〜6ヶ月」「1歳」等)。 */
    label: text().notNull(),
    /** 月齢の下限(この値を含む)。 */
    ageFromMonths: integer().notNull(),
    /** 月齢の上限(この値を含まない)。 */
    ageToMonths: integer().notNull(),
    /** この時期によく描写する行動・単語(「ずり這い」「指差し」等)。{childContext} に差し込む。 */
    behaviorWords: text().notNull().default(''),
    /** 発達の主なトピック(「首すわり・追視」等)。 */
    developmentTopics: text().notNull().default(''),
    /** 場面の例(「離乳食」「お散歩」等)。 */
    sceneExamples: text().notNull().default(''),
    sortOrder: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    unique('report_age_bands_tenant_code_uk').on(t.tenantId, t.code),
    // report_age_band_keywords からの複合FKの参照先。
    unique('report_age_bands_tenant_id_uk').on(t.tenantId, t.id),
    check('report_age_bands_code_not_blank', sql`NULLIF(btrim(${t.code}), '') IS NOT NULL`),
    check(
      'report_age_bands_age_range_check',
      sql`${t.ageFromMonths} >= 0
        AND ${t.ageToMonths} > ${t.ageFromMonths}
        AND ${t.ageToMonths} <= ${sqlNumber(AGE_MONTHS_MAX)}`,
    ),
  ],
).enableRLS();

/**
 * 教育キーワード(「敏感期」「感覚統合」「自己肯定感」等)と、その語を使ってよい条件。
 * 1行=1語。テナントごとに任意の本数。
 *
 * 使用可否は次の3条件を全部満たすときだけ(コードで絞り込む。domain/reports/promptAssembly.ts):
 *   - 子の月齢が [age_from_months, age_to_months) に入る
 *   - 家庭の教育関心度★(ストレス度による引き下げ後)が [education_level_min, education_level_max] に入る
 *   - 保護者のストレス度が stress_level_min 以上(負担が大きい家庭ほど自動的に候補から外れる)
 *
 * 【category / tone を区分値にしない理由】
 * どちらもテナントが自分の言葉で決める分類(「非認知能力・生きる力系」「情緒ケア」等)で、
 * コードが分岐に使わない。CHECKで縛ると、テナントが分類を1つ足すたびにマイグレーションになる。
 */
export const reportKeywords = pgTable(
  'report_keywords',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    /** 短い識別子(「K01」等)。生成結果の usedKeywords との突合、取込での更新に使う。 */
    code: text().notNull(),
    /** 分類(テナントの自由な言葉)。 */
    category: text().notNull().default(''),
    /** キーワード(用語名)。 */
    name: text().notNull(),
    /** 副題・別名(「心の安全基地」等)。 */
    subConcept: text().notNull().default(''),
    /** 対象月齢の下限(含む)。 */
    ageFromMonths: integer().notNull(),
    /** 対象月齢の上限(含まない)。 */
    ageToMonths: integer().notNull(),
    /** この語を使ってよい教育関心度★の範囲(両端を含む)。 */
    educationLevelMin: integer().notNull(),
    educationLevelMax: integer().notNull(),
    /** この語を使ってよい最低ストレス度。保護者のストレス度がこの値以上のときだけ候補に入る。 */
    stressLevelMin: integer().notNull(),
    /** 語調の種類(「意味づけ」「情緒ケア」等。テナントの自由な言葉)。 */
    tone: text().notNull().default(''),
    /** 親向けのやさしい言い換え。用語名を出すときは必ずこれとセットで使う。 */
    parentExplanation: text().notNull().default(''),
    /** 日報での言い回しの例(複数可。改行区切り)。 */
    phraseExamples: text().notNull().default(''),
    /** 使いどころ・場面。 */
    usageScene: text().notNull().default(''),
    /** この語で避ける言い方(評価口調・上から目線の例)。 */
    ngExample: text().notNull().default(''),
    sortOrder: integer().notNull().default(0),
    /** 廃止は false にする。過去の生成記録(report_ai_generation_keywords)が参照するため行は消さない。 */
    active: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    unique('report_keywords_tenant_code_uk').on(t.tenantId, t.code),
    // report_age_band_keywords / report_ai_generation_keywords からの複合FKの参照先。
    unique('report_keywords_tenant_id_uk').on(t.tenantId, t.id),
    check('report_keywords_code_not_blank', sql`NULLIF(btrim(${t.code}), '') IS NOT NULL`),
    check('report_keywords_name_not_blank', sql`NULLIF(btrim(${t.name}), '') IS NOT NULL`),
    check(
      'report_keywords_age_range_check',
      sql`${t.ageFromMonths} >= 0
        AND ${t.ageToMonths} > ${t.ageFromMonths}
        AND ${t.ageToMonths} <= ${sqlNumber(AGE_MONTHS_MAX)}`,
    ),
    check(
      'report_keywords_education_level_check',
      sql`${t.educationLevelMin} BETWEEN ${sqlNumber(REPORT_LEVEL_MIN)} AND ${sqlNumber(REPORT_LEVEL_MAX)}
        AND ${t.educationLevelMax} BETWEEN ${sqlNumber(REPORT_LEVEL_MIN)} AND ${sqlNumber(REPORT_LEVEL_MAX)}
        AND ${t.educationLevelMin} <= ${t.educationLevelMax}`,
    ),
    check(
      'report_keywords_stress_level_check',
      sql`${t.stressLevelMin} BETWEEN ${sqlNumber(REPORT_LEVEL_MIN)} AND ${sqlNumber(REPORT_LEVEL_MAX)}`,
    ),
  ],
).enableRLS();

/**
 * 年齢帯と「その時期に相性の良いキーワード」の対応。多対多。
 *
 * 月齢の範囲だけでも候補は絞れるが、同じ月齢で使える語が10以上あるとき、どれを先に提示するかの
 * 手がかりになる(相性の良い語を候補の先頭に並べる)。並び順は sort_order。
 */
export const reportAgeBandKeywords = pgTable(
  'report_age_band_keywords',
  {
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    ageBandId: uuid().notNull(),
    keywordId: uuid().notNull(),
    sortOrder: integer().notNull().default(0),
  },
  (t) => [
    primaryKey({ name: 'report_age_band_keywords_pk', columns: [t.tenantId, t.ageBandId, t.keywordId] }),
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    foreignKey({
      name: 'report_age_band_keywords_tenant_band_fk',
      columns: [t.tenantId, t.ageBandId],
      foreignColumns: [reportAgeBands.tenantId, reportAgeBands.id],
    }),
    foreignKey({
      name: 'report_age_band_keywords_tenant_keyword_fk',
      columns: [t.tenantId, t.keywordId],
      foreignColumns: [reportKeywords.tenantId, reportKeywords.id],
    }),
  ],
).enableRLS();

/**
 * 温かみ表現(encourage)と、全日報で避ける表現(avoid)。1行=1表現。
 *
 * encourage は保護者のストレス度が [stress_level_min, stress_level_max] のときに候補になる
 * (負担が大きい家庭ほど、教育語の代わりにこちらで締める)。avoid はストレス度に関わらず
 * 全ての日報で「使わない言い回し」として {toneGuide} に列挙する。
 */
export const reportPhrases = pgTable(
  'report_phrases',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    /** 'encourage' / 'avoid'。@katahimo/shared の REPORT_PHRASE_KINDS。 */
    kind: text().notNull(),
    /** 表現そのもの(avoid なら避ける言い回しの例)。 */
    body: text().notNull(),
    /** 込めるメッセージ、または避ける理由。管理画面で意図を読めるようにする。 */
    intent: text().notNull().default(''),
    /** 適用するストレス度の範囲(両端を含む)。avoid は既定の 1〜5(全範囲)のままにする。 */
    stressLevelMin: integer().notNull().default(REPORT_LEVEL_MIN),
    stressLevelMax: integer().notNull().default(REPORT_LEVEL_MAX),
    /** 'any' / 'closing'。締めの一文として使う表現を区別する。 */
    placement: text().notNull().default('any'),
    sortOrder: integer().notNull().default(0),
    /** 廃止は false にする。 */
    active: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    check('report_phrases_kind_check', sql`${t.kind} IN ${sqlInList(REPORT_PHRASE_KINDS)}`),
    check('report_phrases_placement_check', sql`${t.placement} IN ${sqlInList(REPORT_PHRASE_PLACEMENTS)}`),
    check('report_phrases_body_not_blank', sql`NULLIF(btrim(${t.body}), '') IS NOT NULL`),
    check(
      'report_phrases_stress_level_check',
      sql`${t.stressLevelMin} BETWEEN ${sqlNumber(REPORT_LEVEL_MIN)} AND ${sqlNumber(REPORT_LEVEL_MAX)}
        AND ${t.stressLevelMax} BETWEEN ${sqlNumber(REPORT_LEVEL_MIN)} AND ${sqlNumber(REPORT_LEVEL_MAX)}
        AND ${t.stressLevelMin} <= ${t.stressLevelMax}`,
    ),
    // 生成のたびに「このテナントの有効な表現を種類別に」読む。
    index('report_phrases_tenant_kind_idx').on(t.tenantId, t.kind).where(sql`${t.active}`),
  ],
).enableRLS();

/**
 * 家庭(顧客)ごとの日報の書き方の設定。いまは教育関心度★だけ。1顧客1行。
 *
 * 【customers の列にしない理由】
 * customers は RESERVA CSV の取込で更新される「顧客側から来た情報」の表。★は管理者・担当者が
 * 家庭との会話から付ける「こちら側の判断」で、取込の全件上書きで消えてはいけない。
 * 訪問割当の customer_traits(相性計算用の特性値)に載せることも考えたが、あちらは
 * 「誰を組ませるか」の判断材料で、こちらは「どう書くか」の設定。目的が違う値を1つの表に
 * 混ぜると、相性計算がうっかり★を読む(またはその逆)余地が生まれる。
 */
export const customerReportProfiles = pgTable(
  'customer_report_profiles',
  {
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    customerId: uuid().notNull(),
    /** 教育関心度★(1〜5)。未設定は null(生成時は report_education_levels の既定=★2相当として扱う)。 */
    educationLevel: integer(),
    /** ★を付けた根拠・家庭の意向のメモ(「モンテッソーリに関心」「専門用語は控えてほしい」等)。 */
    note: text().notNull().default(''),
    /** 最後に更新したスタッフ。取込・移行で入った行は null。 */
    updatedByStaffId: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'customer_report_profiles_pk', columns: [t.tenantId, t.customerId] }),
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    foreignKey({
      name: 'customer_report_profiles_tenant_customer_fk',
      columns: [t.tenantId, t.customerId],
      foreignColumns: [customers.tenantId, customers.id],
    }),
    foreignKey({
      name: 'customer_report_profiles_tenant_updated_by_fk',
      columns: [t.tenantId, t.updatedByStaffId],
      foreignColumns: [staff.tenantId, staff.id],
    }),
    check(
      'customer_report_profiles_education_level_check',
      sql`${t.educationLevel} IS NULL
        OR ${t.educationLevel} BETWEEN ${sqlNumber(REPORT_LEVEL_MIN)} AND ${sqlNumber(REPORT_LEVEL_MAX)}`,
    ),
  ],
).enableRLS();

/**
 * AI生成1回の記録。生成のたびに1行(保存されなかった下書きも残る)。
 *
 * 【残す理由】
 * - 日報から「どのモデル・どの版の文面・どの★/ストレス度・どの候補語」で生まれたかを辿る
 *   (doc/proposal/tech-stack.md: AI生成の記録にはモデル名とプロンプトの版を残す)。
 * - 文面やキーワード表を変えた前後で出来上がりを比べる(検証の材料)。
 * - 失敗(APIエラー)も残し、どの入力で落ちたかを追える。
 *
 * 【書き換えない】updated_at を持たない。生成結果は事実の記録で、後から直す対象ではない。
 * 本文を直すのは daily_reports 側(人が編集した最終版)であって、この表は AI が返した生の値を保つ。
 *
 * 【daily_reports との向き】daily_reports.ai_generation_id がこの表を指す(逆ではない)。
 * 生成は保存の前に何度でも行われ、保存に使われた1回だけが日報から参照される。
 */
export const reportAiGenerations = pgTable(
  'report_ai_generations',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    /** 生成を実行したスタッフ。 */
    staffId: uuid().notNull(),
    /** 対象の家庭。 */
    customerId: uuid().notNull(),
    /** 対象児(世帯構成員)。未選択は null(このとき child_age_months も null)。 */
    targetFamilyMemberId: uuid(),
    /** 使った日報生成文面(prompt_templates の版)。テナントの版が無く既定文面を使ったときは null。 */
    promptTemplateId: uuid(),
    /** 使ったモデル名(「gemini-2.5-flash」等)。 */
    model: text().notNull(),

    /** 生成時点の対象児の月齢(生年月日から計算した値のスナップショット)。不明は null。 */
    childAgeMonths: integer(),
    /** 生成時点の家庭の教育関心度★(customer_report_profiles の値)。未設定は null。 */
    educationLevel: integer(),
    /** ストレス度による引き下げ後に実際に適用した★。 */
    effectiveEducationLevel: integer(),
    /** 生成時点でスタッフが評価していたストレス度(daily_reports.risk_rating と同じ尺度)。未評価は null。 */
    stressLevel: integer(),
    /** 管理者への連絡を要するストレス度だったか(report_stress_levels.escalation_required の適用結果)。 */
    escalationRequired: boolean().notNull().default(false),

    /** スタッフが入力したメモ(口語)。生成の入力そのもの。 */
    inputText: text().notNull(),
    /** 保育時間の文字列("10:00〜13:00" 等)。 */
    timeInfo: text().notNull().default(''),
    /** AIが返した値(warnings / internal / customer / usedKeywords 等)をそのまま。失敗時は null。 */
    outputJson: jsonb(),
    /** 失敗時のエラー内容。成功時は null。 */
    errorMessage: text(),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    foreignKey({
      name: 'report_ai_generations_tenant_staff_fk',
      columns: [t.tenantId, t.staffId],
      foreignColumns: [staff.tenantId, staff.id],
    }),
    foreignKey({
      name: 'report_ai_generations_tenant_customer_fk',
      columns: [t.tenantId, t.customerId],
      foreignColumns: [customers.tenantId, customers.id],
    }),
    foreignKey({
      name: 'report_ai_generations_tenant_target_family_member_fk',
      columns: [t.tenantId, t.targetFamilyMemberId],
      foreignColumns: [familyMembers.tenantId, familyMembers.id],
    }),
    foreignKey({
      name: 'report_ai_generations_tenant_prompt_template_fk',
      columns: [t.tenantId, t.promptTemplateId],
      foreignColumns: [promptTemplates.tenantId, promptTemplates.id],
    }),
    // daily_reports.ai_generation_id / report_ai_generation_keywords からの複合FKの参照先。
    unique('report_ai_generations_tenant_id_uk').on(t.tenantId, t.id),
    check(
      'report_ai_generations_levels_check',
      sql`(${t.educationLevel} IS NULL
          OR ${t.educationLevel} BETWEEN ${sqlNumber(REPORT_LEVEL_MIN)} AND ${sqlNumber(REPORT_LEVEL_MAX)})
        AND (${t.effectiveEducationLevel} IS NULL
          OR ${t.effectiveEducationLevel} BETWEEN ${sqlNumber(REPORT_LEVEL_MIN)} AND ${sqlNumber(REPORT_LEVEL_MAX)})
        AND (${t.stressLevel} IS NULL
          OR ${t.stressLevel} BETWEEN ${sqlNumber(REPORT_LEVEL_MIN)} AND ${sqlNumber(REPORT_LEVEL_MAX)})`,
    ),
    check(
      'report_ai_generations_child_age_check',
      sql`${t.childAgeMonths} IS NULL OR ${t.childAgeMonths} BETWEEN 0 AND ${sqlNumber(AGE_MONTHS_MAX)}`,
    ),
    // 成功と失敗のどちらかが必ず分かる形にする(両方 null / 両方入りの行を作らせない)。
    check(
      'report_ai_generations_outcome_check',
      sql`(${t.outputJson} IS NULL) <> (${t.errorMessage} IS NULL)`,
    ),
    // 「この家庭への生成履歴を新しい順に」(文面調整の効果を家庭ごとに見る)を索引だけで返す。
    index('report_ai_generations_tenant_customer_created_idx').on(
      t.tenantId,
      t.customerId,
      t.createdAt.desc(),
    ),
  ],
).enableRLS();

/**
 * 生成1回で、どのキーワードを候補として提示し(candidate)、AIがどれを使ったと答えたか(used)。
 *
 * 「どの家庭にどの語を何回出したか」「提示したのに使われない語」「提示していないのに使われた語」
 * をSQLで数えるための表。outputJson の中を JSON 検索して集計する形にしないのは、
 * 語の廃止・改名(report_keywords)と突き合わせるのに外部キーが要るため。
 */
export const reportAiGenerationKeywords = pgTable(
  'report_ai_generation_keywords',
  {
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    generationId: uuid().notNull(),
    keywordId: uuid().notNull(),
    /** 'candidate' / 'used'。@katahimo/shared の GENERATION_KEYWORD_ROLES。 */
    role: text().notNull(),
  },
  (t) => [
    primaryKey({
      name: 'report_ai_generation_keywords_pk',
      columns: [t.tenantId, t.generationId, t.keywordId, t.role],
    }),
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    foreignKey({
      name: 'report_ai_generation_keywords_tenant_generation_fk',
      columns: [t.tenantId, t.generationId],
      foreignColumns: [reportAiGenerations.tenantId, reportAiGenerations.id],
    }),
    foreignKey({
      name: 'report_ai_generation_keywords_tenant_keyword_fk',
      columns: [t.tenantId, t.keywordId],
      foreignColumns: [reportKeywords.tenantId, reportKeywords.id],
    }),
    check(
      'report_ai_generation_keywords_role_check',
      sql`${t.role} IN ${sqlInList(GENERATION_KEYWORD_ROLES)}`,
    ),
    // 「この語は何回使われたか」を語側から数えるため。
    index('report_ai_generation_keywords_tenant_keyword_idx').on(t.tenantId, t.keywordId, t.role),
  ],
).enableRLS();
