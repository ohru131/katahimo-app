import type {
  ReportAgeBandInput,
  ReportAgeBandRecord,
  ReportAiConfigRepositoryPort,
  ReportAiConfigSnapshot,
  ReportAiLevelsSnapshot,
  ReportEducationLevelInput,
  ReportEducationLevelRecord,
  ReportKeywordInput,
  ReportKeywordRecord,
  ReportPhraseInput,
  ReportPhraseRecord,
  ReportStressLevelInput,
  ReportStressLevelRecord,
} from '@katahimo/core/ports';
import type { ReportPhraseKind, ReportPhrasePlacement } from '@katahimo/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';
import {
  reportAgeBandKeywords,
  reportAgeBands,
  reportEducationLevels,
  reportKeywords,
  reportPhrases,
  reportStressLevels,
} from '../schema';
import type { Database, DatabaseTransaction } from '../tenantScope';
import { withTenant } from '../tenantScope';

type AgeBandRow = typeof reportAgeBands.$inferSelect;
type KeywordRow = typeof reportKeywords.$inferSelect;
type EducationLevelRow = typeof reportEducationLevels.$inferSelect;
type StressLevelRow = typeof reportStressLevels.$inferSelect;
type PhraseRow = typeof reportPhrases.$inferSelect;

function toAgeBand(row: AgeBandRow): ReportAgeBandRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    code: row.code,
    label: row.label,
    ageFromMonths: row.ageFromMonths,
    ageToMonths: row.ageToMonths,
    behaviorWords: row.behaviorWords,
    developmentTopics: row.developmentTopics,
    sceneExamples: row.sceneExamples,
    sortOrder: row.sortOrder,
  };
}

function toKeyword(row: KeywordRow): ReportKeywordRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    code: row.code,
    category: row.category,
    name: row.name,
    subConcept: row.subConcept,
    ageFromMonths: row.ageFromMonths,
    ageToMonths: row.ageToMonths,
    educationLevelMin: row.educationLevelMin,
    educationLevelMax: row.educationLevelMax,
    stressLevelMin: row.stressLevelMin,
    tone: row.tone,
    parentExplanation: row.parentExplanation,
    phraseExamples: row.phraseExamples,
    usageScene: row.usageScene,
    ngExample: row.ngExample,
    sortOrder: row.sortOrder,
    active: row.active,
  };
}

function toEducationLevel(row: EducationLevelRow): ReportEducationLevelRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    level: row.level,
    label: row.label,
    description: row.description,
    promptInstruction: row.promptInstruction,
    maxKeywords: row.maxKeywords,
    allowTermNames: row.allowTermNames,
  };
}

function toStressLevel(row: StressLevelRow): ReportStressLevelRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    level: row.level,
    label: row.label,
    criteria: row.criteria,
    promptInstruction: row.promptInstruction,
    educationLevelShift: row.educationLevelShift,
    keywordsEnabled: row.keywordsEnabled,
    escalationRequired: row.escalationRequired,
  };
}

/** kind / placement はDBではtext(許可値はCHECK制約が縛る)なので、読み出しでドメインの型に戻す。 */
function toPhrase(row: PhraseRow): ReportPhraseRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    kind: row.kind as ReportPhraseKind,
    body: row.body,
    intent: row.intent,
    stressLevelMin: row.stressLevelMin,
    stressLevelMax: row.stressLevelMax,
    placement: row.placement as ReportPhrasePlacement,
    sortOrder: row.sortOrder,
    active: row.active,
  };
}

/** insert / update で同じ値を使うため、入力から列の組を1度だけ作る。 */
function ageBandValues(tenantId: string, input: ReportAgeBandInput) {
  return {
    tenantId,
    code: input.code,
    label: input.label,
    ageFromMonths: input.ageFromMonths,
    ageToMonths: input.ageToMonths,
    behaviorWords: input.behaviorWords,
    developmentTopics: input.developmentTopics,
    sceneExamples: input.sceneExamples,
    sortOrder: input.sortOrder,
  };
}

