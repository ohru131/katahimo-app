import { describe, expect, it } from 'vitest';
import { AGE_MONTHS_MAX, PROMPT_TEMPLATE_KEYS } from './contracts/reportAi';
import {
  type ImportSheet,
  parseAgeRangeText,
  parseBooleanCell,
  parseReportAiImportSheets,
  parseStarLevel,
  resolvePromptTemplateKey,
} from './reportAiImport';

describe('parseAgeRangeText', () => {
  it('月齢で書かれた範囲は上限を含まない半開区間になる', () => {
    expect(parseAgeRangeText('0〜6ヶ月')).toEqual({ ageFromMonths: 0, ageToMonths: 6 });
    expect(parseAgeRangeText('6〜12ヶ月')).toEqual({ ageFromMonths: 6, ageToMonths: 12 });
    // 単位の無い側は、もう一方の単位を引き継ぐ。
    expect(parseAgeRangeText('0-6')).toEqual({ ageFromMonths: 0, ageToMonths: 6 });
  });

  it('年で書かれた表記はその年の終わりまでを含む', () => {
    expect(parseAgeRangeText('1歳')).toEqual({ ageFromMonths: 12, ageToMonths: 24 });
    expect(parseAgeRangeText('1歳〜2歳')).toEqual({ ageFromMonths: 12, ageToMonths: 36 });
    expect(parseAgeRangeText('3歳以上')).toEqual({ ageFromMonths: 36, ageToMonths: AGE_MONTHS_MAX });
  });

  it('片側にしか単位が無ければ、もう一方の単位で読む', () => {
    expect(parseAgeRangeText('1-2歳')).toEqual({ ageFromMonths: 12, ageToMonths: 36 });
    expect(parseAgeRangeText('1歳-2')).toEqual({ ageFromMonths: 12, ageToMonths: 36 });
    expect(parseAgeRangeText('0-6ヶ月')).toEqual({ ageFromMonths: 0, ageToMonths: 6 });
    expect(parseAgeRangeText('6ヶ月-12')).toEqual({ ageFromMonths: 6, ageToMonths: 12 });
  });

  it('全角・表記ゆれも同じに読む', () => {
    expect(parseAgeRangeText('０〜６ヵ月')).toEqual({ ageFromMonths: 0, ageToMonths: 6 });
    expect(parseAgeRangeText('1歳6ヶ月〜3歳')).toEqual({ ageFromMonths: 18, ageToMonths: 48 });
    expect(parseAgeRangeText('1歳未満')).toEqual({ ageFromMonths: 0, ageToMonths: 12 });
  });

  it('読み取れない表記は null(勝手に0〜144にしない)', () => {
    expect(parseAgeRangeText('乳児期')).toBeNull();
    expect(parseAgeRangeText('')).toBeNull();
    expect(parseAgeRangeText(null)).toBeNull();
  });
});

describe('parseStarLevel / parseBooleanCell', () => {
  it('★の表記は数値・★付き・★の個数のどれでも読める', () => {
    expect(parseStarLevel('★3')).toBe(3);
    expect(parseStarLevel('3')).toBe(3);
    expect(parseStarLevel(3)).toBe(3);
    expect(parseStarLevel('★★★')).toBe(3);
    expect(parseStarLevel('★6')).toBeNull();
    expect(parseStarLevel('')).toBeNull();
  });

  it('小数・負の数は整数の1〜5でなければnullにする', () => {
    expect(parseStarLevel(1.5)).toBeNull();
    expect(parseStarLevel('1.5')).toBeNull();
    expect(parseStarLevel('-3')).toBeNull();
    expect(parseStarLevel(3)).toBe(3);
    expect(parseStarLevel('3')).toBe(3);
    expect(parseStarLevel('★3')).toBe(3);
    expect(parseStarLevel('★★★')).toBe(3);
  });

  it('○/×・はい/いいえを真偽値にする', () => {
    expect(parseBooleanCell('○')).toBe(true);
    expect(parseBooleanCell('はい')).toBe(true);
    expect(parseBooleanCell('×')).toBe(false);
    expect(parseBooleanCell('いいえ')).toBe(false);
    expect(parseBooleanCell('ときどき')).toBeNull();
  });

  it('「使用可/使用不可」「利用可/利用不可」も読む(否定形を肯定形と取り違えない)', () => {
    expect(parseBooleanCell('使用可')).toBe(true);
    expect(parseBooleanCell('利用可')).toBe(true);
    expect(parseBooleanCell('使用不可')).toBe(false);
    expect(parseBooleanCell('利用不可')).toBe(false);
  });
});

