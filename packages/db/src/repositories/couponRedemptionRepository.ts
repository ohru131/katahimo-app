import type {
  CouponDiscountKind,
  CouponRedemptionRecord,
  CouponRedemptionRepositoryPort,
  CouponUsageLimitKind,
  NewCouponRedemptionInput,
  TransactionScope,
} from '@katahimo/core/ports';
import { and, eq, inArray } from 'drizzle-orm';
import { couponRedemptions } from '../schema';
import type { Database } from '../tenantScope';
import { withTenant } from '../tenantScope';

type CouponRedemptionRow = typeof couponRedemptions.$inferSelect;

/** Drizzleのcoupon_redemptionsテーブルのSELECT結果行を、ポート層のCouponRedemptionRecordに変換する。 */
function toRecord(row: CouponRedemptionRow): CouponRedemptionRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    dailyReportId: row.dailyReportId,
    customerId: row.customerId,
    couponId: row.couponId,
    appliedAt: row.appliedAt,
    // discount_kind_checkによりDB上は'amount'|'percent'しか入らないので、asで型を絞る。
    discountKind: row.discountKind as CouponDiscountKind,
    discountAmountYen: row.discountAmountYen,
    discountPercent: row.discountPercent,
    usageLimitKind: row.usageLimitKind as CouponUsageLimitKind,
    usageScopeKey: row.usageScopeKey,
    birthdaySubjectName: row.birthdaySubjectName,
    birthdaySubjectDob: row.birthdaySubjectDob,
    note: row.note,
  };
}

/** NewCouponRedemptionInputをDrizzleのinsert値に変換する。 */
function toInsertValues(input: NewCouponRedemptionInput) {
  return {
    tenantId: input.tenantId,
    dailyReportId: input.dailyReportId,
    customerId: input.customerId,
    couponId: input.couponId,
    discountKind: input.discountKind,
    discountAmountYen: input.discountAmountYen,
    discountPercent: input.discountPercent,
    usageLimitKind: input.usageLimitKind,
    usageScopeKey: input.usageScopeKey,
    birthdaySubjectName: input.birthdaySubjectName,
    birthdaySubjectDob: input.birthdaySubjectDob,
    note: input.note ?? null,
  };
}

export class DrizzleCouponRedemptionRepository implements CouponRedemptionRepositoryPort {
  constructor(private readonly db: Database) {}

  /**
   * 「削除して入れ直す」。familyMemberRepository.replaceForCustomerと同じ形
   * (ports/repositories.tsのCouponRedemptionRepositoryPort.replaceForDailyReportのコメント参照)。
   * scopeを渡した場合はsaveDailyReportのトランザクションに相乗りする(日報保存が失敗したら
   * この書き込みも一緒にロールバックされる)。
   */
  async replaceForDailyReport(
    tenantId: string,
    dailyReportId: string,
    inputs: NewCouponRedemptionInput[],
    scope?: TransactionScope,
  ): Promise<CouponRedemptionRecord[]> {
    return withTenant(
      this.db,
      tenantId,
      async (tx) => {
        await tx
          .delete(couponRedemptions)
          .where(
            and(eq(couponRedemptions.tenantId, tenantId), eq(couponRedemptions.dailyReportId, dailyReportId)),
          );

        if (inputs.length === 0) return [];

        const rows = await tx.insert(couponRedemptions).values(inputs.map(toInsertValues)).returning();
        return rows.map(toRecord);
      },
      scope,
    );
  }

  async listByDailyReportId(tenantId: string, dailyReportId: string): Promise<CouponRedemptionRecord[]> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(couponRedemptions)
        .where(
          and(eq(couponRedemptions.tenantId, tenantId), eq(couponRedemptions.dailyReportId, dailyReportId)),
        );
      return rows.map(toRecord);
    });
  }

  async listByDailyReportIds(tenantId: string, dailyReportIds: string[]): Promise<CouponRedemptionRecord[]> {
    if (dailyReportIds.length === 0) return [];
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(couponRedemptions)
        .where(
          and(
            eq(couponRedemptions.tenantId, tenantId),
            inArray(couponRedemptions.dailyReportId, dailyReportIds),
          ),
        );
      return rows.map(toRecord);
    });
  }

  async listByCustomerId(tenantId: string, customerId: string): Promise<CouponRedemptionRecord[]> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(couponRedemptions)
        .where(and(eq(couponRedemptions.tenantId, tenantId), eq(couponRedemptions.customerId, customerId)));
      return rows.map(toRecord);
    });
  }
}
