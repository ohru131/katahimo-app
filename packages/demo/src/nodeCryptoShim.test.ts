import * as node from 'node:crypto';
import { describe, expect, it } from 'vitest';
import * as shim from './nodeCryptoShim';

/**
 * シムの出力が node:crypto と1バイトも違わないことを保証する。
 *
 * ここがずれると、デモのブラウザ内で作った暗号文・ブラインドインデックスが本番の
 * コードで復号/照合できなくなる。「デモだから多少違ってもいい」ものではなく、
 * 同じ実装を差し替えて動かしている以上、暗号まわりの等価性は明示的に検証しておく。
 */
describe('node:cryptoシム', () => {
  const key = Buffer.alloc(32, 7);
  const nonce = Buffer.alloc(12, 3);

  it('sha256のダイジェストがnode:cryptoと一致する', () => {
    for (const input of ['', 'abc', 'テナントID:あいうえお', 'a'.repeat(1000)]) {
      expect(shim.createHash('sha256').update(input, 'utf8').digest('hex')).toBe(
        node.createHash('sha256').update(input, 'utf8').digest('hex'),
      );
    }
  });

  it('update()を複数回に分けても連結した入力と同じ結果になる', () => {
    // LocalBlindIndexPort が .update(masterKey).update(':blind-index:').update(tenantId) と
    // 3回に分けて呼ぶため、分割呼び出しの等価性が必要。
    const chained = shim.createHash('sha256').update(key).update(':blind-index:').update('tenant-1').digest();
    const expected = node
      .createHash('sha256')
      .update(key)
      .update(':blind-index:')
      .update('tenant-1')
      .digest();
    expect(chained.equals(expected)).toBe(true);
  });

  it('hmac-sha256がnode:cryptoと一致する', () => {
    const value = '山田';
    expect(shim.createHmac('sha256', key).update(value, 'utf8').digest('hex')).toBe(
      node.createHmac('sha256', key).update(value, 'utf8').digest('hex'),
    );
  });

  it('aes-256-gcmの暗号文と認証タグがnode:cryptoと一致する', () => {
    const plaintext = '大阪府大阪市中央区1-2-3';

    const cipher = shim.createCipheriv('aes-256-gcm', key, nonce);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

    const nodeCipher = node.createCipheriv('aes-256-gcm', key, nonce);
    const nodeEncrypted = Buffer.concat([nodeCipher.update(plaintext, 'utf8'), nodeCipher.final()]);

    expect(encrypted.equals(nodeEncrypted)).toBe(true);
    expect(cipher.getAuthTag().equals(nodeCipher.getAuthTag())).toBe(true);
  });

  it('node:cryptoで暗号化した値をシムで復号できる', () => {
    const plaintext = '090-1234-5678';
    const nodeCipher = node.createCipheriv('aes-256-gcm', key, nonce);
    const encrypted = Buffer.concat([nodeCipher.update(plaintext, 'utf8'), nodeCipher.final()]);

    const decipher = shim.createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAuthTag(nodeCipher.getAuthTag());
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

    expect(decrypted.toString('utf8')).toBe(plaintext);
  });

  it('認証タグが改ざんされていれば復号に失敗する', () => {
    const cipher = shim.createCipheriv('aes-256-gcm', key, nonce);
    const encrypted = Buffer.concat([cipher.update('秘密', 'utf8'), cipher.final()]);
    const tamperedTag = Buffer.from(cipher.getAuthTag());
    tamperedTag[0] = (tamperedTag[0] ?? 0) ^ 0xff;

    const decipher = shim.createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAuthTag(tamperedTag);
    decipher.update(encrypted);
    expect(() => decipher.final()).toThrow();
  });

  it('未対応のアルゴリズムは黙って別の結果を返さず例外にする', () => {
    expect(() => shim.createHash('sha512')).toThrow(/sha256のみ/);
    expect(() => shim.createCipheriv('aes-128-gcm', key, nonce)).toThrow(/aes-256-gcmのみ/);
  });

  it('randomBytesが指定バイト数のランダム値を返す', () => {
    const a = shim.randomBytes(32);
    const b = shim.randomBytes(32);
    expect(a).toHaveLength(32);
    expect(a.equals(b)).toBe(false);
  });
});
