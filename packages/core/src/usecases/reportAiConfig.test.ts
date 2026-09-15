import { beforeEach, describe, expect, it } from 'vitest';
import {
  deleteAgeBand,
  getCustomerReportProfile,
  getReportAiConfigForAdmin,
  getReportAiLevelsForStaff,
  importReportAiConfig,
  type ReportAiConfigDeps,
  replacePhrases,
  saveAgeBand,
  saveCustomerReportProfile,
  saveEducationLevel,
  saveKeyword,
  saveStressLevel,
} from './reportAiConfig';
import { FakeCustomerReportProfileRepository, FakeReportAiConfigRepository } from './reportAiTestDoubles';
import { FakePromptTemplateRepository } from './testDoubles';

const TENANT = 'tenant-1';
const OTHER_TENANT = 'tenant-2';

/** 年齢帯1件ぶんの入力。テストで変えたいところだけ上書きする。 */
function ageBand(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    code: 'm0_6',
    label: '0〜6ヶ月',
    ageFromMonths: 0,
    ageToMonths: 6,
    behaviorWords: 'ずり這い',
    developmentTopics: '首すわり',
    sceneExamples: '授乳',
    sortOrder: 1,
    ...overrides,
  };
}

function keyword(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    code: 'K01',
    category: '非認知能力',
    name: '敏感期',
    subConcept: '',
    ageFromMonths: 0,
    ageToMonths: 36,
    educationLevelMin: 2,
    educationLevelMax: 5,
    stressLevelMin: 3,
    tone: '意味づけ',
    parentExplanation: '今だけ夢中になる時期',
    phraseExamples: '',
    usageScene: '',
    ngExample: '',
    sortOrder: 1,
    active: true,
    ageBandCodes: [] as string[],
    ...overrides,
  };
}

interface Fixture extends ReportAiConfigDeps {
  reportAiConfig: FakeReportAiConfigRepository;
  customerReportProfiles: FakeCustomerReportProfileRepository;
  promptTemplates: FakePromptTemplateRepository;
}

function createDeps(): Fixture {
  return {
    reportAiConfig: new FakeReportAiConfigRepository(),
    customerReportProfiles: new FakeCustomerReportProfileRepository(),
    promptTemplates: new FakePromptTemplateRepository(),
  };
}

describe('年齢帯', () => {
  let deps: Fixture;
  beforeEach(() => {
    deps = createDeps();
  });

  it('隣り合う帯は上限と下限が同じ値ならつながる(上限は範囲に含まない)', async () => {
    await saveAgeBand(deps, TENANT, ageBand());
    await saveAgeBand(
      deps,
      TENANT,
      ageBand({ code: 'm6_12', label: '6〜12ヶ月', ageFromMonths: 6, ageToMonths: 12 }),
    );
    expect(deps.reportAiConfig.listAgeBandsForTest(TENANT)).toHaveLength(2);
  });

  it('月齢が重なる帯は保存できない', async () => {
    await saveAgeBand(deps, TENANT, ageBand());
    await expect(
      saveAgeBand(
        deps,
        TENANT,
        ageBand({ code: 'm3_9', label: '3〜9ヶ月', ageFromMonths: 3, ageToMonths: 9 }),
      ),
    ).rejects.toThrow(/重なっています/);
    expect(deps.reportAiConfig.listAgeBandsForTest(TENANT)).toHaveLength(1);
  });

  it('同じコードの帯は上書きなので、自分自身とは重ならない', async () => {
    await saveAgeBand(deps, TENANT, ageBand());
    const updated = await saveAgeBand(deps, TENANT, ageBand({ label: '0〜3ヶ月', ageToMonths: 3 }));
    expect(updated).toMatchObject({ code: 'm0_6', ageToMonths: 3 });
    expect(deps.reportAiConfig.listAgeBandsForTest(TENANT)).toHaveLength(1);
  });

  it('上限が下限以下の帯は弾く(DBのCHECK制約と同じ判定)', async () => {
    await expect(saveAgeBand(deps, TENANT, ageBand({ ageFromMonths: 6, ageToMonths: 6 }))).rejects.toThrow(
      /年齢帯の入力が正しくありません/,
    );
  });

  it('別テナントの帯とは重なりを見ない', async () => {
    await saveAgeBand(deps, OTHER_TENANT, ageBand());
    await expect(
      saveAgeBand(deps, TENANT, ageBand({ code: 'm3_9', ageFromMonths: 3, ageToMonths: 9 })),
    ).resolves.toBeDefined();
  });

  it('消すと対応表の行も一緒に消える。無いコードは false', async () => {
    await saveAgeBand(deps, TENANT, ageBand());
    await saveKeyword(deps, TENANT, keyword({ ageBandCodes: ['m0_6'] }));
    expect(deps.reportAiConfig.ageBandCodesForTest(TENANT, 'K01')).toEqual(['m0_6']);

    expect(await deleteAgeBand(deps, TENANT, 'm0_6')).toBe(true);
    expect(await deleteAgeBand(deps, TENANT, 'm0_6')).toBe(false);
    expect(deps.reportAiConfig.ageBandCodesForTest(TENANT, 'K01')).toEqual([]);
  });
});

