import {
  type PromptPlaceholder,
  REPORT_LEVEL_MAX,
  REPORT_LEVEL_MIN,
  type ReportPhraseKind,
  type ReportPhrasePlacement,
} from '@katahimo/shared';

/**
 * 保育日報の生成プロンプトを、テナントの設定(文面・年齢帯・キーワード表・判定基準)と
 * 家庭・訪問ごとの値(子の月齢・教育関心度★・ストレス度)から組み立てる純関数群。
 *
 * DBの表(packages/db/src/schema/reportAi.ts)と1:1の入力型を受け取り、文字列を返すだけ。
 * 外部I/Oを持たないので、「この家庭・この訪問でどの語が候補になるか」をテストで固定できる。
 * 設計の背景は doc/db/new-domains.md 第6章。
 *
 * 【3軸の適用順】
 *   1. 子の月齢 → 年齢帯(行動語)を決める
 *   2. ストレス度 → 教育関心度★を引き下げる/教育語を止める/管理者連絡を要するかを決める
 *   3. 月齢・引き下げ後の★・ストレス度の3条件を全部満たす語だけを候補にする
 *   4. 候補が空(教育語オフ)なら温かみ表現に切り替える
 * 絞り込みはここで済ませ、AIにはキーワード表を丸ごと渡さない。
 */

// ---------------------------------------------------------------------------
// 入力型(DBの行と同じ形。IDはUUID文字列)
// ---------------------------------------------------------------------------

export interface ReportAgeBand {
  id: string;
  code: string;
  label: string;
  /** 月齢の下限(含む)。 */
  ageFromMonths: number;
  /** 月齢の上限(含まない)。 */
  ageToMonths: number;
  behaviorWords: string;
  developmentTopics: string;
  sceneExamples: string;
  sortOrder: number;
}

export interface ReportKeyword {
  id: string;
  code: string;
  category: string;
  name: string;
  subConcept: string;
  ageFromMonths: number;
  ageToMonths: number;
  educationLevelMin: number;
  educationLevelMax: number;
  stressLevelMin: number;
  tone: string;
  parentExplanation: string;
  phraseExamples: string;
  usageScene: string;
  ngExample: string;
  sortOrder: number;
  active: boolean;
}

export interface ReportEducationLevel {
  level: number;
  label: string;
  description: string;
  promptInstruction: string;
  maxKeywords: number;
  allowTermNames: boolean;
}

export interface ReportStressLevel {
  level: number;
  label: string;
  criteria: string;
  promptInstruction: string;
  /** 0(下げない)〜-4。 */
  educationLevelShift: number;
  keywordsEnabled: boolean;
  escalationRequired: boolean;
}

export interface ReportPhrase {
  id: string;
  kind: ReportPhraseKind;
  body: string;
  intent: string;
  stressLevelMin: number;
  stressLevelMax: number;
  placement: ReportPhrasePlacement;
  sortOrder: number;
  active: boolean;
}

// ---------------------------------------------------------------------------
// 既定値
// ---------------------------------------------------------------------------

/**
 * 教育関心度★が未設定の家庭に適用する値。「標準(平易な自然語を1つまで)」に当たる。
 * 未設定を★1(教育語なし)にしないのは、大半の家庭が標準に当たる想定で、設定を付けて
 * いない家庭の日報が急に素っ気なくならないようにするため。
 */
export const DEFAULT_EDUCATION_LEVEL = 2;

/**
 * ストレス度が未評価の訪問に適用する値。「通常(★どおりに使う)」に当たる。
 * 未評価を「危険」側に寄せないのは、評価の手間を省いた訪問すべてが教育語オフに
 * なると、設定した★の意味が無くなるため。危険側はスタッフが評価して初めて効く。
 */
export const DEFAULT_STRESS_LEVEL = 4;

/** プロンプトに提示するキーワード候補の上限。多すぎるとAIが詰め込むため、少数に絞る。 */
export const DEFAULT_MAX_KEYWORD_CANDIDATES = 6;

// ---------------------------------------------------------------------------
// 月齢と年齢帯
// ---------------------------------------------------------------------------

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDateOnly(value: string): { y: number; m: number; d: number } | null {
  const match = DATE_ONLY_RE.exec(value);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { y, m, d };
}

/**
 * 生年月日(YYYY-MM-DD)と基準日(YYYY-MM-DD)から満月齢を求める。
 * 基準日の「日」が生まれた日に達していなければ、その月はまだ数えない
 * (2026-01-15生まれは 2026-03-14 で1ヶ月、2026-03-15 で2ヶ月)。
 * 形式が不正・基準日が生年月日より前なら null。
 */
