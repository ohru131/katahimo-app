import type {
  CustomerPatchInput,
  CustomerRecord,
  CustomerRepositoryPort,
  NewCustomerInput,
} from '@katahimo/core/ports';
import { and, eq, isNull } from 'drizzle-orm';
import { customers } from '../schema';
import type { Database } from '../tenantScope';
import { withTenant } from '../tenantScope';

type CustomerRow = typeof customers.$inferSelect;

function toRecord(row: CustomerRow): CustomerRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    externalSource: row.externalSource,
    externalId: row.externalId,
    name: row.name,
    familyName: row.familyName,
    givenName: row.givenName,
    familyNameKana: row.familyNameKana,
    givenNameKana: row.givenNameKana,
    email: row.email,
    phone: row.phone,
    addressDetail: row.addressDetail,
    city: row.city,
    parkingArea: row.parkingArea,
    parkingDetail: row.parkingDetail,
    emergencyContact: row.emergencyContact,
    emergencyContactRelation: row.emergencyContactRelation,
    evacuationSite: row.evacuationSite,
    memo: row.memo,
    benefitMemberId: row.benefitMemberId,
    address2: row.address2,
    address2StartDate: row.address2StartDate,
    address2EndDate: row.address2EndDate,
    latLng: row.latLng,
    memberType: row.memberType,
    memberStatus: row.memberStatus,
    paymentMethod: row.paymentMethod,
    paymentStatus: row.paymentStatus,
    gender: row.gender,
    ageBracket: row.ageBracket,
    registeredAt: row.registeredAt,
    externalLastUpdatedAt: row.externalLastUpdatedAt,
    deactivatedAt: row.deactivatedAt,
  };
}

/** NewCustomerInputをDrizzleのinsert値に変換する(未指定の任意項目はnullで埋める)。 */
function toColumnValues(input: NewCustomerInput) {
  return {
    externalSource: input.externalSource,
    externalId: input.externalId,
    familyNameKana: input.familyNameKana ?? null,
    givenNameKana: input.givenNameKana ?? null,
    email: input.email ?? null,
    phone: input.phone ?? null,
    addressDetail: input.addressDetail ?? null,
    city: input.city ?? null,
    parkingArea: input.parkingArea ?? null,
    parkingDetail: input.parkingDetail ?? null,
    emergencyContact: input.emergencyContact ?? null,
    emergencyContactRelation: input.emergencyContactRelation ?? null,
    evacuationSite: input.evacuationSite ?? null,
    memo: input.memo ?? null,
    benefitMemberId: input.benefitMemberId ?? null,
    address2: input.address2 ?? null,
    address2StartDate: input.address2StartDate ?? null,
    address2EndDate: input.address2EndDate ?? null,
    latLng: input.latLng ?? null,
    memberType: input.memberType ?? null,
    memberStatus: input.memberStatus ?? null,
    paymentMethod: input.paymentMethod ?? null,
    paymentStatus: input.paymentStatus ?? null,
    gender: input.gender ?? null,
    ageBracket: input.ageBracket ?? null,
    registeredAt: input.registeredAt ?? null,
    externalLastUpdatedAt: input.externalLastUpdatedAt ?? null,
  };
}

/**
 * CustomerPatchInputを部分更新(PATCH)としてDrizzleのupdate値に変換する。
 * `undefined`のフィールドは列自体を出力せず(=既存値を保持)、`null`が明示的に渡された場合のみ
 * その列をクリアする。ポート定義(CustomerRepositoryPort.update)が約束する
 * 「渡されたフィールドだけを上書きする」契約を満たすための変換。
 */
