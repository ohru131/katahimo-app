import { type SQL, sql } from 'drizzle-orm';

/**
 * CHECK制約の中に「定数」を埋めるためのヘルパ。
 *
 * 【sql.raw を使う理由】
 * drizzleの `sql` テンプレートに JavaScript の値を `${}` で埋めると、リテラルではなく
 * バインドパラメータ($1)になる。CHECK制約はDDLの一部で、パラメータを取れないため、
 * `CHECK (... <= $1)` というDDLが生成されて適用時に
 * 「there is no parameter $1」で落ちる(実際にこれで踏んだ)。
 * 定数を入れるときは必ずこのヘルパを通し、SQL文字列としてそのまま埋める。
 */

/**
 * `CHECK (col IN ('a', 'b', ...))` の右辺を組み立てる。
 *
 * 許可値は必ず @katahimo/shared の contracts で定義した配列(zodのenumのoptions)を渡すこと。
 * DDLに値をベタ書きすると、区分が増えたときにDBだけが古い許可値のまま残り、
 * 「アプリは通すのにDBが23514で拒否する(またはその逆)」というズレに気付けなくなる。
 *
 * 渡すのは常にコード内のリテラル(zodのenum)であって外部入力ではないが、将来うっかり
 * DB由来の値を渡したときに黙って壊れないよう、単引用符とバックスラッシュを含む値は拒否する。
 */
export function sqlInList(values: readonly string[]): SQL {
  if (values.length === 0) throw new Error('sqlInList: 許可値が空です');
  for (const value of values) {
    if (/['\\]/.test(value)) throw new Error(`sqlInList: 引用符を含む許可値は使えません: ${value}`);
  }
  return sql.raw(`(${values.map((value) => `'${value}'`).join(', ')})`);
}

/**
 * 数値の定数をCHECK制約に埋める。上限バイト数・スコアの範囲などを
 * @katahimo/shared 側の定数と1箇所で揃えるために使う。
 */
export function sqlNumber(value: number): SQL {
  if (!Number.isFinite(value)) throw new Error(`sqlNumber: 有限の数値ではありません: ${value}`);
  return sql.raw(String(value));
}
