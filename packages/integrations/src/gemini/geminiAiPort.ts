import type {
  AccidentReportDraft,
  AccidentReportDraftError,
  DailyReportDraft,
  ExtractReceiptAmountInput,
  GenerateAccidentReportInput,
  GenerateDailyReportInput,
  ReceiptOcrResult,
  ReportAiPort,
} from '@katahimo/core/ports';

const DEFAULT_MODEL_REPORT = 'gemini-2.5-flash';
const DEFAULT_MODEL_OCR = 'gemini-2.5-flash-lite';

type GeminiCallResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string; httpCode?: number; rawError?: string };

/** 値の中の全ての文字列に含まれる `\n`(エスケープされた改行)を実際の改行に戻す。GAS版callGeminiのunescapeNewlinesと同じ。 */
function unescapeNewlines(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(/\\n/g, '\n');
  if (Array.isArray(value)) return value.map(unescapeNewlines);
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      result[key] = unescapeNewlines(v);
    }
    return result;
  }
  return value;
}

/**
 * Gemini generateContent APIを呼ぶ。GAS版GeminiReport.js callGeminiに対応
 * (思考パートのスキップ・マークダウンのコードフェンス除去・改行アンエスケープ・
 * HTTPステータスコード別の日本語エラーメッセージも含めて完全に同じ挙動にする)。
 */
async function callGemini(
  apiKey: string,
  contentParts: unknown[],
  generationConfig: Record<string, unknown> | null,
  modelName: string,
): Promise<GeminiCallResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
  const payload = {
    contents: [{ parts: contentParts }],
    generationConfig: generationConfig || { responseMimeType: 'application/json' },
  };

  let httpCode: number;
  let responseText: string;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    httpCode = response.status;
    responseText = await response.text();
  } catch (e) {
    return { ok: false, error: `System Error: ${e instanceof Error ? e.message : String(e)}` };
  }

  if (httpCode === 200) {
    try {
      const json = JSON.parse(responseText);
      const candidates = json.candidates;
      if (!Array.isArray(candidates) || candidates.length === 0) {
        return { ok: false, error: 'No candidates returned' };
      }
      const responseParts: Array<{ thought?: boolean; text?: string }> = candidates[0]?.content?.parts ?? [];
      const textPart = responseParts.find((p) => !p.thought) ?? responseParts[0];
      if (!textPart?.text) {
        return { ok: false, error: 'No text part found in response' };
      }
      const cleanText = textPart.text
        .replace(/```json/g, '')
        .replace(/```/g, '')
        .trim();
      const parsed = JSON.parse(cleanText);
      return { ok: true, value: unescapeNewlines(parsed) };
    } catch (_parseError) {
      return { ok: false, error: 'レスポンス解析エラー(サーバー側の問題の可能性があります)' };
    }
  }

  const rawError = responseText.slice(0, 500);
  switch (true) {
    case httpCode === 400:
      return { ok: false, error: 'リクエストが不正です(APIキーを確認してください)', httpCode, rawError };
    case httpCode === 401:
      return { ok: false, error: 'APIキーが無効です(設定を確認してください)', httpCode, rawError };
    case httpCode === 403:
      return {
        ok: false,
        error: 'API呼び出しが許可されていません(QuotaまたはAPI有効化を確認してください)',
        httpCode,
        rawError,
      };
    case httpCode === 429:
      return {
        ok: false,
        error: 'APIのレート制限に達しました。数分〜数時間待ってから再度お試しください。',
        httpCode,
        rawError,
      };
    case httpCode === 500:
      return {
        ok: false,
        error: 'Gemini API側で一時的なエラーが発生しました。数分〜数時間待ってから再度お試しください。',
        httpCode,
        rawError,
      };
    case httpCode === 503:
      return {
        ok: false,
        error:
          'Gemini APIサービスが混み合っており、一時的に利用できません。数分〜数時間待ってから再度お試しください。',
        httpCode,
        rawError,
      };
    case httpCode >= 500:
      return {
        ok: false,
        error: `Gemini APIサーバーエラー(${httpCode})が発生しました。数分〜数時間待ってから再度お試しください。`,
        httpCode,
        rawError,
      };
    default:
      return { ok: false, error: `API呼び出しエラー(${httpCode})`, httpCode, rawError };
  }
}

export interface GeminiAiPortOptions {
  apiKey: string;
  reportModel?: string;
  ocrModel?: string;
}

/** 領収書画像を Gemini の inline_data に載せる形(MIMEタイプとbase64本体)に分けたもの。 */
export interface ParsedImageData {
  mimeType: string;
  data: string;
}

/**
 * 先頭が `data:image/<subtype>` で、パラメータに `;base64` を含むデータURLを拾う。
 * 本体はカンマの後ろ全部。Gemini の inline_data はbase64本体しか受け付けないため、
 * `;base64` の無いデータURL(パーセントエンコードの生バイト)はここで弾く。
 */
const IMAGE_DATA_URL_RE = /^data:(image\/[a-z0-9.+-]+)((?:;[^,;]*)*),/i;
const BASE64_PARAM_RE = /(^|;)base64(;|$)/i;

/** MIMEタイプを読み取れなかったときに使う値。GAS版が固定で送っていたもの。 */
const FALLBACK_IMAGE_MIME = 'image/jpeg';

/** 画像のbase64データURLでない入力を受けたときのエラー文言(OCRは呼ばない)。 */
export const IMAGE_FORMAT_ERROR = '画像の形式が不正です(base64のデータURLではありません)';

