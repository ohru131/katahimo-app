import type { TableInfo } from './collectSchema';
import { SCHEMA_DOMAINS } from './domains';

/**
 * 収集したスキーマ情報を doc/16 のMarkdownに組み立てる。
 *
 * 書くのは「スキーマ定義から機械的に導ける事実」だけに限る。なぜその形にしたのかは
 * doc/09(手書き)と各schemaファイルのコメントが持つ。両方に同じ説明を置くと、
 * 生成されない側だけが古くなって食い違うため。
 */

/** mermaidの属性行は空白を含む型名を受け付けないので、1語に均す。 */
function mermaidType(sqlType: string): string {
  return sqlType.replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, '_');
}

/** 外部キーが指す先が一意なら1対1、そうでなければ1対多として描く。 */
function cardinality(child: TableInfo, columns: readonly string[]): string {
  const key = [...columns].sort().join(',');
  const unique = [
    ...child.uniqueConstraints.map((constraint) => constraint.expression.split(', ')),
    ...child.indexes.filter((index) => index.unique && !index.where).map((index) => index.columns),
  ].some((candidate) => [...candidate].sort().join(',') === key);
  return unique ? '||--||' : '||--o{';
}

/**
 * ドメイン1つぶんのER図。
 *
 * 属性はPKとFKの列だけを出す。全462列を図に流し込むと読めなくなるうえ、同じ内容が
 * 第2章の表にもある。図の役目は「どのテーブルがどう繋がっているか」に絞る。
 */
function renderDiagram(owned: readonly TableInfo[]): string {
  const ownedNames = new Set(owned.map((table) => table.name));
  // 親として参照されるだけのテーブルも、線の行き先として図に出す(属性は出さない)。
  const referenced = new Set<string>();
  for (const table of owned) {
    for (const foreignKey of table.foreignKeys) {
      if (!ownedNames.has(foreignKey.table)) referenced.add(foreignKey.table);
    }
  }

  const lines = ['```mermaid', 'erDiagram'];

  for (const table of owned) {
    const keyColumns = new Set<string>([
      ...table.columns.filter((column) => column.primaryKey).map((column) => column.name),
      ...(table.primaryKey ?? []),
      ...table.foreignKeys.flatMap((foreignKey) => foreignKey.columns),
    ]);
    const shown = table.columns.filter((column) => keyColumns.has(column.name));
    lines.push(`    ${table.name} {`);
    for (const column of shown) {
      const role = column.primaryKey || table.primaryKey?.includes(column.name) ? 'PK' : 'FK';
      lines.push(`        ${mermaidType(column.sqlType)} ${column.name} "${role}"`);
    }
    lines.push('    }');
  }
  for (const name of [...referenced].sort()) lines.push(`    ${name} {`, '    }');

  for (const table of owned) {
    for (const foreignKey of table.foreignKeys) {
      const label = foreignKey.columns.join(', ');
      lines.push(
        `    ${foreignKey.table} ${cardinality(table, foreignKey.columns)} ${table.name} : "${label}"`,
      );
    }
  }

  lines.push('```');
  return lines.join('\n');
}

/** テーブル1つぶんの定義(列の表+制約の箇条書き)。 */
function renderTable(table: TableInfo): string {
  const out: string[] = [`### \`${table.name}\``, ''];

  const policy = table.policies[0];
  out.push(
    policy ? `RLS: \`${policy.name}\`(${policy.for.toUpperCase()})— \`${policy.using ?? ''}\`` : 'RLS: なし',
    '',
  );

  out.push('| 列 | 型 | NULL | 既定値 |', '|---|---|---|---|');
  for (const column of table.columns) {
    const name =
      column.primaryKey || table.primaryKey?.includes(column.name)
        ? `\`${column.name}\` (PK)`
        : `\`${column.name}\``;
    out.push(
      `| ${name} | \`${column.sqlType}\` | ${column.notNull ? 'NOT NULL' : 'NULL可'} | ${column.default ? `\`${column.default}\`` : '—'} |`,
    );
  }
  out.push('');

  const section = (title: string, items: readonly string[]) => {
    if (items.length === 0) return;
    out.push(`**${title}**`, '');
    for (const item of items) out.push(`- ${item}`);
    out.push('');
  };

  if (table.primaryKey) section('主キー(複合)', [`\`(${table.primaryKey.join(', ')})\``]);
  section(
    '一意制約',
    table.uniqueConstraints.map((unique) => `\`${unique.name}\` \`(${unique.expression})\``),
  );
  section(
    '外部キー',
    table.foreignKeys.map(
      (foreignKey) =>
        `\`(${foreignKey.columns.join(', ')})\` → \`${foreignKey.table}(${foreignKey.foreignColumns.join(', ')})\`` +
        (foreignKey.onDelete ? ` ON DELETE ${foreignKey.onDelete.toUpperCase()}` : ''),
    ),
  );
  section(
    'CHECK制約',
    table.checks.map((check) => `\`${check.name}\` — \`${check.expression}\``),
  );
  section(
    'インデックス',
    table.indexes.map(
      (index) =>
        `\`${index.name}\` \`(${index.columns.join(', ')})\`` +
        (index.unique ? ' UNIQUE' : '') +
        (index.where ? ` WHERE \`${index.where}\`` : ''),
    ),
  );

  return out.join('\n');
}

