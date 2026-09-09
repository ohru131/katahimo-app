import { sql } from 'drizzle-orm';
import { index, integer, pgPolicy, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { TENANT_RLS_USING } from './_rls';
import { tenants } from './tenants';

/**
 * ミラー書き込み(DB → Googleスプレッドシート等)のジョブキュー。
 * ドメインの書き込みと同一トランザクションでここに積み(UnitOfWorkPort経由)、
 * ミラーワーカー(Phase 5)が非同期に処理する(packages/core/src/ports/mirror.ts のMirrorPort参照)。
 *
 * status遷移: pending →(claim)→ processing →(成功)→ done
 *                                        →(失敗・再試行可)→ pending(next_attempt_atを未来へ)
 *                                        →(失敗・上限到達/恒久的)→ failed(デッドレター)
 * processingのまま放置された行(ワーカーの異常終了)は、updated_atが可視性タイムアウトを
 * 過ぎた時点で再びclaimの対象になる。
 */
export const outboxJobs = pgTable(
  'outbox_jobs',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    kind: text().notNull(),
    targetId: uuid().notNull(),
    idempotencyKey: text().notNull(),
    status: text({ enum: ['pending', 'processing', 'done', 'failed'] })
      .notNull()
      .default('pending'),
    attempts: integer().notNull().default(0),
    lastError: text(),
    /** 次に取り出してよい時刻。失敗のたびに指数バックオフで先送りする。 */
    nextAttemptAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** claim/完了/失敗のたびに更新する。processingのまま落ちた行の回収判定に使う。 */
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    // テナントを跨いでidempotencyKeyの一意性を要求する理由はない(生成ロジック次第では
    // 他テナントの値と衝突しうる)ため、tenant_idでスコープする(データベース構造レビューで指摘)。
    uniqueIndex('outbox_jobs_tenant_idempotency_key_idx').on(t.tenantId, t.idempotencyKey),
    // ワーカーのポーリング(claimPending)が status と next_attempt_at で絞って
    // created_at 順に取り出すため、done/failedが積み上がってもフルスキャンにならないようにする。
    index('outbox_jobs_tenant_status_next_attempt_idx').on(
      t.tenantId,
      t.status,
      t.nextAttemptAt,
      t.createdAt,
    ),
  ],
).enableRLS();
