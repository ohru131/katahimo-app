import type {
  NewReportAiGenerationInput,
  ReportAiGenerationRecord,
  ReportAiGenerationRepositoryPort,
} from '@katahimo/core/ports';
import { and, eq, inArray, lt, notExists } from 'drizzle-orm';
import { dailyReports, reportAiGenerationKeywords, reportAiGenerations } from '../schema';
import type { Database, DatabaseTransaction } from '../tenantScope';
import { withTenant } from '../tenantScope';

type GenerationRow = typeof reportAiGenerations.$inferSelect;

/** 行と、候補語・使用語のIDから、ユースケースが受け取る記録の形を組み立てる。 */
function toRecord(
  row: GenerationRow,
  candidateKeywordIds: string[],
  usedKeywordIds: string[],
): ReportAiGenerationRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    staffId: row.staffId,
    customerId: row.customerId,
    targetFamilyMemberId: row.targetFamilyMemberId,
    promptTemplateId: row.promptTemplateId,
    promptText: row.promptText,
    model: row.model,
    childAgeMonths: row.childAgeMonths,
    educationLevel: row.educationLevel,
    effectiveEducationLevel: row.effectiveEducationLevel,
    stressLevel: row.stressLevel,
    escalationRequired: row.escalationRequired,
    inputText: row.inputText,
    timeInfo: row.timeInfo,
    outputJson: row.outputJson ?? null,
    errorMessage: row.errorMessage,
    candidateKeywordIds,
    usedKeywordIds,
    createdAt: row.createdAt,
  };
}

