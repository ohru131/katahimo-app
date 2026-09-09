import type { TransactionScope } from '@katahimo/core/ports';
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
 * UnitOfWorkPort(@katahimo/core)が配る TransactionScope の実体。
 * 型としては不透明なまま usecases を通り抜け、ここで元のトランザクションに戻す。
 */
interface DrizzleTransactionScope extends TransactionScope {
  readonly db: Database;
  readonly tx: DatabaseTransaction;
}

/** withTenant()が開いたトランザクションを、他のリポジトリからも使えるスコープとして包む。 */
export function createTransactionScope(
  db: Database,
  tenantId: string,
  tx: DatabaseTransaction,
): TransactionScope {
  const scope: DrizzleTransactionScope = { tenantId, db, tx };
  return scope;
}

/**
 * 受け取ったスコープが「同じDB接続・同じテナント」で開かれたものかを確かめて、
 * 中のトランザクションを取り出す。取り違えたまま実行すると、RLSが別テナントに
 * 束縛されたトランザクションへ黙って書いてしまうため、必ず落とす。
 */
function resolveScope(db: Database, tenantId: string, scope: TransactionScope): DatabaseTransaction {
  const candidate = scope as Partial<DrizzleTransactionScope>;
  if (!candidate.tx || candidate.db !== db) {
    throw new Error('別のデータベース接続で開かれたトランザクションスコープが渡されました');
  }
  if (candidate.tenantId !== tenantId) {
    throw new Error(
      `別テナントのトランザクションスコープが渡されました(scope=${candidate.tenantId}, 要求=${tenantId})`,
    );
  }
  return candidate.tx;
}

/**
 * テナントスコープでクエリを実行する。
 *
 * 全テーブルに Row Level Security を張り、ポリシーは current_setting('app.tenant_id') と
 * 突き合わせる形にしてある(doc/07 第4章)。アプリ側のWHERE句の書き忘れでは
 * 他テナントのデータが漏れない、という保証をDBに持たせるのが狙い。
 *
 * SET LOCAL はトランザクション内でのみ有効なため、必ずトランザクションで包む。
 * プール接続が使い回されても設定が残らないので、漏れの心配がない。
 *
 * scope を渡した場合は新しいトランザクションを開かず、既に開いているものに相乗りする。
 * 「ドメインの行を書く」と「outbox_jobsに積む」のように、揃って成立しなければ意味がない
 * 書き込みを1つのトランザクションにまとめるための入口(UnitOfWorkPort参照)。
 */
export async function withTenant<T>(
  db: Database,
  tenantId: string,
  fn: (tx: DatabaseTransaction) => Promise<T>,
  scope?: TransactionScope,
): Promise<T> {
  if (scope) return fn(resolveScope(db, tenantId, scope));
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}
