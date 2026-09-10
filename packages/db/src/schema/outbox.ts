import type { MirrorKind } from '@katahimo/core/ports';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { TENANT_RLS_USING } from './_rls';
import { tenants } from './tenants';

/**
 * outbox_jobs.kind のCHECK制約に使う許可値。doc/14 D項のDDLをそのまま書き写すと、
 * MirrorKind(packages/core/src/ports/mirror.ts)側の変更(例: calendar_eventの廃止)に
 * 追従できず、ズレに気付かないままDBが誤った値を許可/拒否し続ける。
 * `Record<MirrorKind, true>` の形で持つことで、MirrorKindに追加/削除があれば
 * ここが型エラーになり、追記漏れをコンパイル時に検知できるようにする。
 */
const MIRROR_KIND_SET: Record<MirrorKind, true> = {
  attendance_day: true,
  attendance_aggregate: true,
  daily_report: true,
  accident_report: true,
  receipt: true,
};
const MIRROR_KINDS = Object.keys(MIRROR_KIND_SET) as MirrorKind[];

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
    // statusはTypeScript上は enum({...}) で型付けているが、Drizzleはそこから
    // CHECK制約を生成しない(doc/14 D項)。psqlから直接でたらめな値を書けてしまい、
    // 書けばワーカーが永久に拾わない行になるため、DB側でも縛る。
    check('outbox_jobs_status_check', sql`${t.status} IN ('pending', 'processing', 'done', 'failed')`),
    // kindの許可値はMirrorKindと実行時にも一致させる(上のMIRROR_KINDS参照)。
    check(
      'outbox_jobs_kind_check',
      sql`${t.kind} IN (${sql.raw(MIRROR_KINDS.map((k) => `'${k}'`).join(', '))})`,
    ),
    check('outbox_jobs_attempts_check', sql`${t.attempts} >= 0`),
  ],
).enableRLS();
