import { loadDotenv } from '../loadDotenv';

loadDotenv();

import { importLegacyStaff } from '@katahimo/core';
import { getDatabase } from '@katahimo/db';
import { loadEnv } from '../env';
import { createContainer } from '../nodeContainer';

const USAGE =
  "使い方: printf %s '<GAS版のパスワードハッシュ>' | pnpm --filter @katahimo/api import:legacy-staff " +
  '<tenantSlug> <氏名> <メールアドレス> [--admin]';

/**
 * GAS版のパスワードハッシュ(Staffシート列J)を標準入力から1件読み取る。
 *
 * ハッシュはコマンドライン引数では渡させない。argvはシェル履歴にも `ps` の出力にも残るため、
 * 同じホストの他ユーザーや後から履歴を見た人に認証情報が漏れてしまう。
 */
async function readLegacyPasswordHashFromStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    throw new Error(
      `パスワードハッシュは標準入力から渡してください(端末から直接実行されています)。\n${USAGE}`,
    );
  }

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const value = Buffer.concat(chunks).toString('utf8').trim();

  if (value === '') {
    throw new Error(`標準入力が空です。パスワードハッシュを1行で渡してください。\n${USAGE}`);
  }
  if (/\s/.test(value)) {
    throw new Error(
      `標準入力に空白または改行が含まれています。パスワードハッシュは1件だけを1行で渡してください。\n${USAGE}`,
    );
  }

  return value;
}

/**
 * GAS版スタッフ台帳(Staffシート)の1行分を、パスワードハッシュ(SHA-256+salt)ごと移行する。
 * 実際の移行では、Sheets APIでStaffシートを読み取り、行ごとにこの関数相当の処理を呼ぶ
 * ドライバをPhase 5(Google連携)で追加する想定。ここでは単発の移行操作として提供する。
 *
 * 使い方:
 *   printf %s '<GAS版のパスワードハッシュ(Staffシート列J)>' \
 *     | pnpm --filter @katahimo/api import:legacy-staff <tenantSlug> <氏名> <メールアドレス> [--admin]
 *
 * パスワードハッシュだけは標準入力から受け取る(argvに載せると履歴や `ps` に残るため)。
 *
 * 移行したスタッフは、次回ログイン時に入力されたパスワードがこのハッシュと一致すれば、
 * argon2idへサイレント再ハッシュされる(パスワード変更を求めない移行)。
 */
async function main() {
  const [tenantSlug, name, email, ...rest] = process.argv.slice(2);
  const isAdmin = rest.includes('--admin');

  if (!tenantSlug || !name || !email) {
    console.error(USAGE);
    process.exit(1);
  }

  // DB接続より先に入力を検証し、渡し方を間違えたときはDBに触れずに終わるようにする。
  const legacyPasswordHash = await readLegacyPasswordHashFromStdin();

  const env = loadEnv();
  const db = getDatabase();
  const container = createContainer(env, db);

  const tenant = await container.tenants.findBySlug(tenantSlug);
  if (!tenant) {
    console.error(`テナントが見つかりません: ${tenantSlug}`);
    process.exit(1);
  }

  const staff = await importLegacyStaff(container, {
    tenantId: tenant.id,
    name,
    email,
    legacyPasswordHash,
    isAdmin,
  });
  console.log(`[import] スタッフを移行しました: id=${staff.id}, email=${email}`);
  console.log('次回ログイン時、既存パスワードのままでログインでき、argon2idへ自動的に再ハッシュされます。');
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
