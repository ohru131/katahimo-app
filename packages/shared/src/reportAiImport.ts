import type { z } from 'zod';
import {
  AGE_MONTHS_MAX,
  type PromptTemplateKey,
  REPORT_LEVEL_MAX,
  REPORT_LEVEL_MIN,
} from './contracts/reportAi';
import {
  ageBandInputSchema,
  educationLevelInputSchema,
  keywordInputSchema,
  phraseInputSchema,
  type ReportAiImportPayload,
  stressLevelInputSchema,
} from './contracts/reportAiAdmin';

/**
 * 法人が持っている表(xlsx)を、日報AIの設定(年齢帯・キーワード・判定基準・表現・プロンプト文面)の
 * 取込データに変換する純関数。
 *
 * 【ここが受け取るのは「読み終わった生の2次元配列」】
 * xlsx の解析は画面側(SheetJS)が行う。このパッケージは api / web の両方から読まれるので、
 * 依存を zod 以外に増やさない。ここに来るのはシート名と、セルの値をそのまま並べた配列だけ。
 *
 * 【シート名ではなく見出し行で判定する理由】
 * 法人の資料はシート名が自由(「キーワード表(最新)」「Sheet3」等)で、名前で当てにいくと
 * 取込のたびに人がシート名を直すことになる。1行目の列名を別名表と突き合わせて種類を決め、
 * どの種類にも当てはまらないシートは warnings に出して無視する(黙って捨てない)。
 *
 * 【行はここで検証してから payload に入れる】
 * 変換できた行だけを contracts/reportAiAdmin.ts の zod スキーマに通し、通らない行は
 * 「どのシートの何行目が、なぜ入らなかったか」を warnings に出して落とす。1行の入力ミスで
 * 表全体の取込が失敗しないようにするため。
 */

/** SheetJS が返すセルの値(`{ raw: true }` 相当)。 */
export type ImportCellValue = string | number | boolean | null | undefined;

export interface ImportSheet {
  name: string;
  /** 1行目が見出し。2行目以降がデータ。 */
  rows: ImportCellValue[][];
}

export interface ReportAiImportSource {
  sheets: ImportSheet[];
}

export interface ReportAiImportParseResult {
  payload: ReportAiImportPayload;
  /** 無視したシート・落とした行の説明(日本語)。画面にそのまま出す。 */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// セルの読み取り
// ---------------------------------------------------------------------------

/**
 * 見出し・値の突き合わせに使う正規化。全角/半角(NFKC)を揃え、英字は小文字にし、
 * 区切り記号と空白を落とす。別名表もこの関数を通すので、「対象月齢(から)」と
 * 「対象月齢（から）」と「age_from_months」を同じ土俵で比べられる。
 */
export function normalizeHeader(value: ImportCellValue): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s()[\]{}「」『』【】:;,、。.・/\\|_*※#]/g, '');
}

/** セルを文字列にする。null/undefined は空文字。 */
function cellText(value: ImportCellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value).trim();
}

/** セルを整数にする。数字が1つも無ければ null(勝手に0にしない)。 */
function cellInteger(value: ImportCellValue): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : null;
  const text = cellText(value).normalize('NFKC');
  const matched = /-?\d+/.exec(text);
  return matched ? Number.parseInt(matched[0], 10) : null;
}

/**
 * ○/×・はい/いいえ・true/false・1/0 を真偽値にする。判定できなければ null。
 * 法人の表は「可/不可」「使用可」などの書き方が混ざるため、代表的な表記を拾う。
 */
export function parseBooleanCell(value: ImportCellValue): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 0 ? false : value === 1 ? true : null;
  const text = normalizeHeader(value);
  if (!text) return null;
  // 否定形を先に見る。「使用不可」は「使用可」を含む形なので、肯定側から見ると取り違える。
  if (FALSE_CELLS.includes(text)) return false;
  if (TRUE_CELLS.includes(text)) return true;
  return null;
}

