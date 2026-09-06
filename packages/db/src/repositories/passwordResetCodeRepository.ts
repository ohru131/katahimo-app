import type {
  NewPasswordResetCodeInput,
  PasswordResetCodeRecord,
  PasswordResetCodeRepositoryPort,
} from '@katahimo/core/ports';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { passwordResetCodes } from '../schema';
import type { Database } from '../tenantScope';
import { withTenant } from '../tenantScope';

function toRecord(row: typeof passwordResetCodes.$inferSelect): PasswordResetCodeRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    staffId: row.staffId,
    codeHash: row.codeHash,
    expiresAt: row.expiresAt,
    consumedAt: row.consumedAt,
    failedAttempts: row.failedAttempts,
  };
}

export class DrizzlePasswordResetCodeRepository implements PasswordResetCodeRepositoryPort {
  constructor(private readonly db: Database) {}

  async create(input: NewPasswordResetCodeInput): Promise<PasswordResetCodeRecord> {
    return withTenant(this.db, input.tenantId, async (tx) => {
      const rows = await tx
        .insert(passwordResetCodes)
        .values({
          tenantId: input.tenantId,
          staffId: input.staffId,
          codeHash: input.codeHash,
          expiresAt: input.expiresAt,
        })
        .returning();
      const row = rows[0];
      if (!row) throw new Error('パスワード再設定コードの作成に失敗しました');
      return toRecord(row);
    });
  }

  async findLatestActive(tenantId: string, staffId: string): Promise<PasswordResetCodeRecord | null> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(passwordResetCodes)
        .where(
          and(
            eq(passwordResetCodes.staffId, staffId),
            isNull(passwordResetCodes.consumedAt),
            gt(passwordResetCodes.expiresAt, new Date()),
          ),
        )
        .orderBy(desc(passwordResetCodes.createdAt))
        .limit(1);
      const row = rows[0];
      return row ? toRecord(row) : null;
    });
  }

  async markConsumed(tenantId: string, id: string): Promise<void> {
    await withTenant(this.db, tenantId, async (tx) => {
      await tx
        .update(passwordResetCodes)
        .set({ consumedAt: new Date() })
        .where(eq(passwordResetCodes.id, id));
    });
  }

  async incrementFailedAttempts(tenantId: string, id: string): Promise<number> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .update(passwordResetCodes)
        .set({ failedAttempts: sql`${passwordResetCodes.failedAttempts} + 1` })
        .where(eq(passwordResetCodes.id, id))
        .returning();
      return rows[0]?.failedAttempts ?? 0;
    });
  }

  async consumeAllForStaff(tenantId: string, staffId: string): Promise<void> {
    await withTenant(this.db, tenantId, async (tx) => {
      await tx
        .update(passwordResetCodes)
        .set({ consumedAt: new Date() })
        .where(and(eq(passwordResetCodes.staffId, staffId), isNull(passwordResetCodes.consumedAt)));
    });
  }
}
