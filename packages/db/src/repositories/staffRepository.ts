import type { LoginThrottlePolicy } from '@katahimo/core';
import { applyFailedLogin } from '@katahimo/core';
import type {
  ActiveStaffRecord,
  NewStaffInput,
  ReplacePasswordInput,
  ReplacePasswordResult,
  StaffAdminRecord,
  StaffRecord,
  StaffRepositoryPort,
  TransactionScope,
  UpdateStaffInput,
} from '@katahimo/core/ports';
import { and, eq } from 'drizzle-orm';
import { sessions, staff } from '../schema';
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
    failedLoginAttempts: row.failedLoginAttempts,
    lockedUntil: row.lockedUntil,
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

  async replacePassword(
    input: ReplacePasswordInput,
    scope?: TransactionScope,
  ): Promise<ReplacePasswordResult> {
    return withTenant(
      this.db,
      input.tenantId,
      async (tx) => {
        // 先に行ロックを取る。認証済みの書き込み同士が混ざって「後から来たほうが勝つ」
        // 状態になるのを防ぐ(管理者の再発行と、コードによる再設定が同時に走る場合)。
        const rows = await tx
          .select({ passwordHash: staff.passwordHash })
          .from(staff)
          .where(eq(staff.id, input.staffId))
          .for('update')
          .limit(1);
        const row = rows[0];
        if (!row) return 'stale';
        if (input.expect && row.passwordHash !== input.expect.passwordHash) return 'stale';

        await tx
          .update(staff)
          .set({
            passwordHash: input.passwordHash,
            legacyPasswordHash: null,
            mustChangePassword: input.mustChangePassword,
            updatedAt: new Date(),
          })
          .where(eq(staff.id, input.staffId));

        if (input.revokeSessions) {
          await tx
            .delete(sessions)
            .where(and(eq(sessions.tenantId, input.tenantId), eq(sessions.staffId, input.staffId)));
        }

        return 'applied';
      },
      scope,
    );
  }

  /**
   * ログイン失敗を1回記録する。行ロックを取ってから読み、遷移を計算して書き戻すまでを
   * 1つのトランザクションで行う。
   *
   * ロックを取らずに読むと、同時に届いた失敗が揃って加算前の値を読み、どちらも同じ値を
   * 書いて加算が消える。その隙間を突けば、上限に達しないまま並列に何度でも試せてしまう。
   */
  async recordFailedLogin(tenantId: string, staffId: string, policy: LoginThrottlePolicy): Promise<void> {
    await withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select({ failedLoginAttempts: staff.failedLoginAttempts, lockedUntil: staff.lockedUntil })
        .from(staff)
        .where(eq(staff.id, staffId))
        .for('update')
        .limit(1);
      const row = rows[0];
      if (!row) return;

      const next = applyFailedLogin(row, new Date(), policy);
      await tx
        .update(staff)
        .set({ failedLoginAttempts: next.failedLoginAttempts, lockedUntil: next.lockedUntil })
        .where(eq(staff.id, staffId));
    });
  }

  /** ログイン成功時に失敗回数とロックを消す。連続でない失敗が積み上がってロックされないようにする。 */
  async clearLoginFailures(tenantId: string, staffId: string): Promise<void> {
    await withTenant(this.db, tenantId, async (tx) => {
      await tx.update(staff).set({ failedLoginAttempts: 0, lockedUntil: null }).where(eq(staff.id, staffId));
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