/** 「使う・有効」と読む表記。normalizeHeader を通した形で持つ。 */
const TRUE_CELLS: readonly string[] = [
  '○',
  '◯',
  '〇',
  '◎',
  '✓',
  '✔',
  'はい',
  '可',
  '有',
  'あり',
  '使用可',
  '利用可',
  'yes',
  'y',
  'true',
  '1',
];

/** 「使わない・無効」と読む表記。 */
const FALSE_CELLS: readonly string[] = [
  '×',
  '✕',
  '✗',
  'x',
  '✘',
  'いいえ',
  '不可',
  '無',
  'なし',
  '使用不可',
  '利用不可',
  'no',
  'n',
  'false',
  '0',
  '-',
];

/**
 * 「★3」「3」「★★★」のいずれの書き方でもレベル(1〜5)にする。範囲外・判定不能は null。
 * 資料が★の絵文字で書かれていることも、数値で書かれていることもあるため両方を受ける。
 */
export function parseStarLevel(value: ImportCellValue): number | null {
  if (typeof value === 'number') {
    const n = Math.trunc(value);
    return n >= REPORT_LEVEL_MIN && n <= REPORT_LEVEL_MAX ? n : null;
  }
  const text = cellText(value).normalize('NFKC');
  if (!text) return null;
  const digits = /\d+/.exec(text);
  if (digits) {
    const n = Number.parseInt(digits[0], 10);
    return n >= REPORT_LEVEL_MIN && n <= REPORT_LEVEL_MAX ? n : null;
  }
  const stars = text.match(/[★☆✩✪⭐]/g);
  if (!stars) return null;
  const n = stars.length;
  return n >= REPORT_LEVEL_MIN && n <= REPORT_LEVEL_MAX ? n : null;
}

// ---------------------------------------------------------------------------
// 年齢表記 → 月齢の半開区間
// ---------------------------------------------------------------------------

export interface AgeMonthsRange {
  ageFromMonths: number;
  ageToMonths: number;
}

/** 年・月の単位を表す接尾辞。「ヶ月」の表記ゆれ(ヶ/ケ/箇/か/カ)をまとめて拾う。 */
const YEAR_UNIT_RE = /(歳|才|歳児|year|y)\s*$/;
const MONTH_UNIT_RE = /(ヶ月|ケ月|箇月|か月|カ月|ヵ月|月|month|months|m)\s*$/;

/** 年齢表記の単位。`none` は「1〜2歳」の「1」のように、単位が書かれていない側。 */
type AgeUnit = 'year' | 'month' | 'none';

interface AgePart {
  /** 書かれている単位で解釈した月齢。単位が無ければ数字そのもの。 */
  months: number;
  unit: AgeUnit;
  /** 表記にあった数字。単位を相手側から引き継ぐときに、月齢を数え直すために使う。 */
  value: number;
}

/** 「1歳6ヶ月」のような複合表記も含めて、片側1つぶんの月齢を読む。 */
function parseAgePart(part: string): AgePart | null {
  const text = part.replace(/(以上|以降|未満|より前|〜|~)/g, '').trim();
  if (!text) return null;
  const compound = /(\d+)\s*(?:歳|才)\s*(\d+)\s*(?:ヶ月|ケ月|箇月|か月|カ月|ヵ月|月)/.exec(text);
  if (compound) {
    const months = Number.parseInt(compound[1] ?? '0', 10) * 12 + Number.parseInt(compound[2] ?? '0', 10);
    return { months, unit: 'month', value: months };
  }
  const digits = /\d+/.exec(text);
  if (!digits) return null;
  const value = Number.parseInt(digits[0], 10);
  if (YEAR_UNIT_RE.test(text)) return { months: value * 12, unit: 'year', value };
  if (MONTH_UNIT_RE.test(text)) return { months: value, unit: 'month', value };
  return { months: value, unit: 'none', value };
}

/**
 * 単位の無い側に相手の単位を当てはめた月齢。「1〜2歳」の「1」は1歳(12ヶ月)であって
 * 1ヶ月ではない、という読み方をどちらの側でもできるようにする。
 */
function monthsWithUnit(part: AgePart, unit: AgeUnit): number {
  return part.unit === 'none' && unit === 'year' ? part.value * 12 : part.months;
}

