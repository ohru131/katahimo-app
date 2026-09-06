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
 */
export async function destroyDemoDatabase(client: PGlite): Promise<void> {
  await client.close();
  const databases = (await indexedDB.databases?.()) ?? [];
  const targets = databases.map((d) => d.name).filter((name): name is string => !!name?.includes(DATA_DIR));
  await Promise.all(
    targets.map(
      (name) =>
        new Promise<void>((resolve, reject) => {
          const request = indexedDB.deleteDatabase(name);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error ?? new Error(`${name} を削除できませんでした`));
          // onblockedは「他のタブがまだこのDBを開いている」状態。ここでresolveすると、
          // 実際には消えていないのにリセット成功として画面をリロードしてしまい、
          // 古いデータがそのまま残っているように見える。必ず失敗として扱う。
          request.onblocked = () =>
            reject(
              new Error(
                'デモを開いている他のタブがあるため、データを削除できませんでした。' +
                  '他のタブを閉じてからもう一度お試しください。',
              ),
            );
        }),
    ),
  );
}
