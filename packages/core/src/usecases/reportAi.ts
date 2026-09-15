import { ageInMonths, assembleDailyReportPrompt, formatJstDateKey, renderPromptTemplate } from '../domain';
import type {
  AccidentReportDraft,
  AccidentReportDraftError,
  ReceiptOcrResult,
  ReportAiPort,
  ReportAiPortFactory,
} from '../ports/ai';
import type { CryptoPort } from '../ports/crypto';
import type {
  CustomerReportProfileRepositoryPort,
  ReportAiConfigRepositoryPort,
  ReportAiGenerationRepositoryPort,
} from '../ports/reportAiRepositories';
import type {
  AppSettingsRepositoryPort,
  FamilyMemberRepositoryPort,
  PromptTemplateRepositoryPort,
} from '../ports/repositories';
import { UsecaseValidationError } from './errors';
import { resolvePromptTemplate } from './promptTemplates';

export interface ReportAiDeps {
  /** テナントが独自のGemini APIキーを設定していない場合に使うフォールバック(.env設定 or Noop)。 */
  reportAi: ReportAiPort;
  appSettings: AppSettingsRepositoryPort;
  crypto: CryptoPort;
  reportAiFactory: ReportAiPortFactory;
  /** 生成に使う文面(テナントが編集した版、無ければ既定文面)の取得元。 */
  promptTemplates: PromptTemplateRepositoryPort;
  /** 3軸(年齢帯・キーワード・判定基準・表現)の設定一式。 */
  reportAiConfig: ReportAiConfigRepositoryPort;
  /** 家庭ごとの教育関心度★。 */
  customerReportProfiles: CustomerReportProfileRepositoryPort;
  /** 生成1回の記録。 */
  reportAiGenerations: ReportAiGenerationRepositoryPort;
  /** 対象児の生年月日から月齢を出すため。 */
  familyMembers: FamilyMemberRepositoryPort;
}

/**
 * 事故報告・領収書OCRは3軸を使わない(GAS版と同じく、メモと時間情報だけを差し込む)ので、
 * 3軸の差し込みは空文字にする。文面に {childContext} 等が書かれていても、何も入らないだけで
 * 生成は通る。
 */
function renderWithoutProfileAxes(template: string, anonymizedText: string, timeInfo: string): string {
  return renderPromptTemplate(template, {
    anonymizedText,
    timeInfo,
    childContext: '',
    keywordGuide: '',
    toneGuide: '',
  });
}

/**
 * テナントの管理者設定(app_settings)にGemini APIキーが保存されていればそれを使い、
 * 無ければ.env設定(deps.reportAi、未設定ならNoop)にフォールバックする。
 * GAS版がScript Properties一本を全ユーザーで共有していたのに対し、マルチテナントSaaSでは
 * テナントごとに異なるキー/モデルを持てる必要があるため、呼び出しのたびに解決する。
 */
async function resolveReportAiPort(deps: ReportAiDeps, tenantId: string): Promise<ReportAiPort> {
  const settings = await deps.appSettings.find(tenantId);
  if (!settings?.geminiApiKey) return deps.reportAi;
  const apiKey = await deps.crypto.decrypt(tenantId, settings.geminiApiKey);
  return deps.reportAiFactory.create({
    apiKey,
    reportModel: settings.geminiReportModel ?? undefined,
    ocrModel: settings.geminiOcrModel ?? undefined,
  });
}

export interface GenerateDailyReportDraftInput {
  /** スタッフが入力したメモ(口語)。 */
  text: string;
  /** 'HH:mm'。両方揃ったときだけ時間情報になる(GAS版と同じ)。 */
  start?: string;
  end?: string;
  customerId: string;
  /** 対象児(世帯構成員)。未選択(世帯全体)は null/省略。 */
  familyMemberId?: string | null;
  /** スタッフが付けたストレス度(PSI)。未評価は null/省略。 */
  stressLevel?: number | null;
  /** 'YYYY-MM-DD'。対象児の月齢を数える基準日。省略時はJSTの今日。 */
  reportDate?: string;
  /** 生成を行ったスタッフ(記録に残す)。APIルートがセッションから解決した値。 */
  staffId: string;
}

/**
 * 生成1回の結果。GAS版 generateReportWithWarnings の warnings/internal/customer に、
 * 3軸を通したことで分かる値(使った語・記録のID・管理者連絡の要否・月齢・適用した★)を足したもの。
 */