/**
 * 「0〜6ヶ月」「6〜12ヶ月」「1歳」「1歳〜2歳」「3歳以上」「0-6」などを、月齢の
 * 半開区間 `[from, to)` に変換する。判定できなければ null。
 *
 * 【年で書かれた上限をその年の終わりまで含める理由】
 * 「1歳〜2歳」は日本語では「2歳の子まで」を指すので、上限は 2歳の終わり = 36ヶ月。
 * 一方「6〜12ヶ月」は月齢で書かれており、12ヶ月ちょうどは次の帯(1歳)に入る = 上限は12。
 * 単位によって上限の解釈が変わるため、単位を見てから決める。単位の無い側は、もう一方の
 * 単位を引き継ぐ(「0〜6ヶ月」の「0」は月齢)。
 */
export function parseAgeRangeText(value: ImportCellValue): AgeMonthsRange | null {
  const raw = cellText(value).normalize('NFKC');
  if (!raw) return null;
  // 範囲の区切り(波ダッシュ・全角チルダ・ハイフン類)を1種類に寄せる。
  const text = raw.replace(/[〜～~\-–—―ー]/g, '~').replace(/\s+/g, '');
  if (!text) return null;

  const open = /(以上|以降)/.test(text);
  const under = /(未満|より前)/.test(text);
  const parts = text.split('~').filter((p) => p.length > 0);

  if (parts.length >= 2) {
    const left = parseAgePart(parts[0] ?? '');
    const right = parseAgePart(parts[1] ?? '');
    if (!left || !right) return null;
    // 単位はどちら向きにも引き継ぐ(「1-2歳」の左、「1歳-2」の右のどちらも歳で読む)。
    const leftUnit = left.unit === 'none' ? right.unit : left.unit;
    const rightUnit = right.unit === 'none' ? left.unit : right.unit;
    const from = monthsWithUnit(left, leftUnit);
    // 右側が年で書かれていれば「その年の終わりまで」、月なら「その月の手前まで」。
    const to = /(以上|以降)/.test(parts[1] ?? '')
      ? AGE_MONTHS_MAX
      : rightUnit === 'year'
        ? monthsWithUnit(right, rightUnit) + 12
        : monthsWithUnit(right, rightUnit);
    return clampRange(from, to);
  }

  const only = parseAgePart(parts[0] ?? text);
  if (!only) return null;
  if (open) return clampRange(only.months, AGE_MONTHS_MAX);
  if (under) return clampRange(0, only.months);
  // 単独の表記は1区切りぶん。「1歳」= [12,24)、「6ヶ月」= [6,7)。
  return clampRange(only.months, only.unit === 'year' ? only.months + 12 : only.months + 1);
}

/** 月齢を 0〜AGE_MONTHS_MAX に収める。上下が逆・幅0になったものは null。 */
function clampRange(from: number, to: number): AgeMonthsRange | null {
  const ageFromMonths = Math.max(0, Math.min(AGE_MONTHS_MAX, from));
  const ageToMonths = Math.max(0, Math.min(AGE_MONTHS_MAX, to));
  if (ageToMonths <= ageFromMonths) return null;
  return { ageFromMonths, ageToMonths };
}

// ---------------------------------------------------------------------------
// GAS版「ＡＩプロンプト」シートのキー対応
// ---------------------------------------------------------------------------

/**
 * GAS版 GeminiReport.js の PROMPT_KEYS から本アプリのキーへの対応。
 * GAS版のシートをそのまま読み込めるようにするためのもので、未知のキーは warnings に出して捨てる。
 */
export const GAS_PROMPT_KEY_MAP: Readonly<Record<string, PromptTemplateKey>> = {
  generatewithwarnings: 'daily_report',
  generateaccident: 'accident_report',
  placeholderdaily: 'daily_memo_placeholder',
  placeholderaccident: 'accident_memo_placeholder',
  hintaccident: 'accident_hint',
  placeholderhiyari: 'hiyari_hint',
  // 本アプリのキーで書かれた表もそのまま読めるようにする。
  daily_report: 'daily_report',
  daily_report_stance: 'daily_report_stance',
  accident_report: 'accident_report',
  receipt_ocr: 'receipt_ocr',
  daily_memo_placeholder: 'daily_memo_placeholder',
  accident_memo_placeholder: 'accident_memo_placeholder',
  accident_hint: 'accident_hint',
  hiyari_hint: 'hiyari_hint',
};

