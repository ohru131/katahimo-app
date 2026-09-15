import { describe, expect, it } from 'vitest';
import {
  ageInMonths,
  applyStressLevel,
  assembleDailyReportPrompt,
  DEFAULT_EDUCATION_LEVEL,
  DEFAULT_STRESS_LEVEL,
  findAgeBand,
  type ReportAgeBand,
  type ReportEducationLevel,
  type ReportKeyword,
  type ReportPhrase,
  type ReportStressLevel,
  renderPromptTemplate,
  selectKeywords,
} from './promptAssembly';

// テスト用の架空データ。実運用のキーワード表・文面はテナントがDBに持つもので、ここには置かない。

function keyword(over: Partial<ReportKeyword> & Pick<ReportKeyword, 'id' | 'code'>): ReportKeyword {
  return {
    category: '',
    name: over.code,
    subConcept: '',
    ageFromMonths: 0,
    ageToMonths: 84,
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
    ...over,
  };
}

const bands: ReportAgeBand[] = [
  {
    id: 'b0',
    code: 'm0_6',
    label: '0〜6ヶ月',
    ageFromMonths: 0,
    ageToMonths: 6,
    behaviorWords: '目が合って笑う',
    developmentTopics: '',
    sceneExamples: '',
    sortOrder: 0,
  },
  {
    id: 'b1',
    code: 'm6_12',
    label: '6〜12ヶ月',
    ageFromMonths: 6,
    ageToMonths: 12,
    behaviorWords: 'ずり這い',
    developmentTopics: '',
    sceneExamples: '',
    sortOrder: 1,
  },
];

const educationLevels: ReportEducationLevel[] = [1, 2, 3, 4, 5].map((level) => ({
  level,
  label: `★${level}`,
  description: '',
  promptInstruction: `★${level}向けの指示`,
  maxKeywords: level <= 1 ? 0 : level <= 3 ? 1 : 2,
  allowTermNames: level >= 4,
}));

const stressLevels: ReportStressLevel[] = [
  {
    level: 5,
    label: '良好',
    criteria: '',
    promptInstruction: '',
    educationLevelShift: 0,
    keywordsEnabled: true,
    escalationRequired: false,
  },
  {
    level: 4,
    label: '通常',
    criteria: '',
    promptInstruction: '',
    educationLevelShift: 0,
    keywordsEnabled: true,
    escalationRequired: false,
  },
  {
    level: 3,
    label: '要観察',
    criteria: '',
    promptInstruction: '控えめに',
    educationLevelShift: -1,
    keywordsEnabled: true,
    escalationRequired: false,
  },
  {
    level: 2,
    label: '注意',
    criteria: '',
    promptInstruction: '',
    educationLevelShift: -4,
    keywordsEnabled: false,
    escalationRequired: false,
  },
  {
    level: 1,
    label: '緊急',
    criteria: '',
    promptInstruction: '',
    educationLevelShift: -4,
    keywordsEnabled: false,
    escalationRequired: true,
  },
];

const phrases: ReportPhrase[] = [
  {
    id: 'p1',
    kind: 'encourage',
    body: 'ゆっくり休めますように',
    intent: '',
    stressLevelMin: 1,
    stressLevelMax: 3,
    placement: 'closing',
    sortOrder: 0,
    active: true,
  },
  {
    id: 'p2',
    kind: 'avoid',
    body: '次回は〜してみましょう',
    intent: '宿題感',
    stressLevelMin: 1,
    stressLevelMax: 5,
    placement: 'any',
    sortOrder: 0,
    active: true,
  },
  {
    id: 'p3',
    kind: 'avoid',
    body: '(無効)',
    intent: '',
    stressLevelMin: 1,
    stressLevelMax: 5,
    placement: 'any',
    sortOrder: 1,
    active: false,
  },
];

describe('ageInMonths', () => {
  it('誕生日の「日」に達していない月は数えない', () => {
    expect(ageInMonths('2026-01-15', '2026-03-14')).toBe(1);
    expect(ageInMonths('2026-01-15', '2026-03-15')).toBe(2);
  });
  it('年をまたいでも満月齢になる', () => {
    expect(ageInMonths('2023-11-30', '2026-02-28')).toBe(26);
  });
  it('不正な形式・生年月日より前の基準日は null', () => {
    expect(ageInMonths('2026/01/15', '2026-03-14')).toBeNull();
    expect(ageInMonths('2026-05-01', '2026-03-14')).toBeNull();
  });
});

