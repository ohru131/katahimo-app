import type { AccidentReportContent } from '@katahimo/core/domain';
import type {
  AccidentReportRecord,
  AccidentReportRepositoryPort,
  NewAccidentReportInput,
  TransactionScope,
} from '@katahimo/core/ports';
import { and, desc, eq, lt } from 'drizzle-orm';
import { accidentReports } from '../schema';
import type { Database } from '../tenantScope';
import { withTenant } from '../tenantScope';

type AccidentReportRow = typeof accidentReports.$inferSelect;

/**
 * AccidentReportContent ↔ accident_reports の項目別平文列(1:1)の詰め替え。
 * 列を足したら両方向を同時に更新する(schema/accidentReports.ts 参照)。
 */
function toContentColumns(content: AccidentReportContent) {
  return {
    targetName: content.targetName,
    targetDob: content.targetDob,
    occurrenceTime: content.occurrenceTime,
    location: content.location,
    accidentContent: content.accidentContent,
    situation: content.situation,
    immediateResponse: content.immediateResponse,
    parentCorrespondence: content.parentCorrespondence,
    diagnosisTreatment: content.diagnosisTreatment,
    prevention: content.prevention,
    inputText: content.inputText,
  };
}

/** accident_reportsの項目別平文列から、AccidentReportContentを組み立てる。 */
function toContent(row: AccidentReportRow): AccidentReportContent {
  return {
    targetName: row.targetName,
    targetDob: row.targetDob,
    occurrenceTime: row.occurrenceTime,
    location: row.location,
    accidentContent: row.accidentContent,
    situation: row.situation,
    immediateResponse: row.immediateResponse,
    parentCorrespondence: row.parentCorrespondence,
    diagnosisTreatment: row.diagnosisTreatment,
    prevention: row.prevention,
    inputText: row.inputText,
  };
}

/** DrizzleのaccidentReportsテーブルのSELECT結果行を、ポート層のAccidentReportRecordに変換する。 */
function toRecord(row: AccidentReportRow): AccidentReportRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    staffId: row.staffId,
    customerId: row.customerId,
    occurredAt: row.occurredAt,
    reportType: row.reportType,
    content: toContent(row),
    updatedAt: row.updatedAt,
  };
}

export class DrizzleAccidentReportRepository implements AccidentReportRepositoryPort {
  constructor(private readonly db: Database) {}

  async create(input: NewAccidentReportInput, scope?: TransactionScope): Promise<AccidentReportRecord> {
    return withTenant(
      this.db,
      input.tenantId,
      async (tx) => {
        const rows = await tx
          .insert(accidentReports)
          .values({
            tenantId: input.tenantId,
            staffId: input.staffId,
            customerId: input.customerId,
            occurredAt: input.occurredAt,
            reportType: input.reportType,
            ...toContentColumns(input.content),
          })
          .returning();
        const row = rows[0];
        if (!row) throw new Error('事故報告の保存に失敗しました');
        return toRecord(row);
      },
      scope,
    );
  }

  async update(
    tenantId: string,
    id: string,
    input: NewAccidentReportInput,
    scope?: TransactionScope,
  ): Promise<AccidentReportRecord | null> {
    return withTenant(
      this.db,
      tenantId,
      async (tx) => {
        const rows = await tx
          .update(accidentReports)
          .set({
            occurredAt: input.occurredAt,
            reportType: input.reportType,
            ...toContentColumns(input.content),
            updatedAt: new Date(),
          })
          .where(eq(accidentReports.id, id))
          .returning();
        const row = rows[0];
        return row ? toRecord(row) : null;
      },
      scope,
    );
  }

  async findById(tenantId: string, id: string): Promise<AccidentReportRecord | null> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx.select().from(accidentReports).where(eq(accidentReports.id, id)).limit(1);
      const row = rows[0];
      return row ? toRecord(row) : null;
    });
  }

  async listByCustomer(
    tenantId: string,
    customerId: string,
    before: Date | null,
    limit: number,
  ): Promise<AccidentReportRecord[]> {
    return withTenant(this.db, tenantId, async (tx) => {
      const condition = before
        ? and(eq(accidentReports.customerId, customerId), lt(accidentReports.occurredAt, before))
        : eq(accidentReports.customerId, customerId);
      const rows = await tx
        .select()
        .from(accidentReports)
        .where(condition)
        .orderBy(desc(accidentReports.occurredAt))
        .limit(limit);
      return rows.map(toRecord);
    });
  }
}