function keywordValues(tenantId: string, input: ReportKeywordInput) {
  return {
    tenantId,
    code: input.code,
    category: input.category,
    name: input.name,
    subConcept: input.subConcept,
    ageFromMonths: input.ageFromMonths,
    ageToMonths: input.ageToMonths,
    educationLevelMin: input.educationLevelMin,
    educationLevelMax: input.educationLevelMax,
    stressLevelMin: input.stressLevelMin,
    tone: input.tone,
    parentExplanation: input.parentExplanation,
    phraseExamples: input.phraseExamples,
    usageScene: input.usageScene,
    ngExample: input.ngExample,
    sortOrder: input.sortOrder,
    active: input.active,
  };
}

function phraseValues(tenantId: string, input: ReportPhraseInput) {
  return {
    tenantId,
    kind: input.kind,
    body: input.body,
    intent: input.intent,
    stressLevelMin: input.stressLevelMin,
    stressLevelMax: input.stressLevelMax,
    placement: input.placement,
    sortOrder: input.sortOrder,
    active: input.active,
  };
}

/**
 * 日報AIの設定6表(年齢帯・キーワード・その対応・教育関心度★・ストレス度・表現)のリポジトリ実装。
 * 識別子は `code`(年齢帯・キーワード)と `level`(各レベル定義)で、画面・取込のどちらから来た
 * 行も同じ鍵で upsert する(UUIDは外に出さない)。
 */
export class DrizzleReportAiConfigRepository implements ReportAiConfigRepositoryPort {
  constructor(private readonly db: Database) {}

  /** テナントの設定一式。生成1回・管理画面1表示でこれだけを読む。 */
  async loadAll(tenantId: string): Promise<ReportAiConfigSnapshot> {
    return withTenant(this.db, tenantId, async (tx) => {
      // 1つのトランザクション(=1接続)で順に読む。並列に投げるとドライバによっては
      // 同じ接続を取り合うため、件数の少ないこの6本は直列で十分。
      const bands = await tx
        .select()
        .from(reportAgeBands)
        .where(eq(reportAgeBands.tenantId, tenantId))
        .orderBy(asc(reportAgeBands.sortOrder), asc(reportAgeBands.ageFromMonths));
      const keywords = await tx
        .select()
        .from(reportKeywords)
        .where(eq(reportKeywords.tenantId, tenantId))
        .orderBy(asc(reportKeywords.sortOrder), asc(reportKeywords.code));
      const links = await tx
        .select()
        .from(reportAgeBandKeywords)
        .where(eq(reportAgeBandKeywords.tenantId, tenantId))
        .orderBy(asc(reportAgeBandKeywords.sortOrder));
      const educationLevels = await tx
        .select()
        .from(reportEducationLevels)
        .where(eq(reportEducationLevels.tenantId, tenantId))
        .orderBy(asc(reportEducationLevels.level));
      const stressLevels = await tx
        .select()
        .from(reportStressLevels)
        .where(eq(reportStressLevels.tenantId, tenantId))
        .orderBy(asc(reportStressLevels.level));
      const phrases = await tx
        .select()
        .from(reportPhrases)
        .where(eq(reportPhrases.tenantId, tenantId))
        .orderBy(asc(reportPhrases.sortOrder), asc(reportPhrases.body));

      const ageBandKeywordIds: Record<string, string[]> = {};
      for (const link of links) {
        const current = ageBandKeywordIds[link.ageBandId];
        if (current) current.push(link.keywordId);
        else ageBandKeywordIds[link.ageBandId] = [link.keywordId];
      }

      return {
        ageBands: bands.map(toAgeBand),
        keywords: keywords.map(toKeyword),
        ageBandKeywordIds,
        educationLevels: educationLevels.map(toEducationLevel),
        stressLevels: stressLevels.map(toStressLevel),
        phrases: phrases.map(toPhrase),
      };
    });
  }

