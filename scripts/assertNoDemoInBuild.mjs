#!/usr/bin/env node
/**
 * 本番ビルドの成果物にデモ用のコード・データが混ざっていないことを検証する。
 *
 * デモ(packages/demo)はブラウザ内PostgreSQL(PGlite、wasm 約8MB)と架空の利用者データを
 * 抱えている。これが本番の配信物に紛れ込むと、無用な巨大アセットを配るだけでなく、
 * 「デモ用の固定鍵」や架空データが本番サイトから読める状態になる。
 *
 * 混入を防いでいるのは vite.config.ts の stripDemoEntry プラグイン(通常ビルドでは
 * デモの入口モジュールごとスタブに差し替える)だが、設定は将来壊れうるので、
 * 壊れたことをCIで必ず検知できるようにここで実際の成果物を検査する。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const distDir = process.argv[2] ?? 'packages/web/dist';

/** 見つかったら即アウトの文字列。デモ側にしか存在しないものだけを並べること。 */
const FORBIDDEN = [
  { needle: 'PGlite', why: 'ブラウザ内PostgreSQL(デモ専用)' },
  { needle: 'katahimo-demo', why: 'デモ用IndexedDBのデータ置き場名' },
  { needle: '織田', why: 'デモ用の架空利用者データ' },
  { needle: 'demo1234', why: 'デモ用アカウントのパスワード' },
  { needle: '@noble/ciphers', why: 'デモ専用のnode:cryptoシムの依存' },
];

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) files.push(...walk(path));
    else files.push(path);
  }
  return files;
}

let files;
try {
  files = walk(distDir);
} catch {
  console.error(`[assert-no-demo] ビルド成果物が見つかりません: ${distDir}`);
  console.error('[assert-no-demo] 先に `pnpm --filter @katahimo/web build` を実行してください。');
  process.exit(1);
}

const violations = [];

for (const file of files) {
  if (file.endsWith('.wasm')) {
    violations.push(`${file}: wasmは本番ビルドには含まれないはずです(PGliteの混入が疑われます)`);
    continue;
  }
  // バイナリを含めて素朴に文字列検索する。テキスト以外でも誤検知より見落としのほうが困る。
  const content = readFileSync(file, 'latin1');
  const utf8 = readFileSync(file, 'utf8');
  for (const { needle, why } of FORBIDDEN) {
    if (content.includes(needle) || utf8.includes(needle)) {
      violations.push(`${file}: "${needle}" を検出(${why})`);
    }
  }
}

if (violations.length > 0) {
  console.error('[assert-no-demo] 本番ビルドにデモ用のコード/データが混入しています:');
  for (const violation of violations) console.error(`  - ${violation}`);
  console.error('[assert-no-demo] packages/web/vite.config.ts の stripDemoEntry を確認してください。');
  process.exit(1);
}

console.log(`[assert-no-demo] OK: ${files.length}ファイルを検査し、デモ用コードの混入はありませんでした。`);