export interface DailyReportDraftResult {
  warnings: string[];
  internal: string;
  customer: string;
  /** AIが「使った」と答えた教育キーワードのコード(表に無い語も含む。記録では落とす)。 */
  usedKeywords: string[];
  /** report_ai_generations の行ID。記録に失敗した場合は null(生成結果自体は返す)。 */
  generationId: string | null;
  escalationRequired: boolean;
  childAgeMonths: number | null;
  /** 引き下げ後に実際に適用した教育関心度★。ストレス度が未評価で教育語を使わなかった回は null。 */
  effectiveEducationLevel: number | null;
}

/** 管理者連絡が要るときに、AIの応答に関わらず画面へ必ず出す警告。 */
const ESCALATION_WARNING = '管理者へ連絡してください(ストレス度の判定基準により)';

/**
 * 保育日報のメモ(口語)からAI下書きを生成し、生成1回を記録する。
 * GAS版GeminiReport.js generateReportWithWarningsに対応。APIキー未設定時・API呼び出し失敗時も
 * 例外にはせず、warnings/internalにその旨を詰めた同じ形のオブジェクトを返す(GAS版と同じ)。
 *
 * 【対象児が別の顧客の子だったときだけ例外にする理由】
 * 生成の失敗(APIの不調)は画面で「もう一度」を促せばよいが、他の家庭の子の月齢で
 * 日報を書くのは黙って通してはいけない取り違えなので、生成する前に止める。
 */
export async function generateDailyReportDraft(
  deps: ReportAiDeps,
  tenantId: string,
  input: GenerateDailyReportDraftInput,
): Promise<DailyReportDraftResult> {
  const [reportAi, template, stance, config, profile, familyMembers] = await Promise.all([
    resolveReportAiPort(deps, tenantId),
    resolvePromptTemplate(deps, tenantId, 'daily_report'),
    resolvePromptTemplate(deps, tenantId, 'daily_report_stance'),
    deps.reportAiConfig.loadAll(tenantId),
    deps.customerReportProfiles.find(tenantId, input.customerId),
    input.familyMemberId
      ? deps.familyMembers.listByCustomerId(tenantId, input.customerId)
      : Promise.resolve([]),
  ]);

  const targetFamilyMemberId = input.familyMemberId || null;
  const targetMember = targetFamilyMemberId
    ? (familyMembers.find((m) => m.id === targetFamilyMemberId) ?? null)
    : null;
  if (targetFamilyMemberId && !targetMember) {
    throw new UsecaseValidationError('対象児が見つかりません');
  }

  // 月齢は「訪問日時点」で数える。保存済みの日報を編集して作り直す場合に、今日の日付で
  // 数えると当時と違う年齢帯になってしまう。
  const onDate = input.reportDate ?? formatJstDateKey(new Date());
  const childAgeMonths = targetMember?.dobDate ? ageInMonths(targetMember.dobDate, onDate) : null;

  // GAS版 generateReportWithWarnings と同じ時間情報の作り方。
  const timeInfo = input.start && input.end ? `${input.start}〜${input.end}` : '時間指定なし';
  const stressLevel = input.stressLevel ?? null;

  const assembled = assembleDailyReportPrompt({
    template: template.body,
    stanceTemplate: stance.body,
    anonymizedText: input.text,
    timeInfo,
    childAgeMonths,
    educationLevel: profile?.educationLevel ?? null,
    stressLevel,
    ageBands: config.ageBands,
    ageBandKeywordIds: config.ageBandKeywordIds,
    keywords: config.keywords,
    educationLevels: config.educationLevels,
    stressLevels: config.stressLevels,
    phrases: config.phrases,
  });

  const draft = await reportAi.generateDailyReport({
    prompt: assembled.prompt,
    text: input.text,
    start: input.start,
    end: input.end,
    keywordCodes: assembled.candidates.map((k) => k.code),
  });

  const usedKeywords = draft.usedKeywords ?? [];
  const warnings = [...draft.warnings];
  // プロンプトでもAIに指示しているが、AIが落としてもスタッフの画面には必ず出す。
  if (assembled.escalationRequired && !warnings.some((w) => w.includes('管理者へ連絡'))) {
    warnings.push(ESCALATION_WARNING);
  }

  // 成功か失敗かは `error` の有無1つで決める。DBの report_ai_generations_outcome_check が
  // 「outputJson と errorMessage のちょうど一方だけ非NULL」を強制するので、空文字の error で
  // 両方入りの行を作らないよう、ここで null に寄せてから振り分ける。
  const errorMessage = draft.error || null;

  const generationId = await recordGeneration(deps, tenantId, {
    staffId: input.staffId,
    customerId: input.customerId,
    targetFamilyMemberId,
    promptTemplateId: template.templateId,
    promptText: assembled.prompt,
    model: reportAi.reportModel,
    childAgeMonths,
    educationLevel: profile?.educationLevel ?? null,
    // 教育語を使わなかった回(PSI未評価)は null。
    effectiveEducationLevel: assembled.effectiveEducationLevel,
    // 実際に適用した値(1〜5に収めたもの)を残す。未評価は null。
    stressLevel: assembled.appliedStressLevel,
    escalationRequired: assembled.escalationRequired,
    inputText: input.text,
    timeInfo,
    outputJson: errorMessage ? null : draft,
    errorMessage,
    candidateKeywordIds: assembled.candidates.map((k) => k.id),
    // AIが表に無いコード(創作した語)を返すことがある。記録は語の行を参照するので
    // 解決できないコードは落とすが、draft.usedKeywords はそのまま画面に返す
    // (「AIが何と答えたか」を消さないため)。active=false の廃止済みの語も解決する。
    usedKeywordIds: resolveKeywordIds(config.keywords, usedKeywords),
  });

  return {
    warnings,
    internal: draft.internal,
    customer: draft.customer,
    usedKeywords,
    generationId,
    escalationRequired: assembled.escalationRequired,
    childAgeMonths,
    effectiveEducationLevel: assembled.effectiveEducationLevel,
  };
}

