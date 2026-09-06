import type {
  ActiveStaffRecord,
  NewStaffInput,
  StaffAdminRecord,
  StaffRecord,
  StaffRepositoryPort,
  UpdateStaffInput,
} from '@katahimo/core/ports';
import { eq } from 'drizzle-orm';
import { staff } from '../schema';
import type { Database } from '../tenantScope';
import { withTenant } from '../tenantScope';

function toRecord(row: typeof staff.$inferSelect): StaffRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    email: row.email,
    phone: row.phone,
    passwordHash: row.passwordHash,
    legacyPasswordHash: row.legacyPasswordHash,
    isAdmin: row.isAdmin,
    retirementDate: row.retirementDate,
    mustChangePassword: row.mustChangePassword,
  };
}

export class DrizzleStaffRepository implements StaffRepositoryPort {
  constructor(private readonly db: Database) {}

  async findByEmail(tenantId: string, email: string): Promise<StaffRecord | null> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx.select().from(staff).where(eq(staff.email, email)).limit(1);
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
          name: input.name,
          email: input.email,
          phone: input.phone ?? null,
          passwordHash: input.passwordHash ?? null,
          legacyPasswordHash: input.legacyPasswordHash ?? null,
          isAdmin: input.isAdmin,
          mustChangePassword: input.mustChangePassword ?? false,
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

  async setPassword(
    tenantId: string,
    staffId: string,
    passwordHash: string,
    mustChangePassword: boolean,
  ): Promise<void> {
    await withTenant(this.db, tenantId, async (tx) => {
      await tx
        .update(staff)
        .set({ passwordHash, legacyPasswordHash: null, mustChangePassword, updatedAt: new Date() })
        .where(eq(staff.id, staffId));
    });
  }

  async listAll(tenantId: string): Promise<StaffAdminRecord[]> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx.select().from(staff);
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        email: r.email,
        isAdmin: r.isAdmin,
        retirementDate: r.retirementDate,
        mustChangePassword: r.mustChangePassword,
      }));
    });
  }

  async update(tenantId: string, staffId: string, input: UpdateStaffInput): Promise<void> {
    await withTenant(this.db, tenantId, async (tx) => {
      // 渡された項目だけを書き換える(undefinedの項目は現状維持。retirementDateは
      // nullが「在籍中に戻す」という意味を持つので、undefinedと区別する必要がある)。
      const values: Partial<typeof staff.$inferInsert> = { updatedAt: new Date() };
      if (input.name !== undefined) values.name = input.name;
      if (input.isAdmin !== undefined) values.isAdmin = input.isAdmin;
      if (input.retirementDate !== undefined) values.retirementDate = input.retirementDate;
      await tx.update(staff).set(values).where(eq(staff.id, staffId));
    });
  }

  async listActive(tenantId: string): Promise<ActiveStaffRecord[]> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx.select().from(staff);
      const todayStr = new Date().toISOString().slice(0, 10);
      return rows
        .filter((r) => !r.retirementDate || r.retirementDate > todayStr)
        .map((r) => ({ id: r.id, name: r.name }));
    });
  }
}