export function ageInMonths(dobDate: string, onDate: string): number | null {
  const dob = parseDateOnly(dobDate);
  const on = parseDateOnly(onDate);
  if (!dob || !on) return null;
  let months = (on.y - dob.y) * 12 + (on.m - dob.m);
  if (on.d < dob.d) months -= 1;
  return months < 0 ? null : months;
}

/** 月齢が [ageFromMonths, ageToMonths) に入る年齢帯。複数当たる設定ミスの場合は sortOrder が先のもの。 */
export function findAgeBand(bands: readonly ReportAgeBand[], months: number): ReportAgeBand | null {
  const hit = [...bands]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.ageFromMonths - b.ageFromMonths)
    .find((band) => months >= band.ageFromMonths && months < band.ageToMonths);
  return hit ?? null;
}

// ---------------------------------------------------------------------------
// ストレス度の適用
// ---------------------------------------------------------------------------

export interface StressAdjustment {
  /** 引き下げ後に実際に使う教育関心度★。 */
  effectiveEducationLevel: number;
  /** 教育キーワードを候補に入れてよいか。 */
  keywordsEnabled: boolean;
  /** 管理者への連絡を要するか。 */
  escalationRequired: boolean;
}

function clampLevel(level: number): number {
  return Math.min(REPORT_LEVEL_MAX, Math.max(REPORT_LEVEL_MIN, level));
}

/**
 * ストレス度の定義(report_stress_levels の1行)を教育関心度★に適用する。
 * 定義が無い(そのレベルの行をテナントが作っていない)ときは何も変えない。
 */
export function applyStressLevel(
  educationLevel: number | null,
  stressRule: ReportStressLevel | null,
): StressAdjustment {
  const base = clampLevel(educationLevel ?? DEFAULT_EDUCATION_LEVEL);
  if (!stressRule) {
    return { effectiveEducationLevel: base, keywordsEnabled: true, escalationRequired: false };
  }
  return {
    effectiveEducationLevel: clampLevel(base + stressRule.educationLevelShift),
    keywordsEnabled: stressRule.keywordsEnabled,
    escalationRequired: stressRule.escalationRequired,
  };
}

// ---------------------------------------------------------------------------
// キーワードの絞り込み
// ---------------------------------------------------------------------------

export interface SelectKeywordsInput {
  keywords: readonly ReportKeyword[];
  /** 子の月齢。不明(null)なら月齢条件は見ない(全月齢の語だけが残るわけではなく、月齢で落とさない)。 */
  childAgeMonths: number | null;
  effectiveEducationLevel: number;
  stressLevel: number;
  /** 年齢帯の「相性の良い語」のID。候補の並びで先頭に寄せる。 */
  affinityKeywordIds?: readonly string[];
  maxCandidates?: number;
}

/**
 * 使用可否 = 有効な語 かつ 月齢が範囲内 かつ ★が範囲内 かつ ストレス度が下限以上。
 * 3条件のどれか1つでも外れる語は候補にしない(資料の「1つでも×なら使わない」)。
 * 並びは 相性の良い語 → sortOrder → code。
 */
export function selectKeywords(input: SelectKeywordsInput): ReportKeyword[] {
  const affinity = new Set(input.affinityKeywordIds ?? []);
  const limit = input.maxCandidates ?? DEFAULT_MAX_KEYWORD_CANDIDATES;
  return input.keywords
    .filter((k) => k.active)
    .filter(
      (k) =>
        input.childAgeMonths === null ||
        (input.childAgeMonths >= k.ageFromMonths && input.childAgeMonths < k.ageToMonths),
    )
    .filter(
      (k) =>
        input.effectiveEducationLevel >= k.educationLevelMin &&
        input.effectiveEducationLevel <= k.educationLevelMax,
    )
    .filter((k) => input.stressLevel >= k.stressLevelMin)
    .sort((a, b) => {
      const affinityDiff = Number(affinity.has(b.id)) - Number(affinity.has(a.id));
      if (affinityDiff !== 0) return affinityDiff;
      return a.sortOrder - b.sortOrder || a.code.localeCompare(b.code);
    })
    .slice(0, limit);
}

/** ストレス度に合う有効な表現を種類別に取り出す。並びは sortOrder → body。 */
export function selectPhrases(
  phrases: readonly ReportPhrase[],
  kind: ReportPhraseKind,
  stressLevel: number,
): ReportPhrase[] {
  return phrases
    .filter((p) => p.active && p.kind === kind)
    .filter((p) => stressLevel >= p.stressLevelMin && stressLevel <= p.stressLevelMax)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.body.localeCompare(b.body));
}