/** 同じ語を2回渡されても主キー(tenant, generation, keyword, role)で落ちないよう、重複を潰す。 */
function unique(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

/**
 * 1回のトランザクションで消す生成の件数。保持期間を初めて回した日など、消す対象が
 * 何万件も溜まっていることがあるので、IN句と削除を一度に膨らませずに区切って回す。
 */
const PURGE_BATCH_SIZE = 1000;

/**
 * AI生成の記録(`report_ai_generations` と `report_ai_generation_keywords`)のリポジトリ実装。
 *
 * この表は事実の記録なので更新のメソッドを持たない(生成結果を後から直すことはない)。
 * 人が直した最終版は `daily_reports` 側にある。
 */
export class DrizzleReportAiGenerationRepository implements ReportAiGenerationRepositoryPort {
  /** `purgeBatchSize` はテストで小さくして複数バッチの動きを確かめるためだけに差し替える。 */
  constructor(
    private readonly db: Database,
    private readonly purgeBatchSize: number = PURGE_BATCH_SIZE,
  ) {}

  /**
   * 生成1回と、提示した候補語・使われた語を同じトランザクションで書く。
   * 片方だけ残ると「候補が空だった生成」と区別が付かず、後からの検証の材料にならない。
   */
  async create(input: NewReportAiGenerationInput): Promise<ReportAiGenerationRecord> {
    return withTenant(this.db, input.tenantId, async (tx) => {
      const rows = await tx
        .insert(reportAiGenerations)
        .values({
          tenantId: input.tenantId,
          staffId: input.staffId,
          customerId: input.customerId,
          targetFamilyMemberId: input.targetFamilyMemberId,
          promptTemplateId: input.promptTemplateId,
          promptText: input.promptText,
          model: input.model,
          childAgeMonths: input.childAgeMonths,
          educationLevel: input.educationLevel,
          effectiveEducationLevel: input.effectiveEducationLevel,
          stressLevel: input.stressLevel,
          escalationRequired: input.escalationRequired,
          inputText: input.inputText,
          timeInfo: input.timeInfo,
          outputJson: input.outputJson ?? null,
          errorMessage: input.errorMessage,
        })
        .returning();
      const row = rows[0];
      if (!row) throw new Error('AI生成の記録に失敗しました');

      const candidateKeywordIds = unique(input.candidateKeywordIds);
      const usedKeywordIds = unique(input.usedKeywordIds);
      const links = [
        ...candidateKeywordIds.map((keywordId) => ({
          tenantId: input.tenantId,
          generationId: row.id,
          keywordId,
          role: 'candidate' as const,
        })),
        ...usedKeywordIds.map((keywordId) => ({
          tenantId: input.tenantId,
          generationId: row.id,
          keywordId,
          role: 'used' as const,
        })),
      ];
      if (links.length > 0) await tx.insert(reportAiGenerationKeywords).values(links);

      return toRecord(row, candidateKeywordIds, usedKeywordIds);
    });
  }

  /** 生成1回を、候補語・使用語ごと読む。他テナントのIDを渡しても null(RLSと明示の条件の両方で絞る)。 */
  async findById(tenantId: string, id: string): Promise<ReportAiGenerationRecord | null> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(reportAiGenerations)
        .where(and(eq(reportAiGenerations.tenantId, tenantId), eq(reportAiGenerations.id, id)))
        .limit(1);
      const row = rows[0];
      if (!row) return null;

      const links = await tx
        .select()
        .from(reportAiGenerationKeywords)
        .where(
          and(
            eq(reportAiGenerationKeywords.tenantId, tenantId),
            eq(reportAiGenerationKeywords.generationId, id),
          ),
        );
      return toRecord(
        row,
        links.filter((link) => link.role === 'candidate').map((link) => link.keywordId),
        links.filter((link) => link.role === 'used').map((link) => link.keywordId),
      );
    });
  }

  /**
   * 保存されなかった下書き(どの日報からも参照されていない行)のうち、`cutoff` より古いものを消す。
   * 消した合計件数を返す。
   *
   * 消す対象のIDを先に確定させてから、キーワードの行 → 生成の行の順で消す(逆順だと複合FKで
   * 落ちる)。DELETE ... USING で一度に書かず2段にしているのは、PGlite(公開デモ)でも
   * 同じクエリが通る形にするため。
   *
   * 取得と削除を `purgeBatchSize` 件ずつ繰り返すのは、対象が大量に溜まっていても
   * 1つの長いトランザクションと巨大なIN句にしないため。1バッチずつ確定するので、
   * 途中で失敗してもそこまでの削除は残る(次回の実行が続きから消す)。
   */
  async purgeUnreferencedOlderThan(tenantId: string, cutoff: Date): Promise<number> {
    let deleted = 0;
    for (;;) {
      const removed = await withTenant(this.db, tenantId, async (tx) => {
        const targets = await selectPurgeTargets(tx, tenantId, cutoff, this.purgeBatchSize);
        if (targets.length === 0) return 0;

        await tx
          .delete(reportAiGenerationKeywords)
          .where(
            and(
              eq(reportAiGenerationKeywords.tenantId, tenantId),
              inArray(reportAiGenerationKeywords.generationId, targets),
            ),
          );
        await tx
          .delete(reportAiGenerations)
          .where(and(eq(reportAiGenerations.tenantId, tenantId), inArray(reportAiGenerations.id, targets)));
        return targets.length;
      });

      deleted += removed;
      // 上限に満たなければ、その回で対象を消し切っている(次を引いても空)。
      if (removed < this.purgeBatchSize) return deleted;
    }
  }
}

/** 「cutoff より古く、どの日報からも参照されていない」生成のIDを、最大 `limit` 件。 */
async function selectPurgeTargets(
  tx: DatabaseTransaction,
  tenantId: string,
  cutoff: Date,
  limit: number,
): Promise<string[]> {
  const rows = await tx
    .select({ id: reportAiGenerations.id })
    .from(reportAiGenerations)
    .where(
      and(
        eq(reportAiGenerations.tenantId, tenantId),
        lt(reportAiGenerations.createdAt, cutoff),
        notExists(
          tx
            .select({ one: dailyReports.id })
            .from(dailyReports)
            .where(
              and(
                eq(dailyReports.tenantId, tenantId),
                eq(dailyReports.aiGenerationId, reportAiGenerations.id),
              ),
            ),
        ),
      ),
    )
    .limit(limit);
  return rows.map((row) => row.id);
}