/** キーワードのコードを行のIDに直す。表に無いコードは落とす。 */
function resolveKeywordIds(keywords: readonly { id: string; code: string }[], codes: string[]): string[] {
  const idByCode = new Map(keywords.map((k) => [k.code, k.id]));
  return codes.map((code) => idByCode.get(code)).filter((id): id is string => id !== undefined);
}

/**
 * 生成1回を記録し、行のIDを返す。記録に失敗しても生成結果は壊さない(null を返す)。
 *
 * 記録は「後から検証するための材料」で、スタッフが目の前で書こうとしている日報より
 * 優先されるものではない。ここで例外を投げると、生成に成功しているのに画面には
 * エラーしか出ない(しかも書き直しても同じ結果になる)。
 */
async function recordGeneration(
  deps: ReportAiDeps,
  tenantId: string,
  input: Omit<Parameters<ReportAiGenerationRepositoryPort['create']>[0], 'tenantId'>,
): Promise<string | null> {
  try {
    const record = await deps.reportAiGenerations.create({ tenantId, ...input });
    return record.id;
  } catch (e) {
    console.error('[reportAi] AI生成の記録に失敗しました', e);
    return null;
  }
}

/** GAS版GeminiReport.js generateAccidentReportに対応。失敗時は{error}を返す。 */
export async function generateAccidentReportDraft(
  deps: ReportAiDeps,
  tenantId: string,
  input: { text: string; start?: string; end?: string },
): Promise<AccidentReportDraft | AccidentReportDraftError> {
  const [reportAi, template] = await Promise.all([
    resolveReportAiPort(deps, tenantId),
    resolvePromptTemplate(deps, tenantId, 'accident_report'),
  ]);
  // 事故報告は終了時刻が無くても発生時刻だけで意味を持つので、開始だけでも渡す(GAS版と同じ)。
  const timeInfo = input.start && input.end ? `${input.start}〜${input.end}` : input.start || '時間指定なし';
  const prompt = renderWithoutProfileAxes(template.body, input.text, timeInfo);
  return reportAi.generateAccidentReport({ prompt, text: input.text, start: input.start, end: input.end });
}

/** GAS版GeminiReport.js extractAmountFromImageに対応。失敗時も空値のフォールバックを返す。 */
export async function extractReceiptAmount(
  deps: ReportAiDeps,
  tenantId: string,
  base64Image: string,
): Promise<ReceiptOcrResult> {
  const [reportAi, template] = await Promise.all([
    resolveReportAiPort(deps, tenantId),
    resolvePromptTemplate(deps, tenantId, 'receipt_ocr'),
  ]);
  // 領収書の文面に差し込みは無いが、同じ経路(テナントの版→既定)で解決する。
  const prompt = renderWithoutProfileAxes(template.body, '', '');
  return reportAi.extractReceiptAmount({ prompt, base64Image });
}
