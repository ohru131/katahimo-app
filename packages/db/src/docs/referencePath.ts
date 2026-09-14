import { fileURLToPath } from 'node:url';

/**
 * 生成物の置き場。生成する側(generate.ts)と、陳腐化を検査する側
 * (schemaReference.test.ts)が同じ定数を見るようにして、片方だけが
 * 別のファイルを指したまま「検査は通るが実物は古い」状態になるのを防ぐ。
 *
 * URL.pathname はWindowsで先頭に余分な "/" が付き崩れるため fileURLToPath を使う
 * (src/migrate.ts と同じ理由)。
 */
export const REFERENCE_PATH = fileURLToPath(
  new URL('../../../../doc/16_データベース構造リファレンス.md', import.meta.url),
);
