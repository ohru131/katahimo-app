import { PGlite } from '@electric-sql/pglite';
import * as schema from '@katahimo/db/schema';
import { serializeTransactions } from '@katahimo/db/serialize-transactions';
import type { Database } from '@katahimo/db/tenant-scope';
import { drizzle } from 'drizzle-orm/pglite';
// 本番と同じマイグレーションをそのまま流す。デモ専用のDDLを別に持つと、スキーマを変えた
// ときにデモだけ壊れる(しかも気付くのが遅れる)ため、必ず単一の正から生成する。
import INIT_SCHEMA_SQL from '../../db/drizzle/0000_init_schema.sql?raw';

/** IndexedDB上のデータ置き場。リセット時にこの名前を含むDBを消す。 */
const DATA_DIR = 'katahimo-demo';

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
    // コミットのたびにIndexedDBへの書き出し完了を待たない。デモのシード投入は
    // 数十件ぶんのトランザクションを直列に流すため、待つと初回起動が数倍遅くなる。
    // 引き換えにブラウザを強制終了した場合の直近数件が失われうるが、
    // 失われて困るデータが存在しないデモでは払って構わないコスト。
    relaxedDurability: true,
  });
  await client.waitReady;

  // 出勤簿・勤怠は全てJST基準の業務日として扱う(postgres-js側の connection.TimeZone と揃える)。
  // PGliteのセッションは起動ごとに作り直されるため、毎回設定する必要がある。
  await client.exec("SET TIME ZONE 'Asia/Tokyo';");

  const { rows } = await client.query<{ exists: boolean }>(
    "SELECT to_regclass('public.tenants') IS NOT NULL AS exists;",
  );
  const isFresh = rows[0]?.exists !== true;
  if (isFresh) {
    await client.exec(INIT_SCHEMA_SQL);
  }

  // PGliteは接続を1本しか持たないため、トランザクションを直列化しないと
  // usecasesのPromise.all(...)でBEGINが入れ子になって壊れる。
  const db = serializeTransactions(drizzle(client, { schema, casing: 'snake_case' }) as unknown as Database);

  return { db, client, isFresh };
}

/**
 * デモデータを完全に破棄する(画面の「デモデータをリセット」用)。
 * 次回起動時にスキーマ作成とシード投入からやり直される。
 */
export async function destroyDemoDatabase(client: PGlite): Promise<void> {
  await client.close();
  const databases = (await indexedDB.databases?.()) ?? [];
  const targets = databases.map((d) => d.name).filter((name): name is string => !!name?.includes(DATA_DIR));
  await Promise.all(
    targets.map(
      (name) =>
        new Promise<void>((resolve) => {
          const request = indexedDB.deleteDatabase(name);
          // ブロックされた場合(他タブが開いている等)もデモを固まらせないため、
          // 失敗してもresolveしてリロードに進ませる。
          request.onsuccess = () => resolve();
          request.onerror = () => resolve();
          request.onblocked = () => resolve();
        }),
    ),
  );
}
