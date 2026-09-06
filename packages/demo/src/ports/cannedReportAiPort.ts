import type {
  AccidentReportDraft,
  AccidentReportDraftError,
  DailyReportDraft,
  GenerateAccidentReportInput,
  GenerateDailyReportInput,
  ReceiptOcrResult,
  ReportAiPort,
} from '@katahimo/core/ports';

/** 生成中であることが伝わる程度の待ち時間。即返しだと「本当に動いたのか」が分からない。 */
const FAKE_LATENCY_MS = 900;

const DEMO_NOTICE =
  '【デモ】このテキストは定型応答です。管理者設定でGemini APIキーを登録すると実際に生成されます。';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 入力メモから、日報らしく整えるための素材を拾う。 */
function summarize(text: string): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return '特記事項なし';
  return cleaned.length > 120 ? `${cleaned.slice(0, 120)}…` : cleaned;
}

function timeRange(start?: string, end?: string): string {
  if (start && end) return `${start}〜${end}`;
  return '訪問時間の記録なし';
}

/**
 * ReportAiPortのデモ実装。Gemini APIキーが設定されていないときのフォールバック。
 *
 * 本番のNoopReportAiPortは「APIキーが未設定です」と返すだけで、公開デモとしては
 * 何も見えない。ここでは入力メモを実際に使った定型文を返し、画面遷移と編集フローを
 * 一通り体験できるようにする。AIが書いたように見せかけないよう、必ず断り書きを含める。
 */
export class CannedReportAiPort implements ReportAiPort {
  async generateDailyReport(input: GenerateDailyReportInput): Promise<DailyReportDraft> {
    await delay(FAKE_LATENCY_MS);
    const summary = summarize(input.text);
    return {
      warnings: [DEMO_NOTICE],
      internal: [
        `【訪問時間】${timeRange(input.start, input.end)}`,
        `【支援者の記録】${summary}`,
        '【所見】お子さまの様子は落ち着いており、前回からの大きな変化は見られませんでした。',
        '【次回に向けて】ご家族から共有のあった内容を、次回訪問時に継続して確認します。',
      ].join('\n'),
      customer: [
        `本日は${timeRange(input.start, input.end)}でご訪問させていただきました。`,
        `${summary}`,
        'お子さまは終始落ち着いて過ごされていました。次回もどうぞよろしくお願いいたします。',
      ].join('\n'),
    };
  }

  async generateAccidentReport(
    input: GenerateAccidentReportInput,
  ): Promise<AccidentReportDraft | AccidentReportDraftError> {
    await delay(FAKE_LATENCY_MS);
    const summary = summarize(input.text);
    return {
      occurrenceTime: input.start ?? '',
      location: '訪問先ご自宅内',
      accidentContent: `${summary}(${DEMO_NOTICE})`,
      situation: '室内で活動中に発生しました。周囲に他のお子さまはいませんでした。',
      immediateResponse: '直ちに状態を確認し、患部を冷却したうえで安静にしていただきました。',
      parentCorrespondence: '保護者の方へその場で状況をご説明し、ご了承をいただきました。',
      diagnosisTreatment: '外傷は見られず、受診は不要と判断しました。',
      prevention: '活動前に周囲の環境を確認し、動線上に物を置かないよう徹底します。',
    };
  }

  async extractReceiptAmount(_base64Image: string): Promise<ReceiptOcrResult> {
    await delay(FAKE_LATENCY_MS);
    // 読み取れなかった扱いにして手入力へ誘導する。もっともらしい金額を捏造すると、
    // デモを見た人が「OCRの精度がこの程度」と誤解しかねない。
    return {
      amount: '',
      storeName: '',
      receiptDate: '',
      error: DEMO_NOTICE,
    };
  }
}
