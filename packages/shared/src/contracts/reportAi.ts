import { z } from 'zod';

/**
 * 日報AI(プロンプト調整)の区分値と値域。
 *
 * GAS版は「ＡＩプロンプト」シートでプロンプト文面を管理者が上書きできた。本アプリではその
 * 置き場所をDB(`prompt_templates` ほか)に移し、さらに保護者向け文面を
 * 「子の年齢帯 × 家庭の教育関心度 × 保護者のストレス度」の3軸で組み替えられるようにする。
 * 3軸の意味と、なぜこの形にしたかは doc/db/new-domains.md 第6章。
 *
 * ここに置くのは DB の CHECK 制約・core の組み立てロジック・web の入力欄が同じ許可値を
 * 参照するためのもの(customerNotes.ts と同じ狙い)。
 */

/**
 * プロンプトテンプレートのキー。GAS版 GeminiReport.js の PROMPT_KEYS に、GAS版ではコードに
 * ベタ書きだった領収書OCR(receipt_ocr)と、保護者向け文面の文体ルール(daily_report_stance)を足したもの。
 *
 * - 'daily_report'               : 保育日報の生成本体。差し込み位置は PROMPT_PLACEHOLDERS 参照
 * - 'daily_report_stance'        : 保護者向け文面の文体ルール(評価・上から目線を避ける等)。
 *                                  daily_report の {toneGuide} に差し込まれる
 * - 'accident_report'            : 事故報告/ヒヤリハットの生成
 * - 'receipt_ocr'                : 領収書画像からの金額・店名・日時の読み取り
 * - 'daily_memo_placeholder'     : 日報メモ入力欄のプレースホルダー(UI文言)
 * - 'accident_memo_placeholder'  : 事故報告メモ入力欄のプレースホルダー(UI文言)
 * - 'accident_hint'              : 事故報告の記載要領(UI文言)
 * - 'hiyari_hint'                : ヒヤリハットの記載要領(UI文言)
 */
export const promptTemplateKeySchema = z.enum([
  'daily_report',
  'daily_report_stance',
  'accident_report',
  'receipt_ocr',
  'daily_memo_placeholder',
  'accident_memo_placeholder',
  'accident_hint',
  'hiyari_hint',
]);
export const PROMPT_TEMPLATE_KEYS = promptTemplateKeySchema.options;
export type PromptTemplateKey = z.infer<typeof promptTemplateKeySchema>;

/** 画面表示用の日本語名。DBには入れない。 */
export const PROMPT_TEMPLATE_KEY_LABELS: Record<PromptTemplateKey, string> = {
  daily_report: '保育日報の生成',
  daily_report_stance: '保護者向け文面の文体ルール',
  accident_report: '事故報告の生成',
  receipt_ocr: '領収書の読み取り',
  daily_memo_placeholder: '日報メモ欄の入力例',
  accident_memo_placeholder: '事故報告メモ欄の入力例',
  accident_hint: '事故報告の記載要領',
  hiyari_hint: 'ヒヤリハットの記載要領',
};

/**
 * 日報生成テンプレート(daily_report)に差し込む変数。テンプレート本文にこの名前を `{...}` で書く。
 * GAS版から引き継いだ {anonymizedText}/{timeInfo} に、3軸の組み立て結果を足している。
 *
 * - anonymizedText : スタッフが入力したメモ(口語)
 * - timeInfo       : 保育時間("10:00〜13:00" など)
 * - childContext   : 対象児の月齢・年齢帯と、その年齢帯でよく描く行動語(report_age_bands 由来)
 * - keywordGuide   : 3軸で絞り込んだ教育キーワードの候補と使い方(report_keywords / 各レベル定義 由来)。
 *                    ストレス度が高い家庭では候補が空になり、代わりに温かみ表現(report_phrases)が入る
 * - toneGuide      : 文体ルール(daily_report_stance)と、全日報で避ける表現(report_phrases の avoid)
 */
export const PROMPT_PLACEHOLDERS = [
  'anonymizedText',
  'timeInfo',
  'childContext',
  'keywordGuide',
  'toneGuide',
] as const;
export type PromptPlaceholder = (typeof PROMPT_PLACEHOLDERS)[number];

