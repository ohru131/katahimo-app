import { Buffer } from 'buffer';

/**
 * `Buffer` をグローバルに生やす。
 *
 * packages/core と packages/integrations の暗号まわりは Buffer を前提に書かれている
 * (Buffer.concat / subarray / toString('base64') など)。ブラウザには Buffer が無いので、
 * デモではnpmの`buffer`パッケージで補う。
 *
 * ビルド時のinjectプラグインではなく明示的な関数にしているのは、実行順を確実にするため。
 * startDemo()の最初に呼ぶ、という1点だけ守れば依存の評価順を気にしなくて済む。
 */
export function installBufferPolyfill(): void {
  const target = globalThis as { Buffer?: unknown };
  if (!target.Buffer) target.Buffer = Buffer;
}
