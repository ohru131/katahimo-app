import type {
  CustomerCouponRecord,
  CustomerCouponRepositoryPort,
  NewCustomerCouponInput,
} from '@katahimo/core/ports';
import { and, eq } from 'drizzle-orm';
import { customerCoupons } from '../schema';
import type { Database } from '../tenantScope';
import { withTenant } from '../tenantScope';

type CustomerCouponRow = typeof customerCoupons.$inferSelect;

/** Drizzleのcustomer_couponsテーブルのSELECT結果行を、ポート層のCustomerCouponRecordに変換する。 */
function toRecord(row: CustomerCouponRow): CustomerCouponRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    customerId: row.customerId,
    couponId: row.couponId,
    validFrom: row.validFrom,
    validTo: row.validTo,
    note: row.note,
  };
}

export class DrizzleCustomerCouponRepository implements CustomerCouponRepositoryPort {
  constructor(private readonly db: Database) {}

  async listByCustomerId(tenantId: string, customerId: string): Promise<CustomerCouponRecord[]> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(customerCoupons)
        .where(and(eq(customerCoupons.tenantId, tenantId), eq(customerCoupons.customerId, customerId)));
      return rows.map(toRecord);
    });
  }

  /**
   * 割り当てる。既に同じ(顧客, クーポン)の行があれば有効期間・メモを上書きする。
   *
   * 「先に引いて、無ければINSERT」にせず ON CONFLICT に任せるのは、同時に2回押されたときに
   * 検索とINSERTの間をすり抜けて23505で落ちるのを避けるため(doc/14 §8.4)。
   */
  async upsert(input: NewCustomerCouponInput): Promise<CustomerCouponRecord> {
    return withTenant(this.db, input.tenantId, async (tx) => {
      const rows = await tx
        .insert(customerCoupons)
        .values({
          tenantId: input.tenantId,
          customerId: input.customerId,
          couponId: input.couponId,
          validFrom: input.validFrom,
          validTo: input.validTo,
          note: input.note,
        })
        .onConflictDoUpdate({
          target: [customerCoupons.tenantId, customerCoupons.customerId, customerCoupons.couponId],
          set: {
            validFrom: input.validFrom,
            validTo: input.validTo,
            note: input.note,
            updatedAt: new Date(),
          },
        })
        .returning();
      const row = rows[0];
      if (!row) throw new Error('クーポンの割り当てに失敗しました');
      return toRecord(row);
    });
  }

  async remove(tenantId: string, customerId: string, couponId: string): Promise<boolean> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .delete(customerCoupons)
        .where(
          and(
            eq(customerCoupons.tenantId, tenantId),
            eq(customerCoupons.customerId, customerId),
            eq(customerCoupons.couponId, couponId),
          ),
        )
        .returning();
      return rows.length > 0;
    });
  }
}