/**
 * 別名表を、突き合わせに使う正規化後のキーで引けるようにしたもの。
 * `normalizeHeader` はアンダースコアを落とすので、`daily_report` のような本アプリのキーは
 * 表に書いたままでは引けない(表の側も同じ関数を通しておく)。
 */
const PROMPT_KEY_LOOKUP: ReadonlyMap<string, PromptTemplateKey> = new Map(
  Object.entries(GAS_PROMPT_KEY_MAP).map(([alias, key]) => [normalizeHeader(alias), key]),
);

/** GASのキー(表記ゆれ込み)を本アプリのキーに直す。対応が無ければ null。 */
export function resolvePromptTemplateKey(value: ImportCellValue): PromptTemplateKey | null {
  return PROMPT_KEY_LOOKUP.get(normalizeHeader(value)) ?? null;
}

// ---------------------------------------------------------------------------
// 見出しの別名表
// ---------------------------------------------------------------------------

type SheetKind = 'promptTemplates' | 'ageBands' | 'keywords' | 'educationLevels' | 'stressLevels' | 'phrases';

/** 列の別名。左から順に見て、最初に当たった列を使う。normalizeHeader を通して比べる。 */
type ColumnAliases = Readonly<Record<string, readonly string[]>>;

interface SheetSpec {
  kind: SheetKind;
  /** 日本語名(warnings と doc に出す)。 */
  label: string;
  columns: ColumnAliases;
  /** 各グループから最低1列が見つかったときだけ、このシートだと判定する。 */
  required: readonly (readonly string[])[];
}

const AGE_FROM_ALIASES = ['対象月齢(から)', '月齢(から)', '開始月齢', '月齢下限', 'age_from_months', 'from'];
const AGE_TO_ALIASES = ['対象月齢(まで)', '月齢(まで)', '終了月齢', '月齢上限', 'age_to_months', 'to'];
const AGE_TEXT_ALIASES = ['対象月齢', '対象年齢', '月齢', '年齢', '適用年齢'];
const SORT_ORDER_ALIASES = ['並び順', '表示順', '順序', 'sort_order', 'order'];
const ACTIVE_ALIASES = ['有効', '使用', '利用可', 'active', '有効フラグ'];

