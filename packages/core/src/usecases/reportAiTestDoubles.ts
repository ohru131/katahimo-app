import type {
  CustomerReportProfileInput,
  CustomerReportProfileRecord,
  CustomerReportProfileRepositoryPort,
  NewReportAiGenerationInput,
  ReportAgeBandInput,
  ReportAgeBandRecord,
  ReportAiConfigRepositoryPort,
  ReportAiConfigSnapshot,
  ReportAiGenerationRecord,
  ReportAiGenerationRepositoryPort,
  ReportEducationLevelInput,
  ReportEducationLevelRecord,
  ReportKeywordInput,
  ReportKeywordRecord,
  ReportPhraseInput,
  ReportPhraseRecord,
  ReportStressLevelInput,
  ReportStressLevelRecord,
} from '../ports/reportAiRepositories';

/**
 * 日報AI(3軸の設定・家庭ごとの★・生成の記録)のインメモリ実装。testDoubles.ts と同じく
 * usecases のテスト専用で、本番コードから参照してはいけない。
 *
 * 実DBを使わずに確かめたいのは「年齢帯の重なりを入口で弾いているか」「取込がどの順で
 * 何件反映するか」「廃止した語を消さずに残すか」で、いずれもSQLではなくユースケース側の
 * 判断。SQLそのものが要点になる検証(upsert・対応表の入れ替え・RLS)は PGlite で行う
 * (packages/demo/src/reportAiRepositories.test.ts)。
 */

/** テナントを跨いで行を持つので、フェイクの中では常に (tenantId, 鍵) で引く。 */
export class FakeReportAiConfigRepository implements ReportAiConfigRepositoryPort {
  private readonly ageBands: ReportAgeBandRecord[] = [];
  private readonly keywords: ReportKeywordRecord[] = [];
  /** 年齢帯ID → キーワードIDの並び(report_age_band_keywords)。 */
  private readonly links: { tenantId: string; ageBandId: string; keywordId: string; sortOrder: number }[] =
    [];
  private readonly educationLevels: ReportEducationLevelRecord[] = [];
  private readonly stressLevels: ReportStressLevelRecord[] = [];
  private readonly phrases: ReportPhraseRecord[] = [];

  async loadAll(tenantId: string): Promise<ReportAiConfigSnapshot> {
    const ageBandKeywordIds: Record<string, string[]> = {};
    for (const link of this.links.filter((l) => l.tenantId === tenantId).sort(bySortOrder)) {
      const current = ageBandKeywordIds[link.ageBandId];
      if (current) current.push(link.keywordId);
      else ageBandKeywordIds[link.ageBandId] = [link.keywordId];
    }
    return {
      ageBands: this.ageBands.filter((r) => r.tenantId === tenantId).map(copy),
      keywords: this.keywords.filter((r) => r.tenantId === tenantId).map(copy),
      ageBandKeywordIds,
      educationLevels: this.educationLevels.filter((r) => r.tenantId === tenantId).map(copy),
      stressLevels: this.stressLevels.filter((r) => r.tenantId === tenantId).map(copy),
      phrases: this.phrases.filter((r) => r.tenantId === tenantId).map(copy),
    };
  }

  async upsertAgeBand(tenantId: string, input: ReportAgeBandInput): Promise<ReportAgeBandRecord> {
    const current = this.ageBands.find((r) => r.tenantId === tenantId && r.code === input.code);
    if (current) {
      Object.assign(current, input);
      return copy(current);
    }
    const record: ReportAgeBandRecord = { id: crypto.randomUUID(), tenantId, ...input };
    this.ageBands.push(record);
    return copy(record);
  }

  async deleteAgeBand(tenantId: string, code: string): Promise<boolean> {
    const index = this.ageBands.findIndex((r) => r.tenantId === tenantId && r.code === code);
    if (index < 0) return false;
    const [removed] = this.ageBands.splice(index, 1);
    if (removed) removeWhere(this.links, (l) => l.tenantId === tenantId && l.ageBandId === removed.id);
    return true;
  }