describe('findAgeBand', () => {
  it('上限は含まない(6ヶ月ちょうどは次の帯)', () => {
    expect(findAgeBand(bands, 5)?.code).toBe('m0_6');
    expect(findAgeBand(bands, 6)?.code).toBe('m6_12');
    expect(findAgeBand(bands, 12)).toBeNull();
  });
});

describe('applyStressLevel', () => {
  it('定義が無ければ★をそのまま使い、未設定の★は既定値になる', () => {
    expect(applyStressLevel(null, null)).toEqual({
      effectiveEducationLevel: DEFAULT_EDUCATION_LEVEL,
      keywordsEnabled: true,
      escalationRequired: false,
    });
  });
  it('引き下げは★1より下に行かない', () => {
    const rule = stressLevels.find((s) => s.level === 3) ?? null;
    expect(applyStressLevel(1, rule).effectiveEducationLevel).toBe(1);
    expect(applyStressLevel(5, rule).effectiveEducationLevel).toBe(4);
  });
});

describe('selectKeywords', () => {
  const keywords = [
    keyword({
      id: 'k1',
      code: 'K01',
      ageFromMonths: 36,
      ageToMonths: 84,
      educationLevelMin: 4,
      stressLevelMin: 3,
    }),
    keyword({
      id: 'k2',
      code: 'K02',
      ageFromMonths: 0,
      ageToMonths: 84,
      educationLevelMin: 3,
      stressLevelMin: 3,
    }),
    keyword({
      id: 'k3',
      code: 'K03',
      ageFromMonths: 0,
      ageToMonths: 48,
      educationLevelMin: 5,
      stressLevelMin: 4,
    }),
    keyword({ id: 'k4', code: 'K04', active: false }),
  ];

  it('月齢・★・ストレス度の3条件を全部満たす語だけ残る', () => {
    const picked = selectKeywords({
      keywords,
      childAgeMonths: 40,
      effectiveEducationLevel: 4,
      stressLevel: 3,
    });
    expect(picked.map((k) => k.code)).toEqual(['K01', 'K02']);
  });
  it('月齢が範囲外なら落ちる(上限は含まない)', () => {
    const picked = selectKeywords({
      keywords,
      childAgeMonths: 48,
      effectiveEducationLevel: 5,
      stressLevel: 5,
    });
    expect(picked.map((k) => k.code)).toEqual(['K01', 'K02']);
  });
  it('ストレス度が下限未満なら★が高くても落ちる', () => {
    const picked = selectKeywords({
      keywords,
      childAgeMonths: 40,
      effectiveEducationLevel: 5,
      stressLevel: 3,
    });
    expect(picked.map((k) => k.code)).not.toContain('K03');
  });
  it('月齢不明なら月齢では落とさない', () => {
    const picked = selectKeywords({
      keywords,
      childAgeMonths: null,
      effectiveEducationLevel: 5,
      stressLevel: 5,
    });
    expect(picked.map((k) => k.code)).toEqual(['K01', 'K02', 'K03']);
  });
  it('相性の良い語を先頭に寄せ、上限で切る', () => {
    const picked = selectKeywords({
      keywords,
      childAgeMonths: 40,
      effectiveEducationLevel: 5,
      stressLevel: 5,
      affinityKeywordIds: ['k3'],
      maxCandidates: 2,
    });
    expect(picked.map((k) => k.code)).toEqual(['K03', 'K01']);
  });
});

describe('renderPromptTemplate', () => {
  it('同じ差し込みが複数あっても全部置き換え、未知の波括弧は残す', () => {
    const out = renderPromptTemplate('{timeInfo} / {timeInfo} / {"warnings": []} / {childContext}', {
      anonymizedText: '',
      timeInfo: 'T',
      childContext: 'C',
      keywordGuide: '',
      toneGuide: '',
    });
    expect(out).toBe('T / T / {"warnings": []} / C');
  });

  it('差し込んだ値の中の `{timeInfo}` はそのまま残る(二重に置き換えない)', () => {
    // スタッフが「{timeInfo}」という文字列をメモにそのまま書いた場合。差し込んだ値は
    // もう本文の一部なので、後続の差し込みの対象にしてはいけない。
    const out = renderPromptTemplate('{anonymizedText}\n{timeInfo}', {
      anonymizedText: 'メモに {timeInfo} と書かれていた',
      timeInfo: '10:00〜13:00',
      childContext: '',
      keywordGuide: '',
      toneGuide: '',
    });
    expect(out).toBe('メモに {timeInfo} と書かれていた\n10:00〜13:00');
  });
});