const SHEET_SPECS: readonly SheetSpec[] = [
  {
    kind: 'promptTemplates',
    label: 'プロンプト文面',
    columns: {
      key: ['key', 'キー', 'プロンプトキー', 'プロンプト名'],
      body: ['prompt template', 'prompttemplate', 'プロンプト', '文面', 'プロンプト文面', 'body'],
    },
    required: [['key'], ['body']],
  },
  {
    kind: 'ageBands',
    label: '年齢帯',
    columns: {
      code: ['コード', 'code', '年齢帯コード'],
      label: ['年齢帯', '年齢帯名', '帯', 'age_band', 'ageband', '表示名', 'ラベル'],
      ageFromMonths: AGE_FROM_ALIASES,
      ageToMonths: AGE_TO_ALIASES,
      ageText: AGE_TEXT_ALIASES,
      behaviorWords: ['行動語', '行動・言葉', 'よく描く行動', '行動', 'behavior_words'],
      developmentTopics: ['発達の主なトピック', '発達トピック', '発達', 'development_topics'],
      sceneExamples: ['場面例', '場面', 'シーン', 'scene_examples'],
      sortOrder: SORT_ORDER_ALIASES,
    },
    required: [
      ['label'],
      ['behaviorWords', 'developmentTopics', 'sceneExamples', 'ageFromMonths', 'ageText'],
    ],
  },
  {
    kind: 'keywords',
    label: 'キーワード',
    columns: {
      code: ['コード', 'code', 'キーワードコード', 'no'],
      category: ['分類', 'カテゴリ', 'category', '系統'],
      name: ['キーワード', '用語', 'キーワード名', '名称', 'name'],
      subConcept: ['副題', '別名', 'サブコンセプト', 'sub_concept'],
      ageFromMonths: AGE_FROM_ALIASES,
      ageToMonths: AGE_TO_ALIASES,
      ageText: AGE_TEXT_ALIASES,
      educationLevelMin: ['教育関心度(から)', '★下限', '教育関心度下限', 'education_level_min'],
      educationLevelMax: ['教育関心度(まで)', '★上限', '教育関心度上限', 'education_level_max'],
      educationLevelRange: ['教育関心度', '対象★', '★', '★の範囲', '対象教育関心度'],
      stressLevelMin: ['ストレス度下限', '最低ストレス度', 'ストレス度', 'psi', 'stress_level_min'],
      tone: ['語調', 'トーン', 'tone'],
      parentExplanation: ['親向け説明', '保護者向け説明', '言い換え', 'parent_explanation'],
      phraseExamples: ['言い回しの例', '例文', 'フレーズ例', 'phrase_examples'],
      usageScene: ['使いどころ', '使用場面', '場面', 'usage_scene'],
      ngExample: ['避ける言い方', 'ng例', 'ng', 'ng_example'],
      ageBandCodes: ['相性の良い年齢帯', '対象年齢帯', '年齢帯コード', 'age_band_codes'],
      sortOrder: SORT_ORDER_ALIASES,
      active: ACTIVE_ALIASES,
    },
    required: [['name']],
  },
  {
    kind: 'educationLevels',
    label: '教育関心度★の判定基準',
    columns: {
      level: ['教育関心度', '★', 'レベル', 'level', '段階'],
      label: ['呼称', '名称', 'ラベル', 'label', '区分名'],
      description: ['想定する家庭像', '説明', '家庭像', 'description'],
      promptInstruction: ['指示文', 'ai指示', 'プロンプト指示', 'prompt_instruction'],
      maxKeywords: ['キーワード数上限', '最大キーワード数', '語数上限', 'max_keywords'],
      allowTermNames: ['用語名の使用', '用語名', '専門用語', 'allow_term_names'],
    },
    required: [['level'], ['maxKeywords', 'allowTermNames', 'description']],
  },
  {
    kind: 'stressLevels',
    label: 'ストレス度の判定基準',
    columns: {
      level: ['ストレス度', 'psi', 'レベル', 'level', '段階'],
      label: ['呼称', '名称', 'ラベル', 'label', '区分名'],
      criteria: ['判定基準', '基準', '状態', 'criteria'],
      promptInstruction: ['指示文', 'ai指示', 'プロンプト指示', 'prompt_instruction'],
      educationLevelShift: ['★の引き下げ', '引き下げ幅', '★調整', 'education_level_shift'],
      keywordsEnabled: ['教育語の使用', 'キーワード使用', 'keywords_enabled'],
      escalationRequired: ['管理者連絡', 'エスカレーション', 'escalation_required'],
    },
    required: [['level'], ['criteria', 'educationLevelShift', 'keywordsEnabled', 'escalationRequired']],
  },
  {
    kind: 'phrases',
    label: '温かみ表現・避ける表現',
    columns: {
      kind: ['種別', '区分', '種類', 'kind'],
      body: ['表現', '言い回し', '文言', 'フレーズ', 'body'],
      intent: ['意図', 'メッセージ', '理由', 'intent'],
      stressLevelMin: ['ストレス度(から)', 'ストレス度下限', 'stress_level_min'],
      stressLevelMax: ['ストレス度(まで)', 'ストレス度上限', 'stress_level_max'],
      placement: ['配置', '置き場所', 'placement'],
      sortOrder: SORT_ORDER_ALIASES,
      active: ACTIVE_ALIASES,
    },
    required: [['body'], ['kind']],
  },
];

