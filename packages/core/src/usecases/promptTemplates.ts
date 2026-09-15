import {
  DEFAULT_PROMPT_TEMPLATES,
  PROMPT_PLACEHOLDERS,
  PROMPT_TEMPLATE_BODY_MAX_LENGTH,
  PROMPT_TEMPLATE_KEY_LABELS,
  PROMPT_TEMPLATE_KEYS,
  type PromptTemplateKey,
} from '@katahimo/shared';
import type { PromptTemplateRecord, PromptTemplateRepositoryPort } from '../ports/repositories';

/**
 * テナントが編集したプロンプト文面の解決と、管理画面からの編集。
 *
 * GAS版 GeminiReport.js getPrompt は「ＡＩプロンプト」シートにキーがあればその文面、
 * 無ければコードの既定文面(DEFAULT_PROMPTS)を返していた。ここはその置き換えで、
 * 読む先がシートから prompt_templates(テナントごと・キーごとの最大版)に変わっただけ。
 * 既定文面は @katahimo/shared の DEFAULT_PROMPT_TEMPLATES。
 *
 * 文面は上書きせず版を積む(packages/db/src/schema/reportAi.ts)。「既定に戻す」も
 * 既定文面を新しい版として積む操作で、過去の版は消さない。
 */

export interface PromptTemplateDeps {
  promptTemplates: PromptTemplateRepositoryPort;
}

/** 生成時に使う文面1件。テナントの版が無ければ既定文面(isDefault=true)。 */
export interface ResolvedPromptTemplate {
  key: PromptTemplateKey;
  body: string;
  /** テナントの版の番号。既定文面のときは null。 */
  version: number | null;
  /** 使った版のID(report_ai_generations.prompt_template_id に残す値)。既定文面のときは null。 */
  templateId: string | null;
  isDefault: boolean;
}

/**
 * キーごとに、文面へ差し込める変数名。
 *
 * daily_report は3軸の組み立て結果まで差し込める(PROMPT_PLACEHOLDERS)。accident_report は
 * GAS版から引き継いだ2つだけ。UI文言のキー(入力例・記載要領)は差し込み無しでそのまま表示する。
 * 管理画面が「この文面で使える変数」を案内するために持つ。
 */
const PLACEHOLDERS_BY_KEY: Readonly<Record<PromptTemplateKey, readonly string[]>> = {
  daily_report: PROMPT_PLACEHOLDERS,
  daily_report_stance: [],
  accident_report: ['anonymizedText', 'timeInfo'],
  receipt_ocr: [],
  daily_memo_placeholder: [],
  accident_memo_placeholder: [],
  accident_hint: [],
  hiyari_hint: [],
};

/**
 * この変数が文面から消えるとスタッフの入力がAIに届かない、というキーと変数。
 * 空のメモで生成したのと同じ結果になり、しかも画面上はエラーにならないので気付けない。
 */
const REQUIRED_PLACEHOLDER = '{anonymizedText}';
const KEYS_REQUIRING_INPUT_TEXT: readonly PromptTemplateKey[] = ['daily_report', 'accident_report'];

/** 外から来た文字列が区分値(PROMPT_TEMPLATE_KEYS)のキーかを判定する。 */
function isPromptTemplateKey(value: unknown): value is PromptTemplateKey {
  return (PROMPT_TEMPLATE_KEYS as readonly unknown[]).includes(value);
}

/** 有効版の行(無ければ null)を、生成で使う形に整える。行が無いキーは既定文面で埋める。 */
function toResolved(key: PromptTemplateKey, row: PromptTemplateRecord | null): ResolvedPromptTemplate {
  if (!row) {
    return { key, body: DEFAULT_PROMPT_TEMPLATES[key], version: null, templateId: null, isDefault: true };
  }
  return { key, body: row.body, version: row.version, templateId: row.id, isDefault: false };
}

/** 全キーの有効な文面。テナントの版が無いキーは既定文面で埋める(GAS版 getPrompt と同じ挙動)。 */
export async function resolvePromptTemplates(
  deps: PromptTemplateDeps,
  tenantId: string,
): Promise<Record<PromptTemplateKey, ResolvedPromptTemplate>> {
  const rows = await deps.promptTemplates.findLatestAll(tenantId);
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const result = {} as Record<PromptTemplateKey, ResolvedPromptTemplate>;
  for (const key of PROMPT_TEMPLATE_KEYS) {
    result[key] = toResolved(key, byKey.get(key) ?? null);
  }
  return result;
}

