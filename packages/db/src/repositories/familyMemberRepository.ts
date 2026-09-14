import type {
  FamilyAllergyStatus,
  FamilyMemberRecord,
  FamilyMemberRepositoryPort,
  NewFamilyMemberInput,
} from '@katahimo/core/ports';
import { and, eq } from 'drizzle-orm';
import { familyMembers } from '../schema';
import type { Database } from '../tenantScope';
import { withTenant } from '../tenantScope';

type FamilyMemberRow = typeof familyMembers.$inferSelect;

/** NewFamilyMemberInputをDrizzleのinsert値に変換する。 */
function toInsertValues(input: NewFamilyMemberInput) {
  return {
    tenantId: input.tenantId,
    customerId: input.customerId,
    name: input.name,
    dobDate: input.dobDate,
    dobRaw: input.dobRaw,
    info: input.info,
    allergyStatus: input.allergyStatus,
    allergyNote: input.allergyNote,
  };
}

/** DrizzleのfamilyMembersテーブルのSELECT結果行を、ポート層のFamilyMemberRecordに変換する。 */
function toRecord(row: FamilyMemberRow): FamilyMemberRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    customerId: row.customerId,
    name: row.name,
    dobDate: row.dobDate,
    dobRaw: row.dobRaw,
    info: row.info,
    // DB上は text 列(許可値はCHECK制約が縛る)なので、ポートの型へ寄せる。
    allergyStatus: row.allergyStatus as FamilyAllergyStatus,
    allergyNote: row.allergyNote,
  };
}

export class DrizzleFamilyMemberRepository implements FamilyMemberRepositoryPort {
  constructor(private readonly db: Database) {}

  async createMany(inputs: NewFamilyMemberInput[]): Promise<FamilyMemberRecord[]> {
    if (inputs.length === 0) return [];
    const tenantId = inputs[0]?.tenantId;
    if (!tenantId) return [];
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx.insert(familyMembers).values(inputs.map(toInsertValues)).returning();
      return rows.map(toRecord);
    });
  }

  async listByCustomerId(tenantId: string, customerId: string): Promise<FamilyMemberRecord[]> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(familyMembers)
        .where(and(eq(familyMembers.tenantId, tenantId), eq(familyMembers.customerId, customerId)));
      return rows.map(toRecord);
    });
  }

  async replaceForCustomer(
    tenantId: string,
    customerId: string,
    inputs: NewFamilyMemberInput[],
  ): Promise<FamilyMemberRecord[]> {
    return withTenant(this.db, tenantId, async (tx) => {
      await tx
        .delete(familyMembers)
        .where(and(eq(familyMembers.tenantId, tenantId), eq(familyMembers.customerId, customerId)));

      if (inputs.length === 0) return [];

      const rows = await tx.insert(familyMembers).values(inputs.map(toInsertValues)).returning();
      return rows.map(toRecord);
    });
  }

  async updateAllergy(
    tenantId: string,
    customerId: string,
    memberId: string,
    allergy: { status: FamilyAllergyStatus; note: string | null },
  ): Promise<FamilyMemberRecord | null> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .update(familyMembers)
        .set({ allergyStatus: allergy.status, allergyNote: allergy.note })
        .where(
          and(
            eq(familyMembers.tenantId, tenantId),
            // URLの顧客に属する構成員だけを対象にする(別の顧客のIDを渡しても0件で404になる)。
            eq(familyMembers.customerId, customerId),
            eq(familyMembers.id, memberId),
          ),
        )
        .returning();
      const row = rows[0];
      return row ? toRecord(row) : null;
    });
  }
}
