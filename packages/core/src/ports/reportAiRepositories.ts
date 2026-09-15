/**
 * 日報AIの3軸(年齢帯・教育関心度★・ストレス度)の設定と、AI生成の記録のポート。
 * 実装はDrizzleスキーマを持つ @katahimo/db(repositories/reportAi*.ts)に置く。
 *
 * 【レコードの型を promptAssembly.ts の入力型から作る理由】
 * 生成の経路は「リポジトリで読む → そのまま `assembleDailyReportPrompt` に渡す」だけで、
 * 途中に詰め替えを挟まない。詰め替えを挟むと、DBの列とプロンプト組み立ての入力がずれても
 * 気付けなくなる(列を足したのに差し込みに出ない、等)。ここでは domain の型を継承して
 * `id` / `tenantId` を足すだけにし、ずれたらコンパイルで落ちるようにしている。
 */

import type {
  ReportAgeBand,
  ReportEducationLevel,
  ReportKeyword,
  ReportPhrase,
  ReportStressLevel,
} from '../domain/reports/promptAssembly';

// ---------------------------------------------------------------------------
// 設定6表(report_age_bands / report_keywords / report_age_band_keywords /
//          report_education_levels / report_stress_levels / report_phrases)
// ---------------------------------------------------------------------------

/** `report_age_bands` の1行。 */
export interface ReportAgeBandRecord extends ReportAgeBand {
  tenantId: string;
}

/** `report_keywords` の1行。 */
export interface ReportKeywordRecord extends ReportKeyword {
  tenantId: string;
}

/** `report_education_levels` の1行。`level` が識別子で、id は参照されない。 */
export interface ReportEducationLevelRecord extends ReportEducationLevel {
  id: string;
  tenantId: string;
}

/** `report_stress_levels` の1行。 */
export interface ReportStressLevelRecord extends ReportStressLevel {
  id: string;
  tenantId: string;
}

/** `report_phrases` の1行。 */
export interface ReportPhraseRecord extends ReportPhrase {
  tenantId: string;
}

/**
 * 生成1回・管理画面1表示ぶんの設定一式。
 *
 * 【1回でまとめて読む理由】
 * 3軸の絞り込みは純関数(promptAssembly.ts)が行うので、生成のたびに条件付きで
 * 表を引き直す意味がない。テナントあたりの行数は数百のオーダー(年齢帯10前後・キーワード
 * 100前後・レベル各5・表現数十)で、1回のSELECTで読み切れる。
 *
 * 【`active=false` の行も返す理由】
 * 管理画面が「廃止した語」も一覧に出して戻せるようにするため。生成側の絞り込みは
 * `selectKeywords` / `selectPhrases` が `active` を見るので、ここで落とす必要はない。
 */
export interface ReportAiConfigSnapshot {
  ageBands: ReportAgeBandRecord[];
  keywords: ReportKeywordRecord[];
  /** 年齢帯ID → 相性の良いキーワードID(`report_age_band_keywords`)。並びは sort_order。 */
  ageBandKeywordIds: Record<string, string[]>;
  educationLevels: ReportEducationLevelRecord[];
  stressLevels: ReportStressLevelRecord[];
  phrases: ReportPhraseRecord[];
}

/** 年齢帯の登録・更新。`code` が識別子(同じコードの行があれば上書き)。 */
export type ReportAgeBandInput = Omit<ReportAgeBandRecord, 'id' | 'tenantId'>;

/**
 * キーワードの登録・更新。`code` が識別子。
 * `ageBandCodes` はそのキーワードの `report_age_band_keywords` の対応行を丸ごと入れ替える
 * (1語あたり数件で、差分を取るより入れ替えた方が「画面に出ている通りになる」ことが確かめやすい)。
 */
export interface ReportKeywordInput extends Omit<ReportKeywordRecord, 'id' | 'tenantId'> {
  ageBandCodes: string[];
}

/** 教育関心度★の定義。`level` が識別子。 */
export type ReportEducationLevelInput = ReportEducationLevel;

/** ストレス度の定義。`level` が識別子。 */
export type ReportStressLevelInput = ReportStressLevel;

/** 表現1件。行を指す鍵を持たない(入れ替え・本文での突合で扱う)。 */
export type ReportPhraseInput = Omit<ReportPhraseRecord, 'id' | 'tenantId'>;

export interface ReportAiConfigRepositoryPort {
  /** テナントの設定一式。生成時も管理画面もこれ1回で読む。 */
  loadAll(tenantId: string): Promise<ReportAiConfigSnapshot>;

  /** 年齢帯を `code` で upsert する。 */
  upsertAgeBand(tenantId: string, input: ReportAgeBandInput): Promise<ReportAgeBandRecord>;
  /**
   * 年齢帯を消す。`report_age_band_keywords` の対応行も同じトランザクションで消す
   * (対応行が残ると複合FKで消せないうえ、消せたとしても宙に浮いた相性が残る)。
   * 該当する行が無ければ false。
   */
  deleteAgeBand(tenantId: string, code: string): Promise<boolean>;

  /**
   * キーワードを `code` で upsert し、`ageBandCodes` を対応表へ反映する。
   * 存在しない年齢帯コードが混じっていればエラー(黙って対応を落とさない)。
   *
   * 【削除を持たない理由】
   * 生成の記録(`report_ai_generation_keywords`)が語の行を参照する。消すと
   * 「この日報にどの語を提示したか」が辿れなくなるので、廃止は `active=false` で行う。
   */
  upsertKeyword(tenantId: string, input: ReportKeywordInput): Promise<ReportKeywordRecord>;