function toPatchColumnValues(patch: CustomerPatchInput) {
  return {
    ...(patch.externalSource !== undefined && { externalSource: patch.externalSource }),
    ...(patch.externalId !== undefined && { externalId: patch.externalId }),
    ...(patch.name !== undefined && { name: patch.name }),
    ...(patch.familyName !== undefined && { familyName: patch.familyName }),
    ...(patch.givenName !== undefined && { givenName: patch.givenName }),
    ...(patch.familyNameKana !== undefined && { familyNameKana: patch.familyNameKana }),
    ...(patch.givenNameKana !== undefined && { givenNameKana: patch.givenNameKana }),
    ...(patch.email !== undefined && { email: patch.email }),
    ...(patch.phone !== undefined && { phone: patch.phone }),
    ...(patch.addressDetail !== undefined && { addressDetail: patch.addressDetail }),
    ...(patch.city !== undefined && { city: patch.city }),
    ...(patch.parkingArea !== undefined && { parkingArea: patch.parkingArea }),
    ...(patch.parkingDetail !== undefined && { parkingDetail: patch.parkingDetail }),
    ...(patch.emergencyContact !== undefined && { emergencyContact: patch.emergencyContact }),
    ...(patch.emergencyContactRelation !== undefined && {
      emergencyContactRelation: patch.emergencyContactRelation,
    }),
    ...(patch.evacuationSite !== undefined && { evacuationSite: patch.evacuationSite }),
    ...(patch.memo !== undefined && { memo: patch.memo }),
    ...(patch.benefitMemberId !== undefined && { benefitMemberId: patch.benefitMemberId }),
    ...(patch.address2 !== undefined && { address2: patch.address2 }),
    ...(patch.address2StartDate !== undefined && { address2StartDate: patch.address2StartDate }),
    ...(patch.address2EndDate !== undefined && { address2EndDate: patch.address2EndDate }),
    ...(patch.latLng !== undefined && { latLng: patch.latLng }),
    ...(patch.memberType !== undefined && { memberType: patch.memberType }),
    ...(patch.memberStatus !== undefined && { memberStatus: patch.memberStatus }),
    ...(patch.paymentMethod !== undefined && { paymentMethod: patch.paymentMethod }),
    ...(patch.paymentStatus !== undefined && { paymentStatus: patch.paymentStatus }),
    ...(patch.gender !== undefined && { gender: patch.gender }),
    ...(patch.ageBracket !== undefined && { ageBracket: patch.ageBracket }),
    ...(patch.registeredAt !== undefined && { registeredAt: patch.registeredAt }),
    ...(patch.externalLastUpdatedAt !== undefined && {
      externalLastUpdatedAt: patch.externalLastUpdatedAt,
    }),
  };
}

export class DrizzleCustomerRepository implements CustomerRepositoryPort {
  constructor(private readonly db: Database) {}

  async create(input: NewCustomerInput): Promise<CustomerRecord> {
    return withTenant(this.db, input.tenantId, async (tx) => {
      const rows = await tx
        .insert(customers)
        .values({
          tenantId: input.tenantId,
          name: input.name,
          familyName: input.familyName,
          givenName: input.givenName,
          ...toColumnValues(input),
        })
        .returning();
      const row = rows[0];
      if (!row) throw new Error('顧客の作成に失敗しました');
      return toRecord(row);
    });
  }

  async findById(tenantId: string, customerId: string): Promise<CustomerRecord | null> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx.select().from(customers).where(eq(customers.id, customerId)).limit(1);
      const row = rows[0];
      return row ? toRecord(row) : null;
    });
  }

  async findByFamilyName(tenantId: string, familyName: string): Promise<CustomerRecord[]> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(customers)
        .where(and(eq(customers.tenantId, tenantId), eq(customers.familyName, familyName)));
      return rows.map(toRecord);
    });
  }

  async findByExternalId(
    tenantId: string,
    externalSource: string,
    externalId: string,
  ): Promise<CustomerRecord | null> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(customers)
        .where(and(eq(customers.externalSource, externalSource), eq(customers.externalId, externalId)))
        .limit(1);
      const row = rows[0];
      return row ? toRecord(row) : null;
    });
  }

  async listActiveExternalIds(tenantId: string, externalSource: string): Promise<string[]> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select({ externalId: customers.externalId })
        .from(customers)
        .where(and(eq(customers.externalSource, externalSource), isNull(customers.deactivatedAt)));
      return rows.map((r) => r.externalId).filter((id): id is string => id !== null);
    });
  }

  async listActive(tenantId: string): Promise<CustomerRecord[]> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx.select().from(customers).where(isNull(customers.deactivatedAt));
      return rows.map(toRecord);
    });
  }

  async update(tenantId: string, customerId: string, patch: CustomerPatchInput): Promise<CustomerRecord> {
    const columnValues = toPatchColumnValues(patch);
    return withTenant(this.db, tenantId, async (tx) => {
      // 空パッチ(更新対象フィールドが1つも無い)場合、Drizzleの.set({})は不正なSQL
      // (空のSET句)を生成しうるため、更新をスキップして現在値をそのまま返す。
      if (Object.keys(columnValues).length === 0) {
        const rows = await tx.select().from(customers).where(eq(customers.id, customerId)).limit(1);
        const row = rows[0];
        if (!row) throw new Error(`顧客が見つかりません: ${customerId}`);
        return toRecord(row);
      }

      const rows = await tx
        .update(customers)
        .set(columnValues)
        .where(eq(customers.id, customerId))
        .returning();
      const row = rows[0];
      if (!row) throw new Error(`顧客が見つかりません: ${customerId}`);
      return toRecord(row);
    });
  }

  async deactivate(tenantId: string, customerId: string): Promise<void> {
    await withTenant(this.db, tenantId, async (tx) => {
      await tx.update(customers).set({ deactivatedAt: new Date() }).where(eq(customers.id, customerId));
    });
  }
}
