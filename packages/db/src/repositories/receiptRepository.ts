import type {
  NewReceiptInput,
  ReceiptBillingType,
  ReceiptRecord,
  ReceiptRepositoryPort,
  TransactionScope,
} from '@katahimo/core/ports';
import { and, desc, eq, gte, inArray, isNotNull, isNull, lt } from 'drizzle-orm';
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
    cancelledAt: row.cancelledAt,
    cancellationReason: row.cancellationReason,
    cancelledByStaffId: row.cancelledByStaffId,
    mirrorClaimedAt: row.mirrorClaimedAt,
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
        // 取り消し済みの行は receipts_tenant_dedupe_key_uidx の対象外なので、重複としても
        // 数えない(取り消して登録し直す訂正を、重複扱いで弾かないため。doc/14 §10)。
        .where(
          and(
            isNotNull(receipts.dedupeKey),
            inArray(receipts.dedupeKey, dedupeKeys),
            isNull(receipts.cancelledAt),
          ),
        );
      return new Set(rows.map((r) => r.dedupeKey).filter((v): v is string => v !== null));
    });
  }

  async listByStaffInPeriod(
    tenantId: string,
    staffId: string,
    from: Date,
    to: Date,
  ): Promise<ReceiptRecord[]> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(receipts)
        .where(
          and(
            eq(receipts.tenantId, tenantId),
            eq(receipts.staffId, staffId),
            gte(receipts.receiptTimestamp, from),
            // 上限は含めない([from, to))。月末の23:59:59.999のような端の値を
            // 「その月に入れるか」で悩まずに済み、月を並べても重複しない。
            lt(receipts.receiptTimestamp, to),
          ),
        )
        // 並びは receipts_tenant_staff_timestamp_idx と向きを揃える(doc/14 §3)。
        .orderBy(desc(receipts.receiptTimestamp));
      return rows.map(toRecord);
    });
  }

  async cancel(
    tenantId: string,
    receiptId: string,
    input: { cancelledByStaffId: string; reason: string | null },
  ): Promise<ReceiptRecord | null> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .update(receipts)
        .set({
          cancelledAt: new Date(),
          cancelledByStaffId: input.cancelledByStaffId,
          cancellationReason: input.reason,
        })
        // 既に取り消し済みの行は更新しない(取り消した人・理由・時刻を上書きしないため)。
        // usecase側でも弾いているが、同時に2回押された場合はここだけが止められる。
        .where(and(eq(receipts.tenantId, tenantId), eq(receipts.id, receiptId), isNull(receipts.cancelledAt)))
        .returning();
      const row = rows[0];
      return row ? toRecord(row) : null;
    });
  }

  async claimForMirror(tenantId: string, receiptId: string): Promise<ReceiptRecord | null> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .update(receipts)
        .set({ mirrorClaimedAt: new Date() })
        // 取り消し済みの行は宣言できない=送信しない。cancelのUPDATEと同じ行を争うので、
        // どちらが先かはPostgreSQLの行ロックが決める(doc/14 §10)。
        .where(and(eq(receipts.tenantId, tenantId), eq(receipts.id, receiptId), isNull(receipts.cancelledAt)))
        .returning();
      const row = rows[0];
      return row ? toRecord(row) : null;
    });
  }
}
