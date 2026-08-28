import type {
  ActiveStaffRecord,
  NewStaffInput,
  StaffRecord,
  StaffRepositoryPort,
} from '@katahimo/core/ports';
import { eq } from 'drizzle-orm';
import type { Database } from '../client';
import { withTenant } from '../client';
import { staff } from '../schema';

function toRecord(row: typeof staff.$inferSelect): StaffRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: { ciphertext: row.nameCiphertext, keyVersion: row.nameKeyVersion },
    email: { ciphertext: row.emailCiphertext, keyVersion: row.emailKeyVersion },
    emailBlindIndex: row.emailBlindIndex,
    passwordHash: row.passwordHash,
    legacyPasswordHash: row.legacyPasswordHash,
    isAdmin: row.isAdmin,
    retirementDate: row.retirementDate,
  };
}

export class DrizzleStaffRepository implements StaffRepositoryPort {
  constructor(private readonly db: Database) {}

  async findByEmailBlindIndex(tenantId: string, emailBlindIndex: string): Promise<StaffRecord | null> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx.select().from(staff).where(eq(staff.emailBlindIndex, emailBlindIndex)).limit(1);
      const row = rows[0];
      return row ? toRecord(row) : null;
    });
  }

  async findById(tenantId: string, staffId: string): Promise<StaffRecord | null> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx.select().from(staff).where(eq(staff.id, staffId)).limit(1);
      const row = rows[0];
      return row ? toRecord(row) : null;
    });
  }

  async create(input: NewStaffInput): Promise<StaffRecord> {
    return withTenant(this.db, input.tenantId, async (tx) => {
      const rows = await tx
        .insert(staff)
        .values({
          tenantId: input.tenantId,
          nameCiphertext: input.name.ciphertext,
          nameKeyVersion: input.name.keyVersion,
          familyNameBlindIndex: input.familyNameBlindIndex,
          givenNameBlindIndex: input.givenNameBlindIndex,
          emailCiphertext: input.email.ciphertext,
          emailKeyVersion: input.email.keyVersion,
          emailBlindIndex: input.emailBlindIndex,
          passwordHash: input.passwordHash ?? null,
          legacyPasswordHash: input.legacyPasswordHash ?? null,
          isAdmin: input.isAdmin,
        })
        .returning();
      const row = rows[0];
      if (!row) throw new Error('スタッフの作成に失敗しました');
      return toRecord(row);
    });
  }

  async upgradeToArgon2Hash(tenantId: string, staffId: string, passwordHash: string): Promise<void> {
    await withTenant(this.db, tenantId, async (tx) => {
      await tx.update(staff).set({ passwordHash, legacyPasswordHash: null }).where(eq(staff.id, staffId));
    });
  }

  async listActive(tenantId: string): Promise<ActiveStaffRecord[]> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx.select().from(staff);
      const todayStr = new Date().toISOString().slice(0, 10);
      return rows
        .filter((r) => !r.retirementDate || r.retirementDate > todayStr)
        .map((r) => ({ id: r.id, name: { ciphertext: r.nameCiphertext, keyVersion: r.nameKeyVersion } }));
    });
  }
}