/**
 * ドメイン定義に挙がっているテーブルを引く。
 *
 * 見つからないのは domains.ts と schema/ が食い違っている状態で、黙って飛ばすと
 * 生成物からテーブルが1つ消えるだけで気付けない。schemaReference.test.ts が先に
 * 落とすはずだが、生成を直接叩いた場合のために例外にしておく。
 */
function mustGet(tables: Map<string, TableInfo>, name: string): TableInfo {
  const table = tables.get(name);
  if (!table) throw new Error(`domains.ts に、スキーマに存在しないテーブルがある: ${name}`);
  return table;
}

/** doc/16 の全文を組み立てる。 */
export function renderReference(tables: Map<string, TableInfo>): string {
  const all = [...tables.values()];
  const totals = {
    tables: all.length,
    columns: all.reduce((sum, table) => sum + table.columns.length, 0),
    foreignKeys: all.reduce((sum, table) => sum + table.foreignKeys.length, 0),
    indexes: all.reduce((sum, table) => sum + table.indexes.length, 0),
    checks: all.reduce((sum, table) => sum + table.checks.length, 0),
    policies: all.reduce((sum, table) => sum + table.policies.length, 0),
  };

  const out: string[] = [
    '---',
    'title: "データベース構造リファレンス(自動生成)"',
    '---',
    '',
    '<!--',
    '  このファイルは packages/db/src/schema/*.ts から自動生成される。手で編集しない。',
    '  編集してもスキーマを変えた次の再生成で消える。内容を変えたいときはスキーマ定義か',
    '  packages/db/src/docs/ の生成コードを直すこと。',
    '',
    '  再生成: pnpm db:docs',
    '-->',
    '',
    '# データベース構造リファレンス',
    '',
    '`packages/db/src/schema/*.ts` から機械的に書き出した、全テーブルの定義。',
    'drizzleがDDLを起こすときと同じ解釈を通しているので、`packages/db/drizzle/*.sql` で',
    '実際に適用される形と一致する。',
    '',
    'ここに書くのはスキーマから導ける事実だけで、**なぜその形にしたのか**は扱わない。',
    '設計の意図・テナント分離の方針・暗号化の構成は `doc/09_データベース構造解説.md`、',
    '設計時に踏んだ落とし穴は `doc/14_データベース設計の指針と落とし穴.md` を参照。',
    '',
    '## 規模',
    '',
    '| 項目 | 数 |',
    '|---|---|',
    `| テーブル | ${totals.tables} |`,
    `| 列 | ${totals.columns} |`,
    `| 外部キー | ${totals.foreignKeys} |`,
    `| インデックス | ${totals.indexes} |`,
    `| CHECK制約 | ${totals.checks} |`,
    `| RLSポリシー | ${totals.policies} |`,
    '',
    '---',
    '',
    '# 1. ER図',
    '',
    '1枚に収めると読めないため、業務ドメインごとに分ける(区切り方は `doc/09` 第2章と同じ)。',
    '図に出すのは主キーと外部キーの列だけで、全列は第2章にある。',
    '枠だけのテーブルは、そのドメインでは参照されるだけで定義は別の節にあることを示す。',
    '',
  ];

  SCHEMA_DOMAINS.forEach((domain, index) => {
    const owned = domain.tables.map((name) => mustGet(tables, name));
    out.push(`## 1.${index + 1} ${domain.title}`, '');
    if (domain.note) out.push(domain.note, '');
    out.push(renderDiagram(owned), '');
  });

  out.push(
    '---',
    '',
    '# 2. テーブル定義',
    '',
    '並びは第1章の図と同じ。見出しは連番ではなくテーブル名にしてある(テーブルが増えても',
    '以降の番号がずれず、差分が実際に変わった箇所だけになるため)。',
    '',
  );
  SCHEMA_DOMAINS.forEach((domain, index) => {
    out.push(`## 2.${index + 1} ${domain.title}`, '');
    for (const name of domain.tables) out.push(renderTable(mustGet(tables, name)), '');
  });

  return `${out.join('\n').trimEnd()}\n`;
}
