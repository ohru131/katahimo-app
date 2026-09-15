import { z } from 'zod';
import {
  AGE_MONTHS_MAX,
  EDUCATION_LEVEL_SHIFT_MIN,
  MAX_KEYWORDS_PER_REPORT_LIMIT,
  PROMPT_TEMPLATE_BODY_MAX_LENGTH,
  promptTemplateKeySchema,
  REPORT_LEVEL_MAX,
  REPORT_LEVEL_MIN,
  reportLevelSchema,
  reportPhraseKindSchema,
  reportPhrasePlacementSchema,
} from './reportAi';

/**
 * 日報AIの3軸(年齢帯・教育関心度★・ストレス度)の設定を管理者が編集するための契約。
 *
 * 区分値・値域そのものは `./reportAi.ts`(DBのCHECK制約もそこから組み立てている)にあり、
 * ここはその値域を使って「1行ぶんの入力」と「画面に返す1行」の形を決める。
 * 同じスキーマを API(packages/api/src/routes/settings.ts)と画面
 * (packages/web/src/settings/ReportAiAdminModal.tsx)の両方が参照することで、
 * 入力欄と受け口のズレをコンパイル時に見つけられる。
 *
 * 【View に id・createdAt を含めない理由】
 * 管理画面が行を指すのは `code`(年齢帯・キーワード)と `level`(各レベル定義)で、UUIDは使わない。
 * 取込(xlsx)も同じ列で突き合わせるので、画面・取込・APIのどこから来た行も同じ鍵で upsert できる。
 * 表現(report_phrases)は全件入れ替えなので、そもそも行を指す鍵を持たない。
 */

// ---------------------------------------------------------------------------
// 列ごとの部品(DBのCHECK制約と同じ判定を入口で行うためのもの)
// ---------------------------------------------------------------------------

/** 識別子。DBの `*_code_not_blank`(空白だけを許さない)と同じ判定。 */
const codeSchema = z.string().trim().min(1, 'コードを入力してください').max(64, 'コードが長すぎます');
/** 表示名。空文字を許さない列(label / name / body)に使う。 */
const requiredTextSchema = z.string().trim().min(1, '入力してください').max(200, '長すぎます');
/** 空文字を許す説明列。DB側も `NOT NULL DEFAULT ''` なので、未入力は空文字で持つ。 */
const optionalTextSchema = z.string().trim().max(2000, '長すぎます').default('');
/** 並び順。小さいほど先に出す。 */
const sortOrderSchema = z.number().int().min(0).max(9999).default(0);
/** 月齢。上限は `AGE_MONTHS_MAX`(report_age_bands / report_keywords の CHECK と同じ)。 */
const ageMonthsSchema = z.number().int().min(0).max(AGE_MONTHS_MAX);

/**
 * 月齢の範囲が半開区間 `[from, to)` として成立しているか。
 * DBの `*_age_range_check` と同じ判定を入口でも行い、23514(CHECK違反)でしか
 * 気付けない形にしない(doc/db/guidelines.md §1.6)。
 */
function refineAgeRange<T extends { ageFromMonths: number; ageToMonths: number }>(
  value: T,
  ctx: z.RefinementCtx,
): void {
  if (value.ageToMonths <= value.ageFromMonths) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['ageToMonths'],
      message: '対象月齢の上限は下限より大きい値にしてください(上限の月齢は範囲に含みません)。',
    });
  }
}

// ---------------------------------------------------------------------------
// 年齢帯(report_age_bands)
// ---------------------------------------------------------------------------

const ageBandFields = {
  /** 短い識別子(「m0_6」「y1」等)。この値で upsert する。 */
  code: codeSchema,
  /** 表示名(「0〜6ヶ月」「1歳」等)。 */
  label: requiredTextSchema,
  /** 月齢の下限(含む)。 */
  ageFromMonths: ageMonthsSchema,
  /** 月齢の上限(含まない)。 */
  ageToMonths: ageMonthsSchema,
  /** この時期によく描写する行動・単語。`{childContext}` に差し込まれる。 */
  behaviorWords: optionalTextSchema,
  developmentTopics: optionalTextSchema,
  sceneExamples: optionalTextSchema,
  sortOrder: sortOrderSchema,
};

