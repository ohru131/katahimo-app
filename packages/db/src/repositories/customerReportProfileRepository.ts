import type {
  CustomerReportProfileInput,
  CustomerReportProfileRecord,
  CustomerReportProfileRepositoryPort,
} from '@katahimo/core/ports';
import { and, eq, inArray } from 'drizzle-orm';
import { customerReportProfiles } from '../schema';
import type { Database } from '../tenantScope';
import { withTenant } from '../tenantScope';

type ProfileRow = typeof customerReportProfiles.$inferSelect;

function toRecord(row: ProfileRow): CustomerReportProfileRecord {
  return {
    tenantId: row.tenantId,
    customerId: row.customerId,
    educationLevel: row.educationLevel,
    note: row.note,
    updatedByStaffId: row.updatedByStaffId,
    updatedAt: row.updatedAt,
  };
}

/**
 * 家庭ごとの日報の書き方の設定(`customer_report_profiles`)のリポジトリ実装。
 * 主キーは (tenant_id, customer_id) で1顧客1行なので、更新は upsert 1本で足りる。
 */
export class DrizzleCustomerReportProfileRepository implements CustomerReportProfileRepositoryPort {
  constructor(private readonly db: Database) {}

  async find(tenantId: string, customerId: string): Promise<CustomerReportProfileRecord | null> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(customerReportProfiles)
        .where(
          and(
            eq(customerReportProfiles.tenantId, tenantId),
            eq(customerReportProfiles.customerId, customerId),
          ),
        )
        .limit(1);
      const row = rows[0];
      return row ? toRecord(row) : null;
    });
  }

  /** 行がある顧客だけが返る(未設定の顧客は呼び出し側で null 扱いにする)。 */
  async findMany(tenantId: string, customerIds: string[]): Promise<CustomerReportProfileRecord[]> {
    if (customerIds.length === 0) return [];
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(customerReportProfiles)
        .where(
          and(
            eq(customerReportProfiles.tenantId, tenantId),
            inArray(customerReportProfiles.customerId, customerIds),
          ),
        );
      return rows.map(toRecord);
    });
  }

  async upsert(
    tenantId: string,
    customerId: string,
    input: CustomerReportProfileInput,
  ): Promise<CustomerReportProfileRecord> {
    return withTenant(this.db, tenantId, async (tx) => {
      const values = {
        tenantId,
        customerId,
        educationLevel: input.educationLevel,
        note: input.note,
        updatedByStaffId: input.updatedByStaffId,
      };
      const rows = await tx
        .insert(customerReportProfiles)
        .values(values)
        .onConflictDoUpdate({
          target: [customerReportProfiles.tenantId, customerReportProfiles.customerId],
          set: {
            educationLevel: values.educationLevel,
            note: values.note,
            updatedByStaffId: values.updatedByStaffId,
          },
        })
        .returning();
      const row = rows[0];
      if (!row) throw new Error('家庭ごとの日報設定の保存に失敗しました');
      return toRecord(row);
    });
  }
}