/** 1キーだけの解決。生成1回で1〜2キーしか要らない経路(日報生成・OCR)で使う。 */
export async function resolvePromptTemplate(
  deps: PromptTemplateDeps,
  tenantId: string,
  key: PromptTemplateKey,
): Promise<ResolvedPromptTemplate> {
  const row = await deps.promptTemplates.findLatest(tenantId, key);
  return toResolved(key, row);
}

/** 管理画面の一覧1行。編集欄の中身(body)と、既定文面との差を見るための情報を揃えて返す。 */
export interface PromptTemplateAdminView {
  key: PromptTemplateKey;
  label: string;
  body: string;
  /** テナントの版の番号。既定文面のままなら null。 */
  version: number | null;
  isDefault: boolean;
  note: string;
  /** 有効な版を作った日時。既定文面のままなら null。 */
  updatedAt: Date | null;
  /** 「既定に戻す」で入る文面。編集前に見比べられるよう一緒に返す。 */
  defaultBody: string;
  /** この文面で使える差し込み変数名(`{...}` の中身)。 */
  placeholders: string[];
}

/** 有効版の行(無ければ null)を、管理画面の一覧1行に整える。既定文面と使える差し込みも添える。 */
function toAdminView(key: PromptTemplateKey, row: PromptTemplateRecord | null): PromptTemplateAdminView {
  return {
    key,
    label: PROMPT_TEMPLATE_KEY_LABELS[key],
    body: row ? row.body : DEFAULT_PROMPT_TEMPLATES[key],
    version: row?.version ?? null,
    isDefault: !row,
    note: row?.note ?? '',
    updatedAt: row?.createdAt ?? null,
    defaultBody: DEFAULT_PROMPT_TEMPLATES[key],
    placeholders: [...PLACEHOLDERS_BY_KEY[key]],
  };
}

/** 管理画面のプロンプト一覧。全キーを、テナントの版が無いものも含めて返す。 */
export async function listPromptTemplatesForAdmin(
  deps: PromptTemplateDeps,
  tenantId: string,
): Promise<PromptTemplateAdminView[]> {
  const rows = await deps.promptTemplates.findLatestAll(tenantId);
  const byKey = new Map(rows.map((row) => [row.key, row]));
  return PROMPT_TEMPLATE_KEYS.map((key) => toAdminView(key, byKey.get(key) ?? null));
}

export type SavePromptTemplateResult =
  | { ok: true; message: string; template: PromptTemplateAdminView }
  | { ok: false; message: string };

export interface SavePromptTemplateInput {
  key: string;
  body: string;
  note?: string;
}

/**
 * 文面を新しい版として積む。
 *
 * 【保存前に弾くもの】
 * - 未知のキー(DBのCHECK制約違反=23514で初めて気付く形にしない。doc/db/guidelines.md §1.6)
 * - 空白だけの文面(prompt_templates_body_not_blank と同じ判定。指示ゼロでAIに書かせることになる)
 * - 上限(PROMPT_TEMPLATE_BODY_MAX_LENGTH)を超える文面(prompt_templates_body_length_check と同じ判定)
 * - 日報・事故報告で {anonymizedText} が消えている文面(スタッフのメモがAIに届かなくなる)
 * - いま有効な文面と同一の内容(版だけが増えて履歴が読みにくくなる)
 */
