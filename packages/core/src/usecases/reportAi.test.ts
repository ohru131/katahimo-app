import { DEFAULT_PROMPT_TEMPLATES } from '@katahimo/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import type {
  AccidentReportDraft,
  DailyReportDraft,
  ExtractReceiptAmountInput,
  GenerateAccidentReportInput,
  GenerateDailyReportInput,
  ReceiptOcrResult,
  ReportAiPort,
} from '../ports/ai';
import { savePromptTemplate } from './promptTemplates';
import type { ReportAiDeps } from './reportAi';
import { extractReceiptAmount, generateAccidentReportDraft, generateDailyReportDraft } from './reportAi';
import { FakeAppSettingsRepository, FakeCryptoPort, FakePromptTemplateRepository } from './testDoubles';

/** 受け取った入力をそのまま覚えるだけのアダプタ。何がGeminiへ渡るのかを見るために使う。 */
class RecordingReportAiPort implements ReportAiPort {
  daily: GenerateDailyReportInput | null = null;
  accident: GenerateAccidentReportInput | null = null;
  ocr: ExtractReceiptAmountInput | null = null;

  async generateDailyReport(input: GenerateDailyReportInput): Promise<DailyReportDraft> {
    this.daily = input;
    return { warnings: [], internal: '', customer: '' };
  }

  async generateAccidentReport(input: GenerateAccidentReportInput): Promise<AccidentReportDraft> {
    this.accident = input;
    return {
      occurrenceTime: '',
      location: '',
      accidentContent: '',
      situation: '',
      immediateResponse: '',
      parentCorrespondence: '',
      diagnosisTreatment: '',
      prevention: '',
    };
  }

  async extractReceiptAmount(input: ExtractReceiptAmountInput): Promise<ReceiptOcrResult> {
    this.ocr = input;
    return { amount: '', storeName: '', receiptDate: '' };
  }
}

/**
 * 文面を持つのはアダプタではなくユースケース、という境界を固定する。
 * ここが崩れると、テナントが管理画面で編集した文面が使われないまま生成が走る
 * (しかも出力はそれらしく出るので気付けない)。
 */
describe('AI生成に渡すプロンプト', () => {
  let deps: ReportAiDeps;
  let port: RecordingReportAiPort;
  const tenantId = 'tenant-1';
  const staffId = 'staff-1';

  beforeEach(() => {
    port = new RecordingReportAiPort();
    deps = {
      reportAi: port,
      appSettings: new FakeAppSettingsRepository(),
      crypto: new FakeCryptoPort(),
      reportAiFactory: { create: () => port },
      promptTemplates: new FakePromptTemplateRepository(),
    };
  });

  it('テナントが編集した日報の文面に、メモと時間情報を差し込んで渡す', async () => {
    await savePromptTemplate(deps, tenantId, staffId, {
      key: 'daily_report',
      body: 'メモ: {anonymizedText} / 時間: {timeInfo}',
    });

    await generateDailyReportDraft(deps, tenantId, {
      text: '公園で砂遊びをしました',
      start: '10:00',
      end: '13:00',
    });

    expect(port.daily?.prompt).toBe('メモ: 公園で砂遊びをしました / 時間: 10:00〜13:00');
    // 定型応答(公開デモ)が素材として使うので、メモ本体もそのまま渡す。
    expect(port.daily?.text).toBe('公園で砂遊びをしました');
    expect(port.daily?.start).toBe('10:00');
    expect(port.daily?.end).toBe('13:00');
  });

  it('テナントの版が無ければ既定文面で組み立てる(GAS版と同じ出力)', async () => {
    await generateDailyReportDraft(deps, tenantId, {
      text: 'お昼寝のあと絵本を読みました',
      start: '09:30',
      end: '12:00',
    });

    const expected = DEFAULT_PROMPT_TEMPLATES.daily_report
      .replace('{anonymizedText}', 'お昼寝のあと絵本を読みました')
      .replace('{timeInfo}', '09:30〜12:00');
    expect(port.daily?.prompt).toBe(expected);
  });

  it('3軸の差し込みはまだ組み立てないので空文字にする(文面に書かれていても残さない)', async () => {
    await savePromptTemplate(deps, tenantId, staffId, {
      key: 'daily_report',
      body: '[{childContext}][{keywordGuide}][{toneGuide}]{anonymizedText}',
    });

    await generateDailyReportDraft(deps, tenantId, { text: 'メモ', start: '10:00', end: '11:00' });

    expect(port.daily?.prompt).toBe('[][][]メモ');
  });

  it('日報は開始か終了が欠けると「時間指定なし」(GAS版と同じ)', async () => {
    await savePromptTemplate(deps, tenantId, staffId, {
      key: 'daily_report',
      body: '{timeInfo}|{anonymizedText}',
    });

    await generateDailyReportDraft(deps, tenantId, { text: 'メモ', start: '10:00' });
    expect(port.daily?.prompt).toBe('時間指定なし|メモ');

    await generateDailyReportDraft(deps, tenantId, { text: 'メモ' });
    expect(port.daily?.prompt).toBe('時間指定なし|メモ');
  });

  it('事故報告は開始だけでもその時刻を渡す(発生時刻だけで意味を持つため)', async () => {
    await savePromptTemplate(deps, tenantId, staffId, {
      key: 'accident_report',
      body: '{timeInfo}|{anonymizedText}',
    });

    await generateAccidentReportDraft(deps, tenantId, { text: '転倒', start: '14:05', end: '15:00' });
    expect(port.accident?.prompt).toBe('14:05〜15:00|転倒');

    await generateAccidentReportDraft(deps, tenantId, { text: '転倒', start: '14:05' });
    expect(port.accident?.prompt).toBe('14:05|転倒');

    await generateAccidentReportDraft(deps, tenantId, { text: '転倒' });
    expect(port.accident?.prompt).toBe('時間指定なし|転倒');
  });

  it('事故報告もテナントの版が無ければ既定文面で組み立てる', async () => {
    await generateAccidentReportDraft(deps, tenantId, { text: '転倒して額を切った', start: '14:05' });

    const expected = DEFAULT_PROMPT_TEMPLATES.accident_report
      .replace('{anonymizedText}', '転倒して額を切った')
      .replace('{timeInfo}', '14:05');
    expect(port.accident?.prompt).toBe(expected);
  });

  it('領収書OCRの指示文もテナントの文面→既定文面の順で解決する', async () => {
    await extractReceiptAmount(deps, tenantId, 'data:image/jpeg;base64,AAAA');
    expect(port.ocr?.prompt).toBe(DEFAULT_PROMPT_TEMPLATES.receipt_ocr);
    expect(port.ocr?.base64Image).toBe('data:image/jpeg;base64,AAAA');

    await savePromptTemplate(deps, tenantId, staffId, {
      key: 'receipt_ocr',
      body: 'Read the total amount only.',
    });
    await extractReceiptAmount(deps, tenantId, 'data:image/jpeg;base64,BBBB');
    expect(port.ocr?.prompt).toBe('Read the total amount only.');
  });
});
