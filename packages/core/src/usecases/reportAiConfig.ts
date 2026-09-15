import {
  type AgeBandView,
  ageBandInputSchema,
  type CustomerReportProfileView,
  customerReportProfileInputSchema,
  type EducationLevelView,
  educationLevelInputSchema,
  type KeywordView,
  keywordInputSchema,
  type PhraseView,
  phraseInputSchema,
  type ReportAiAdminConfigView,
  type ReportAiImportPayload,
  type ReportAiImportResult,
  type ReportAiLevelChoicesView,
  reportAiImportPayloadSchema,
  type StressLevelView,
  stressLevelInputSchema,
} from '@katahimo/shared';
import type {
  CustomerReportProfileRepositoryPort,
  ReportAgeBandRecord,
  ReportAiConfigRepositoryPort,
  ReportAiConfigSnapshot,
  ReportEducationLevelRecord,
  ReportKeywordRecord,
  ReportPhraseRecord,
  ReportStressLevelRecord,
} from '../ports/reportAiRepositories';
import type { PromptTemplateRepositoryPort } from '../ports/repositories';
import { savePromptTemplate } from './promptTemplates';

/**
 * 日報AIの3軸(年齢帯・教育関心度★・ストレス度)の設定を読み書きするユースケース。
 *
 * 入力の検証は @katahimo/shared の zod スキーマ(contracts/reportAiAdmin.ts)で行い、API と
 * 画面が同じ判定を共有する。DBのCHECK制約と同じ判定を入口でも行うのは、23514(CHECK違反)で
 * しか気付けない形にしないため(doc/db/guidelines.md §1.6)。
 *
 * 年齢帯どうしの月齢の重なり禁止だけは、1行のCHECKでは書けない(btree_gist の EXCLUDE が
 * PGlite に無い)ので、ここが唯一の砦になる(doc/db/new-domains.md 第6章)。
 */

export interface ReportAiConfigDeps {
  reportAiConfig: ReportAiConfigRepositoryPort;
  customerReportProfiles: CustomerReportProfileRepositoryPort;
  /** 取込でプロンプト文面の版も一緒に積むため。 */
  promptTemplates: PromptTemplateRepositoryPort;
}

/** 取込で積む版に残す理由。一覧で「取込で入った版」と分かるようにする。 */
const IMPORT_NOTE = '取込';

// ---------------------------------------------------------------------------
// 入力の検証
// ---------------------------------------------------------------------------

/** zod の失敗を、画面にそのまま出せる日本語のエラーにする。 */
function validationError(what: string, error: { issues: { path: (string | number)[]; message: string }[] }) {
  const detail = error.issues.map((issue) => `${issue.path.join('.') || '値'}: ${issue.message}`).join(' / ');
  return new Error(`${what}の入力が正しくありません(${detail})`);
}

// ---------------------------------------------------------------------------
// レコード → 画面に返す形
// ---------------------------------------------------------------------------

function toAgeBandView(record: ReportAgeBandRecord): AgeBandView {
  const { id: _id, tenantId: _tenantId, ...view } = record;
  return view;
}

function toKeywordView(record: ReportKeywordRecord, ageBandCodes: string[]): KeywordView {
  const { id: _id, tenantId: _tenantId, ...view } = record;
  return { ...view, ageBandCodes };
}

function toEducationLevelView(record: ReportEducationLevelRecord): EducationLevelView {
  const { id: _id, tenantId: _tenantId, ...view } = record;
  return view;
}

function toStressLevelView(record: ReportStressLevelRecord): StressLevelView {
  const { id: _id, tenantId: _tenantId, ...view } = record;
  return view;
}

function toPhraseView(record: ReportPhraseRecord): PhraseView {
  const { id: _id, tenantId: _tenantId, ...view } = record;
  return view;
}

/**
 * キーワードID → 相性の良い年齢帯コード。対応表(report_age_band_keywords)は年齢帯側から
 * 引ける形で持っているので、画面が必要とする「語ごとのコード一覧」に向きを変える。
 */
