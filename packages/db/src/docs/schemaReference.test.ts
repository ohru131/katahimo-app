import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectTables, type TableInfo } from './collectSchema';
import { SCHEMA_DOMAINS } from './domains';
import { REFERENCE_PATH } from './referencePath';
import { renderDiagram, renderReference, renderTable } from './renderReference';

/**
 * 自動生成するリファレンス(doc/db/reference.md)が、スキーマの現状と一致していることの検査。
 *
 * 生成物をリポジトリに置く以上、「スキーマを変えたが `pnpm db:docs` を忘れた」状態が
 * 必ず起きる。そのとき図と表だけが古いまま残り、読んだ人は気付けない。CIで作り直して
 * 突き合わせ、ズレていたら落とす。
 */

const tables = collectTables();

/** 検査用の空テーブル。必要な項目だけを上書きして使う。 */
function emptyTable(name: string): TableInfo {
  return {
    name,
    columns: [],
    uniqueConstraints: [],
    foreignKeys: [],
    checks: [],
    indexes: [],
    policies: [],
    rlsEnabled: false,
  };
}

/** 検査用の列。 */
function column(name: string, notNull: boolean): TableInfo['columns'][number] {
  return { name, sqlType: 'uuid', notNull, primaryKey: false };
}

/** テーブル1つぶんの節だけを描画する(ドメイン定義を通さずに確かめるため)。 */
function renderTableSection(table: TableInfo): string {
  return renderTable(table);
}

/** 生成したMarkdownから、mermaidの関係線だけを取り出す。 */
function diagramRelations(): string[] {
  return renderReference(tables)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^\w+ \|[|o]--o[|{] \w+ :/.test(line))
    .map((line) => line.replace(/ : ".*$/, ''));
}

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

  // 以下は「生成器そのものが壊れていないか」の検査。
  //
  // 下の「生成物が最新である」検査は、生成し直した結果とコミット済みファイルを突き合わせるだけなので、
  // 生成器が壊れたまま再生成されると、両方が同じように壊れて素通りする。実際にレビューで
  // 見つかった壊れ方(オブジェクトの既定値・索引の並び順・部分ユニーク索引の扱い)を
  // 名指しで押さえておく。
  describe('生成器の出力', () => {
    it('jsonbの既定値をJSONとして出す(JavaScriptの文字列化に落ちない)', () => {
      const rowData = tables.get('attendance_days')?.columns.find((column) => column.name === 'row_data');

      expect(rowData?.default).toBe("'{}'::jsonb");
    });

    it('索引の降順を落とさない', () => {
      // ORDER BY と向きを揃えるために降順で張っている索引がある(doc/db/guidelines.md §3)。
      const index = tables
        .get('daily_reports')
        ?.indexes.find((candidate) => candidate.name === 'daily_reports_tenant_customer_occurred_idx');

      expect(index?.columns).toEqual(['tenant_id', 'customer_id', 'occurred_at DESC NULLS LAST']);
    });

    it('NULLを除くだけの部分ユニーク索引は1対1として描く', () => {
      // daily_reports_tenant_reservation_uidx は reservation_id IS NOT NULL の部分索引。
      // 親を指している行は全部この索引が縛るので、1予約に日報は1件まで。
      expect(diagramRelations()).toContain('reservations |o--o| daily_reports');
    });

    it('RLSが有効ならポリシーの有無に関わらず「なし」とは書かない', () => {
      // ポリシーが1つも無いまま有効にすると、一致するポリシーが無いので何も見えなくなる。
      // そこで「RLS: なし」と出すと実態と正反対の説明になる。
      // 一方で「全行が拒否される」とも書かない(superuser・BYPASSRLS・FORCE未適用の所有者は素通りする)。
      const rendered = renderTableSection({
        ...emptyTable('rls_without_policy'),
        rlsEnabled: true,
        policies: [],
      });

      expect(rendered).toContain('RLS: 有効(ポリシーが無いため、RLSが適用されるロールからは1行も見えない)');
    });

    it('ポリシーが複数あれば全部出す', () => {
      const rendered = renderTableSection({
        ...emptyTable('two_policies'),
        rlsEnabled: true,
        policies: [
          { name: 'policy_a', for: 'select', using: 'a' },
          { name: 'policy_b', for: 'insert', using: 'b' },
        ],
      });

      expect(rendered).toContain('RLS: `policy_a`(SELECT)— `a`');
      expect(rendered).toContain('RLS: `policy_b`(INSERT)— `b`');
    });

    it('式インデックスを含むユニーク索引は多重度の判定に使わない', () => {
      // columnNames には式が入らないので、`(tenant_id, lower(code))` が `[tenant_id]` に
      // 見えて、tenant_id だけの外部キーと誤って一致してしまう。
      const child: TableInfo = {
        ...emptyTable('children'),
        columns: [column('parent_id', true)],
        foreignKeys: [{ columns: ['parent_id'], table: 'parents', foreignColumns: ['id'] }],
        indexes: [
          {
            name: 'children_expr_uidx',
            columns: ['parent_id', 'lower(code)'],
            columnNames: ['parent_id'],
            unique: true,
          },
        ],
      };
      const rendered = renderDiagram([child]);

      // 1対1(o|)ではなく1対多(o{)になる。
      expect(rendered).toContain('parents ||--o{ children');
    });

    it('業務条件で絞る部分ユニーク索引は1対1にしない', () => {
      // reservation_assignments_primary_uidx は role='primary' の行だけを縛る。
      // 同行スタッフは何人でも割り当てられるので1対多のまま。
      expect(diagramRelations()).toContain('reservations ||--o{ reservation_assignments');
    });
  });

  it('コミットされている生成物が最新である', () => {
    const committed = readFileSync(REFERENCE_PATH, 'utf8');

    expect(
      renderReference(tables),
      `${relative(process.cwd(), REFERENCE_PATH)} が古い。pnpm db:docs で作り直すこと`,
    ).toBe(committed);
  });
});
