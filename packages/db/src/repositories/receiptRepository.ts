import type {
  NewReceiptInput,
  ReceiptBillingType,
  ReceiptRecord,
  ReceiptRepositoryPort,
  TransactionScope,
} from '@katahimo/core/ports';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { receipts } from '../schema';
import type { Database } from '../tenantScope';
import { withTenant } from '../tenantScope';

type ReceiptRow = typeof receipts.$inferSelect;

/**
 * DrizzleのreceiptsテーブルのSELECT結果行を、ポート層のReceiptRecordに変換する。
 * billingTypeはDBのCHECK制約(receipts_billing_type_check)で許可値に縛られているため、
 * ここではキャストのみで安全(未知の値が来ることはDB側で防いでいる)。
 */
function toRecord(row: ReceiptRow): ReceiptRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    staffId: row.staffId,
    customerId: row.customerId,
    receiptTimestamp: row.receiptTimestamp,
    amountYen: row.amountYen,
    amountRaw: row.amountRaw,
    storeName: row.storeName,
    handoffText: row.handoffText,
    fileKey: row.fileKey,
    contentType: row.contentType,
    billingType: row.billingType as ReceiptBillingType,
    createdAt: row.createdAt,
  };
}

export class DrizzleReceiptRepository implements ReceiptRepositoryPort {
  constructor(private readonly db: Database) {}

  async create(input: NewReceiptInput, scope?: TransactionScope): Promise<ReceiptRecord> {
    return withTenant(
      this.db,
      input.tenantId,
      async (tx) => {
        const rows = await tx
          .insert(receipts)
          .values({
            tenantId: input.tenantId,
            staffId: input.staffId,
            customerId: input.customerId,
            receiptTimestamp: input.receiptTimestamp,
            dedupeKey: input.dedupeKey,
            amountYen: input.amountYen,
            amountRaw: input.amountRaw,
            storeName: input.storeName,
            handoffText: input.handoffText,
            fileKey: input.fileKey,
            contentType: input.contentType,
            billingType: input.billingType,
          })
          .returning();
        const row = rows[0];
        if (!row) throw new Error('領収書の保存に失敗しました');
        return toRecord(row);
      },
      scope,
    );
  }

  async findById(tenantId: string, id: string): Promise<ReceiptRecord | null> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx.select().from(receipts).where(eq(receipts.id, id)).limit(1);
      const row = rows[0];
      return row ? toRecord(row) : null;
    });
  }

  /** 渡されたdedupeKeyのうち、このテナントで既に登録済みのものだけを返す。 */
  async findExistingDedupeKeys(tenantId: string, dedupeKeys: string[]): Promise<Set<string>> {
    if (dedupeKeys.length === 0) return new Set();
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select({ dedupeKey: receipts.dedupeKey })
        .from(receipts)
        .where(and(isNotNull(receipts.dedupeKey), inArray(receipts.dedupeKey, dedupeKeys)));
      return new Set(rows.map((r) => r.dedupeKey).filter((v): v is string => v !== null));
    });
  }
}