  /** 教育関心度★の定義を `level` で upsert する。 */
  upsertEducationLevel(
    tenantId: string,
    input: ReportEducationLevelInput,
  ): Promise<ReportEducationLevelRecord>;
  /** ストレス度の定義を `level` で upsert する。 */
  upsertStressLevel(tenantId: string, input: ReportStressLevelInput): Promise<ReportStressLevelRecord>;

  /**
   * 表現を全件入れ替える(管理画面の保存)。行を指す鍵が無いため、画面の一覧が
   * そのままテナントの表現一式になる。
   */
  replacePhrases(tenantId: string, inputs: ReportPhraseInput[]): Promise<ReportPhraseRecord[]>;
  /**
   * 取込用。`kind` と `body` が同じ行は更新し、無ければ足す(既存の表現は消さない)。
   * 法人の資料は「今回足した表現だけ」を載せていることが多く、入れ替えにすると
   * 表に載っていない表現が黙って消えるため。
   */
  upsertPhrasesByBody(tenantId: string, inputs: ReportPhraseInput[]): Promise<ReportPhraseRecord[]>;
}

// ---------------------------------------------------------------------------
// 家庭ごとの設定(customer_report_profiles)
// ---------------------------------------------------------------------------

export interface CustomerReportProfileRecord {
  tenantId: string;
  customerId: string;
  /** 教育関心度★(1〜5)。未設定は null(生成時は既定=★2相当として扱う)。 */
  educationLevel: number | null;
  /** ★を付けた根拠・家庭の意向のメモ。 */
  note: string;
  /** 最後に更新したスタッフ。取込・移行で入った行は null。 */
  updatedByStaffId: string | null;
  updatedAt: Date;
}

export type CustomerReportProfileInput = Pick<
  CustomerReportProfileRecord,
  'educationLevel' | 'note' | 'updatedByStaffId'
>;

export interface CustomerReportProfileRepositoryPort {
  find(tenantId: string, customerId: string): Promise<CustomerReportProfileRecord | null>;
  /** 顧客一覧に★を並べる用。渡したIDのうち、行がある顧客だけが返る。 */
  findMany(tenantId: string, customerIds: string[]): Promise<CustomerReportProfileRecord[]>;
  upsert(
    tenantId: string,
    customerId: string,
    input: CustomerReportProfileInput,
  ): Promise<CustomerReportProfileRecord>;
}

// ---------------------------------------------------------------------------
// AI生成の記録(report_ai_generations / report_ai_generation_keywords)
// ---------------------------------------------------------------------------

/**
 * 生成1回の記録。
 *
 * 【`outputJson` と `errorMessage` は必ずどちらか一方】
 * DBの `report_ai_generations_outcome_check` が `(output_json IS NULL) <> (error_message IS NULL)`
 * を強制する。成功なら `outputJson` に AI の生の応答、失敗なら `errorMessage` にその理由を入れ、
 * 両方 null・両方入りの入力は渡さない(渡すとCHECK違反で落ちる)。
 */
export interface NewReportAiGenerationInput {
  tenantId: string;
  staffId: string;
  customerId: string;
  /** 対象児(世帯構成員)。未選択は null(このとき `childAgeMonths` も null)。 */
  targetFamilyMemberId: string | null;
  /** 使った文面の版。既定文面を使ったときは null。 */
  promptTemplateId: string | null;
  /** 実際にモデルへ送ったプロンプト全文。 */
  promptText: string;
  model: string;
  childAgeMonths: number | null;
  /** 生成時点の家庭の★。未設定は null。 */
  educationLevel: number | null;
  /** ストレス度による引き下げ後に実際に適用した★。 */
  effectiveEducationLevel: number | null;
  /** 生成時点のストレス度。未評価は null。 */
  stressLevel: number | null;
  escalationRequired: boolean;
  inputText: string;
  timeInfo: string;
  /** 成功時のAIの応答。失敗時は null(`errorMessage` と排他)。 */
  outputJson: unknown | null;
  /** 失敗時の理由。成功時は null(`outputJson` と排他)。 */
  errorMessage: string | null;
  /** プロンプトに提示した候補語のID。 */
  candidateKeywordIds: string[];
  /** AIが「使った」と答えた語のID。候補と同じ語が両方に入ってよい(PKに role が入っている)。 */
  usedKeywordIds: string[];
}

export interface ReportAiGenerationRecord extends Omit<NewReportAiGenerationInput, 'tenantId'> {
  id: string;
  tenantId: string;
  createdAt: Date;
}

export interface ReportAiGenerationRepositoryPort {
  /**
   * 生成1回を記録する。候補語・使用語(`report_ai_generation_keywords`)も同じ
   * トランザクションで書く。片方だけ残ると「候補が空だった生成」と区別が付かなくなる。
   */
  create(input: NewReportAiGenerationInput): Promise<ReportAiGenerationRecord>;
  findById(tenantId: string, id: string): Promise<ReportAiGenerationRecord | null>;
  /**
   * 保存されなかった下書き(どの日報からも参照されていない行)のうち、`cutoff` より古いものを
   * キーワードの行ごと消す。消した生成の件数を返す。
   *
   * 日報から参照されている行は、保持期間を過ぎても残す(日報から「どの文面・どの語で
   * 生まれたか」を辿れなくなるため)。ワーカー(packages/worker)が日次で呼ぶ。
   */
  purgeUnreferencedOlderThan(tenantId: string, cutoff: Date): Promise<number>;
}