describe('assembleDailyReportPrompt', () => {
  const template =
    '# 子\n{childContext}\n# 語\n{keywordGuide}\n# 文体\n{toneGuide}\n# メモ\n{anonymizedText}\n{timeInfo}';
  const keywords = [
    keyword({
      id: 'k1',
      code: 'K01',
      name: '見守る',
      parentExplanation: 'そっと見守る関わり',
      educationLevelMin: 3,
      stressLevelMin: 3,
    }),
    keyword({ id: 'k2', code: 'K02', name: '専門語', educationLevelMin: 5, stressLevelMin: 4 }),
  ];
  const base = {
    template,
    stanceTemplate: '私は〜と感じました、の一人称で書く。',
    anonymizedText: 'メモ本文',
    timeInfo: '10:00〜13:00',
    ageBands: bands,
    ageBandKeywordIds: { b1: ['k1'] },
    keywords,
    educationLevels,
    stressLevels,
    phrases,
  };

  it('★4・ストレス度4なら候補を提示し、用語名の使用を許す', () => {
    const out = assembleDailyReportPrompt({ ...base, childAgeMonths: 8, educationLevel: 4, stressLevel: 4 });
    expect(out.candidates.map((k) => k.code)).toEqual(['K01']);
    expect(out.ageBand?.code).toBe('m6_12');
    expect(out.prompt).toContain('年齢帯: 6〜12ヶ月');
    expect(out.prompt).toContain('ずり這い');
    expect(out.prompt).toContain('K01 見守る');
    expect(out.prompt).toContain('親向け説明: そっと見守る関わり');
    expect(out.prompt).toContain('用語名を出すときは');
    expect(out.prompt).toContain('★4向けの指示');
    expect(out.prompt).toContain('次回は〜してみましょう(宿題感)');
    expect(out.prompt).not.toContain('(無効)');
    expect(out.prompt).toContain('メモ本文\n10:00〜13:00');
    expect(out.escalationRequired).toBe(false);
  });

  it('ストレス度3は★を1段下げ、指示文を差し込む', () => {
    const out = assembleDailyReportPrompt({ ...base, childAgeMonths: 8, educationLevel: 5, stressLevel: 3 });
    expect(out.effectiveEducationLevel).toBe(4);
    expect(out.candidates.map((k) => k.code)).toEqual(['K01']);
    expect(out.prompt).toContain('控えめに');
  });

  it('ストレス度2は教育語を止め、温かみ表現に切り替える', () => {
    const out = assembleDailyReportPrompt({ ...base, childAgeMonths: 8, educationLevel: 5, stressLevel: 2 });
    expect(out.candidates).toEqual([]);
    expect(out.prompt).toContain('教育キーワード(専門用語・発達の意味づけ)を使わないでください');
    expect(out.prompt).toContain('ゆっくり休めますように(締めに)');
    expect(out.prompt).not.toContain('【候補】');
  });

  it('ストレス度1は管理者連絡の指示を出す', () => {
    const out = assembleDailyReportPrompt({ ...base, childAgeMonths: 8, educationLevel: 2, stressLevel: 1 });
    expect(out.escalationRequired).toBe(true);
    expect(out.prompt).toContain('管理者へ連絡');
  });

  it('★・ストレス度が未設定なら既定値で動き、★1は候補があっても教育語オフ', () => {
    const out = assembleDailyReportPrompt({
      ...base,
      childAgeMonths: null,
      educationLevel: null,
      stressLevel: null,
    });
    expect(out.effectiveEducationLevel).toBe(DEFAULT_EDUCATION_LEVEL);
    expect(out.appliedStressLevel).toBe(DEFAULT_STRESS_LEVEL);
    expect(out.prompt).toContain('対象児の月齢: 不明');

    const low = assembleDailyReportPrompt({ ...base, childAgeMonths: 8, educationLevel: 1, stressLevel: 5 });
    expect(low.prompt).toContain('使わないでください');
  });
});
