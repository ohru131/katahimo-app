import { is, SQL } from 'drizzle-orm';
import { CasingCache } from 'drizzle-orm/casing';
import { getTableConfig, PgDialect, PgTable } from 'drizzle-orm/pg-core';
import * as schema from '../schema';

/**
 * drizzleのスキーマ定義から、ドキュメント生成に必要な事実だけを取り出す。
 *
 * 一次情報は packages/db/src/schema/*.ts。SQLファイルを読み直すのではなく
 * drizzleの getTableConfig() に解釈させるのは、drizzle-kit がDDLを起こすときと
 * 同じ入力・同じ解釈を通すため。ここでDDLを自前で解析すると、解析器の癖のぶんだけ
 * 「実際に適用されるDDL」とドキュメントがズレる余地ができる。
 *
 * 列名・SQLの描画には casing: 'snake_case' を渡す。client.ts の drizzle() と
 * drizzle.config.ts が同じ設定なので、ここを揃えないと生成物だけが
 * キャメルケース(TypeScript側のプロパティ名)になってDBの実物と食い違う。
 */

const CASING = 'snake_case' as const;

const casing = new CasingCache(CASING);
const dialect = new PgDialect({ casing: CASING });

/**
 * SQL式を、そのままDDLに出るテキストへ直す。
 *
 * 改行・連続空白を1個の空白に潰すのは、スキーマ側で読みやすく改行して書いたCHECK制約が
 * そのまま出るとMarkdownの箇条書きの途中で行が割れて崩れるため。意味は変わらない。
 */
function renderSql(value: SQL | SQL.Aliased): string {
  return dialect
    .sqlToQuery(value as SQL)
    .sql.replace(/\s+/g, ' ')
    .trim();
}

/** 列の既定値。SQL式(now() 等)とリテラル(文字列・数値)の両方を受ける。 */
function renderDefault(column: {
  hasDefault: boolean;
  default: unknown;
  defaultFn?: unknown;
}): string | undefined {
  if (!column.hasDefault) return undefined;
  // $defaultFn() は実行時にアプリ側で値を作るもので、DDL上の既定値は持たない。
  if (column.default === undefined) return column.defaultFn ? '(アプリ側で採番)' : undefined;
  if (is(column.default, SQL)) return renderSql(column.default);
  return typeof column.default === 'string' ? `'${column.default}'` : String(column.default);
}

export interface ColumnInfo {
  readonly name: string;
  readonly sqlType: string;
  readonly notNull: boolean;
  readonly primaryKey: boolean;
  readonly default?: string;
}

export interface ForeignKeyInfo {
  readonly columns: readonly string[];
  readonly table: string;
  readonly foreignColumns: readonly string[];
  readonly onDelete?: string;
}

export interface IndexInfo {
  readonly name: string;
  readonly columns: readonly string[];
  readonly unique: boolean;
  readonly where?: string;
}

export interface ConstraintInfo {
  readonly name: string;
  readonly expression: string;
}

export interface PolicyInfo {
  readonly name: string;
  readonly for: string;
  readonly using?: string;
}

export interface TableInfo {
  readonly name: string;
  readonly columns: readonly ColumnInfo[];
  /** 複合主キー。単一列のPKは ColumnInfo.primaryKey 側に出る。 */
  readonly primaryKey?: readonly string[];
  readonly uniqueConstraints: readonly ConstraintInfo[];
  readonly foreignKeys: readonly ForeignKeyInfo[];
  readonly checks: readonly ConstraintInfo[];
  readonly indexes: readonly IndexInfo[];
  readonly policies: readonly PolicyInfo[];
  readonly rlsEnabled: boolean;
}

/**
 * インデックスの構成要素。素の列と、式インデックス(SQL)の両方を受ける。
 *
 * インデックスが持つのは列そのものではなく IndexedColumn という包みで、
 * casing の解決に要る table を持たない。そのため CasingCache には渡せず、
 * 同じ名前のテーブル列を引いて解決済みの名前に読み替える。
 */
function renderIndexColumn(column: unknown, columnNames: ReadonlyMap<string, string>): string {
  if (is(column, SQL)) return renderSql(column);
  const name = (column as { name?: string }).name;
  if (name === undefined) return String(column);
  return columnNames.get(name) ?? name;
}

/**
 * 引数を unknown で受けるのは、`Object.values(schema)` の要素型(テーブルごとの具象型の
 * union)に対して `value is PgTable` を直接書くと、型述語の代入互換性検査で弾かれるため。
 * 同じ理由の同じ書き方が rlsPolicies.test.ts にもある。
 */
function isPgTable(value: unknown): value is PgTable {
  return is(value, PgTable);
}

/**
 * スキーマの全テーブルを、DB上の名前をキーにして返す。
 *
 * schema/index.ts の export をそのまま辿るので、テーブルを足したときに
 * ここへ書き足す必要は無い(書き足し忘れで生成物から漏れることが無い)。
 */
export function collectTables(): Map<string, TableInfo> {
  const tables = (Object.values(schema) as unknown[]).filter(isPgTable);
  const collected = new Map<string, TableInfo>();

  for (const table of tables) {
    const config = getTableConfig(table);
    const columnName = (column: unknown) => casing.getColumnCasing(column as never);
    // IndexedColumn から実物の列へ戻すための対応表(TypeScript側の名前 → DB上の名前)。
    const columnNames = new Map(config.columns.map((column) => [column.name, columnName(column)]));

    collected.set(config.name, {
      name: config.name,
      columns: config.columns.map((column) => ({
        name: columnName(column),
        sqlType: column.getSQLType(),
        notNull: column.notNull,
        primaryKey: column.primary,
        default: renderDefault(column as never),
      })),
      primaryKey: config.primaryKeys[0]?.columns.map(columnName),
      uniqueConstraints: config.uniqueConstraints.map((unique) => ({
        name: unique.name ?? '',
        expression: unique.columns.map(columnName).join(', '),
      })),
      foreignKeys: config.foreignKeys.map((foreignKey) => {
        const reference = foreignKey.reference();
        return {
          columns: reference.columns.map(columnName),
          table: getTableConfig(reference.foreignTable).name,
          foreignColumns: reference.foreignColumns.map(columnName),
          // drizzleは未指定を 'no action' で返す。既定と同じものは書かない。
          onDelete: foreignKey.onDelete === 'no action' ? undefined : foreignKey.onDelete,
        };
      }),
      checks: config.checks.map((check) => ({ name: check.name, expression: renderSql(check.value) })),
      indexes: config.indexes.map((index) => ({
        name: index.config.name ?? '',
        columns: index.config.columns.map((column) => renderIndexColumn(column, columnNames)),
        unique: index.config.unique === true,
        where: index.config.where ? renderSql(index.config.where) : undefined,
      })),
      policies: Object.values(config.policies ?? {}).map((policy) => ({
        name: policy.name,
        for: policy.for ?? 'all',
        using: policy.using ? renderSql(policy.using) : undefined,
      })),
      rlsEnabled: config.enableRLS || Object.values(config.policies ?? {}).length > 0,
    });
  }

  return collected;
}