function ageBandCodesByKeywordId(snapshot: ReportAiConfigSnapshot): Map<string, string[]> {
  const codeByBandId = new Map(snapshot.ageBands.map((band) => [band.id, band.code]));
  const result = new Map<string, string[]>();
  for (const [bandId, keywordIds] of Object.entries(snapshot.ageBandKeywordIds)) {
    const code = codeByBandId.get(bandId);
    if (!code) continue;
    for (const keywordId of keywordIds) {
      const codes = result.get(keywordId);
      if (codes) codes.push(code);
      else result.set(keywordId, [code]);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// 読み取り
// ---------------------------------------------------------------------------

/** 管理画面の1表示ぶん。廃止した語(active=false)も含めて返す(画面で戻せるようにするため)。 */
export async function getReportAiConfigForAdmin(
  deps: ReportAiConfigDeps,
  tenantId: string,
): Promise<ReportAiAdminConfigView> {
  const snapshot = await deps.reportAiConfig.loadAll(tenantId);
  const codesByKeywordId = ageBandCodesByKeywordId(snapshot);
  return {
    ageBands: snapshot.ageBands.map(toAgeBandView),
    keywords: snapshot.keywords.map((keyword) =>
      toKeywordView(keyword, codesByKeywordId.get(keyword.id) ?? []),
    ),
    educationLevels: snapshot.educationLevels.map(toEducationLevelView),
    stressLevels: snapshot.stressLevels.map(toStressLevelView),
    phrases: snapshot.phrases.map(toPhraseView),
  };
}

/**
 * 一般スタッフ向けのレベル一覧。顧客詳細の★設定と、日報入力画面のストレス度の判定基準に使う。
 * テナントが行を作っていないレベルは含めない(選択肢に出さない)。
 */
export async function getReportAiLevelsForStaff(
  deps: ReportAiConfigDeps,
  tenantId: string,
): Promise<ReportAiLevelChoicesView> {
  const snapshot = await deps.reportAiConfig.loadAll(tenantId);
  return {
    educationLevels: snapshot.educationLevels.map((row) => ({
      level: row.level,
      label: row.label,
      description: row.description,
    })),
    stressLevels: snapshot.stressLevels.map((row) => ({
      level: row.level,
      label: row.label,
      criteria: row.criteria,
    })),
  };
}

// ---------------------------------------------------------------------------
// 年齢帯
// ---------------------------------------------------------------------------

interface AgeBandRange {
  code: string;
  label: string;
  ageFromMonths: number;
  ageToMonths: number;
}

/**
 * 年齢帯どうしの月齢が重なっていないことを確かめる。重なっていれば、どの帯とどの帯が
 * 重なっているかを書いたエラーにする。
 *
 * 【入口で担保する理由】
 * 帯が重なると、同じ月齢の子に当たる帯が2つできて「どちらの行動語で書くか」が並び順任せに
 * なる。1行のCHECK制約では書けない条件(btree_gist の EXCLUDE が PGlite に無い)なので、
 * 保存の手前で弾く。
 */
function assertNoAgeBandOverlap(bands: readonly AgeBandRange[]): void {
  const sorted = [...bands].sort((a, b) => a.ageFromMonths - b.ageFromMonths);
  for (let i = 1; i < sorted.length; i++) {
    const previous = sorted[i - 1];
    const current = sorted[i];
    if (!previous || !current) continue;
    if (current.ageFromMonths < previous.ageToMonths) {
      throw new Error(
        `年齢帯「${previous.label}」(${previous.ageFromMonths}〜${previous.ageToMonths}ヶ月)と` +
          `「${current.label}」(${current.ageFromMonths}〜${current.ageToMonths}ヶ月)の月齢が重なっています。` +
          '上限の月齢は範囲に含まれないので、隣り合う帯は同じ値でつなげてください。',
      );
    }
  }
}

/** 既存の帯(同じコードの行は置き換え)に入力を合わせた一覧。重なりの検証に使う。 */
function mergeAgeBands(
  existing: readonly ReportAgeBandRecord[],
  incoming: readonly AgeBandRange[],
): AgeBandRange[] {
  const byCode = new Map<string, AgeBandRange>(existing.map((band) => [band.code, band]));
  for (const band of incoming) byCode.set(band.code, band);
  return [...byCode.values()];
}

/** 年齢帯を1件 upsert する。保存前に他の帯との重なりを検証する。 */
export async function saveAgeBand(
  deps: ReportAiConfigDeps,
  tenantId: string,
  input: unknown,
): Promise<AgeBandView> {
  const parsed = ageBandInputSchema.safeParse(input);
  if (!parsed.success) throw validationError('年齢帯', parsed.error);

  const snapshot = await deps.reportAiConfig.loadAll(tenantId);
  assertNoAgeBandOverlap(mergeAgeBands(snapshot.ageBands, [parsed.data]));

  return toAgeBandView(await deps.reportAiConfig.upsertAgeBand(tenantId, parsed.data));
}

/** 年齢帯を消す。対応表の行も一緒に消える。該当が無ければ false。 */
export async function deleteAgeBand(
  deps: ReportAiConfigDeps,
  tenantId: string,
  code: string,
): Promise<boolean> {
  return deps.reportAiConfig.deleteAgeBand(tenantId, code);
}

// ---------------------------------------------------------------------------
// キーワード
// ---------------------------------------------------------------------------

/** 登録されていない年齢帯コードが混じっていればエラー(対応を黙って落とさない)。 */
function assertAgeBandCodesExist(
  knownCodes: ReadonlySet<string>,
  codes: readonly string[],
  what: string,
): void {
  const missing = [...new Set(codes)].filter((code) => !knownCodes.has(code));
  if (missing.length > 0) {
    throw new Error(`${what}に指定された年齢帯コード ${missing.join(', ')} は登録されていません。`);
  }
}

/**
 * キーワードを1件 upsert する。削除は無く、廃止は `active=false`
 * (過去の生成記録が語の行を参照するため)。
 */
export async function saveKeyword(
  deps: ReportAiConfigDeps,
  tenantId: string,
  input: unknown,
): Promise<KeywordView> {
  const parsed = keywordInputSchema.safeParse(input);
  if (!parsed.success) throw validationError('キーワード', parsed.error);

  const snapshot = await deps.reportAiConfig.loadAll(tenantId);
  const knownCodes = new Set(snapshot.ageBands.map((band) => band.code));
  assertAgeBandCodesExist(knownCodes, parsed.data.ageBandCodes, `キーワード「${parsed.data.code}」`);

  const saved = await deps.reportAiConfig.upsertKeyword(tenantId, parsed.data);
  return toKeywordView(saved, [...new Set(parsed.data.ageBandCodes)]);
}

// ---------------------------------------------------------------------------
// レベル定義・表現
// ---------------------------------------------------------------------------

export async function saveEducationLevel(
  deps: ReportAiConfigDeps,
  tenantId: string,
  input: unknown,
): Promise<EducationLevelView> {
  const parsed = educationLevelInputSchema.safeParse(input);
  if (!parsed.success) throw validationError('教育関心度の判定基準', parsed.error);
  return toEducationLevelView(await deps.reportAiConfig.upsertEducationLevel(tenantId, parsed.data));
}

export async function saveStressLevel(
  deps: ReportAiConfigDeps,
  tenantId: string,
  input: unknown,
): Promise<StressLevelView> {
  const parsed = stressLevelInputSchema.safeParse(input);
  if (!parsed.success) throw validationError('ストレス度の判定基準', parsed.error);
  return toStressLevelView(await deps.reportAiConfig.upsertStressLevel(tenantId, parsed.data));
}

/** 表現を全件入れ替える(管理画面の一覧がそのままテナントの表現一式になる)。 */
export async function replacePhrases(
  deps: ReportAiConfigDeps,
  tenantId: string,
  inputs: unknown,
): Promise<PhraseView[]> {
  const parsed = phraseInputSchema.array().safeParse(inputs);
  if (!parsed.success) throw validationError('表現', parsed.error);
  const saved = await deps.reportAiConfig.replacePhrases(tenantId, parsed.data);
  return saved.map(toPhraseView);
}

// ---------------------------------------------------------------------------
// 取込
// ---------------------------------------------------------------------------

/**
 * xlsx から作った取込データを反映する。反映した件数を種類ごとに返す。
 *
 * 【この順で入れる理由】
 * キーワードは年齢帯コードを参照するので、年齢帯を先に入れる。レベル定義は他に依存しないが、
 * キーワードの★・ストレス度の範囲を人が見比べられるよう先に入れておく。表現は入れ替えではなく
 * 「同じ kind+body は更新・無ければ追加」にして、表に載っていない既存の表現を消さない。
 * プロンプト文面は版を積む操作なので最後(前段が失敗したときに版だけ増えるのを避ける)。
 */
export async function importReportAiConfig(
  deps: ReportAiConfigDeps,
  tenantId: string,
  payload: unknown,
  options: { staffId: string | null },
): Promise<ReportAiImportResult> {
  const parsed = reportAiImportPayloadSchema.safeParse(payload);
  if (!parsed.success) throw validationError('取込データ', parsed.error);
  const data: ReportAiImportPayload = parsed.data;

  const snapshot = await deps.reportAiConfig.loadAll(tenantId);
  // 取込後の姿(既存 + 今回の行)で重なりを見る。1件ずつ見ると、入れ替えの途中の
  // 状態で重なったように見えてしまう(「0〜12ヶ月」を「0〜6」「6〜12」に割る取込など)。
  assertNoAgeBandOverlap(mergeAgeBands(snapshot.ageBands, data.ageBands));

  const knownCodes = new Set(snapshot.ageBands.map((band) => band.code));
  for (const band of data.ageBands) knownCodes.add(band.code);
  for (const keyword of data.keywords) {
    assertAgeBandCodesExist(knownCodes, keyword.ageBandCodes, `キーワード「${keyword.code}」`);
  }

  for (const band of data.ageBands) await deps.reportAiConfig.upsertAgeBand(tenantId, band);
  for (const level of data.educationLevels) await deps.reportAiConfig.upsertEducationLevel(tenantId, level);
  for (const level of data.stressLevels) await deps.reportAiConfig.upsertStressLevel(tenantId, level);
  for (const keyword of data.keywords) await deps.reportAiConfig.upsertKeyword(tenantId, keyword);
  await deps.reportAiConfig.upsertPhrasesByBody(tenantId, data.phrases);

  // 文面は「いま有効な版と違うときだけ」積む(savePromptTemplate が既定文面への
  // フォールバックと差分の判定をまとめて行う)。同じ文面なら版を増やさないので、
  // 同じ資料を2回取り込んでも履歴が汚れない。
  let promptTemplates = 0;
  for (const template of data.promptTemplates) {
    const result = await savePromptTemplate(deps, tenantId, options.staffId, {
      key: template.key,
      body: template.body,
      note: IMPORT_NOTE,
    });
    if (result.ok) promptTemplates += 1;
  }

  return {
    ageBands: data.ageBands.length,
    keywords: data.keywords.length,
    educationLevels: data.educationLevels.length,
    stressLevels: data.stressLevels.length,
    phrases: data.phrases.length,
    promptTemplates,
  };
}

// ---------------------------------------------------------------------------
// 家庭ごとの設定
// ---------------------------------------------------------------------------

/** 顧客詳細の★設定。行が無ければ null(未設定)。 */
export async function getCustomerReportProfile(
  deps: ReportAiConfigDeps,
  tenantId: string,
  customerId: string,
): Promise<CustomerReportProfileView | null> {
  const record = await deps.customerReportProfiles.find(tenantId, customerId);
  return record ? { educationLevel: record.educationLevel, note: record.note } : null;
}

/**
 * ★とメモを保存する。管理者に限定しない(担当者も付けられる。設計書「管理者・担当者が付ける」)。
 * ★は null(未設定に戻す)を許し、値があれば 1〜5。
 */
export async function saveCustomerReportProfile(
  deps: ReportAiConfigDeps,
  tenantId: string,
  customerId: string,
  input: unknown,
  staffId: string | null,
): Promise<CustomerReportProfileView> {
  const parsed = customerReportProfileInputSchema.safeParse(input);
  if (!parsed.success) throw validationError('家庭ごとの日報設定', parsed.error);
  const saved = await deps.customerReportProfiles.upsert(tenantId, customerId, {
    educationLevel: parsed.data.educationLevel,
    note: parsed.data.note,
    updatedByStaffId: staffId,
  });
  return { educationLevel: saved.educationLevel, note: saved.note };
}
