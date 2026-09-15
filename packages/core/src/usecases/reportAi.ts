import { renderPromptTemplate } from '../domain/reports/promptAssembly';
import type {
  AccidentReportDraft,
  AccidentReportDraftError,
  DailyReportDraft,
  ReceiptOcrResult,
  ReportAiPort,
  ReportAiPortFactory,
} from '../ports/ai';
import type { CryptoPort } from '../ports/crypto';
import type { AppSettingsRepositoryPort, PromptTemplateRepositoryPort } from '../ports/repositories';
import { resolvePromptTemplate } from './promptTemplates';

export interface ReportAiDeps {
  /** テナントが独自のGemini APIキーを設定していない場合に使うフォールバック(.env設定 or Noop)。 */
  reportAi: ReportAiPort;
  appSettings: AppSettingsRepositoryPort;
  crypto: CryptoPort;
  reportAiFactory: ReportAiPortFactory;
  /** 生成に使う文面(テナントが編集した版、無ければ既定文面)の取得元。 */
  promptTemplates: PromptTemplateRepositoryPort;
}

/**
 * 3軸(年齢帯・教育関心度・ストレス度)の組み立てはまだ繋いでいないので、その差し込みは
 * 空文字にする。文面に {childContext} 等が書かれていても、いまは何も入らないだけで生成は通る
 * (GAS版と同じく {anonymizedText} と {timeInfo} だけが効く)。
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

/**
 * 保育日報のメモ(口語)からAI下書きを生成する。GAS版GeminiReport.js
 * generateReportWithWarningsに対応。APIキー未設定時・API呼び出し失敗時も例外にはせず、
 * warnings/internalにその旨を詰めた同じ形のオブジェクトを返す(GAS版と同じ)。
 */
export async function generateDailyReportDraft(
  deps: ReportAiDeps,
  tenantId: string,
  input: { text: string; start?: string; end?: string },
): Promise<DailyReportDraft> {
  const [reportAi, template] = await Promise.all([
    resolveReportAiPort(deps, tenantId),
    resolvePromptTemplate(deps, tenantId, 'daily_report'),
  ]);
  // GAS版 generateReportWithWarnings と同じ時間情報の作り方。
  const timeInfo = input.start && input.end ? `${input.start}〜${input.end}` : '時間指定なし';
  const prompt = renderWithoutProfileAxes(template.body, input.text, timeInfo);
  return reportAi.generateDailyReport({ prompt, text: input.text, start: input.start, end: input.end });
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