/**
 * プロンプト文面1本の長さの上限(文字数。`prompt_templates.body`)。
 * 文面はそのままAIへ送るため、上限が無いと誤操作で貼り付けた巨大なテキストが
 * 毎回の生成でトークンを浪費する。GAS版の運用文面は数千字なので、余裕を見て2万字。
 */
export const PROMPT_TEMPLATE_BODY_MAX_LENGTH = 20000;

/**
 * 家庭の教育関心度(★)と保護者のストレス度(PSI)の値域。どちらも1〜5。
 *
 * ストレス度は `daily_reports.risk_rating`(GAS版から引き継いだPSI評価。1〜5)と同じ尺度で、
 * 数値が低いほど負担が大きい(1=危険・緊急、5=安心・良好)。教育関心度は数値が高いほど
 * 教育語への関心が高い。向きが逆なので、コードでは名前で区別し数値の大小を直接比べない。
 */
export const REPORT_LEVEL_MIN = 1;
export const REPORT_LEVEL_MAX = 5;
export const reportLevelSchema = z.number().int().min(REPORT_LEVEL_MIN).max(REPORT_LEVEL_MAX);

/**
 * ストレス度の判定に応じて教育関心度を何段下げるか(`report_stress_levels.education_level_shift`)の下限。
 * 0(下げない)〜 -(REPORT_LEVEL_MAX-1)(必ず★1相当まで下げる)。正の値(上げる)は許さない。
 * 保護者の負担が大きいときに文面を「より控えめ」にする方向しか意味を持たないため。
 */
export const EDUCATION_LEVEL_SHIFT_MIN = -(REPORT_LEVEL_MAX - REPORT_LEVEL_MIN);

/**
 * 1通の日報に織り込む教育キーワード数の上限(`report_education_levels.max_keywords`)の値域。
 * 資料上の運用は最大2。3語以上は営業臭が出て逆効果とされるため、DBでも小さな上限で縛る。
 */
export const MAX_KEYWORDS_PER_REPORT_LIMIT = 3;

/**
 * 月齢の上限(`report_age_bands` / `report_keywords` の age_to_months)。
 * ベビーシッターの対象は概ね小学校低学年まで。12歳=144ヶ月を超える値は入力ミスとみなす。
 */
export const AGE_MONTHS_MAX = 144;

/**
 * 温かみ表現・避ける表現(`report_phrases.kind`)の区分。
 *
 * - 'encourage' : 保護者をねぎらう・寄り添う表現。ストレス度が高い家庭では教育語の代わりに使う
 * - 'avoid'     : 全日報で使わない表現(提案・比較・催促・評価口調など)。ストレス度に関わらず適用
 */
export const reportPhraseKindSchema = z.enum(['encourage', 'avoid']);
export const REPORT_PHRASE_KINDS = reportPhraseKindSchema.options;
export type ReportPhraseKind = z.infer<typeof reportPhraseKindSchema>;

/**
 * 温かみ表現をどこに置くか(`report_phrases.placement`)。
 * - 'any'     : 本文のどこでも
 * - 'closing' : 締めの一文として
 */
export const reportPhrasePlacementSchema = z.enum(['any', 'closing']);
export const REPORT_PHRASE_PLACEMENTS = reportPhrasePlacementSchema.options;
export type ReportPhrasePlacement = z.infer<typeof reportPhrasePlacementSchema>;

/**
 * AI生成の記録(`report_ai_generation_keywords.role`)における、キーワードの関わり方。
 * - 'candidate' : 3軸で絞り込んでプロンプトに提示した候補
 * - 'used'      : AIが「実際に本文へ織り込んだ」と回答したもの
 *
 * 両方を残すのは、「提示したのに使われない語」「提示していないのに使われた語(=創作)」を
 * 後から数え、キーワード表や文面の調整に使うため。
 */
export const generationKeywordRoleSchema = z.enum(['candidate', 'used']);
export const GENERATION_KEYWORD_ROLES = generationKeywordRoleSchema.options;
export type GenerationKeywordRole = z.infer<typeof generationKeywordRoleSchema>;