  /** レベルの2表だけ。全スタッフが開く画面向けなので、キーワード表・表現までは読まない。 */
  async loadLevels(tenantId: string): Promise<ReportAiLevelsSnapshot> {
    return withTenant(this.db, tenantId, async (tx) => {
      const educationLevels = await tx
        .select()
        .from(reportEducationLevels)
        .where(eq(reportEducationLevels.tenantId, tenantId))
        .orderBy(asc(reportEducationLevels.level));
      const stressLevels = await tx
        .select()
        .from(reportStressLevels)
        .where(eq(reportStressLevels.tenantId, tenantId))
        .orderBy(asc(reportStressLevels.level));
      return {
        educationLevels: educationLevels.map(toEducationLevel),
        stressLevels: stressLevels.map(toStressLevel),
      };
    });
  }

  async upsertAgeBand(tenantId: string, input: ReportAgeBandInput): Promise<ReportAgeBandRecord> {
    return withTenant(this.db, tenantId, async (tx) => {
      const values = ageBandValues(tenantId, input);
      const rows = await tx
        .insert(reportAgeBands)
        .values(values)
        .onConflictDoUpdate({
          target: [reportAgeBands.tenantId, reportAgeBands.code],
          set: values,
        })
        .returning();
      const row = rows[0];
      if (!row) throw new Error('年齢帯の保存に失敗しました');
      return toAgeBand(row);
    });
  }

  /** 対応表(report_age_band_keywords)の行も同じトランザクションで消す。 */
  async deleteAgeBand(tenantId: string, code: string): Promise<boolean> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select({ id: reportAgeBands.id })
        .from(reportAgeBands)
        .where(and(eq(reportAgeBands.tenantId, tenantId), eq(reportAgeBands.code, code)))
        .limit(1);
      const band = rows[0];
      if (!band) return false;

      await tx
        .delete(reportAgeBandKeywords)
        .where(
          and(eq(reportAgeBandKeywords.tenantId, tenantId), eq(reportAgeBandKeywords.ageBandId, band.id)),
        );
      await tx
        .delete(reportAgeBands)
        .where(and(eq(reportAgeBands.tenantId, tenantId), eq(reportAgeBands.id, band.id)));
      return true;
    });
  }

  async upsertKeyword(tenantId: string, input: ReportKeywordInput): Promise<ReportKeywordRecord> {
    return withTenant(this.db, tenantId, async (tx) => {
      const values = keywordValues(tenantId, input);
      const rows = await tx
        .insert(reportKeywords)
        .values(values)
        .onConflictDoUpdate({
          target: [reportKeywords.tenantId, reportKeywords.code],
          set: values,
        })
        .returning();
      const row = rows[0];
      if (!row) throw new Error('キーワードの保存に失敗しました');

      await replaceKeywordAgeBands(tx, tenantId, row.id, input);
      return toKeyword(row);
    });
  }

  async upsertEducationLevel(
    tenantId: string,
    input: ReportEducationLevelInput,
  ): Promise<ReportEducationLevelRecord> {
    return withTenant(this.db, tenantId, async (tx) => {
      const values = {
        tenantId,
        level: input.level,
        label: input.label,
        description: input.description,
        promptInstruction: input.promptInstruction,
        maxKeywords: input.maxKeywords,
        allowTermNames: input.allowTermNames,
      };
      const rows = await tx
        .insert(reportEducationLevels)
        .values(values)
        .onConflictDoUpdate({
          target: [reportEducationLevels.tenantId, reportEducationLevels.level],
          set: values,
        })
        .returning();
      const row = rows[0];
      if (!row) throw new Error('教育関心度の判定基準の保存に失敗しました');
      return toEducationLevel(row);
    });
  }

  async upsertStressLevel(tenantId: string, input: ReportStressLevelInput): Promise<ReportStressLevelRecord> {
    return withTenant(this.db, tenantId, async (tx) => {
      const values = {
        tenantId,
        level: input.level,
        label: input.label,
        criteria: input.criteria,
        promptInstruction: input.promptInstruction,
        educationLevelShift: input.educationLevelShift,
        keywordsEnabled: input.keywordsEnabled,
        escalationRequired: input.escalationRequired,
      };
      const rows = await tx
        .insert(reportStressLevels)
        .values(values)
        .onConflictDoUpdate({
          target: [reportStressLevels.tenantId, reportStressLevels.level],
          set: values,
        })
        .returning();
      const row = rows[0];
      if (!row) throw new Error('ストレス度の判定基準の保存に失敗しました');
      return toStressLevel(row);
    });
  }

  /** 全件入れ替え。削除と挿入を同じトランザクションで行う(途中の状態を他から読ませない)。 */
  async replacePhrases(tenantId: string, inputs: ReportPhraseInput[]): Promise<ReportPhraseRecord[]> {
    return withTenant(this.db, tenantId, async (tx) => {
      await tx.delete(reportPhrases).where(eq(reportPhrases.tenantId, tenantId));
      if (inputs.length === 0) return [];
      const rows = await tx
        .insert(reportPhrases)
        .values(inputs.map((input) => phraseValues(tenantId, input)))
        .returning();
      return rows.map(toPhrase);
    });
  }

  /**
   * 取込用。`kind` + `body` が同じ行を更新し、無ければ足す。
   *
   * (tenant_id, kind, body) の一意制約は置いていない(同じ文言を意図的に2行持つ運用を
   * 縛りたくないため)ので、`ON CONFLICT` ではなく読んでから振り分ける。取込は管理者が
   * 明示的に実行する操作で、同時に2本走る想定がない。
   */
  async upsertPhrasesByBody(tenantId: string, inputs: ReportPhraseInput[]): Promise<ReportPhraseRecord[]> {
    if (inputs.length === 0) return [];
    return withTenant(this.db, tenantId, async (tx) => {
      const existing = await tx.select().from(reportPhrases).where(eq(reportPhrases.tenantId, tenantId));
      const byKey = new Map(existing.map((row) => [`${row.kind}\n${row.body}`, row]));

      const saved: ReportPhraseRecord[] = [];
      for (const input of inputs) {
        const values = phraseValues(tenantId, input);
        const current = byKey.get(`${input.kind}\n${input.body}`);
        const rows = current
          ? await tx
              .update(reportPhrases)
              .set(values)
              .where(and(eq(reportPhrases.tenantId, tenantId), eq(reportPhrases.id, current.id)))
              .returning()
          : await tx.insert(reportPhrases).values(values).returning();
        const row = rows[0];
        if (!row) throw new Error('表現の保存に失敗しました');
        saved.push(toPhrase(row));
      }
      return saved;
    });
  }
}