export const ageBandInputSchema = z.object(ageBandFields).superRefine(refineAgeRange);
export type AgeBandInput = z.infer<typeof ageBandInputSchema>;

/** `PUT /age-bands/:code` の本文。code はURLから来るので本文には含めない。 */
export const ageBandBodySchema = z.object(ageBandFields).omit({ code: true }).superRefine(refineAgeRange);
export type AgeBandBody = z.infer<typeof ageBandBodySchema>;

/** 管理画面に返す1行。入力と同じ形(code が識別子)。 */
export type AgeBandView = AgeBandInput;

// ---------------------------------------------------------------------------
// 教育キーワード(report_keywords)
// ---------------------------------------------------------------------------

const keywordFields = {
  /** 短い識別子(「K01」等)。この値で upsert し、生成結果の usedKeywords とも突き合わせる。 */
  code: codeSchema,
  /** 分類(テナントの自由な言葉)。区分値にはしない。 */
  category: optionalTextSchema,
  /** キーワード(用語名)。 */
  name: requiredTextSchema,
  subConcept: optionalTextSchema,
  ageFromMonths: ageMonthsSchema,
  ageToMonths: ageMonthsSchema,
  /** この語を使ってよい教育関心度★の範囲(両端を含む)。 */
  educationLevelMin: reportLevelSchema,
  educationLevelMax: reportLevelSchema,
  /** この語を使ってよい最低ストレス度。保護者のストレス度がこの値以上のときだけ候補に入る。 */
  stressLevelMin: reportLevelSchema,
  tone: optionalTextSchema,
  /** 親向けのやさしい言い換え。用語名を出すときは必ずこれとセットで使う。 */
  parentExplanation: optionalTextSchema,
  phraseExamples: optionalTextSchema,
  usageScene: optionalTextSchema,
  ngExample: optionalTextSchema,
  sortOrder: sortOrderSchema,
  /** 廃止は false。生成記録が参照するため行は消さない。 */
  active: z.boolean().default(true),
  /** 相性の良い年齢帯のコード(report_age_band_keywords)。保存のたびに対応行を入れ替える。 */
  ageBandCodes: z.array(codeSchema).default([]),
};

function refineKeyword(
  value: { educationLevelMin: number; educationLevelMax: number },
  ctx: z.RefinementCtx,
) {
  if (value.educationLevelMin > value.educationLevelMax) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['educationLevelMax'],
      message: '教育関心度★の上限は下限以上にしてください。',
    });
  }
}

export const keywordInputSchema = z.object(keywordFields).superRefine((value, ctx) => {
  refineAgeRange(value, ctx);
  refineKeyword(value, ctx);
});
export type KeywordInput = z.infer<typeof keywordInputSchema>;

/** `PUT /keywords/:code` の本文。 */
export const keywordBodySchema = z
  .object(keywordFields)
  .omit({ code: true })
  .superRefine((value, ctx) => {
    refineAgeRange(value, ctx);
    refineKeyword(value, ctx);
  });
export type KeywordBody = z.infer<typeof keywordBodySchema>;

export type KeywordView = KeywordInput;

// ---------------------------------------------------------------------------
// 教育関心度★の定義(report_education_levels)
// ---------------------------------------------------------------------------

const educationLevelFields = {
  /** ★の値(1〜5)。この値で upsert する。 */
  level: reportLevelSchema,
  label: requiredTextSchema,
  /** 想定する家庭像。管理者が★を付けるときの判断材料。 */
  description: optionalTextSchema,
  /** このレベルでのAIへの指示文。`{keywordGuide}` に差し込まれる。 */
  promptInstruction: optionalTextSchema,
  /** 1通に織り込む教育キーワード数の上限。0なら教育語を使わない。 */
  maxKeywords: z.number().int().min(0).max(MAX_KEYWORDS_PER_REPORT_LIMIT).default(1),
  /** 用語名をそのまま出してよいか。false なら親向け説明の言い換えだけを使う。 */
  allowTermNames: z.boolean().default(false),
};

