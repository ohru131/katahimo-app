import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { describe, expect, it } from 'vitest';

/**
 * 「drizzle/*.sql が本番のマイグレータでそのまま流せる」ことの静的検査。
 *
 * 本番は drizzle-orm/postgres-js/migrator の migrate() が適用する。これは区切りの目印
 * (ハイフン2つと大なり記号に続けて statement-breakpoint と書いた行コメント)で
 * SQLを単純に文字列分割し、断片を1文ずつ送る。SQLとして解釈してから切るのではないので、
 * 目印が「文の区切り以外の場所」にあると、そこで文が真っ二つになって適用時に落ちる。
 *
 * この検査が必要なのは、CIの他の経路がここを通らないため。
 * - packages/demo は PGlite に `exec(ファイル全体)` で流す(分割しない)
 * - packages/db/src/rlsPolicies.test.ts は .sql を正規表現で読むだけ(分割しない)
 * つまりテストが全部緑でも migrate() だけが落ちる、という状態があり得る。実際、
 * 0000_baseline_schema.sql の注意書きが目印そのものを引用していたために、
 * コメントの途中で分割されて migrate() が syntax error で落ちていた。
 *
 * 検査は readMigrationFiles()(migrate() が内部で使う実物)に分割させる。分割の規則を
 * このテスト側に写すと、drizzle側の規則が変わったときに検査だけが古くなるため。
 */

const MIGRATIONS_FOLDER = join(dirname(fileURLToPath(import.meta.url)), '../drizzle');

const migrations = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER });

/** 行コメントを落として、SQL本体だけにする。 */
function stripComments(statement: string): string {
  return statement.replace(/--[^\n]*/g, '').trim();
}

/**
 * 分割後の断片が始まってよいキーワード。drizzle-kitが生成するのは今のところ
 * ALTER / CREATE / DROP / UPDATE だけだが、手で追記するDDL(COMMENT・GRANT等)も
 * 通るようにしてある。ここに無いもので始まったら、まず「文の途中で切れている」を疑う。
 */
const STATEMENT_HEADS = [
  'ALTER',
  'COMMENT',
  'CREATE',
  'DELETE',
  'DO',
  'DROP',
  'GRANT',
  'INSERT',
  'REVOKE',
  'SELECT',
  'SET',
  'TRUNCATE',
  'UPDATE',
  'WITH',
];

describe('マイグレーションの分割', () => {
  it('マイグレーションを1本以上読めている', () => {
    // 読み込み先を間違えて0本になっても「全部通った」ことにならないようにする。
    expect(migrations.length).toBeGreaterThan(0);
  });

  for (const migration of migrations) {
    // readMigrationFiles() はファイル名を返さないので、通し番号で場所が分かるようにする。
    describe(`${migration.folderMillis}`, () => {
      it('どの断片もSQL文として始まっている(コメントや文の途中で切れていない)', () => {
        const broken = migration.sql
          .map((statement, index) => ({ index, body: stripComments(statement) }))
          .filter(({ body }) => {
            if (body === '') return true;
            const head = body.split(/\s+/)[0]?.toUpperCase() ?? '';
            return !STATEMENT_HEADS.includes(head);
          })
          .map(({ index, body }) => `${index}: ${body.slice(0, 60)}`);

        expect(broken).toEqual([]);
      });

      it('どの断片の中でもドル引用符が閉じている', () => {
        // 関数定義($$ 〜 $$)の内側で切られると、断片ごとにドル引用符の数が奇数になる。
        //
        // PostgreSQLのドル引用符はタグを付けられる($function$ 〜 $function$ など)。
        // 素の $$ だけを数えると、タグ付きの本体が切られたときに「偶数(=0個)」と見えてしまい、
        // しかも後続の断片が UPDATE 等の許可キーワードで始まっていれば上の検査も通る。
        // タグごとに数えて、1つでも奇数のものがあれば落とす。
        const unbalanced = migration.sql
          .map((statement, index) => {
            const counts = new Map<string, number>();
            for (const [delimiter] of statement.matchAll(/\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$/g)) {
              counts.set(delimiter, (counts.get(delimiter) ?? 0) + 1);
            }
            return { index, counts };
          })
          .filter(({ counts }) => [...counts.values()].some((count) => count % 2 !== 0))
          .map(({ index }) => index);

        expect(unbalanced).toEqual([]);
      });
    });
  }
});
