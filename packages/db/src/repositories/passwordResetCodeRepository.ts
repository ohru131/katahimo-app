import { constantTimeEquals } from '@katahimo/core';
import type {
  ConsumeResetCodeResult,
  IssuePasswordResetCodeInput,
  PasswordResetCodeRepositoryPort,
  VerifyPasswordResetCodeInput,
} from '@katahimo/core/ports';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { passwordResetCodes } from '../schema';
import type { Database } from '../tenantScope';
import { withTenant } from '../tenantScope';

export class DrizzlePasswordResetCodeRepository implements PasswordResetCodeRepositoryPort {
  constructor(private readonly db: Database) {}

  /**
   * 既存の未使用コードの無効化と新規発行を同じトランザクションで行う。
   * 分けると、同時に発行要求が来たときに両方が有効なコードを持てる状態が生まれる。
   */
  async issue(input: IssuePasswordResetCodeInput): Promise<void> {
    await withTenant(this.db, input.tenantId, async (tx) => {
      await tx
        .update(passwordResetCodes)
        .set({ consumedAt: new Date() })
        .where(
          and(
            eq(passwordResetCodes.tenantId, input.tenantId),
            eq(passwordResetCodes.staffId, input.staffId),
            isNull(passwordResetCodes.consumedAt),
          ),
        );
      await tx.insert(passwordResetCodes).values({
        tenantId: input.tenantId,
        staffId: input.staffId,
        codeVerifier: input.codeVerifier,
        expiresAt: input.expiresAt,
      });
    });
  }

  /**
   * 有効なコードを `FOR UPDATE` で行ロックしてから検証する。
   *
   * ロックを取らずに「読む→判定→書く」を行うと、同時に届いた複数の試行が揃って
   * 加算前の試行回数を読み、上限をすり抜ける。6桁しかないコードでこれは実際に効くため、
   * 判定と更新を必ず同じロックの中に収める。
   *
   * 検証子の比較はSQLのWHERE句に混ぜず、取り出してから `constantTimeEquals` で行う
   * (途中で打ち切らない比較にするため)。
   */
  async verifyAndConsume(input: VerifyPasswordResetCodeInput): Promise<ConsumeResetCodeResult> {
    return withTenant(this.db, input.tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(passwordResetCodes)
        .where(
          and(
            eq(passwordResetCodes.tenantId, input.tenantId),
            eq(passwordResetCodes.staffId, input.staffId),
            isNull(passwordResetCodes.consumedAt),
            gt(passwordResetCodes.expiresAt, new Date()),
          ),
        )
        .orderBy(desc(passwordResetCodes.createdAt))
        .limit(1)
        .for('update');

      const row = rows[0];
      if (!row) return 'unavailable';

      if (row.failedAttempts >= input.maxFailedAttempts) {
        // 上限に達したコードは期限内でも使わせない。ここで畳んで再発行を促す。
        await tx
          .update(passwordResetCodes)
          .set({ consumedAt: new Date() })
          .where(eq(passwordResetCodes.id, row.id));
        return 'unavailable';
      }

      if (!constantTimeEquals(row.codeVerifier, input.codeVerifier)) {
        await tx
          .update(passwordResetCodes)
          .set({ failedAttempts: row.failedAttempts + 1 })
          .where(eq(passwordResetCodes.id, row.id));
        return 'mismatch';
      }

      await tx
        .update(passwordResetCodes)
        .set({ consumedAt: new Date() })
        .where(eq(passwordResetCodes.id, row.id));
      return 'consumed';
    });
  }

  async consumeAllForStaff(tenantId: string, staffId: string): Promise<void> {
    await withTenant(this.db, tenantId, async (tx) => {
      await tx
        .update(passwordResetCodes)
        .set({ consumedAt: new Date() })
        .where(
          and(
            eq(passwordResetCodes.tenantId, tenantId),
            eq(passwordResetCodes.staffId, staffId),
            isNull(passwordResetCodes.consumedAt),
          ),
        );
    });
  }
}