export const educationLevelInputSchema = z.object(educationLevelFields);
export type EducationLevelInput = z.infer<typeof educationLevelInputSchema>;

/** `PUT /education-levels/:level` の本文。level はURLから来る。 */
export const educationLevelBodySchema = z.object(educationLevelFields).omit({ level: true });
export type EducationLevelBody = z.infer<typeof educationLevelBodySchema>;

export type EducationLevelView = EducationLevelInput;

// ---------------------------------------------------------------------------
// ストレス度の定義(report_stress_levels)
// ---------------------------------------------------------------------------

const stressLevelFields = {
  /** ストレス度の値(1〜5)。低いほど負担が大きい。この値で upsert する。 */
  level: reportLevelSchema,
  label: requiredTextSchema,
  /** スタッフ向けの判定基準。日報入力画面に表示する。 */
  criteria: optionalTextSchema,
  promptInstruction: optionalTextSchema,
  /** 教育関心度★を何段下げて扱うか。0(下げない)〜 EDUCATION_LEVEL_SHIFT_MIN。 */
  educationLevelShift: z.number().int().min(EDUCATION_LEVEL_SHIFT_MIN).max(0).default(0),
  /** 教育キーワードを使ってよいか。false なら候補を空にし、温かみ表現に切り替える。 */
  keywordsEnabled: z.boolean().default(true),
  /** 管理者への連絡を要するか。true なら生成結果の warnings に必ず出す。 */
  escalationRequired: z.boolean().default(false),
};

export const stressLevelInputSchema = z.object(stressLevelFields);
export type StressLevelInput = z.infer<typeof stressLevelInputSchema>;

/** `PUT /stress-levels/:level` の本文。 */
export const stressLevelBodySchema = z.object(stressLevelFields).omit({ level: true });
export type StressLevelBody = z.infer<typeof stressLevelBodySchema>;

export type StressLevelView = StressLevelInput;

// ---------------------------------------------------------------------------
// 温かみ表現・避ける表現(report_phrases)
// ---------------------------------------------------------------------------

export const phraseInputSchema = z
  .object({
    /** 'encourage'(ねぎらう表現)/ 'avoid'(全日報で避ける表現)。 */
    kind: reportPhraseKindSchema,
    /** 表現そのもの。DBの `report_phrases_body_not_blank` と同じで空白だけは許さない。 */
    body: z.string().trim().min(1, '表現を入力してください').max(500, '表現が長すぎます'),
    /** 込めるメッセージ、または避ける理由。 */
    intent: optionalTextSchema,
    /**
     * 適用するストレス度の範囲(両端を含む)。encourage だけが範囲を持ち、
     * avoid は必ず 1〜5(全範囲)にする。
     */
    stressLevelMin: reportLevelSchema.default(REPORT_LEVEL_MIN),
    stressLevelMax: reportLevelSchema.default(REPORT_LEVEL_MAX),
    placement: reportPhrasePlacementSchema.default('any'),
    sortOrder: sortOrderSchema,
    active: z.boolean().default(true),
  })
  .superRefine((value, ctx) => {
    if (value.stressLevelMin > value.stressLevelMax) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['stressLevelMax'],
        message: 'ストレス度の上限は下限以上にしてください。',
      });
    }
    // 【avoid に範囲を持たせない理由】
    // 避ける表現は「どの家庭にも使わない言葉」で、生成時もPSI未評価の回まで含めて全部を
    // 渡している(packages/core/src/domain/reports/promptAssembly.ts の selectPhrases)。
    // 範囲を狭めた行を作れてしまうと、画面の見た目(範囲の入力欄が無い)と実際の扱いが
    // 食い違い、「1〜3に絞ったのに全部の日報で禁止されている」という読み違いを生む。
    if (
      value.kind === 'avoid' &&
      (value.stressLevelMin !== REPORT_LEVEL_MIN || value.stressLevelMax !== REPORT_LEVEL_MAX)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['stressLevelMin'],
        message: `避ける表現は全ての日報に効くため、ストレス度の範囲は${REPORT_LEVEL_MIN}〜${REPORT_LEVEL_MAX}にしてください。`,
      });
    }
  });
