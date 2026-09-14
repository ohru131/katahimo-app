import {
  DEFAULT_RECEIPT_DEADLINE_POLICY,
  type ReceiptDeadlinePolicy,
} from '../domain/reports/receiptCancellation';
import type { CryptoPort } from '../ports/crypto';
import type { AppSettingsRepositoryPort } from '../ports/repositories';

export interface SettingsDeps {
  appSettings: AppSettingsRepositoryPort;
  crypto: CryptoPort;
}

/** GAS版GeminiReport.jsのGEMINI_MODEL_REPORT_DEFAULT/GEMINI_MODEL_OCR_DEFAULTと同じ値。 */
const DEFAULT_GEMINI_REPORT_MODEL = 'gemini-2.5-flash';
const DEFAULT_GEMINI_OCR_MODEL = 'gemini-2.5-flash-lite';

export interface AdminSettingsView {
  /** Gemini APIキーが保存済みかどうか。平文は画面に返さない(書き込み専用の扱い)。 */
  hasGeminiApiKey: boolean;
  /**
   * 「どのキーが入っているか」を管理者が見分けるためだけの末尾数文字。
   * 短いキーで大部分が見えてしまうのを避けるため、条件を満たさない場合はnullにする。
   */
  geminiApiKeyPreview: string | null;
  geminiReportModel: string;
  geminiOcrModel: string;
  gchatReportWebhookUrl: string;
  gchatReceiptWebhookUrl: string;
  /** 締め日まわり(doc/db/guidelines.md §10)。画面はこの2つをそのまま編集する。 */
  receiptClosingDay: number | null;
  receiptCancellableDays: number;
}

/** マスク表示で見せる末尾の文字数。 */
const GEMINI_API_KEY_PREVIEW_LENGTH = 4;
/**
 * この長さ未満のキーは末尾4文字でもキー全体の1/3以上が露出してしまうため、
 * プレビュー自体を出さない(実際のGemini APIキーは39文字程度なので通常は影響しない)。
 */
const GEMINI_API_KEY_PREVIEW_MIN_LENGTH = GEMINI_API_KEY_PREVIEW_LENGTH * 3;

/** 平文キーから画面表示用の末尾数文字を作る。マスクとして意味をなさない長さならnull。 */
function buildApiKeyPreview(apiKey: string): string | null {
  if (apiKey.length < GEMINI_API_KEY_PREVIEW_MIN_LENGTH) return null;
  return apiKey.slice(-GEMINI_API_KEY_PREVIEW_LENGTH);
}

/**
 * 管理者設定画面用の現在値を返す。GAS版のgetGeminiApiKeyForAdmin/
 * getGeminiModelSettingsForAdmin/getGoogleChatWebhookSettingsForAdminをまとめたもの
 * (呼び出し元のAPIルートで管理者権限チェックを行う)。
 *
 * Gemini APIキーだけは平文を返さない。管理者アカウントが1つ乗っ取られただけで
 * テナントのAPIキーが平文で流出するのを防ぐため、書き込み専用+マスク表示にしている。
 */
export async function getAdminSettings(deps: SettingsDeps, tenantId: string): Promise<AdminSettingsView> {
  const row = await deps.appSettings.find(tenantId);
  const [geminiApiKey, gchatReportWebhookUrl, gchatReceiptWebhookUrl] = await Promise.all([
    row?.geminiApiKey ? deps.crypto.decrypt(tenantId, row.geminiApiKey) : Promise.resolve(''),
    row?.gchatReportWebhookUrl
      ? deps.crypto.decrypt(tenantId, row.gchatReportWebhookUrl)
      : Promise.resolve(''),
    row?.gchatReceiptWebhookUrl
      ? deps.crypto.decrypt(tenantId, row.gchatReceiptWebhookUrl)
      : Promise.resolve(''),
  ]);
  return {
    hasGeminiApiKey: !!geminiApiKey,
    geminiApiKeyPreview: geminiApiKey ? buildApiKeyPreview(geminiApiKey) : null,
    geminiReportModel: row?.geminiReportModel || DEFAULT_GEMINI_REPORT_MODEL,
    geminiOcrModel: row?.geminiOcrModel || DEFAULT_GEMINI_OCR_MODEL,
    gchatReportWebhookUrl,
    gchatReceiptWebhookUrl,
    receiptClosingDay: row?.receiptClosingDay ?? DEFAULT_RECEIPT_DEADLINE_POLICY.closingDay,
    receiptCancellableDays: row?.receiptCancellableDays ?? DEFAULT_RECEIPT_DEADLINE_POLICY.cancellableDays,
  };
}

/**
 * 領収書の締め日設定を読む。未登録のテナントは既定値(月末締め・取り消しは2日間)。
 *
 * 取り消し期限はここから導かれる。ミラー送信の時刻とは無関係(送信は登録と同時に始まる)。
 * 期限は登録時に receipts.cancellable_until へ確定させるので、あとで設定を変えても
 * 登録済みの領収書の期限は動かない(doc/db/guidelines.md §10)。
 */