/** 見出し行から「列名 → 列番号」を作る。別名表に無い列は無視する。 */
function mapColumns(headerRow: readonly ImportCellValue[], columns: ColumnAliases): Map<string, number> {
  const normalizedHeader = headerRow.map((cell) => normalizeHeader(cell));
  const found = new Map<string, number>();
  for (const [field, aliases] of Object.entries(columns)) {
    for (const alias of aliases) {
      const index = normalizedHeader.indexOf(normalizeHeader(alias));
      if (index >= 0) {
        found.set(field, index);
        break;
      }
    }
  }
  return found;
}

/** 見出し行から、どのシートかを決める。どの種類にも当てはまらなければ null。 */
function detectSheet(
  headerRow: readonly ImportCellValue[],
): { spec: SheetSpec; columns: Map<string, number> } | null {
  let best: { spec: SheetSpec; columns: Map<string, number> } | null = null;
  for (const spec of SHEET_SPECS) {
    const columns = mapColumns(headerRow, spec.columns);
    const satisfied = spec.required.every((group) => group.some((field) => columns.has(field)));
    if (!satisfied) continue;
    if (!best || columns.size > best.columns.size) best = { spec, columns };
  }
  return best;
}

// ---------------------------------------------------------------------------
// 行の組み立て
// ---------------------------------------------------------------------------

/** 1行ぶんの読み取り口。別名表に無い列は空として扱う。 */
interface RowReader {
  text(field: string): string;
  integer(field: string): number | null;
  boolean(field: string): boolean | null;
  raw(field: string): ImportCellValue;
  has(field: string): boolean;
}

/** 1行と「列名 → 列番号」から読み取り口を作る。別名表に無い列を引いたら空として返す。 */
function createRowReader(row: readonly ImportCellValue[], columns: Map<string, number>): RowReader {
  const at = (field: string): ImportCellValue => {
    const index = columns.get(field);
    return index === undefined ? null : (row[index] ?? null);
  };
  return {
    raw: at,
    has: (field) => columns.has(field) && cellText(at(field)) !== '',
    text: (field) => cellText(at(field)),
    integer: (field) => cellInteger(at(field)),
    boolean: (field) => parseBooleanCell(at(field)),
  };
}

/**
 * 月齢の範囲を決める。数値2列(から/まで)が両方あればそれを優先し、無ければ
 * 年齢表記の列(それも無ければ表示名)を読む。どちらも読めなければ null。
 */
function readAgeRange(reader: RowReader, fallbackTextField: string | null): AgeMonthsRange | null {
  const from = reader.integer('ageFromMonths');
  const to = reader.integer('ageToMonths');
  if (from !== null && to !== null) return clampRange(from, to);
  const fromText = reader.has('ageText')
    ? reader.raw('ageText')
    : fallbackTextField
      ? reader.raw(fallbackTextField)
      : null;
  return parseAgeRangeText(fromText);
}

