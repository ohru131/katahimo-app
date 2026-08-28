import type { CustomerRecord, CustomerRepositoryPort, NewCustomerInput } from '@katahimo/core/ports';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../client';
import { withTenant } from '../client';
import { customers } from '../schema';

function toRecord(row: typeof customers.$inferSelect): CustomerRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: { ciphertext: row.nameCiphertext, keyVersion: row.nameKeyVersion },
    phone:
      row.phoneCiphertext && row.phoneKeyVersion != null
        ? { ciphertext: row.phoneCiphertext, keyVersion: row.phoneKeyVersion }
        : null,
    city:
      row.cityCiphertext && row.cityKeyVersion != null
        ? { ciphertext: row.cityCiphertext, keyVersion: row.cityKeyVersion }
        : null,
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
          nameCiphertext: input.name.ciphertext,
          nameKeyVersion: input.name.keyVersion,
          familyNameBlindIndex: input.familyNameBlindIndex,
          givenNameBlindIndex: input.givenNameBlindIndex,
          phoneCiphertext: input.phone?.ciphertext,
          phoneKeyVersion: input.phone?.keyVersion,
          phoneBlindIndex: input.phoneBlindIndex ?? undefined,
          cityCiphertext: input.city?.ciphertext,
          cityKeyVersion: input.city?.keyVersion,
          cityBlindIndex: input.cityBlindIndex ?? undefined,
        })
        .returning();
      const row = rows[0];
      if (!row) throw new Error('顧客の作成に失敗しました');
      return toRecord(row);
    });
  }

  async findByFamilyNameBlindIndex(
    tenantId: string,
    familyNameBlindIndex: string,
  ): Promise<CustomerRecord[]> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(customers)
        .where(
          and(eq(customers.tenantId, tenantId), eq(customers.familyNameBlindIndex, familyNameBlindIndex)),
        );
      return rows.map(toRecord);
    });
  }
}