export type PhraseInput = z.infer<typeof phraseInputSchema>;
export type PhraseView = PhraseInput;

/** `PUT /phrases`(全件入れ替え)の本文。 */
export const phrasesReplaceRequestSchema = z.object({ phrases: z.array(phraseInputSchema) });
export type PhrasesReplaceRequest = z.infer<typeof phrasesReplaceRequestSchema>;

// ---------------------------------------------------------------------------
// 家庭ごとの設定(customer_report_profiles)
// ---------------------------------------------------------------------------

/**
 * 顧客詳細の★設定。管理者に限定せず担当者も付けられる(設計書「管理者・担当者が付ける」)。
 * `educationLevel: null` は未設定で、生成時は既定(★2相当)として扱う。
 */
export const customerReportProfileInputSchema = z.object({
  educationLevel: reportLevelSchema.nullable(),
  /** ★を付けた根拠・家庭の意向のメモ。 */
  note: z.string().trim().max(2000, 'メモが長すぎます').default(''),
});
export type CustomerReportProfileInput = z.infer<typeof customerReportProfileInputSchema>;

/** `GET /api/customers/:id` と `PUT /api/customers/:id/report-profile` が返す形。 */
export interface CustomerReportProfileView {
  educationLevel: number | null;
  note: string;
}

// ---------------------------------------------------------------------------
// 一覧(GET /api/settings/admin/report-ai)と、スタッフ向けのレベル一覧
// ---------------------------------------------------------------------------

/** 管理画面が1度に読む設定一式。 */
export interface ReportAiAdminConfigView {
  ageBands: AgeBandView[];
  keywords: KeywordView[];
  educationLevels: EducationLevelView[];
  stressLevels: StressLevelView[];
  phrases: PhraseView[];
}

/**
 * 一般スタッフ向け(`GET /api/reports/ai-config`)。顧客詳細の★設定と、日報入力画面の
 * ストレス度の判定基準表示に使う。テナントが行を作っていないレベルは含まない。
 */
export interface ReportAiLevelChoicesView {
  educationLevels: { level: number; label: string; description: string }[];
  stressLevels: { level: number; label: string; criteria: string }[];
}

// ---------------------------------------------------------------------------
// 取込(xlsx から作った payload)
// ---------------------------------------------------------------------------

/**
 * 取込の本文。全項目が任意で、渡されたシートぶんだけ反映する。
 *
 * 【入れ替えではなくマージにする理由】
 * 法人の資料は「今回追加・修正した行だけ」を載せた表であることが多く、全件入れ替えにすると
 * 表に載っていない行(過去に画面から足した語など)が黙って消える。code / level で upsert し、
 * 表現(phrases)は kind+body が同じ行を更新して無ければ足す。廃止は `active=false` で行う。
 */
export const reportAiImportPayloadSchema = z.object({
  ageBands: z.array(ageBandInputSchema).default([]),
  keywords: z.array(keywordInputSchema).default([]),
  educationLevels: z.array(educationLevelInputSchema).default([]),
  stressLevels: z.array(stressLevelInputSchema).default([]),
  phrases: z.array(phraseInputSchema).default([]),
  promptTemplates: z
    .array(
      z.object({
        key: promptTemplateKeySchema,
        body: z.string().trim().min(1, '文面を入力してください').max(PROMPT_TEMPLATE_BODY_MAX_LENGTH),
      }),
    )
    .default([]),
});
export type ReportAiImportPayload = z.infer<typeof reportAiImportPayloadSchema>;

/** 取込の結果。種類ごとに「反映した行数」を返す(画面で取込結果を読めるようにするため)。 */
export interface ReportAiImportResult {
  ageBands: number;
  keywords: number;
  educationLevels: number;
  stressLevels: number;
  phrases: number;
  promptTemplates: number;
}