describe('キーワード', () => {
  let deps: Fixture;
  beforeEach(async () => {
    deps = createDeps();
    await saveAgeBand(deps, TENANT, ageBand());
    await saveAgeBand(
      deps,
      TENANT,
      ageBand({ code: 'y1', label: '1歳', ageFromMonths: 12, ageToMonths: 24 }),
    );
  });

  it('保存のたびに相性の良い年齢帯の対応を入れ替える', async () => {
    const saved = await saveKeyword(deps, TENANT, keyword({ ageBandCodes: ['m0_6', 'y1'] }));
    expect(saved.ageBandCodes).toEqual(['m0_6', 'y1']);

    await saveKeyword(deps, TENANT, keyword({ ageBandCodes: ['y1'] }));
    expect(deps.reportAiConfig.ageBandCodesForTest(TENANT, 'K01')).toEqual(['y1']);
  });

  it('登録の無い年齢帯コードはエラーにする(黙って落とさない)', async () => {
    await expect(saveKeyword(deps, TENANT, keyword({ ageBandCodes: ['y9'] }))).rejects.toThrow(
      /年齢帯コード y9 は登録されていません/,
    );
  });

  it('教育関心度★の上限が下限を下回る行は弾く', async () => {
    await expect(
      saveKeyword(deps, TENANT, keyword({ educationLevelMin: 4, educationLevelMax: 2 })),
    ).rejects.toThrow(/キーワードの入力が正しくありません/);
  });

  it('廃止(active=false)にした語も一覧には残る(生成記録が参照するため消さない)', async () => {
    await saveKeyword(deps, TENANT, keyword());
    await saveKeyword(deps, TENANT, keyword({ active: false }));
    const config = await getReportAiConfigForAdmin(deps, TENANT);
    expect(config.keywords).toHaveLength(1);
    expect(config.keywords[0]).toMatchObject({ code: 'K01', active: false });
  });
});

describe('レベル定義と表現', () => {
  let deps: Fixture;
  beforeEach(() => {
    deps = createDeps();
  });

  it('レベルで upsert し、スタッフ向けには行のあるレベルだけ返す', async () => {
    await saveEducationLevel(deps, TENANT, {
      level: 2,
      label: '標準',
      description: '一般的な家庭',
      promptInstruction: '',
      maxKeywords: 1,
      allowTermNames: false,
    });
    await saveEducationLevel(deps, TENANT, {
      level: 2,
      label: '標準(改)',
      description: '一般的な家庭',
      promptInstruction: '',
      maxKeywords: 2,
      allowTermNames: true,
    });
    await saveStressLevel(deps, TENANT, {
      level: 1,
      label: '危険・緊急',
      criteria: '表情が乏しい',
      promptInstruction: '',
      educationLevelShift: -4,
      keywordsEnabled: false,
      escalationRequired: true,
    });

    const levels = await getReportAiLevelsForStaff(deps, TENANT);
    expect(levels.educationLevels).toEqual([{ level: 2, label: '標準(改)', description: '一般的な家庭' }]);
    expect(levels.stressLevels).toEqual([{ level: 1, label: '危険・緊急', criteria: '表情が乏しい' }]);
  });

  it('★を上げる方向の引き下げ幅(正の値)は弾く', async () => {
    await expect(
      saveStressLevel(deps, TENANT, {
        level: 3,
        label: '要観察',
        criteria: '',
        promptInstruction: '',
        educationLevelShift: 1,
        keywordsEnabled: true,
        escalationRequired: false,
      }),
    ).rejects.toThrow(/ストレス度の判定基準の入力が正しくありません/);
  });

  it('表現は全件入れ替え', async () => {
    await replacePhrases(deps, TENANT, [
      {
        kind: 'encourage',
        body: 'いつもよく見ていらっしゃいますね',
        intent: 'ねぎらい',
        placement: 'closing',
      },
      { kind: 'avoid', body: '〜してあげてください', intent: '指示口調' },
    ]);
    await replacePhrases(deps, TENANT, [{ kind: 'avoid', body: '〜してあげてください', intent: '指示口調' }]);

    const config = await getReportAiConfigForAdmin(deps, TENANT);
    expect(config.phrases).toHaveLength(1);
    expect(config.phrases[0]).toMatchObject({
      kind: 'avoid',
      stressLevelMin: 1,
      stressLevelMax: 5,
      active: true,
    });
  });
});

