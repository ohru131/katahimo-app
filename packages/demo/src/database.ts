import { PGlite } from '@electric-sql/pglite';
import * as schema from '@katahimo/db/schema';
import { serializeTransactions } from '@katahimo/db/serialize-transactions';
import type { Database } from '@katahimo/db/tenant-scope';
import { drizzle } from 'drizzle-orm/pglite';

/**
 * 本番と同じマイグレーションをそのまま流す。デモ専用のDDLを別に持つと、スキーマを変えた
 * ときにデモだけ壊れる(しかも気付くのが遅れる)ため、必ず単一の正から生成する。
 *
 * ファイル名を列挙せずglobで集めるのは、マイグレーションを追加したときに
 * ここを書き足し忘れてデモだけ古いスキーマで動く、という壊れ方を防ぐため。
 * `0000_`, `0001_`, … と連番が先頭に付く命名なので、ファイル名順=適用順になる。
 */
const MIGRATIONS: DemoMigration[] = Object.entries(
  import.meta.glob('../../db/drizzle/*.sql', { query: '?raw', import: 'default', eager: true }),
)
  .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  .map(([path, sql]) => ({ tag: path.replace(/^.*\//, '').replace(/\.sql$/, ''), sql: sql as string }));

/** PGliteに渡すデータ置き場の名前(IndexedDB上は `/pglite/<この名前>` になる)。 */
const DATA_DIR = 'katahimo-demo';

/**
 * 適用済みマイグレーションの台帳。本番の `migrate()` が `drizzle.__drizzle_migrations`
 * でやっていることを、デモでも持つ。
 *
 * これが無いと、既にデモを開いたことがある訪問者のIndexedDBには古いスキーマだけが
 * 残り、あとから追加したマイグレーションが永久に当たらない(スキーマ作成を
 * 「テーブルが1つも無いとき」だけの処理にしていると、そうなる)。
 */
const LEDGER_TABLE = 'demo_applied_migrations';

async function relationExists(client: PGlite, qualifiedName: string): Promise<boolean> {
  const { rows } = await client.query<{ exists: boolean }>('SELECT to_regclass($1) IS NOT NULL AS exists;', [
    qualifiedName,
  ]);
  return rows[0]?.exists === true;
}

/** マイグレーション1件。`tag`はファイル名から拡張子を除いたもの(台帳のキー)。 */
export interface DemoMigration {
  tag: string;
  sql: string;
}

/**
 * 未適用のマイグレーションを順に当てる。戻り値は「スキーマを新規に作ったか」
 * (=シード投入が必要か)。
 *
 * `migrations` を引数で受け取るのは、`import.meta.glob` に依存せずテストから
 * 実際のPostgres(PGlite)に対して当てられるようにするため。
 */
export async function applyPendingMigrations(client: PGlite, migrations: DemoMigration[]): Promise<boolean> {
  if (migrations.length === 0) throw new Error('マイグレーションSQLを読み込めませんでした');

  const schemaExists = await relationExists(client, 'public.tenants');
  const ledgerExists = await relationExists(client, `public.${LEDGER_TABLE}`);

  let isFresh = !schemaExists;
  if (schemaExists && !ledgerExists) {
    // 台帳を持たない時代に作られたDB。どこまで当たっているか判断できないので作り直す。
    // 消えるのは架空のシードデータと訪問者がデモで入力した内容だけなので、
    // 古いスキーマのまま認証経路が落ちる状態で使わせるより、こちらのほうが良い。
    console.warn('[demo] スキーマが古い形式のため、デモデータを作り直します。');
    await client.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    isFresh = true;
  }

  await client.exec(
    `CREATE TABLE IF NOT EXISTS ${LEDGER_TABLE} (
       tag text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     );`,
  );

  const { rows } = await client.query<{ tag: string }>(`SELECT tag FROM ${LEDGER_TABLE};`);
  const applied = new Set(rows.map((row) => row.tag));

  for (const migration of migrations) {
    if (applied.has(migration.tag)) continue;
    await client.exec(migration.sql);
    await client.query(`INSERT INTO ${LEDGER_TABLE} (tag) VALUES ($1);`, [migration.tag]);
  }

  return isFresh;
}

export interface DemoDatabase {
  db: Database;
  client: PGlite;
  /** 初回起動(スキーマを作った直後)ならtrue。シード投入の要否判定に使う。 */
  isFresh: boolean;
}

/**
 * ブラウザ内にPostgreSQL(PGlite/WASM)を立ち上げ、本番と同じスキーマを適用する。
 * データはIndexedDBに永続化されるので、リロードしてもデモで入力した内容は残る。
 */
export async function openDemoDatabase(): Promise<DemoDatabase> {
  const client = new PGlite({
    dataDir: `idb://${DATA_DIR}`,
    // コミットのたびにIndexedDBへの書き出し完了を待たない。シード投入は数百件の
    // トランザクションを直列に流すため、待つと初回起動が12秒→4秒ほど変わる。
    // 代わりに、シード完了時と各更新リクエストの後に flushDemoDatabase() で明示的に
    // 書き出す(そうしないと、ログイン直後にリロードしただけでセッションが消える)。
    relaxedDurability: true,
  });
  await client.waitReady;

  // 出勤簿・勤怠は全てJST基準の業務日として扱う(postgres-js側の connection.TimeZone と揃える)。
  // PGliteのセッションは起動ごとに作り直されるため、毎回設定する必要がある。
  await client.exec("SET TIME ZONE 'Asia/Tokyo';");

  const isFresh = await applyPendingMigrations(client, MIGRATIONS);

  // PGliteは接続を1本しか持たないため、トランザクションを直列化しないと
  // usecasesのPromise.all(...)でBEGINが入れ子になって壊れる。
  const db = serializeTransactions(drizzle(client, { schema, casing: 'snake_case' }) as unknown as Database);

  return { db, client, isFresh };
}

/** PGliteの内部FS。型定義に出ていないので、使う範囲だけをここで宣言する。 */
interface PgliteInternalFs {
  /** IndexedDBへの書き出しを実行して完了を待つ(実体は emscripten の FS.syncfs)。 */
  syncToFs(relaxedDurability?: boolean): Promise<void>;
}

let flushUnavailableWarned = false;

/**
 * コミット済みの内容をIndexedDBへ確実に書き出す。
 *
 * relaxedDurabilityを有効にしているため、トランザクションがコミットしただけでは
 * 書き出しが完了していない。`PGlite.syncToFs()` は公開APIだが、relaxedDurability時は
 * 意図的に完了を待たない実装(内部で `await` していない)なので、実際に待てる
 * FS側を直接呼ぶ。
 *
 * PGliteの内部構造に触れているため、将来のバージョンで到達できなくなる可能性がある。
 * その場合でも壊れるのは「リロードで直前の操作が失われることがある」という程度なので、
 * 例外にはせず警告だけ出してデモは動かし続ける。
 */
export async function flushDemoDatabase(client: PGlite): Promise<void> {
  const fs = (client as unknown as { fs?: Partial<PgliteInternalFs> }).fs;
  if (typeof fs?.syncToFs !== 'function') {
    if (!flushUnavailableWarned) {
      flushUnavailableWarned = true;
      console.warn(
        '[demo] PGliteの書き出しAPIが見つかりません。リロードで直前の操作が失われることがあります。',
      );
    }
    return;
  }
  await fs.syncToFs(false);
}

/**
 * デモデータを完全に破棄する(画面の「デモデータをリセット」用)。
 * 次回起動時にスキーマ作成とシード投入からやり直される。
 *
 * IndexedDBのデータベース(`/pglite/...`)ごと削除する方法は使えない。PGliteは
 * `close()` の後も書き出しのためにIndexedDBの接続を開き直すことがあり、
 * `deleteDatabase()` が `onblocked` のまま完了しない(20秒待っても完了しないことを実測)。
 * 他タブが原因ではないので、待っても案内を出しても解決しない。
 *
 * そこで、DBファイルを消すのではなくスキーマを落とす。次回起動時の
 * `to_regclass('public.tenants')` がnullになるので初回起動と同じ経路に入り、
 * スキーマ作成とシード投入がやり直される。
 */
export async function destroyDemoDatabase(client: PGlite): Promise<void> {
  // 適用済みマイグレーションの台帳も public スキーマにあるので一緒に消える。
  // 次回起動時は台帳が空になり、全マイグレーションが当たり直す。
  await client.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  // 消したことを確実にIndexedDBへ反映してから閉じる(relaxedDurabilityのため)。
  await flushDemoDatabase(client);
  await client.close();
}
