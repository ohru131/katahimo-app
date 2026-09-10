import type {
  CouponDiscountKind,
  CouponPatchInput,
  CouponRecord,
  CouponRepositoryPort,
  NewCouponInput,
} from '@katahimo/core/ports';
import { eq } from 'drizzle-orm';
import { coupons } from '../schema';
import type { Database } from '../tenantScope';
import { withTenant } from '../tenantScope';

type CouponRow = typeof coupons.$inferSelect;

/** DrizzleのcouponsテーブルのSELECT結果行を、ポート層のCouponRecordに変換する。 */
function toRecord(row: CouponRow): CouponRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    code: row.code,
    name: row.name,
    // discount_kind_checkによりDB上は'amount'|'percent'しか入らないので、asで型を絞る。
    discountKind: row.discountKind as CouponDiscountKind,
    discountAmountYen: row.discountAmountYen,
    discountPercent: row.discountPercent,
    validFrom: row.validFrom,
    validTo: row.validTo,
    active: row.active,
    note: row.note,
  };
}

/** NewCouponInputをDrizzleのinsert値に変換する。 */
function toInsertValues(input: NewCouponInput) {
  return {
    tenantId: input.tenantId,
    code: input.code,
    name: input.name,
    discountKind: input.discountKind,
    discountAmountYen: input.discountAmountYen,
    discountPercent: input.discountPercent,
    validFrom: input.validFrom,
    validTo: input.validTo,
    active: input.active,
    note: input.note,
  };
}

/** CouponPatchInputのうち、渡されたフィールドだけをDrizzleのset値に変換する。 */
function toPatchValues(patch: CouponPatchInput): Partial<typeof coupons.$inferInsert> {
  const values: Partial<typeof coupons.$inferInsert> = {};
  if (patch.code !== undefined) values.code = patch.code;
  if (patch.name !== undefined) values.name = patch.name;
  if (patch.discountKind !== undefined) values.discountKind = patch.discountKind;
  if (patch.discountAmountYen !== undefined) values.discountAmountYen = patch.discountAmountYen;
  if (patch.discountPercent !== undefined) values.discountPercent = patch.discountPercent;
  if (patch.validFrom !== undefined) values.validFrom = patch.validFrom;
  if (patch.validTo !== undefined) values.validTo = patch.validTo;
  if (patch.active !== undefined) values.active = patch.active;
  if (patch.note !== undefined) values.note = patch.note;
  return values;
}

export class DrizzleCouponRepository implements CouponRepositoryPort {
  constructor(private readonly db: Database) {}

  async listAll(tenantId: string): Promise<CouponRecord[]> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx.select().from(coupons);
      return rows.map(toRecord);
    });
  }

  async findById(tenantId: string, couponId: string): Promise<CouponRecord | null> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx.select().from(coupons).where(eq(coupons.id, couponId)).limit(1);
      const row = rows[0];
      return row ? toRecord(row) : null;
    });
  }

  async create(input: NewCouponInput): Promise<CouponRecord> {
    return withTenant(this.db, input.tenantId, async (tx) => {
      const rows = await tx.insert(coupons).values(toInsertValues(input)).returning();
      const row = rows[0];
      if (!row) throw new Error('クーポンの作成に失敗しました');
      return toRecord(row);
    });
  }

  async update(tenantId: string, couponId: string, patch: CouponPatchInput): Promise<CouponRecord | null> {
    return withTenant(this.db, tenantId, async (tx) => {
      const columnValues = toPatchValues(patch);
      // 空パッチ(更新対象フィールドが1つも無い)場合、Drizzleの.set({})は空のSET句になり
      // 不正なSQLになりうるため、更新をスキップして現在値をそのまま返す
      // (customerRepository.tsのupdate()と同じ考え方)。
      if (Object.keys(columnValues).length === 0) {
        const rows = await tx.select().from(coupons).where(eq(coupons.id, couponId)).limit(1);
        const row = rows[0];
        return row ? toRecord(row) : null;
      }

      const rows = await tx
        .update(coupons)
        .set({ ...columnValues, updatedAt: new Date() })
        .where(eq(coupons.id, couponId))
        .returning();
      const row = rows[0];
      return row ? toRecord(row) : null;
    });
  }
}