/**
 * キーワード1語ぶんの「相性の良い年齢帯」を入れ替える。
 * 存在しない年齢帯コードは、黙って落とさずエラーにする(取込・APIの入力ミスに気付けるようにする)。
 */
async function replaceKeywordAgeBands(
  tx: DatabaseTransaction,
  tenantId: string,
  keywordId: string,
  input: ReportKeywordInput,
): Promise<void> {
  await tx
    .delete(reportAgeBandKeywords)
    .where(and(eq(reportAgeBandKeywords.tenantId, tenantId), eq(reportAgeBandKeywords.keywordId, keywordId)));

  const codes = [...new Set(input.ageBandCodes)];
  if (codes.length === 0) return;

  const bands = await tx
    .select({ id: reportAgeBands.id, code: reportAgeBands.code })
    .from(reportAgeBands)
    .where(and(eq(reportAgeBands.tenantId, tenantId), inArray(reportAgeBands.code, codes)));
  const idByCode = new Map(bands.map((band) => [band.code, band.id]));
  const missing = codes.filter((code) => !idByCode.has(code));
  if (missing.length > 0) {
    throw new Error(`年齢帯コード ${missing.join(', ')} は登録されていません。`);
  }

  await tx.insert(reportAgeBandKeywords).values(
    codes.map((code) => ({
      tenantId,
      // 上の missing チェックを通っているので必ず引ける。
      ageBandId: idByCode.get(code) as string,
      keywordId,
      // 年齢帯の中での提示順は、語の並び順に合わせる(語ごとに別の順序を持たせない)。
      sortOrder: input.sortOrder,
    })),
  );
}
