/**
 * パスワードの最低文字数。
 *
 * GAS版には長さの制限が無く、1文字でも設定できてしまっていた。ここで下限を設けるが、
 * 記号や大文字の必須化はしない(利用者が同じパスワードを使い回す・付箋に書く動機になり、
 * 長さより効果が薄いという現在の一般的な指針に合わせる)。
 */
export const MIN_PASSWORD_LENGTH = 8;

/** パスワードとして受け付けられるか。理由が必要なのは画面に出す文言のため。 */
export function isAcceptablePassword(password: string): boolean {
  return password.length >= MIN_PASSWORD_LENGTH;
}

/** 初期パスワードの文字数。人が一度だけ手入力する前提で、長すぎない範囲にする。 */
const INITIAL_PASSWORD_LENGTH = 12;

/**
 * 初期パスワードに使う文字。
 *
 * メールに載った文字列を人が読んで打ち直すので、`0/O` `1/l/I` のように
 * 読み違えやすい文字を外している。
 */
const INITIAL_PASSWORD_ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * 管理者がスタッフを登録したときに発行する初期パスワードを作る。
 *
 * `randomBytes` をそのまま剰余で文字に割り当てると、アルファベットの長さで割り切れないぶん
 * 先頭の文字が出やすくなる(modulo bias)。範囲外の値を捨てて引き直すことで偏りを無くす。
 */
export function generateInitialPassword(randomBytes: (size: number) => Uint8Array): string {
  const alphabet = INITIAL_PASSWORD_ALPHABET;
  // 256 をアルファベット長で割り切れる最大値。これ以上の値は捨てる。
  const limit = Math.floor(256 / alphabet.length) * alphabet.length;
  let password = '';
  while (password.length < INITIAL_PASSWORD_LENGTH) {
    for (const byte of randomBytes(INITIAL_PASSWORD_LENGTH)) {
      if (byte >= limit) continue;
      password += alphabet[byte % alphabet.length];
      if (password.length === INITIAL_PASSWORD_LENGTH) break;
    }
  }
  return password;
}

/** パスワード再設定コードの桁数。GAS版と同じ6桁。 */
const RESET_CODE_DIGITS = 6;

/**
 * パスワード再設定の認証コードを作る。GAS版と同じ6桁の数字。
 *
 * GAS版は `Math.random()` を使っていたが、これは暗号用途に使える乱数ではない。
 * 呼び出し側から暗号論的乱数を渡す。初期パスワードと同じ理由で偏りも取り除く。
 */
export function generateResetCode(randomBytes: (size: number) => Uint8Array): string {
  const limit = Math.floor(256 / 10) * 10;
  let code = '';
  while (code.length < RESET_CODE_DIGITS) {
    for (const byte of randomBytes(RESET_CODE_DIGITS)) {
      if (byte >= limit) continue;
      code += String(byte % 10);
      if (code.length === RESET_CODE_DIGITS) break;
    }
  }
  return code;
}

/**
 * 長さと内容を秘密にしたまま2つの文字列を比べる。
 *
 * `===` は先頭から違いが見つかった時点で打ち切るため、比較にかかった時間から
 * 「どこまで一致していたか」が漏れうる。ハッシュ同士の比較にしか使わないので実害は
 * 考えにくいが、秘密の比較でこれを気にしなくてよい形にしておく。
 *
 * node:crypto の timingSafeEqual は使わない(ブラウザ向けの同期shimに無いため。
 * packages/demo/src/nodeCryptoShim.ts 参照)。
 */
export function constantTimeEquals(a: string, b: string): boolean {
  // 長さが違う場合も長い方に合わせて回す。長さ自体は隠せないが、ここで扱うのは
  // 常に固定長のハッシュなので問題にならない。
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) {
    // 範囲外は charCodeAt が NaN を返すので0に寄せる。
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}