export async function resolveReceiptDeadlinePolicy(
  // 暗号化には触れないので SettingsDeps 全体は要求しない(領収書側のdepsからも呼べるようにする)。
  deps: Pick<SettingsDeps, 'appSettings'>,
  tenantId: string,
): Promise<ReceiptDeadlinePolicy> {
  const row = await deps.appSettings.find(tenantId);
  if (!row) return DEFAULT_RECEIPT_DEADLINE_POLICY;
  return {
    closingDay: row.receiptClosingDay,
    cancellableDays: row.receiptCancellableDays,
  };
}

export type SaveReceiptDeadlineInput = ReceiptDeadlinePolicy;

/** 締め日設定を保存する。値域の検証は呼び出し側(APIルート)とDBのCHECK制約が行う。 */
export async function saveReceiptDeadlineSettings(
  deps: SettingsDeps,
  tenantId: string,
  input: SaveReceiptDeadlineInput,
): Promise<SaveSettingsResult> {
  await deps.appSettings.upsert(tenantId, {
    receiptClosingDay: input.closingDay,
    receiptCancellableDays: input.cancellableDays,
  });
  return { ok: true, message: '締め日の設定を保存しました。' };
}

/**
 * 保存済みのGemini APIキーを復号して返す(未設定なら空文字)。
 * サーバー内部でGemini APIを呼ぶためだけのもので、**戻り値をレスポンスに含めてはいけない**。
 * 画面から平文キーが読めなくなった代わりに、モデル一覧取得のようなサーバー側の処理が
 * 保存済みキーを使えるようにするために用意している。
 */
export async function resolveGeminiApiKey(deps: SettingsDeps, tenantId: string): Promise<string> {
  const row = await deps.appSettings.find(tenantId);
  if (!row?.geminiApiKey) return '';
  return deps.crypto.decrypt(tenantId, row.geminiApiKey);
}

export type SaveSettingsResult = { ok: true; message: string } | { ok: false; message: string };

/**
 * Gemini APIキーを保存する。空文字での保存は既存キーの意図しない消失を防ぐため拒否する
 * (GAS版saveGeminiApiKeyForAdminと同じガード)。
 */
export async function saveGeminiApiKey(
  deps: SettingsDeps,
  tenantId: string,
  apiKey: string,
): Promise<SaveSettingsResult> {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    return {
      ok: false,
      message: 'APIキーが空です。空のまま保存すると既存のキーが失われるため、保存を中止しました。',
    };
  }
  const encrypted = await deps.crypto.encrypt(tenantId, trimmed);
  await deps.appSettings.upsert(tenantId, { geminiApiKey: encrypted });
  return { ok: true, message: 'Gemini APIキーを保存しました。' };
}

/** どちらか一方でも空文字での保存は拒否する(GAS版saveGeminiModelSettingsForAdminと同じガード)。 */
export async function saveGeminiModelSettings(
  deps: SettingsDeps,
  tenantId: string,
  reportModel: string,
  ocrModel: string,
): Promise<SaveSettingsResult> {
  const trimmedReport = reportModel.trim();
  const trimmedOcr = ocrModel.trim();
  if (!trimmedReport || !trimmedOcr) {
    return {
      ok: false,
      message: 'モデルが未選択です。空のまま保存すると既存の設定が失われるため、保存を中止しました。',
    };
  }
  await deps.appSettings.upsert(tenantId, { geminiReportModel: trimmedReport, geminiOcrModel: trimmedOcr });
  return { ok: true, message: 'モデル設定を保存しました。' };
}

/** どちらか一方でも空文字での保存は拒否する(GAS版saveGoogleChatWebhookSettingsForAdminと同じガード)。 */
export async function saveGoogleChatWebhookSettings(
  deps: SettingsDeps,
  tenantId: string,
  reportWebhookUrl: string,
  receiptWebhookUrl: string,
): Promise<SaveSettingsResult> {
  const trimmedReport = reportWebhookUrl.trim();
  const trimmedReceipt = receiptWebhookUrl.trim();
  if (!trimmedReport || !trimmedReceipt) {
    return {
      ok: false,
      message: 'Webhook URLが空です。空のまま保存すると既存の設定が失われるため、保存を中止しました。',
    };
  }
  const [reportEnc, receiptEnc] = await Promise.all([
    deps.crypto.encrypt(tenantId, trimmedReport),
    deps.crypto.encrypt(tenantId, trimmedReceipt),
  ]);
  await deps.appSettings.upsert(tenantId, {
    gchatReportWebhookUrl: reportEnc,
    gchatReceiptWebhookUrl: receiptEnc,
  });
  return { ok: true, message: 'Webhook URLを保存しました。' };
}
