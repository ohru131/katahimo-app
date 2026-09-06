import type { ExtractTablesWithRelations } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from 'drizzle-orm/pg-core';
import type * as schema from './schema';

/**
 * リポジトリ実装が要求するDBの型。ドライバを固定しないのが要点で、Node+postgres-js
 * (開発・本番)でも、ブラウザ上のPGlite(packages/demo の公開デモ)でも、同じ
 * DrizzleXxxRepository がそのまま動く。
 *
 * このファイルには特定ドライバのimportを置かないこと。ここに `postgres` を持ち込むと、
 * リポジトリ経由でブラウザ向けバンドルにNode専用モジュール(node:net等)が流れ込む。
 */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema, ExtractTablesWithRelations<typeof schema>>;

/** withTenant()のコールバックが受け取るトランザクションハンドル。 */
export type DatabaseTransaction = PgTransaction<
  PgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

/**
 * テナントスコープでクエリを実行する。
 *
 * 全テーブルに Row Level Security を張り、ポリシーは current_setting('app.tenant_id') と
 * 突き合わせる形にしてある(doc/07 第4章)。アプリ側のWHERE句の書き忘れでは
 * 他テナントのデータが漏れない、という保証をDBに持たせるのが狙い。
 *
 * SET LOCAL はトランザクション内でのみ有効なため、必ずトランザクションで包む。
 * プール接続が使い回されても設定が残らないので、漏れの心配がない。
 */
export async function withTenant<T>(
  db: Database,
  tenantId: string,
  fn: (tx: DatabaseTransaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}