describe('resolvePromptTemplateKey', () => {
  it('GAS版のキーを本アプリのキーに直す', () => {
    expect(resolvePromptTemplateKey('GenerateWithWarnings')).toBe('daily_report');
    expect(resolvePromptTemplateKey('GenerateAccident')).toBe('accident_report');
    expect(resolvePromptTemplateKey('PlaceholderDaily')).toBe('daily_memo_placeholder');
    expect(resolvePromptTemplateKey('PlaceholderAccident')).toBe('accident_memo_placeholder');
    expect(resolvePromptTemplateKey('HintAccident')).toBe('accident_hint');
    expect(resolvePromptTemplateKey('PlaceholderHiyari')).toBe('hiyari_hint');
    expect(resolvePromptTemplateKey('Unknown')).toBeNull();
  });

  it('本アプリのキーはそのまま解決できる(全キー)', () => {
    for (const key of PROMPT_TEMPLATE_KEYS) {
      expect(resolvePromptTemplateKey(key)).toBe(key);
    }
  });
});

describe('parseReportAiImportSheets', () => {
  const ageBandSheet: ImportSheet = {
    name: '年齢別シート',
    rows: [
      ['コード', '年齢帯', '行動語', '発達の主なトピック', '場面例', '並び順'],
      ['m0_6', '0〜6ヶ月', 'ずり這い・追視', '首すわり', '授乳', 1],
      ['y1', '1歳', '指差し・つかまり立ち', 'ことばの芽', 'お散歩', 2],
    ],
  };

  const keywordSheet: ImportSheet = {
    name: 'キーワード一覧',
    rows: [
      [
        'コード',
        '分類',
        'キーワード',
        '対象月齢',
        '教育関心度',
        'ストレス度下限',
        '親向け説明',
        '相性の良い年齢帯',
        '有効',
      ],
      ['K01', '非認知能力', '敏感期', '1歳〜2歳', '★3〜★5', '★3', '今だけ夢中になる時期', 'y1', '○'],
      ['K02', '情緒ケア', '安全基地', '0〜6ヶ月', '★2', '4', '安心の土台', 'm0_6', '×'],
    ],
  };

  const levelSheets: ImportSheet[] = [
    {
      name: '★の基準',
      rows: [
        ['教育関心度', '呼称', '想定する家庭像', '最大キーワード数', '用語名'],
        ['★2', '標準', '一般的な家庭', 1, '×'],
        ['★4', '関心高い', '教育に関心が高い', 2, '○'],
      ],
    },
    {
      name: 'PSI',
      rows: [
        ['ストレス度', '呼称', '判定基準', '★の引き下げ', '教育語の使用', '管理者連絡'],
        [1, '危険・緊急', '表情が乏しい', 4, '×', '○'],
        [5, '安心・良好', '落ち着いている', 0, '○', '×'],
      ],
    },
  ];

  const phraseSheet: ImportSheet = {
    name: '表現集',
    rows: [
      ['種別', '表現', '意図', 'ストレス度(から)', 'ストレス度(まで)', '配置'],
      ['温かみ表現', 'いつもよく見ていらっしゃいますね', 'ねぎらい', 1, 3, '締め'],
      ['避ける表現', '〜してあげてください', '指示口調になる', 1, 5, ''],
    ],
  };

  const promptSheet: ImportSheet = {
    name: 'ＡＩプロンプト',
    rows: [
      ['Key', 'Prompt Template'],
      ['GenerateWithWarnings', '日報を書いてください {anonymizedText}'],
      ['UnknownKey', '対応先の無い文面'],
    ],
  };

  it('見出しからシートの種類を判定し、行を取込データに直す', () => {
    const { payload, warnings } = parseReportAiImportSheets({
      sheets: [ageBandSheet, keywordSheet, ...levelSheets, phraseSheet, promptSheet],
    });

    expect(payload.ageBands).toEqual([
      {
        code: 'm0_6',
        label: '0〜6ヶ月',
        ageFromMonths: 0,
        ageToMonths: 6,
        behaviorWords: 'ずり這い・追視',
        developmentTopics: '首すわり',
        sceneExamples: '授乳',
        sortOrder: 1,
      },
      {
        code: 'y1',
        label: '1歳',
        ageFromMonths: 12,
        ageToMonths: 24,
        behaviorWords: '指差し・つかまり立ち',
        developmentTopics: 'ことばの芽',
        sceneExamples: 'お散歩',
        sortOrder: 2,
      },
    ]);

    expect(payload.keywords).toHaveLength(2);
    expect(payload.keywords[0]).toMatchObject({
      code: 'K01',
      name: '敏感期',
      ageFromMonths: 12,
      ageToMonths: 36,
      educationLevelMin: 3,
      educationLevelMax: 5,
      stressLevelMin: 3,
      ageBandCodes: ['y1'],
      active: true,
    });
    // 「★2」の1点表記は下限=上限。廃止(×)は active=false で入る。
    expect(payload.keywords[1]).toMatchObject({
      educationLevelMin: 2,
      educationLevelMax: 2,
      stressLevelMin: 4,
      active: false,
    });

    expect(payload.educationLevels).toEqual([
      {
        level: 2,
        label: '標準',
        description: '一般的な家庭',
        promptInstruction: '',
        maxKeywords: 1,
        allowTermNames: false,
      },
      {
        level: 4,
        label: '関心高い',
        description: '教育に関心が高い',
        promptInstruction: '',
        maxKeywords: 2,
        allowTermNames: true,
      },
    ]);

    // 引き下げ幅は「4段下げる」と正の数で書かれていても、下げる方向として取り込む。
    expect(payload.stressLevels[0]).toMatchObject({
      level: 1,
      educationLevelShift: -4,
      keywordsEnabled: false,
      escalationRequired: true,
    });
    expect(payload.stressLevels[1]).toMatchObject({
      level: 5,
      educationLevelShift: 0,
      keywordsEnabled: true,
    });

    expect(payload.phrases).toEqual([
      {
        kind: 'encourage',
        body: 'いつもよく見ていらっしゃいますね',
        intent: 'ねぎらい',
        stressLevelMin: 1,
        stressLevelMax: 3,
        placement: 'closing',
        sortOrder: 0,
        active: true,
      },
      {
        kind: 'avoid',
        body: '〜してあげてください',
        intent: '指示口調になる',
        stressLevelMin: 1,
        stressLevelMax: 5,
        placement: 'any',
        sortOrder: 0,
        active: true,
      },
    ]);

    expect(payload.promptTemplates).toEqual([
      { key: 'daily_report', body: '日報を書いてください {anonymizedText}' },
    ]);
    // 対応先の無いキーは捨てるが、捨てたことは必ず伝える。
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('UnknownKey');
  });

  it('避ける表現は、表にストレス度の範囲が書かれていても全範囲で取り込む', () => {
    const { payload, warnings } = parseReportAiImportSheets({
      sheets: [
        {
          name: '表現集',
          rows: [
            ['種別', '表現', '意図', 'ストレス度(から)', 'ストレス度(まで)'],
            ['避ける表現', '〜すべきです', '断定が強い', 2, 3],
          ],
        },
      ],
    });

    // 避ける表現は全ての日報に効くので、範囲の列は読まない(落とさずに1〜5で入れる)。
    expect(payload.phrases).toHaveLength(1);
    expect(payload.phrases[0]).toMatchObject({ kind: 'avoid', stressLevelMin: 1, stressLevelMax: 5 });
    expect(warnings).toEqual([]);
  });

  it('種類を判定できないシートは warnings に出して無視する', () => {
    const { payload, warnings } = parseReportAiImportSheets({
      sheets: [
        {
          name: '売上',
          rows: [
            ['月', '金額'],
            ['2026-01', 1000],
          ],
        },
      ],
    });
    expect(payload.ageBands).toEqual([]);
    expect(warnings).toEqual(['シート「売上」は見出しから種類を判定できなかったため取り込みませんでした。']);
  });

  it('月齢を読み取れない年齢帯の行は、その行だけ落として理由を残す', () => {
    const { payload, warnings } = parseReportAiImportSheets({
      sheets: [
        {
          name: '年齢帯',
          rows: [
            ['年齢帯', '行動語'],
            ['乳児期', 'ずり這い'],
            ['1歳', '指差し'],
          ],
        },
      ],
    });
    expect(payload.ageBands).toHaveLength(1);
    expect(payload.ageBands[0]?.label).toBe('1歳');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('2行目');
  });

  it('空のシート・空行は何も足さない', () => {
    const { payload, warnings } = parseReportAiImportSheets({
      sheets: [
        { name: '空', rows: [] },
        { name: '空行だけ', rows: [[''], [null]] },
      ],
    });
    expect(payload).toEqual({
      ageBands: [],
      keywords: [],
      educationLevels: [],
      stressLevels: [],
      phrases: [],
      promptTemplates: [],
    });
    expect(warnings).toEqual([]);
  });
});