// ---------------------------------------------------------------------------
// 差し込み文の組み立て
// ---------------------------------------------------------------------------

/** 対象児の月齢・年齢帯と行動語。子が選ばれていなければその旨。 */
export function buildChildContext(childAgeMonths: number | null, band: ReportAgeBand | null): string {
  if (childAgeMonths === null) {
    return '対象児の月齢: 不明(メモ本文から推定してよいが、断定はしない)';
  }
  const years = Math.floor(childAgeMonths / 12);
  const rest = childAgeMonths % 12;
  const ageText = years === 0 ? `${childAgeMonths}ヶ月` : rest === 0 ? `${years}歳` : `${years}歳${rest}ヶ月`;
  const lines = [`対象児の月齢: ${ageText}(${childAgeMonths}ヶ月)`];
  if (band) {
    lines.push(`年齢帯: ${band.label}`);
    if (band.behaviorWords) lines.push(`この時期によく描写する行動・言葉: ${band.behaviorWords}`);
    if (band.developmentTopics) lines.push(`発達の主なトピック: ${band.developmentTopics}`);
  }
  return lines.join('\n');
}

export interface KeywordGuideInput {
  candidates: readonly ReportKeyword[];
  educationRule: ReportEducationLevel | null;
  stressRule: ReportStressLevel | null;
  adjustment: StressAdjustment;
  /** 教育語を使わないときに代わりに提示する温かみ表現(selectPhrases の encourage)。 */
  encouragePhrases: readonly ReportPhrase[];
}

/**
 * 教育キーワードの候補と使い方。候補が空(教育語オフ、または条件に合う語が無い)のときは
 * 教育語を使わない指示と温かみ表現の候補を出す。
 */
export function buildKeywordGuide(input: KeywordGuideInput): string {
  const lines: string[] = [];
  const { adjustment, educationRule, stressRule } = input;

  if (stressRule?.promptInstruction) lines.push(stressRule.promptInstruction);
  if (adjustment.escalationRequired) {
    lines.push(
      '保護者・お子様の安全に懸念がある状態です。文面より安全対応を優先し、"warnings" に「管理者へ連絡」を必ず含めてください。',
    );
  }

  const useKeywords =
    adjustment.keywordsEnabled && input.candidates.length > 0 && (educationRule?.maxKeywords ?? 1) > 0;
  if (!useKeywords) {
    lines.push('この日報では教育キーワード(専門用語・発達の意味づけ)を使わないでください。');
    if (input.encouragePhrases.length > 0) {
      lines.push('代わりに、次のような保護者をねぎらう・寄り添う表現から1つ選んで自然に添えてください:');
      for (const p of input.encouragePhrases) {
        lines.push(`- ${p.body}${p.placement === 'closing' ? '(締めに)' : ''}`);
      }
    }
    return lines.join('\n');
  }

  const max = educationRule?.maxKeywords ?? 1;
  lines.push(
    `保護者向けレポートの本文に、次の候補から教育キーワードを${max === 1 ? '1つだけ' : `最大${max}つまで`}、実際にメモにある出来事に結び付けて自然に織り込んでください。メモに無い出来事は創作しないでください。`,
  );
  if (educationRule?.promptInstruction) lines.push(educationRule.promptInstruction);
  lines.push(
    educationRule?.allowTermNames
      ? '用語名を出すときは、必ず「親向け説明」のやさしい言い換えをセットで添えてください。'
      : '用語名はそのまま出さず、「親向け説明」の言い換えだけを使ってください。',
  );
  lines.push('織り込み方は〔観察した具体的な出来事〕→〔やさしい説明〕→〔温かい所感〕の順にしてください。');
  lines.push('使った候補は "usedKeywords" にコードで列挙してください(使わなければ空配列)。');
  lines.push('');
  lines.push('【候補】');
  for (const k of input.candidates) {
    lines.push(`- ${k.code} ${k.name}${k.subConcept ? `(${k.subConcept})` : ''}`);
    if (k.parentExplanation) lines.push(`  親向け説明: ${k.parentExplanation}`);
    if (k.usageScene) lines.push(`  使いどころ: ${k.usageScene}`);
    if (k.phraseExamples)
      lines.push(`  言い回しの例: ${k.phraseExamples.split('\n').filter(Boolean).join(' / ')}`);
    if (k.ngExample) lines.push(`  避ける言い方: ${k.ngExample}`);
  }
  return lines.join('\n');
}

