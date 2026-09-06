import type { PasswordHasherPort } from '@katahimo/core/usecases';
import { argon2id } from '@noble/hashes/argon2';

/**
 * ブラウザ向けのargon2id実装(本番は@node-rs/argon2のネイティブバインディングで、
 * ブラウザでは動かないためデモだけ差し替える)。
 *
 * パラメータは本番より弱い。@noble/hashesは純粋なJS実装で、本番同等のメモリコスト
 * (19MiB以上)にするとログインのたびに数秒固まってデモとして成立しないため。
 * ここで守りたいのは「デモでも認証フローが本物と同じ経路を通ること」であって、
 * 保護対象の秘密は存在しない(パスワードは画面に表示している固定値)。
 */
const PARAMS = { t: 2, m: 8192, p: 1, dkLen: 32 } as const;

const SALT_BYTES = 16;
const PREFIX = 'demo-argon2id';

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

/** 一定時間比較。デモとはいえ、わざわざタイミング差の出る比較を書く理由はない。 */
function equals(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export const demoPasswordHasher: PasswordHasherPort = {
  async hash(password) {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const digest = argon2id(password, salt, PARAMS);
    return `${PREFIX}$${toBase64(salt)}$${toBase64(digest)}`;
  },

  async verify(passwordHash, password) {
    const [prefix, salt, digest] = passwordHash.split('$');
    // 本番のargon2id(PHC形式)やGAS版のレガシーハッシュが渡ってきた場合は、
    // 例外にせず「不一致」として扱う(本番のargon2PasswordHasherと同じ方針)。
    if (prefix !== PREFIX || !salt || !digest) return false;
    return equals(argon2id(password, fromBase64(salt), PARAMS), fromBase64(digest));
  },
};