  async upsertKeyword(tenantId: string, input: ReportKeywordInput): Promise<ReportKeywordRecord> {
    const { ageBandCodes, ...fields } = input;
    const existing = this.keywords.find((r) => r.tenantId === tenantId && r.code === input.code);
    const record: ReportKeywordRecord = existing ?? { id: crypto.randomUUID(), tenantId, ...fields };
    if (existing) Object.assign(record, fields);
    else this.keywords.push(record);

    removeWhere(this.links, (l) => l.tenantId === tenantId && l.keywordId === record.id);
    for (const code of new Set(ageBandCodes)) {
      const band = this.ageBands.find((r) => r.tenantId === tenantId && r.code === code);
      if (!band) throw new Error(`年齢帯コード ${code} は登録されていません。`);
      this.links.push({ tenantId, ageBandId: band.id, keywordId: record.id, sortOrder: input.sortOrder });
    }
    return copy(record);
  }

  async upsertEducationLevel(
    tenantId: string,
    input: ReportEducationLevelInput,
  ): Promise<ReportEducationLevelRecord> {
    const current = this.educationLevels.find((r) => r.tenantId === tenantId && r.level === input.level);
    if (current) {
      Object.assign(current, input);
      return copy(current);
    }
    const record: ReportEducationLevelRecord = { id: crypto.randomUUID(), tenantId, ...input };
    this.educationLevels.push(record);
    return copy(record);
  }

  async upsertStressLevel(tenantId: string, input: ReportStressLevelInput): Promise<ReportStressLevelRecord> {
    const current = this.stressLevels.find((r) => r.tenantId === tenantId && r.level === input.level);
    if (current) {
      Object.assign(current, input);
      return copy(current);
    }
    const record: ReportStressLevelRecord = { id: crypto.randomUUID(), tenantId, ...input };
    this.stressLevels.push(record);
    return copy(record);
  }

  async replacePhrases(tenantId: string, inputs: ReportPhraseInput[]): Promise<ReportPhraseRecord[]> {
    removeWhere(this.phrases, (r) => r.tenantId === tenantId);
    const saved = inputs.map((input) => ({ id: crypto.randomUUID(), tenantId, ...input }));
    this.phrases.push(...saved);
    return saved.map(copy);
  }

  async upsertPhrasesByBody(tenantId: string, inputs: ReportPhraseInput[]): Promise<ReportPhraseRecord[]> {
    const saved: ReportPhraseRecord[] = [];
    for (const input of inputs) {
      const current = this.phrases.find(
        (r) => r.tenantId === tenantId && r.kind === input.kind && r.body === input.body,
      );
      if (current) {
        Object.assign(current, input);
        saved.push(copy(current));
        continue;
      }
      const record: ReportPhraseRecord = { id: crypto.randomUUID(), tenantId, ...input };
      this.phrases.push(record);
      saved.push(copy(record));
    }
    return saved;
  }

  // --- テストの前提を作るためのヘルパー(ポートには無い) ---

  /** そのテナントの年齢帯を並び順で。 */
  listAgeBandsForTest(tenantId: string): ReportAgeBandRecord[] {
    return this.ageBands.filter((r) => r.tenantId === tenantId).map(copy);
  }

  /** そのキーワードに紐づく年齢帯コード(対応表が入れ替わったかを見る)。 */
  ageBandCodesForTest(tenantId: string, keywordCode: string): string[] {
    const keyword = this.keywords.find((r) => r.tenantId === tenantId && r.code === keywordCode);
    if (!keyword) return [];
    return this.links
      .filter((l) => l.tenantId === tenantId && l.keywordId === keyword.id)
      .map((l) => this.ageBands.find((b) => b.id === l.ageBandId)?.code ?? '')
      .filter((code) => code !== '')
      .sort();
  }

