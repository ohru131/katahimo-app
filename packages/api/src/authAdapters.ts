import type { PasswordHasherPort } from '@katahimo/core/usecases';
import { hash, verify } from '@node-rs/argon2';

/**
 * ハッシュ化のコストパラメータ。OWASP Password Storage Cheat Sheet が argon2id に対して
 * 挙げている設定のひとつ(m=19MiB, t=2, p=1)に合わせている。
 *
 * ライブラリの既定値に任せない理由は2つ。既定値はバージョン更新で黙って変わりうること、
 * そして「どのコストで運用しているか」がコードから読めないと、後から妥当性を検証できないこと。
 * 上げる場合は、既存ハッシュはそのまま検証できる(パラメータはハッシュ文字列に埋め込まれる)。
 * ログイン成功時に古いパラメータのものを再ハッシュする経路は、レガシーハッシュの移行と
 * 同じ仕組みで後から足せる。
 */
const ARGON2_OPTIONS = {
  // @node-rs/argon2 の Algorithm.Argon2id。const enum は verbatimModuleSyntax 下で
  // 値として参照できないため、数値で指定している。
  algorithm: 2,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

/** PasswordHasherPortのargon2id実装。GAS版のSHA-256+salt方式からの移行はPhase 2で別途扱う。 */
export const argon2PasswordHasher: PasswordHasherPort = {
  async hash(password) {
    return hash(password, ARGON2_OPTIONS);
  },
  async verify(passwordHash, password) {
    try {
      return await verify(passwordHash, password);
    } catch {
      // ハッシュ形式が不正(移行前のレガシーハッシュ等)な場合はverifyが例外を投げるため、
      // 「不一致」として扱う(認証エラーにするが、内部エラーとしては落とさない)。
      return false;
    }
  },
};
