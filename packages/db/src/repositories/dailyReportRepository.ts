import type { DailyReportContent } from '@katahimo/core/domain';
import type {
  DailyReportRecord,
  DailyReportRepositoryPort,
  NewDailyReportInput,
  TransactionScope,
} from '@katahimo/core/ports';
import { and, desc, eq, lt } from 'drizzle-orm';
import { dailyReports } from '../schema';
import type { Database } from '../tenantScope';
import { withTenant } from '../tenantScope';

type DailyReportRow = typeof dailyReports.$inferSelect;

/**
 * DailyReportContent ↔ daily_reports の項目別平文列(1:1)の詰め替え。
 * 列を足したら両方向を同時に更新する(schema/dailyReports.ts 参照)。
 */
function toContentColumns(content: DailyReportContent) {
  return {
    startTime: content.startTime,
    endTime: content.endTime,
    inputText: content.inputText,
    internalText: content.internalText,
    customerText: content.customerText,
  };
}

/** daily_reportsの項目別平文列から、DailyReportContentを組み立てる。 */
function toContent(row: DailyReportRow): DailyReportContent {
  return {
    startTime: row.startTime,
    endTime: row.endTime,
    inputText: row.inputText,
    internalText: row.internalText,
    customerText: row.customerText,
  };
}

/** DrizzleのdailyReportsテーブルのSELECT結果行を、ポート層のDailyReportRecordに変換する。 */
function toRecord(row: DailyReportRow): DailyReportRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    staffId: row.staffId,
    customerId: row.customerId,
    occurredAt: row.occurredAt,
    riskRating: row.riskRating,
    esRating: row.esRating,
    content: toContent(row),
    updatedAt: row.updatedAt,
  };
}

export class DrizzleDailyReportRepository implements DailyReportRepositoryPort {
  constructor(private readonly db: Database) {}

  async create(input: NewDailyReportInput, scope?: TransactionScope): Promise<DailyReportRecord> {
    return withTenant(
      this.db,
      input.tenantId,
      async (tx) => {
        const rows = await tx
          .insert(dailyReports)
          .values({
            tenantId: input.tenantId,
            staffId: input.staffId,
            customerId: input.customerId,
            occurredAt: input.occurredAt,
            riskRating: input.riskRating,
            esRating: input.esRating,
            ...toContentColumns(input.content),
          })
          .returning();
        const row = rows[0];
        if (!row) throw new Error('日報の保存に失敗しました');
        return toRecord(row);
      },
      scope,
    );
  }

  async update(
    tenantId: string,
    id: string,
    input: NewDailyReportInput,
    scope?: TransactionScope,
  ): Promise<DailyReportRecord | null> {
    return withTenant(
      this.db,
      tenantId,
      async (tx) => {
        const rows = await tx
          .update(dailyReports)
          .set({
            occurredAt: input.occurredAt,
            riskRating: input.riskRating,
            esRating: input.esRating,
            ...toContentColumns(input.content),
            updatedAt: new Date(),
          })
          .where(eq(dailyReports.id, id))
          .returning();
        const row = rows[0];
        return row ? toRecord(row) : null;
      },
      scope,
    );
  }

  async findById(tenantId: string, id: string): Promise<DailyReportRecord | null> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx.select().from(dailyReports).where(eq(dailyReports.id, id)).limit(1);
      const row = rows[0];
      return row ? toRecord(row) : null;
    });
  }

  async listByCustomer(
    tenantId: string,
    customerId: string,
    before: Date | null,
    limit: number,
  ): Promise<DailyReportRecord[]> {
    return withTenant(this.db, tenantId, async (tx) => {
      const condition = before
        ? and(eq(dailyReports.customerId, customerId), lt(dailyReports.occurredAt, before))
        : eq(dailyReports.customerId, customerId);
      const rows = await tx
        .select()
        .from(dailyReports)
        .where(condition)
        .orderBy(desc(dailyReports.occurredAt))
        .limit(limit);
      return rows.map(toRecord);
    });
  }
}
