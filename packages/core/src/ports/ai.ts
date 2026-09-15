/**
 * 日報/事故報告のAI生成・領収書OCRのポート。
 * GAS版 GeminiReport.js の callGemini/generateReportWithWarnings/generateAccidentReport/
 * extractAmountFromImage に対応する。実装は @katahimo/integrations の gemini アダプタ
 * (Gemini API を実際に呼ぶ)と、APIキー未設定時に使うno-op実装の2種類を想定する。
 *
 * 戻り値の形はGAS版に意図的に合わせている(統一エラー型でラップしていない):
 * - generateDailyReport: 失敗時もエラーにはせず、warnings/internalにエラー内容を詰めた
 *   同じ形のオブジェクトを返す(GAS版generateReportWithWarningsと同じ。呼び出し元UIが
 *   常に同じ形として扱えるようにするための設計)。
 * - generateAccidentReport: 失敗時は{error}を返す(GAS版generateAccidentReportと同じ)。
 * - extractReceiptAmount: 失敗時も空値のフォールバックを返す(領収書登録そのものは
 *   手入力でも成立するため。GAS版extractAmountFromImageと同じ)。ただしGAS版と異なり
 *   `error`にエラー内容を詰める(手入力へのフォールバックは維持しつつ、失敗した事実は
 *   画面に表示するため)。
 */

export interface GenerateDailyReportInput {
  /**
   * 差し込み済みのプロンプト全文。文面の出どころ(テナントが編集した prompt_templates か既定文面か)と
   * 差し込みは usecases 側が決める(usecases/reportAi.ts)。アダプタが文面を持つと、テナントが
   * 管理画面で編集した文面が使われないままになるため、ここでは受け取るだけにする。
   */
  prompt: string;
  /** スタッフが入力したメモ本体。prompt にも差し込み済みで、公開デモの定型応答(packages/demo)が素材として使う。 */
  text: string;
  start?: string;
  end?: string;
}

export interface DailyReportDraft {
  warnings: string[];
  internal: string;
  customer: string;
}

export interface GenerateAccidentReportInput {
  /** 差し込み済みのプロンプト全文(GenerateDailyReportInput.prompt と同じ扱い)。 */
  prompt: string;
  /** スタッフが入力したメモ本体。 */
  text: string;
  start?: string;
  end?: string;
}

export interface AccidentReportDraft {
  occurrenceTime: string;
  location: string;
  accidentContent: string;
  situation: string;
  immediateResponse: string;
  parentCorrespondence: string;
  diagnosisTreatment: string;
  prevention: string;
}

export interface AccidentReportDraftError {
  error: string;
}

export interface ExtractReceiptAmountInput {
  /** 読み取りの指示文(prompt_templates の receipt_ocr か既定文面)。 */
  prompt: string;
  /** data URL 形式の画像。 */
  base64Image: string;
}

export interface ReceiptOcrResult {
  amount: string | number;
  storeName: string;
  /** 'yyyy/MM/dd HH:mm' 形式。読み取れなければ空文字。 */
  receiptDate: string;
  /**
   * OCR呼び出し自体が失敗した場合のエラーメッセージ(GAS版は空値フォールバックのみで
   * エラーを一切伝えていなかったが、失敗時に無言のままなのは不親切なため追加した)。
   * 成功時・APIキー未設定でもエラー扱いにしない場合はundefined。
   */
  error?: string;
}

export interface ReportAiPort {
  /** 組み立て済みプロンプトから保育日報の下書き(警告・社内向け・保護者向け)を作る。失敗も戻り値で表す。 */
  generateDailyReport(input: GenerateDailyReportInput): Promise<DailyReportDraft>;
  /** 組み立て済みプロンプトから事故報告/ヒヤリハットの下書きを作る。失敗は error だけを持つ形で返す。 */
  generateAccidentReport(
    input: GenerateAccidentReportInput,
  ): Promise<AccidentReportDraft | AccidentReportDraftError>;
  /** 領収書画像から金額・店名・日時を読み取る。読み取れなかった項目は空文字。 */
  extractReceiptAmount(input: ExtractReceiptAmountInput): Promise<ReceiptOcrResult>;
}

export interface ReportAiPortOptions {
  apiKey: string;
  reportModel?: string;
  ocrModel?: string;
}

/**
 * テナントが管理者設定画面で独自のGemini APIキーを保存している場合、そのキー/モデルで
 * 都度 ReportAiPort を組み立てるためのファクトリ。usecases/reportAi.ts の
 * resolveReportAiPort が、.env設定のフォールバック(単一インスタンス)とこのファクトリを
 * 使い分ける。
 */
export interface ReportAiPortFactory {
  /** APIキー・モデル名から ReportAiPort を1つ組み立てる。 */
  create(options: ReportAiPortOptions): ReportAiPort;
}
