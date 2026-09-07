import type { NewSessionInput, SessionRecord, SessionRepositoryPort } from '@katahimo/core/ports';
import { and, eq } from 'drizzle-orm';
import { sessions } from '../schema';
import type { Database } from '../tenantScope';
import { withTenant } from '../tenantScope';

export class DrizzleSessionRepository implements SessionRepositoryPort {
  constructor(private readonly db: Database) {}

  async create(input: NewSessionInput): Promise<SessionRecord> {
    return withTenant(this.db, input.tenantId, async (tx) => {
      const rows = await tx
        .insert(sessions)
        .values({
          tenantId: input.tenantId,
          staffId: input.staffId,
          tokenHash: input.tokenHash,
          expiresAt: input.expiresAt,
        })
        .returning();
      const row = rows[0];
      if (!row) throw new Error('セッションの作成に失敗しました');
      return { id: row.id, tenantId: row.tenantId, staffId: row.staffId, expiresAt: row.expiresAt };
    });
  }

  async deleteAllForStaff(tenantId: string, staffId: string): Promise<void> {
    await withTenant(this.db, tenantId, async (tx) => {
      // RLSでもテナントは絞られるが、DELETEはWHERE句にも明示する。
      // RLSが外れた状態(所有者ロールでの接続等)で他テナントのセッションまで
      // 消してしまうと、取り返しがつかない。
      await tx.delete(sessions).where(and(eq(sessions.tenantId, tenantId), eq(sessions.staffId, staffId)));
    });
  }

  async findByTokenHash(tenantId: string, tokenHash: string): Promise<SessionRecord | null> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx.select().from(sessions).where(eq(sessions.tokenHash, tokenHash)).limit(1);
      const row = rows[0];
      if (!row) return null;
      return { id: row.id, tenantId: row.tenantId, staffId: row.staffId, expiresAt: row.expiresAt };
    });
  }
}