  listPhrasesForTest(tenantId: string): ReportPhraseRecord[] {
    return this.phrases.filter((r) => r.tenantId === tenantId).map(copy);
  }
}

export class FakeCustomerReportProfileRepository implements CustomerReportProfileRepositoryPort {
  private readonly rows: CustomerReportProfileRecord[] = [];

  async find(tenantId: string, customerId: string): Promise<CustomerReportProfileRecord | null> {
    const row = this.rows.find((r) => r.tenantId === tenantId && r.customerId === customerId);
    return row ? copy(row) : null;
  }

  async findMany(tenantId: string, customerIds: string[]): Promise<CustomerReportProfileRecord[]> {
    const wanted = new Set(customerIds);
    return this.rows.filter((r) => r.tenantId === tenantId && wanted.has(r.customerId)).map(copy);
  }

  async upsert(
    tenantId: string,
    customerId: string,
    input: CustomerReportProfileInput,
  ): Promise<CustomerReportProfileRecord> {
    const current = this.rows.find((r) => r.tenantId === tenantId && r.customerId === customerId);
    if (current) {
      Object.assign(current, input, { updatedAt: new Date() });
      return copy(current);
    }
    const record: CustomerReportProfileRecord = { tenantId, customerId, ...input, updatedAt: new Date() };
    this.rows.push(record);
    return copy(record);
  }
}

export class FakeReportAiGenerationRepository implements ReportAiGenerationRepositoryPort {
  private readonly rows: ReportAiGenerationRecord[] = [];
  /** 日報から参照されている生成のID。実DBの daily_reports.ai_generation_id の代わり。 */
  private readonly referenced = new Set<string>();

  async create(input: NewReportAiGenerationInput): Promise<ReportAiGenerationRecord> {
    const record: ReportAiGenerationRecord = {
      ...input,
      candidateKeywordIds: [...new Set(input.candidateKeywordIds)],
      usedKeywordIds: [...new Set(input.usedKeywordIds)],
      id: crypto.randomUUID(),
      createdAt: new Date(),
    };
    this.rows.push(record);
    return copy(record);
  }

  async findById(tenantId: string, id: string): Promise<ReportAiGenerationRecord | null> {
    const row = this.rows.find((r) => r.tenantId === tenantId && r.id === id);
    return row ? copy(row) : null;
  }

  async purgeUnreferencedOlderThan(tenantId: string, cutoff: Date): Promise<number> {
    const targets = this.rows.filter(
      (r) => r.tenantId === tenantId && r.createdAt < cutoff && !this.referenced.has(r.id),
    );
    removeWhere(this.rows, (r) => targets.includes(r));
    return targets.length;
  }

  // --- テストの前提を作るためのヘルパー ---

  /** 日報がこの生成を参照している状態にする(保持期間の削除で残ることを確かめる用)。 */
  markReferencedForTest(generationId: string): void {
    this.referenced.add(generationId);
  }

  /** 作成日時を差し替える(保持期間を跨いだ古い行を作る用)。 */
  setCreatedAtForTest(generationId: string, createdAt: Date): void {
    const row = this.rows.find((r) => r.id === generationId);
    if (row) row.createdAt = createdAt;
  }

  listForTest(tenantId: string): ReportAiGenerationRecord[] {
    return this.rows.filter((r) => r.tenantId === tenantId).map(copy);
  }
}

/** 返した行を呼び出し側で書き換えても中身が変わらないようにする(実DBに寄せる)。 */
function copy<T>(row: T): T {
  return { ...row };
}

function bySortOrder(a: { sortOrder: number }, b: { sortOrder: number }): number {
  return a.sortOrder - b.sortOrder;
}

/** 条件に当たる行を配列から取り除く(配列そのものは作り直さない)。 */
function removeWhere<T>(rows: T[], predicate: (row: T) => boolean): void {
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (row !== undefined && predicate(row)) rows.splice(i, 1);
  }
}