export async function savePromptTemplate(
  deps: PromptTemplateDeps,
  tenantId: string,
  staffId: string | null,
  input: SavePromptTemplateInput,
): Promise<SavePromptTemplateResult> {
  if (!isPromptTemplateKey(input.key)) {
    return { ok: false, message: '不明なプロンプトの種類です。' };
  }
  const key = input.key;
  if (typeof input.body !== 'string' || !input.body.trim()) {
    return { ok: false, message: '文面を入力してください。' };
  }
  if (input.body.length > PROMPT_TEMPLATE_BODY_MAX_LENGTH) {
    return {
      ok: false,
      message: `文面は${PROMPT_TEMPLATE_BODY_MAX_LENGTH.toLocaleString('ja-JP')}文字以内にしてください。`,
    };
  }
  if (KEYS_REQUIRING_INPUT_TEXT.includes(key) && !input.body.includes(REQUIRED_PLACEHOLDER)) {
    return {
      ok: false,
      message: `文面に ${REQUIRED_PLACEHOLDER} を残してください(入力したメモがAIに渡らなくなります)。`,
    };
  }

  // 「変わっていなければ積まない」の判定はリポジトリのトランザクション内で行う。ここで
  // findLatest してから append すると、読みと書きの間に別の管理者が保存した版を見落とす。
  const result = await deps.promptTemplates.appendIfChanged(
    tenantId,
    { key, body: input.body, note: input.note ?? '', createdByStaffId: staffId },
    DEFAULT_PROMPT_TEMPLATES[key],
  );
  if (!result.appended) {
    return { ok: false, message: '文面が変わっていません。' };
  }
  return { ok: true, message: '文面を保存しました。', template: toAdminView(key, result.record) };
}

/**
 * 既定文面を新しい版として積む(GAS版でシートの行を消して既定に戻したのと同じ結果)。
 * 過去の版は残るので、戻したあとで元の文面を読み直せる。
 */
export async function resetPromptTemplateToDefault(
  deps: PromptTemplateDeps,
  tenantId: string,
  staffId: string | null,
  key: string,
): Promise<SavePromptTemplateResult> {
  if (!isPromptTemplateKey(key)) {
    return { ok: false, message: '不明なプロンプトの種類です。' };
  }
  const defaultBody = DEFAULT_PROMPT_TEMPLATES[key];
  // daily_report_stance の既定は空文字(文体ルールはテナントが書くもので、GAS版にも既定が無い)。
  // 空の文面は版として積めない(prompt_templates_body_not_blank)ので、戻す操作自体を用意しない。
  if (!defaultBody.trim()) {
    return {
      ok: false,
      message: `「${PROMPT_TEMPLATE_KEY_LABELS[key]}」には既定の文面がありません(空にはできないため、戻す操作はできません)。`,
    };
  }

  // savePromptTemplate と同じ理由で、「すでに既定の文面か」の判定も書き込みと同じ
  // トランザクションに入れる(既定文面を積む操作なので、フォールバックも既定文面)。
  const result = await deps.promptTemplates.appendIfChanged(
    tenantId,
    { key, body: defaultBody, note: '既定の文面に戻す', createdByStaffId: staffId },
    defaultBody,
  );
  if (!result.appended) {
    return { ok: false, message: 'すでに既定の文面です。' };
  }
  return { ok: true, message: '既定の文面に戻しました。', template: toAdminView(key, result.record) };
}

/** 版の履歴を新しい順に返す。管理画面で「前の版に何が書いてあったか」を読むため。 */
export async function listPromptTemplateVersions(
  deps: PromptTemplateDeps,
  tenantId: string,
  key: string,
): Promise<PromptTemplateRecord[]> {
  if (!isPromptTemplateKey(key)) return [];
  return deps.promptTemplates.listVersions(tenantId, key);
}

/** 入力画面に出す文言。GAS版 Main.js getUiConfig のプレースホルダー・記載要領に対応する。 */
export interface ReportUiTexts {
  dailyMemoPlaceholder: string;
  accidentMemoPlaceholder: string;
  accidentHint: string;
  hiyariHint: string;
}

/**
 * 日報・事故報告の入力欄に出す文言を、生成用の文面と同じ経路(テナントの版→既定)で解決する。
 * GAS版 getUiConfig が getPrompt を4回呼んでいたのと同じ。
 */
export async function getReportUiTexts(deps: PromptTemplateDeps, tenantId: string): Promise<ReportUiTexts> {
  const templates = await resolvePromptTemplates(deps, tenantId);
  return {
    dailyMemoPlaceholder: templates.daily_memo_placeholder.body,
    accidentMemoPlaceholder: templates.accident_memo_placeholder.body,
    accidentHint: templates.accident_hint.body,
    hiyariHint: templates.hiyari_hint.body,
  };
}
