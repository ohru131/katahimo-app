import type {
  NewReceiptInput,
  ReceiptRecord,
  ReceiptRepositoryPort,
  TransactionScope,
} from '@katahimo/core/ports';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { receipts } from '../schema';
import type { Database } from '../tenantScope';
import { withTenant } from '../tenantScope';

type ReceiptRow = typeof receipts.$inferSelect;

function toRecord(row: ReceiptRow): ReceiptRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    staffId: row.staffId,
    customerId: row.customerId,
    receiptTimestamp: row.receiptTimestamp,
    amount: row.amount,
    storeName: row.storeName,
    handoffText: row.handoffText,
    fileKey: row.fileKey,
    contentType: row.contentType,
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
            amount: input.amount,
            storeName: input.storeName,
            handoffText: input.handoffText,
            fileKey: input.fileKey,
            contentType: input.contentType,
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