/** 文体ルール(daily_report_stance の文面)と、全日報で避ける表現の列挙。 */
export function buildToneGuide(stanceText: string, avoidPhrases: readonly ReportPhrase[]): string {
  const lines: string[] = [];
  if (stanceText.trim()) lines.push(stanceText.trim());
  if (avoidPhrases.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push('【使ってはいけない表現(全レポート共通)】');
    for (const p of avoidPhrases) {
      lines.push(`- ${p.body}${p.intent ? `(${p.intent})` : ''}`);
    }
  }
  return lines.join('\n');
}

/**
 * テンプレート中の `{name}` を値で置き換える。同じ名前が複数あれば全部置き換える
 * (GAS版 String.replace は最初の1箇所だけだったが、文面を自由に書けるようにするため全箇所)。
 * 未知の `{...}` はそのまま残す(JSON出力例の波括弧を壊さないため)。
 */
export function renderPromptTemplate(template: string, values: Record<PromptPlaceholder, string>): string {
  let out = template;
  for (const [name, value] of Object.entries(values)) {
    out = out.split(`{${name}}`).join(value);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

export interface AssembleDailyReportPromptInput {
  /** daily_report の文面(テナント版または既定)。 */
  template: string;
  /** daily_report_stance の文面(テナント版または既定。無ければ空文字)。 */
  stanceTemplate: string;
  anonymizedText: string;
  timeInfo: string;
  /** 対象児の月齢。子が選ばれていない・生年月日不明は null。 */
  childAgeMonths: number | null;
  /** 家庭の教育関心度★(customer_report_profiles)。未設定は null。 */
  educationLevel: number | null;
  /** スタッフが評価したストレス度(daily_reports.risk_rating)。未評価は null。 */
  stressLevel: number | null;
  ageBands: readonly ReportAgeBand[];
  /** 年齢帯 → 相性の良いキーワードID(report_age_band_keywords)。 */
  ageBandKeywordIds?: Readonly<Record<string, readonly string[]>>;
  keywords: readonly ReportKeyword[];
  educationLevels: readonly ReportEducationLevel[];
  stressLevels: readonly ReportStressLevel[];
  phrases: readonly ReportPhrase[];
  maxCandidates?: number;
}

export interface AssembledDailyReportPrompt {
  prompt: string;
  /** プロンプトに提示した候補(report_ai_generation_keywords の candidate として記録する)。 */
  candidates: ReportKeyword[];
  ageBand: ReportAgeBand | null;
  effectiveEducationLevel: number;
  /** 実際に適用したストレス度(未評価なら既定値)。 */
  appliedStressLevel: number;
  escalationRequired: boolean;
}

/** 3軸を適用して日報生成プロンプトを組み立てる。 */
export function assembleDailyReportPrompt(input: AssembleDailyReportPromptInput): AssembledDailyReportPrompt {
  const stressLevel = clampLevel(input.stressLevel ?? DEFAULT_STRESS_LEVEL);
  const stressRule = input.stressLevels.find((s) => s.level === stressLevel) ?? null;
  const adjustment = applyStressLevel(input.educationLevel, stressRule);
  const educationRule =
    input.educationLevels.find((e) => e.level === adjustment.effectiveEducationLevel) ?? null;

  const ageBand = input.childAgeMonths === null ? null : findAgeBand(input.ageBands, input.childAgeMonths);
  const affinityKeywordIds = ageBand ? (input.ageBandKeywordIds?.[ageBand.id] ?? []) : [];

  const candidates = adjustment.keywordsEnabled
    ? selectKeywords({
        keywords: input.keywords,
        childAgeMonths: input.childAgeMonths,
        effectiveEducationLevel: adjustment.effectiveEducationLevel,
        stressLevel,
        affinityKeywordIds,
        maxCandidates: input.maxCandidates,
      })
    : [];

  const prompt = renderPromptTemplate(input.template, {
    anonymizedText: input.anonymizedText,
    timeInfo: input.timeInfo,
    childContext: buildChildContext(input.childAgeMonths, ageBand),
    keywordGuide: buildKeywordGuide({
      candidates,
      educationRule,
      stressRule,
      adjustment,
      encouragePhrases: selectPhrases(input.phrases, 'encourage', stressLevel),
    }),
    toneGuide: buildToneGuide(input.stanceTemplate, selectPhrases(input.phrases, 'avoid', stressLevel)),
  });

  return {
    prompt,
    candidates,
    ageBand,
    effectiveEducationLevel: adjustment.effectiveEducationLevel,
    appliedStressLevel: stressLevel,
    escalationRequired: adjustment.escalationRequired,
  };
}
