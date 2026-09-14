import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectTables } from './collectSchema';
import { SCHEMA_DOMAINS } from './domains';
import { REFERENCE_PATH } from './referencePath';
import { renderReference } from './renderReference';

/**
 * 自動生成するリファレンス(doc/16)が、スキーマの現状と一致していることの検査。
 *
 * 生成物をリポジトリに置く以上、「スキーマを変えたが `pnpm db:docs` を忘れた」状態が
 * 必ず起きる。そのとき図と表だけが古いまま残り、読んだ人は気付けない。CIで作り直して
 * 突き合わせ、ズレていたら落とす。
 */

const tables = collectTables();

describe('データベース構造リファレンス', () => {
  it('全テーブルがいずれかのドメインに属している', () => {
    // ドメイン定義が追い付いていないテーブルは、図にもテーブル定義にも出ない。
    // 生成物が黙って不完全になるのではなく、ここで気付けるようにする。
    const assigned = new Set(SCHEMA_DOMAINS.flatMap((domain) => domain.tables));
    const missing = [...tables.keys()].filter((name) => !assigned.has(name));

    expect(missing, 'packages/db/src/docs/domains.ts に追記すること').toEqual([]);
  });

  it('ドメイン定義に実在しないテーブルが混ざっていない', () => {
    // テーブルを消したのに定義だけ残ると、生成時に例外で落ちる。先にここで示す。
    const unknown = SCHEMA_DOMAINS.flatMap((domain) => domain.tables).filter((name) => !tables.has(name));

    expect(unknown).toEqual([]);
  });

  it('同じテーブルが2つのドメインに登録されていない', () => {
    const seen = new Set<string>();
    const duplicated = SCHEMA_DOMAINS.flatMap((domain) => domain.tables).filter((name) => {
      if (seen.has(name)) return true;
      seen.add(name);
      return false;
    });

    expect(duplicated).toEqual([]);
  });

  it('コミットされている生成物が最新である', () => {
    const committed = readFileSync(REFERENCE_PATH, 'utf8');

    expect(
      renderReference(tables),
      `${relative(process.cwd(), REFERENCE_PATH)} が古い。pnpm db:docs で作り直すこと`,
    ).toBe(committed);
  });
});
