import type { TenantKeyRecord, TenantKeyRepositoryPort } from '@katahimo/core/ports';
import { and, desc, eq } from 'drizzle-orm';
import { tenantKeys } from '../schema';
import type { Database } from '../tenantScope';
import { withTenant } from '../tenantScope';

type TenantKeyRow = typeof tenantKeys.$inferSelect;

function toRecord(row: TenantKeyRow): TenantKeyRecord {
  return {
    tenantId: row.tenantId,
    dekVersion: row.dekVersion,
    wrappedDek: row.wrappedDek,
    kekVersion: row.kekVersion,
    revokedAt: row.revokedAt,
  };
}

/**
 * テナントDEKの読み書き。世代(dekVersion)ごとに1行を持ち、古い世代も残す。
 * 残さないと、その世代で暗号化された既存の値が復号できなくなり、
 * ローテーション自体ができなくなる(schema/tenantKeys.ts のコメント参照)。
 */
export class DrizzleTenantKeyRepository implements TenantKeyRepositoryPort {
  constructor(private readonly db: Database) {}

  /** 最新世代を返す。新しい暗号化はこの鍵で行う。 */
  async findCurrent(tenantId: string): Promise<TenantKeyRecord | null> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(tenantKeys)
        .where(eq(tenantKeys.tenantId, tenantId))
        .orderBy(desc(tenantKeys.dekVersion))
        .limit(1);
      const row = rows[0];
      return row ? toRecord(row) : null;
    });
  }

  /** 指定世代を返す。既存の暗号文は記録された世代の鍵で復号する必要があるため。 */
  async findByVersion(tenantId: string, dekVersion: number): Promise<TenantKeyRecord | null> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(tenantKeys)
        .where(and(eq(tenantKeys.tenantId, tenantId), eq(tenantKeys.dekVersion, dekVersion)))
        .limit(1);
      const row = rows[0];
      return row ? toRecord(row) : null;
    });
  }

  async create(
    tenantId: string,
    dekVersion: number,
    wrappedDek: string,
    kekVersion: number,
  ): Promise<TenantKeyRecord> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .insert(tenantKeys)
        .values({ tenantId, dekVersion, wrappedDek, kekVersion })
        // 複数リクエストが同時に「まだDEKが無い」と判断してcreateを競合実行した場合、
        // 後勝ちで上書きせず先に作られた行を採用する(DEKを2種類生成して片方が孤立する事故を防ぐ)。
        .onConflictDoNothing({ target: [tenantKeys.tenantId, tenantKeys.dekVersion] })
        .returning();
      const row = rows[0];
      if (row) return toRecord(row);
      // onConflictDoNothingで挿入されなかった=既に他のリクエストが先に作成済み。
      // 同じtx内で読み直す(新たに接続を取り直さない)。
      const existingRows = await tx
        .select()
        .from(tenantKeys)
        .where(and(eq(tenantKeys.tenantId, tenantId), eq(tenantKeys.dekVersion, dekVersion)))
        .limit(1);
      const existing = existingRows[0];
      if (!existing) throw new Error(`テナント鍵の作成に失敗しました: tenantId=${tenantId}`);
      return toRecord(existing);
    });
  }

  async updateWrappedDek(
    tenantId: string,
    dekVersion: number,
    wrappedDek: string,
    kekVersion: number,
  ): Promise<void> {
    await withTenant(this.db, tenantId, async (tx) => {
      await tx
        .update(tenantKeys)
        .set({ wrappedDek, kekVersion, updatedAt: new Date() })
        .where(and(eq(tenantKeys.tenantId, tenantId), eq(tenantKeys.dekVersion, dekVersion)));
    });
  }

  async revoke(tenantId: string): Promise<void> {
    await withTenant(this.db, tenantId, async (tx) => {
      // 世代を問わず全て失効させる。1世代でも生き残っていると、その世代で暗号化された
      // データが読めてしまい「解約したら二度と復号できない」という保証が崩れる。
      await tx.update(tenantKeys).set({ revokedAt: new Date() }).where(eq(tenantKeys.tenantId, tenantId));
    });
  }
}
