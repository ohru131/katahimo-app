import type {
  MirrorJob,
  OutboxJobRecord,
  OutboxRepositoryPort,
  TransactionScope,
} from '@katahimo/core/ports';
import { and, asc, eq, inArray, lt, lte, or, sql } from 'drizzle-orm';
import { outboxJobs } from '../schema';
import type { Database } from '../tenantScope';
import { withTenant } from '../tenantScope';

type OutboxJobRow = typeof outboxJobs.$inferSelect;

/**
 * processingのまま放置された行を、再びclaimの対象に戻すまでの猶予。
 * ワーカーが送信の途中で落ちる(コンテナの再起動・OOM等)と、その行は誰も拾わないまま
 * 残り続ける。可視性タイムアウトを設けて自動的に回収する。
 *
 * 送信先(GAS Web App)のHTTPタイムアウトが20秒なので、それより十分長くとる。
 */
const PROCESSING_VISIBILITY_TIMEOUT_MS = 5 * 60 * 1000;

function toRecord(row: OutboxJobRow): OutboxJobRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    kind: row.kind as OutboxJobRecord['kind'],
    targetId: row.targetId,
    attempts: row.attempts,
  };
}

export class DrizzleOutboxRepository implements OutboxRepositoryPort {
  constructor(private readonly db: Database) {}

  /**
   * ミラー要求を積む。通常はドメインの書き込みと同じトランザクション(scope)で呼ばれる。
   * 片方だけが確定すると、保存はできたのにスプレッドシートへ永久に反映されない行が残る。
   */
  async enqueue(job: MirrorJob, scope?: TransactionScope): Promise<void> {
    await withTenant(
      this.db,
      job.tenantId,
      async (tx) => {
        // 同じidempotencyKeyでの再enqueueは無視する(呼び出し側のリトライ等での二重積みを防ぐ)。
        await tx
          .insert(outboxJobs)
          .values({
            tenantId: job.tenantId,
            kind: job.kind,
            targetId: job.targetId,
            idempotencyKey: job.idempotencyKey,
          })
          .onConflictDoNothing({ target: [outboxJobs.tenantId, outboxJobs.idempotencyKey] });
      },
      scope,
    );
  }

  async claimPending(tenantId: string, limit: number): Promise<OutboxJobRecord[]> {
    return withTenant(this.db, tenantId, async (tx) => {
      const staleBefore = new Date(Date.now() - PROCESSING_VISIBILITY_TIMEOUT_MS);
      // FOR UPDATE SKIP LOCKEDで、複数ワーカーインスタンスが同時にポーリングしても
      // 同じジョブを二重に取得しないようにする。
      //
      // 取り出す対象は次の2つ:
      //  - 再試行の待ち時間が明けたpending(初回もnext_attempt_atが既定でnow()なので該当)
      //  - processingのまま可視性タイムアウトを過ぎた行(ワーカーが落ちた場合の回収)
      const pending = await tx
        .select({ id: outboxJobs.id })
        .from(outboxJobs)
        .where(
          or(
            and(eq(outboxJobs.status, 'pending'), lte(outboxJobs.nextAttemptAt, sql`now()`)),
            and(eq(outboxJobs.status, 'processing'), lt(outboxJobs.updatedAt, staleBefore)),
          ),
        )
        .orderBy(asc(outboxJobs.nextAttemptAt), asc(outboxJobs.createdAt))
        .limit(limit)
        .for('update', { skipLocked: true });
      if (pending.length === 0) return [];

      const ids = pending.map((p) => p.id);
      const rows = await tx
        .update(outboxJobs)
        .set({ status: 'processing', attempts: sql`${outboxJobs.attempts} + 1`, updatedAt: new Date() })
        .where(inArray(outboxJobs.id, ids))
        .returning();
      return rows.map(toRecord);
    });
  }

  /** 送信に成功したジョブを完了にする。再試行の記録(lastError)は残さない。 */
  async markDone(tenantId: string, id: string): Promise<void> {
    await withTenant(this.db, tenantId, async (tx) => {
      const now = new Date();
      await tx
        .update(outboxJobs)
        .set({ status: 'done', processedAt: now, updatedAt: now, lastError: null })
        .where(eq(outboxJobs.id, id));
    });
  }

  /**
   * 失敗を記録する。nextAttemptAtがあればpendingへ戻して再試行させ、nullなら
   * failed(デッドレター)で終端させる。どちらにするかは呼び出し側の再試行ポリシーが決める
   * (packages/core/src/domain/mirror/retry.ts)。
   */
  async markFailed(tenantId: string, id: string, error: string, nextAttemptAt: Date | null): Promise<void> {
    await withTenant(this.db, tenantId, async (tx) => {
      const now = new Date();
      await tx
        .update(outboxJobs)
        .set(
          nextAttemptAt === null
            ? { status: 'failed', lastError: error, processedAt: now, updatedAt: now }
            : { status: 'pending', lastError: error, nextAttemptAt, updatedAt: now },
        )
        .where(eq(outboxJobs.id, id));
    });
  }
}