/** 「y1, y2」「y1/y2」「y1 y2」のいずれの区切りでも年齢帯コードの並びとして読む。 */
function splitCodes(value: string): string[] {
  return value
    .split(/[,、/|\s]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

/**
 * シートの並びを取込データに変換する。
 * 同じ種類のシートが複数あれば、出てきた順に行を足す(月齢別にシートを分けている資料があるため)。
 */
export function parseReportAiImportSheets(source: ReportAiImportSource): ReportAiImportParseResult {
  const warnings: string[] = [];
  const payload: ReportAiImportPayload = {
    ageBands: [],
    keywords: [],
    educationLevels: [],
    stressLevels: [],
    phrases: [],
    promptTemplates: [],
  };

  for (const sheet of source.sheets) {
    const rows = sheet.rows.filter((row) => row.some((cell) => cellText(cell) !== ''));
    if (rows.length === 0) continue;
    const headerRow = rows[0] ?? [];
    const detected = detectSheet(headerRow);
    if (!detected) {
      warnings.push(`シート「${sheet.name}」は見出しから種類を判定できなかったため取り込みませんでした。`);
      continue;
    }
    const { spec, columns } = detected;

    rows.slice(1).forEach((row, offset) => {
      // 見出しを1行目としたときの行番号。warnings をシートの見た目と同じ番号で出すため。
      const rowNumber = offset + 2;
      const reader = createRowReader(row, columns);
      const where = `「${sheet.name}」(${spec.label})${rowNumber}行目`;
      const issue = appendRow(spec.kind, reader, payload);
      if (issue) warnings.push(`${where}: ${issue}`);
    });
  }

  return { payload, warnings };
}

/** 1行を payload に足す。足せなかった場合はその理由(日本語)を返す。 */
function appendRow(kind: SheetKind, reader: RowReader, payload: ReportAiImportPayload): string | null {
  switch (kind) {
    case 'promptTemplates': {
      const key = resolvePromptTemplateKey(reader.raw('key'));
      const body = reader.text('body');
      if (!key) return `プロンプトのキー「${reader.text('key')}」は対応先が無いため取り込みませんでした。`;
      if (!body) return '文面が空のため取り込みませんでした。';
      payload.promptTemplates.push({ key, body });
      return null;
    }
    case 'ageBands': {
      const range = readAgeRange(reader, 'label');
      if (!range) return '月齢の範囲を読み取れませんでした。';
      const label = reader.text('label');
      const parsed = parseRow(ageBandInputSchema, {
        code: reader.text('code') || label,
        label,
        ageFromMonths: range.ageFromMonths,
        ageToMonths: range.ageToMonths,
        behaviorWords: reader.text('behaviorWords'),
        developmentTopics: reader.text('developmentTopics'),
        sceneExamples: reader.text('sceneExamples'),
        sortOrder: reader.integer('sortOrder') ?? 0,
      });
      if (!parsed.ok) return parsed.message;
      payload.ageBands.push(parsed.data);
      return null;
    }
    case 'keywords': {
      // 月齢が読めないキーワードは「全月齢で使える語」として扱う(年齢帯と違い、
      // 範囲を持たない語も運用上ありうるため。落とすと表の大半が消えることがある)。
      const range = readAgeRange(reader, null) ?? { ageFromMonths: 0, ageToMonths: AGE_MONTHS_MAX };
      const rangeText = reader.text('educationLevelRange');
      const parsedRange = parseLevelRange(rangeText);
      const min = parseStarLevel(reader.raw('educationLevelMin')) ?? parsedRange?.min ?? REPORT_LEVEL_MIN;
      const max = parseStarLevel(reader.raw('educationLevelMax')) ?? parsedRange?.max ?? REPORT_LEVEL_MAX;
      const parsed = parseRow(keywordInputSchema, {
        code: reader.text('code') || reader.text('name'),
        category: reader.text('category'),
        name: reader.text('name'),
        subConcept: reader.text('subConcept'),
        ageFromMonths: range.ageFromMonths,
        ageToMonths: range.ageToMonths,
        educationLevelMin: min,
        educationLevelMax: max,
        stressLevelMin: parseStarLevel(reader.raw('stressLevelMin')) ?? REPORT_LEVEL_MIN,
        tone: reader.text('tone'),
        parentExplanation: reader.text('parentExplanation'),
        phraseExamples: reader.text('phraseExamples'),
        usageScene: reader.text('usageScene'),
        ngExample: reader.text('ngExample'),
        sortOrder: reader.integer('sortOrder') ?? 0,
        active: reader.boolean('active') ?? true,
        ageBandCodes: splitCodes(reader.text('ageBandCodes')),
      });
      if (!parsed.ok) return parsed.message;
      payload.keywords.push(parsed.data);
      return null;
    }
    case 'educationLevels': {
      const level = parseStarLevel(reader.raw('level'));
      if (level === null) return `教育関心度「${reader.text('level')}」を1〜5として読み取れませんでした。`;
      const parsed = parseRow(educationLevelInputSchema, {
        level,
        label: reader.text('label') || `★${level}`,
        description: reader.text('description'),
        promptInstruction: reader.text('promptInstruction'),
        maxKeywords: reader.integer('maxKeywords') ?? 1,
        allowTermNames: reader.boolean('allowTermNames') ?? false,
      });
      if (!parsed.ok) return parsed.message;
      payload.educationLevels.push(parsed.data);
      return null;
    }
    case 'stressLevels': {
      const level = parseStarLevel(reader.raw('level'));
      if (level === null) return `ストレス度「${reader.text('level')}」を1〜5として読み取れませんでした。`;
      // 引き下げ幅は「2段下げる」のように正の数で書かれることがある。下げる方向しか
      // 意味を持たない列なので、符号を落として負の値として扱う。
      const shift = reader.integer('educationLevelShift');
      const parsed = parseRow(stressLevelInputSchema, {
        level,
        label: reader.text('label') || `ストレス度${level}`,
        criteria: reader.text('criteria'),
        promptInstruction: reader.text('promptInstruction'),
        educationLevelShift: shift ? -Math.abs(shift) : 0,
        keywordsEnabled: reader.boolean('keywordsEnabled') ?? true,
        escalationRequired: reader.boolean('escalationRequired') ?? false,
      });
      if (!parsed.ok) return parsed.message;
      payload.stressLevels.push(parsed.data);
      return null;
    }
    case 'phrases': {
      const kindText = normalizeHeader(reader.raw('kind'));
      const phraseKind = /避|ng|avoid|禁/.test(kindText)
        ? 'avoid'
        : /温|ねぎら|寄り添|encourage|励/.test(kindText)
          ? 'encourage'
          : null;
      if (!phraseKind) return `種別「${reader.text('kind')}」を判定できませんでした。`;
      const placementText = normalizeHeader(reader.raw('placement'));
      // 避ける表現は全ての日報に効くので範囲を持たない(表に範囲が書かれていても 1〜5 で入れる。
      // contracts/reportAiAdmin.ts の phraseInputSchema も avoid に全範囲を要求する)。
      const isAvoid = phraseKind === 'avoid';
      const parsed = parseRow(phraseInputSchema, {
        kind: phraseKind,
        body: reader.text('body'),
        intent: reader.text('intent'),
        stressLevelMin: isAvoid
          ? REPORT_LEVEL_MIN
          : (parseStarLevel(reader.raw('stressLevelMin')) ?? REPORT_LEVEL_MIN),
        stressLevelMax: isAvoid
          ? REPORT_LEVEL_MAX
          : (parseStarLevel(reader.raw('stressLevelMax')) ?? REPORT_LEVEL_MAX),
        placement: /締|closing|結び/.test(placementText) ? 'closing' : 'any',
        sortOrder: reader.integer('sortOrder') ?? 0,
        active: reader.boolean('active') ?? true,
      });
      if (!parsed.ok) return parsed.message;
      payload.phrases.push(parsed.data);
      return null;
    }
  }
}

/** 「★3〜★5」「3-5」のような1列で書かれた範囲を読む。片側だけなら両端に同じ値を入れない。 */
function parseLevelRange(text: string): { min: number; max: number } | null {
  if (!text) return null;
  const normalized = text.normalize('NFKC').replace(/[〜～~－–—―]/g, '-');
  const parts = normalized.split('-').filter((part) => /\d|[★☆]/.test(part));
  if (parts.length >= 2) {
    const min = parseStarLevel(parts[0] ?? '');
    const max = parseStarLevel(parts[1] ?? '');
    if (min !== null && max !== null) return { min, max };
    return null;
  }
  const only = parseStarLevel(normalized);
  if (only === null) return null;
  // 「★3以上」は上限なし、単独の「★3」はその値だけ。
  return /(以上|以降)/.test(text) ? { min: only, max: REPORT_LEVEL_MAX } : { min: only, max: only };
}

/**
 * 組み立てた行をスキーマに通す。通らなければ理由(日本語)を返し、その行だけ捨てる。
 * 1行の入力ミスで表全体の取込が失敗しないようにするため。
 */
function parseRow<S extends z.ZodTypeAny>(
  schema: S,
  value: unknown,
): { ok: true; data: z.infer<S> } | { ok: false; message: string } {
  const parsed = schema.safeParse(value);
  if (parsed.success) return { ok: true, data: parsed.data };
  const message = parsed.error.issues
    .map((issue) => `${issue.path.join('.') || '行'}: ${issue.message}`)
    .join(' / ');
  return { ok: false, message };
}