describe('取込', () => {
  let deps: Fixture;
  beforeEach(() => {
    deps = createDeps();
  });

  const payload = {
    ageBands: [ageBand(), ageBand({ code: 'y1', label: '1歳', ageFromMonths: 12, ageToMonths: 24 })],
    keywords: [keyword({ ageBandCodes: ['y1'] })],
    educationLevels: [{ level: 2, label: '標準', maxKeywords: 1, allowTermNames: false }],
    stressLevels: [{ level: 1, label: '危険・緊急', criteria: '表情が乏しい', educationLevelShift: -4 }],
    phrases: [{ kind: 'encourage' as const, body: 'よく見ていらっしゃいますね' }],
    promptTemplates: [{ key: 'daily_report' as const, body: '日報を書いてください {anonymizedText}' }],
  };

  it('年齢帯→レベル→キーワード→表現→文面の順で反映し、件数を返す', async () => {
    const result = await importReportAiConfig(deps, TENANT, payload, { staffId: 'staff-1' });
    expect(result).toEqual({
      ageBands: 2,
      keywords: 1,
      educationLevels: 1,
      stressLevels: 1,
      phrases: 1,
      promptTemplates: 1,
    });

    // 同じ取込データの中の年齢帯コードを、キーワードが参照できている。
    expect(deps.reportAiConfig.ageBandCodesForTest(TENANT, 'K01')).toEqual(['y1']);
    expect((await deps.promptTemplates.findLatest(TENANT, 'daily_report'))?.note).toBe('取込');
  });

  it('同じ資料を2回取り込んでも文面の版は増えない', async () => {
    await importReportAiConfig(deps, TENANT, payload, { staffId: null });
    const second = await importReportAiConfig(deps, TENANT, payload, { staffId: null });
    expect(second.promptTemplates).toBe(0);
    expect(await deps.promptTemplates.listVersions(TENANT, 'daily_report')).toHaveLength(1);
  });

  it('表現は入れ替えずに足す(同じ kind+body は更新)', async () => {
    await importReportAiConfig(deps, TENANT, payload, { staffId: null });
    await importReportAiConfig(
      deps,
      TENANT,
      {
        ...payload,
        phrases: [
          { kind: 'encourage' as const, body: 'よく見ていらっしゃいますね', intent: '更新後の意図' },
          { kind: 'avoid' as const, body: '〜してあげてください' },
        ],
      },
      { staffId: null },
    );

    const phrases = deps.reportAiConfig.listPhrasesForTest(TENANT);
    expect(phrases).toHaveLength(2);
    expect(phrases.find((p) => p.kind === 'encourage')?.intent).toBe('更新後の意図');
  });

  it('既存の帯と重なる年齢帯を含む取込は、1行も反映せずに落とす', async () => {
    await saveAgeBand(
      deps,
      TENANT,
      ageBand({ code: 'm0_12', label: '0〜12ヶ月', ageFromMonths: 0, ageToMonths: 12 }),
    );
    await expect(importReportAiConfig(deps, TENANT, payload, { staffId: null })).rejects.toThrow(
      /重なっています/,
    );
    expect(deps.reportAiConfig.listAgeBandsForTest(TENANT)).toHaveLength(1);
    expect(await deps.promptTemplates.findLatest(TENANT, 'daily_report')).toBeNull();
  });

  it('取込データに無い年齢帯コードを参照するキーワードは取込全体を落とす', async () => {
    await expect(
      importReportAiConfig(
        deps,
        TENANT,
        { ...payload, keywords: [keyword({ ageBandCodes: ['y9'] })] },
        {
          staffId: null,
        },
      ),
    ).rejects.toThrow(/年齢帯コード y9 は登録されていません/);
    expect(deps.reportAiConfig.listAgeBandsForTest(TENANT)).toHaveLength(0);
  });
});

describe('家庭ごとの設定', () => {
  let deps: Fixture;
  beforeEach(() => {
    deps = createDeps();
  });

  it('★とメモを保存し、更新者を残す', async () => {
    expect(await getCustomerReportProfile(deps, TENANT, 'customer-1')).toBeNull();

    const saved = await saveCustomerReportProfile(
      deps,
      TENANT,
      'customer-1',
      { educationLevel: 4, note: 'モンテッソーリに関心' },
      'staff-1',
    );
    expect(saved).toEqual({ educationLevel: 4, note: 'モンテッソーリに関心' });
    expect((await deps.customerReportProfiles.find(TENANT, 'customer-1'))?.updatedByStaffId).toBe('staff-1');
  });

  it('★は null(未設定に戻す)を許し、範囲外は弾く', async () => {
    await saveCustomerReportProfile(deps, TENANT, 'customer-1', { educationLevel: 4, note: '' }, null);
    const cleared = await saveCustomerReportProfile(
      deps,
      TENANT,
      'customer-1',
      { educationLevel: null, note: '' },
      null,
    );
    expect(cleared.educationLevel).toBeNull();

    await expect(
      saveCustomerReportProfile(deps, TENANT, 'customer-1', { educationLevel: 6, note: '' }, null),
    ).rejects.toThrow(/家庭ごとの日報設定の入力が正しくありません/);
  });
});
