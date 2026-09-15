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
import type { ReportKeywordInput } from '../ports/reportAiRepositories';
import { savePromptTemplate } from './promptTemplates';
import type { ReportAiDeps } from './reportAi';
import { extractReceiptAmount, generateAccidentReportDraft, generateDailyReportDraft } from './reportAi';
import {
  FakeCustomerReportProfileRepository,
  FakeReportAiConfigRepository,
  FakeReportAiGenerationRepository,
} from './reportAiTestDoubles';
import {
  FakeAppSettingsRepository,
  FakeCryptoPort,
  FakeFamilyMemberRepository,
  FakePromptTemplateRepository,
} from './testDoubles';

/** 受け取った入力をそのまま覚えるだけのアダプタ。何がGeminiへ渡るのかを見るために使う。 */
class RecordingReportAiPort implements ReportAiPort {
  readonly reportModel = 'test-model';
  daily: GenerateDailyReportInput | null = null;
  accident: GenerateAccidentReportInput | null = null;
  ocr: ExtractReceiptAmountInput | null = null;
  /** 次の generateDailyReport が返す下書き。テストごとに差し替える。 */
  nextDraft: DailyReportDraft = { warnings: [], internal: '', customer: '', usedKeywords: [] };

  async generateDailyReport(input: GenerateDailyReportInput): Promise<DailyReportDraft> {
    this.daily = input;
    return this.nextDraft;
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

const tenantId = 'tenant-1';
const staffId = 'staff-1';
const customerId = 'customer-1';

/** テスト用のキーワード1件。省略した列はプロンプトに出ない値で埋める。 */
function keywordInput(
  over: Partial<ReportKeywordInput> & Pick<ReportKeywordInput, 'code'>,
): ReportKeywordInput {
  return {
    category: '',
    name: over.code,
    subConcept: '',
    ageFromMonths: 0,
    ageToMonths: 144,
    educationLevelMin: 1,
    educationLevelMax: 5,
    stressLevelMin: 1,
    tone: '',
    parentExplanation: '',
    phraseExamples: '',
    usageScene: '',
    ngExample: '',
    sortOrder: 0,
    active: true,
    ageBandCodes: [],
    ...over,
  };
}

/**
 * 文面を持つのはアダプタではなくユースケース、という境界を固定する。
 * ここが崩れると、テナントが管理画面で編集した文面が使われないまま生成が走る
 * (しかも出力はそれらしく出るので気付けない)。
 */
describe('AI生成に渡すプロンプト', () => {
  let deps: ReportAiDeps;
  let port: RecordingReportAiPort;
  let reportAiConfig: FakeReportAiConfigRepository;
  let customerReportProfiles: FakeCustomerReportProfileRepository;
  let reportAiGenerations: FakeReportAiGenerationRepository;
  let familyMembers: FakeFamilyMemberRepository;

  beforeEach(() => {
    port = new RecordingReportAiPort();
    reportAiConfig = new FakeReportAiConfigRepository();
    customerReportProfiles = new FakeCustomerReportProfileRepository();
    reportAiGenerations = new FakeReportAiGenerationRepository();
    familyMembers = new FakeFamilyMemberRepository();
    deps = {
      reportAi: port,
      appSettings: new FakeAppSettingsRepository(),
      crypto: new FakeCryptoPort(),
      reportAiFactory: { create: () => port },
      promptTemplates: new FakePromptTemplateRepository(),
      reportAiConfig,
      customerReportProfiles,
      reportAiGenerations,
      familyMembers,
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
      customerId,
      staffId,
    });

    expect(port.daily?.prompt).toBe('メモ: 公園で砂遊びをしました / 時間: 10:00〜13:00');
    // 定型応答(公開デモ)が素材として使うので、メモ本体もそのまま渡す。
    expect(port.daily?.text).toBe('公園で砂遊びをしました');
    expect(port.daily?.start).toBe('10:00');
    expect(port.daily?.end).toBe('13:00');
  });

  it('テナントが表を1行も入れていなければ、既定文面がGAS版と同じ形で渡る', async () => {
    await generateDailyReportDraft(deps, tenantId, {
      text: 'お昼寝のあと絵本を読みました',
      start: '09:30',
      end: '12:00',
      customerId,
      staffId,
    });

    // 3軸の差し込みは全部空文字になり、余った空行も畳まれる。
    const prompt = port.daily?.prompt ?? '';
    expect(prompt).toContain('お昼寝のあと絵本を読みました');
    expect(prompt).toContain('時間情報: 09:30〜12:00');
    // 差し込み変数は残らない(JSON出力例の波括弧だけが残る)。
    expect(prompt).not.toMatch(/\{(anonymizedText|timeInfo|childContext|keywordGuide|toneGuide)\}/);
    expect(prompt).not.toContain('教育キーワード');
    expect(prompt).not.toContain('対象児の月齢');
    expect(prompt).not.toMatch(/\n{3}/);
    // 既定文面から差し込みの行を抜いたものと一致する(GAS版のプロンプトと同じ形)。
    const expected = DEFAULT_PROMPT_TEMPLATES.daily_report
      .replace('{anonymizedText}', 'お昼寝のあと絵本を読みました')
      .replace('{timeInfo}', '09:30〜12:00')
      .replace('{keywordGuide}\n', '')
      .replace('{toneGuide}\n', '')
      .replace('{childContext}\n', '')
      .replace(/\n{3,}/g, '\n\n');
    expect(prompt).toBe(expected);
  });

  it('日報は開始か終了が欠けると「時間指定なし」(GAS版と同じ)', async () => {
    await savePromptTemplate(deps, tenantId, staffId, {
      key: 'daily_report',
      body: '{timeInfo}|{anonymizedText}',
    });

    await generateDailyReportDraft(deps, tenantId, { text: 'メモ', start: '10:00', customerId, staffId });
    expect(port.daily?.prompt).toBe('時間指定なし|メモ');

    await generateDailyReportDraft(deps, tenantId, { text: 'メモ', customerId, staffId });
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

  it('事故報告もテナントの版が無ければ既定文面で組み立てる(3軸は使わない)', async () => {
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

describe('3軸を適用した生成と、その記録', () => {
  let deps: ReportAiDeps;
  let port: RecordingReportAiPort;
  let reportAiConfig: FakeReportAiConfigRepository;
  let customerReportProfiles: FakeCustomerReportProfileRepository;
  let reportAiGenerations: FakeReportAiGenerationRepository;
  let familyMembers: FakeFamilyMemberRepository;

  beforeEach(async () => {
    port = new RecordingReportAiPort();
    reportAiConfig = new FakeReportAiConfigRepository();
    customerReportProfiles = new FakeCustomerReportProfileRepository();
    reportAiGenerations = new FakeReportAiGenerationRepository();
    familyMembers = new FakeFamilyMemberRepository();
    deps = {
      reportAi: port,
      appSettings: new FakeAppSettingsRepository(),
      crypto: new FakeCryptoPort(),
      reportAiFactory: { create: () => port },
      promptTemplates: new FakePromptTemplateRepository(),
      reportAiConfig,
      customerReportProfiles,
      reportAiGenerations,
      familyMembers,
    };

    await reportAiConfig.upsertEducationLevel(tenantId, {
      level: 4,
      label: '★4',
      description: '',
      promptInstruction: '',
      maxKeywords: 2,
      allowTermNames: true,
    });
    await reportAiConfig.upsertStressLevel(tenantId, {
      level: 4,
      label: '通常',
      criteria: '',
      promptInstruction: '',
      educationLevelShift: 0,
      keywordsEnabled: true,
      escalationRequired: false,
    });
    await reportAiConfig.upsertStressLevel(tenantId, {
      level: 1,
      label: '緊急',
      criteria: '',
      promptInstruction: '',
      educationLevelShift: -4,
      keywordsEnabled: false,
      escalationRequired: true,
    });
    await reportAiConfig.upsertKeyword(tenantId, keywordInput({ code: 'K01', name: '見守る' }));
    await customerReportProfiles.upsert(tenantId, customerId, {
      educationLevel: 4,
      note: '',
      updatedByStaffId: staffId,
    });
    await familyMembers.createMany([
      {
        tenantId,
        customerId,
        name: '太郎',
        dobDate: '2025-01-15',
        dobRaw: '2025-01-15',
        info: '',
        allergyStatus: 'unknown',
        allergyNote: null,
      },
      {
        tenantId,
        customerId: 'customer-2',
        name: 'よその子',
        dobDate: '2025-01-15',
        dobRaw: '2025-01-15',
        info: '',
        allergyStatus: 'unknown',
        allergyNote: null,
      },
    ]);
  });

  async function targetMemberId(): Promise<string> {
    const members = await familyMembers.listByCustomerId(tenantId, customerId);
    const member = members[0];
    if (!member) throw new Error('テストの前提が崩れています');
    return member.id;
  }

  it('候補を提示し、AIが使った語と一緒に記録する', async () => {
    port.nextDraft = { warnings: [], internal: '社内', customer: '保護者', usedKeywords: ['K01', 'K99'] };
    const memberId = await targetMemberId();

    const result = await generateDailyReportDraft(deps, tenantId, {
      text: 'メモ',
      customerId,
      familyMemberId: memberId,
      stressLevel: 4,
      reportDate: '2026-02-15',
      staffId,
    });

    expect(port.daily?.keywordCodes).toEqual(['K01']);
    // 表に無いコード(AIが創作した語)も、AIが何と答えたかとして画面へは返す。
    expect(result.usedKeywords).toEqual(['K01', 'K99']);
    expect(result.childAgeMonths).toBe(13);
    expect(result.effectiveEducationLevel).toBe(4);
    expect(result.escalationRequired).toBe(false);

    const rows = reportAiGenerations.listForTest(tenantId);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.id).toBe(result.generationId);
    expect(row?.staffId).toBe(staffId);
    expect(row?.targetFamilyMemberId).toBe(memberId);
    expect(row?.childAgeMonths).toBe(13);
    expect(row?.educationLevel).toBe(4);
    expect(row?.effectiveEducationLevel).toBe(4);
    expect(row?.stressLevel).toBe(4);
    expect(row?.model).toBe('test-model');
    // 既定文面で生成したので、文面の版は無い。
    expect(row?.promptTemplateId).toBeNull();
    expect(row?.candidateKeywordIds).toHaveLength(1);
    // 表に無いコードは記録に残せない(語の行を参照するため)。
    expect(row?.usedKeywordIds).toHaveLength(1);
    expect(row?.errorMessage).toBeNull();
    expect(row?.outputJson).toEqual(port.nextDraft);
  });

  it('ストレス度が未評価なら候補は空で、記録にも null が残る', async () => {
    const memberId = await targetMemberId();

    const result = await generateDailyReportDraft(deps, tenantId, {
      text: 'メモ',
      customerId,
      familyMemberId: memberId,
      stressLevel: null,
      reportDate: '2026-02-15',
      staffId,
    });

    expect(port.daily?.keywordCodes).toEqual([]);
    expect(port.daily?.prompt).toContain('教育キーワード(専門用語・発達の意味づけ)を使わないでください');
    expect(result.escalationRequired).toBe(false);
    // 教育語を使っていないので、適用した★も残さない。
    expect(result.effectiveEducationLevel).toBeNull();

    const row = reportAiGenerations.listForTest(tenantId)[0];
    expect(row?.stressLevel).toBeNull();
    expect(row?.effectiveEducationLevel).toBeNull();
    expect(row?.candidateKeywordIds).toEqual([]);
  });

  it('対象児が未選択なら月齢は記録しない(DBのCHECKに合わせる)', async () => {
    const result = await generateDailyReportDraft(deps, tenantId, {
      text: 'メモ',
      customerId,
      stressLevel: 4,
      staffId,
    });

    expect(result.childAgeMonths).toBeNull();
    const row = reportAiGenerations.listForTest(tenantId)[0];
    expect(row?.targetFamilyMemberId).toBeNull();
    expect(row?.childAgeMonths).toBeNull();
  });

  it('別の顧客の子を対象児に指定したら生成せずに止める', async () => {
    const others = await familyMembers.listByCustomerId(tenantId, 'customer-2');
    await expect(
      generateDailyReportDraft(deps, tenantId, {
        text: 'メモ',
        customerId,
        familyMemberId: others[0]?.id ?? '',
        stressLevel: 4,
        staffId,
      }),
    ).rejects.toThrow('対象児が見つかりません');
    expect(port.daily).toBeNull();
    expect(reportAiGenerations.listForTest(tenantId)).toEqual([]);
  });

  it('生成に失敗したら errorMessage で記録し、outputJson は残さない', async () => {
    port.nextDraft = {
      warnings: ['API Key Missing'],
      internal: 'Error: API Key not set',
      customer: '',
      usedKeywords: [],
      error: 'API Key Missing',
    };

    const result = await generateDailyReportDraft(deps, tenantId, {
      text: 'メモ',
      customerId,
      stressLevel: 4,
      staffId,
    });

    // GAS版と同じく例外にはせず、warnings に詰めた同じ形で返す。
    expect(result.warnings).toEqual(['API Key Missing']);
    const row = reportAiGenerations.listForTest(tenantId)[0];
    expect(row?.errorMessage).toBe('API Key Missing');
    expect(row?.outputJson).toBeNull();
  });

  it('管理者連絡が要るときは、AIが警告を落としても画面に出す', async () => {
    port.nextDraft = { warnings: [], internal: '', customer: '', usedKeywords: [] };

    const result = await generateDailyReportDraft(deps, tenantId, {
      text: 'メモ',
      customerId,
      stressLevel: 1,
      staffId,
    });

    expect(result.escalationRequired).toBe(true);
    expect(result.warnings.some((w) => w.includes('管理者へ連絡'))).toBe(true);
  });

  it('記録に失敗しても生成結果は返す(generationId だけ null)', async () => {
    reportAiGenerations.create = async () => {
      throw new Error('記録に失敗');
    };
    port.nextDraft = { warnings: [], internal: '社内', customer: '保護者', usedKeywords: [] };

    const result = await generateDailyReportDraft(deps, tenantId, {
      text: 'メモ',
      customerId,
      stressLevel: 4,
      staffId,
    });

    expect(result.internal).toBe('社内');
    expect(result.generationId).toBeNull();
  });
});
