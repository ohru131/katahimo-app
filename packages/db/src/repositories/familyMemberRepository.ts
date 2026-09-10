import type {
  FamilyMemberRecord,
  FamilyMemberRepositoryPort,
  NewFamilyMemberInput,
} from '@katahimo/core/ports';
import { and, eq } from 'drizzle-orm';
import { familyMembers } from '../schema';
import type { Database } from '../tenantScope';
import { withTenant } from '../tenantScope';

type FamilyMemberRow = typeof familyMembers.$inferSelect;

function toInsertValues(input: NewFamilyMemberInput) {
  return {
    tenantId: input.tenantId,
    customerId: input.customerId,
    name: input.name,
    dob: input.dob,
    info: input.info,
  };
}

function toRecord(row: FamilyMemberRow): FamilyMemberRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    customerId: row.customerId,
    name: row.name,
    dob: row.dob,
    info: row.info,
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
}
