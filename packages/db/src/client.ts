import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type { Database, DatabaseTransaction } from './tenantScope';
export { withTenant } from './tenantScope';

/** Node上でpostgres-jsに繋いだ実体。$client(接続プール)を触りたい場合はこちらの型を使う。 */
export type NodeDatabase = ReturnType<typeof createDatabase>;

let singleton: NodeDatabase | null = null;

export function createDatabase(connectionString: string) {
  const client = postgres(connectionString, {
    // Cloud Run は同時実行数が読めないので控えめに。ローカルでも十分。
    max: Number(process.env.DB_POOL_MAX ?? 10),
    // 出勤簿・勤怠の日付は全てJST基準の業務日として扱う
    connection: { TimeZone: 'Asia/Tokyo' },
  });
  return drizzle(client, { schema, casing: 'snake_case' });
}

/** プロセス全体で1つのプールを共有する。 */
export function getDatabase(): NodeDatabase {
  if (singleton) return singleton;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL が設定されていません(.env.example を参照)');
  singleton = createDatabase(url);
  return singleton;
}

/**
 * getDatabase()が作った共有プールの接続を閉じる。ワーカー等、常駐プロセスが
 * シグナル受信時にイベントループを解放してプロセスを終了できるようにするために使う。
 */
export async function closeDatabase(): Promise<void> {
  if (!singleton) return;
  await singleton.$client.end();
  singleton = null;
}