/**
 * 領収書画像のデータURL(`data:image/png;base64,....`)を、宣言されたMIMEタイプと
 * base64本体に分ける。
 *
 * 【MIMEタイプを見る理由】GAS版は常に `image/jpeg` として送っていたため、実際にはPNGやHEICの
 * 画像でも JPEG と申告していた。モデル側が申告を信じて復号に失敗すると、読み取り結果が
 * 空になる(画面上は「読み取れませんでした」としか見えない)。
 *
 * 【`data:` で始まるのに画像のbase64でないものは null にする理由】`data:text/plain,...` や
 * `data:image/png,<生バイト>` は inline_data に載せられない。送っても復号に失敗して
 * 「読み取れませんでした」になるだけなので、呼び出し前に形式エラーとして返す。
 *
 * 【`data:` で始まらない値をGAS版と同じに倒す理由】呼び出し側が生のbase64を渡してきた場合。
 * GAS版で通っていた入力を通すため、全体を本体・MIMEタイプは `image/jpeg` として送る。
 */
export function parseImageDataUrl(base64Image: string): ParsedImageData | null {
  if (/^data:/i.test(base64Image)) {
    const match = IMAGE_DATA_URL_RE.exec(base64Image);
    if (!match?.[0] || !match[1] || !BASE64_PARAM_RE.test(match[2] ?? '')) return null;
    return { mimeType: match[1].toLowerCase(), data: base64Image.slice(match[0].length) };
  }
  return { mimeType: FALLBACK_IMAGE_MIME, data: base64Image };
}

/** GAS版GeminiReport.jsのAPI呼び出しロジックを実装するReportAiPort。GEMINI_API_KEYが設定されている場合に使う。 */
export class GeminiAiPort implements ReportAiPort {
  constructor(private readonly options: GeminiAiPortOptions) {}

  /** 保育日報の下書きを生成する。GAS版 GeminiReport.js generateReport に対応。 */
  async generateDailyReport(input: GenerateDailyReportInput): Promise<DailyReportDraft> {
    const schema = {
      type: 'OBJECT',
      properties: {
        warnings: { type: 'ARRAY', items: { type: 'STRING' } },
        internal: { type: 'STRING' },
        customer: { type: 'STRING' },
      },
      required: ['warnings', 'internal', 'customer'],
    };

    const result = await callGemini(
      this.options.apiKey,
      [{ text: input.prompt }],
      { responseMimeType: 'application/json', responseSchema: schema },
      this.options.reportModel || DEFAULT_MODEL_REPORT,
    );

    if (!result.ok) {
      const detail = result.rawError ? `${result.error}\n\n[詳細] ${result.rawError}` : result.error;
      return { warnings: ['API Error'], internal: detail, customer: '' };
    }
    return result.value as DailyReportDraft;
  }

  /** 事故報告/ヒヤリハットの下書きを生成する。GAS版 GeminiReport.js generateAccidentReport に対応。 */
  async generateAccidentReport(
    input: GenerateAccidentReportInput,
  ): Promise<AccidentReportDraft | AccidentReportDraftError> {
    const schema = {
      type: 'OBJECT',
      properties: {
        occurrenceTime: { type: 'STRING' },
        location: { type: 'STRING' },
        accidentContent: { type: 'STRING' },
        situation: { type: 'STRING' },
        immediateResponse: { type: 'STRING' },
        parentCorrespondence: { type: 'STRING' },
        diagnosisTreatment: { type: 'STRING' },
        prevention: { type: 'STRING' },
      },
      required: [
        'occurrenceTime',
        'location',
        'accidentContent',
        'situation',
        'immediateResponse',
        'parentCorrespondence',
        'diagnosisTreatment',
        'prevention',
      ],
    };

    const result = await callGemini(
      this.options.apiKey,
      [{ text: input.prompt }],
      { responseMimeType: 'application/json', responseSchema: schema },
      this.options.reportModel || DEFAULT_MODEL_REPORT,
    );

    if (!result.ok) return { error: result.error };
    return result.value as AccidentReportDraft;
  }

  /** 領収書画像から金額・店名・日時を読み取る。GAS版 GeminiReport.js extractAmountFromImage に対応。 */
  async extractReceiptAmount(input: ExtractReceiptAmountInput): Promise<ReceiptOcrResult> {
    const image = parseImageDataUrl(input.base64Image);
    if (!image) {
      return { amount: '', storeName: '', receiptDate: '', error: IMAGE_FORMAT_ERROR };
    }
    const result = await callGemini(
      this.options.apiKey,
      [{ text: input.prompt }, { inline_data: { mime_type: image.mimeType, data: image.data } }],
      null,
      this.options.ocrModel || DEFAULT_MODEL_OCR,
    );

    if (!result.ok) return { amount: '', storeName: '', receiptDate: '', error: result.error };
    return result.value as ReceiptOcrResult;
  }
}

/** GEMINI_API_KEY未設定時のフォールバック。GAS版のapiKey未設定時の挙動と同じ値を返す。 */
export class NoopReportAiPort implements ReportAiPort {
  /** APIキーが無いので生成せず、GAS版と同じ「API Key Missing」を返す。 */
  async generateDailyReport(): Promise<DailyReportDraft> {
    return { warnings: ['API Key Missing'], internal: 'Error: API Key not set', customer: '' };
  }

  /** 同上。事故報告も生成せずエラーだけを返す。 */
  async generateAccidentReport(): Promise<AccidentReportDraftError> {
    return { error: 'API Key Missing' };
  }

  /** 同上。OCRも行わず空の読み取り結果とエラーを返す。 */
  async extractReceiptAmount(): Promise<ReceiptOcrResult> {
    return { amount: '', storeName: '', receiptDate: '', error: 'API Key Missing' };
  }
}
