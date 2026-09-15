import type {
  AgeBandBody,
  AgeBandView,
  EducationLevelBody,
  EducationLevelView,
  KeywordBody,
  KeywordView,
  PhraseInput,
  PhraseView,
  ReportAiAdminConfigView,
  ReportAiImportPayload,
  ReportAiImportResult,
  StressLevelBody,
  StressLevelView,
} from '@katahimo/shared';
import { parseJsonOrThrow } from '../api';

const BASE = '/api/settings/admin/report-ai';

/** 管理画面が1度に読む、日報AI3軸の設定一式(タブ全部ぶん)。保存後はこのキャッシュを作り直す。 */
export async function fetchReportAiAdminConfig(): Promise<ReportAiAdminConfigView> {
  const res = await fetch(BASE, { credentials: 'include' });
  return parseJsonOrThrow<ReportAiAdminConfigView>(res);
}

/** 年齢帯を code で upsert する。 */
export async function saveAgeBand(code: string, body: AgeBandBody): Promise<AgeBandView> {
  const res = await fetch(`${BASE}/age-bands/${encodeURIComponent(code)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  const data = await parseJsonOrThrow<{ ageBand: AgeBandView }>(res);
  return data.ageBand;
}

/** 年齢帯を削除する(report_age_band_keywordsの対応行もサーバー側で消える)。 */
export async function deleteAgeBand(code: string): Promise<void> {
  const res = await fetch(`${BASE}/age-bands/${encodeURIComponent(code)}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  await parseJsonOrThrow<{ success: boolean }>(res);
}

/** キーワードを code で upsert する。削除は無く、廃止は active=false で保存する。 */
export async function saveKeyword(code: string, body: KeywordBody): Promise<KeywordView> {
  const res = await fetch(`${BASE}/keywords/${encodeURIComponent(code)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  const data = await parseJsonOrThrow<{ keyword: KeywordView }>(res);
  return data.keyword;
}

/** 教育関心度★の判定基準(level 1〜5)を upsert する。 */
export async function saveEducationLevel(
  level: number,
  body: EducationLevelBody,
): Promise<EducationLevelView> {
  const res = await fetch(`${BASE}/education-levels/${level}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  const data = await parseJsonOrThrow<{ educationLevel: EducationLevelView }>(res);
  return data.educationLevel;
}

/** ストレス度(PSI)の判定基準(level 1〜5)を upsert する。 */
export async function saveStressLevel(level: number, body: StressLevelBody): Promise<StressLevelView> {
  const res = await fetch(`${BASE}/stress-levels/${level}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  const data = await parseJsonOrThrow<{ stressLevel: StressLevelView }>(res);
  return data.stressLevel;
}

/** 温かみ表現・避ける表現を全件入れ替える。 */
export async function replacePhrases(phrases: PhraseInput[]): Promise<PhraseView[]> {
  const res = await fetch(`${BASE}/phrases`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ phrases }),
  });
  const data = await parseJsonOrThrow<{ phrases: PhraseView[] }>(res);
  return data.phrases;
}

/**
 * xlsx から作った取込データを反映する(マージ。code/levelで upsert、表に無い行は消さない)。
 * 変換自体は`parseReportAiImportSheets`(@katahimo/shared)が行い、ここはその結果を送るだけ。
 */
export async function importReportAiConfig(payload: ReportAiImportPayload): Promise<ReportAiImportResult> {
  const res = await fetch(`${BASE}/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  const data = await parseJsonOrThrow<{ result: ReportAiImportResult }>(res);
  return data.result;
}
