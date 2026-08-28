import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { CryptoPort, EncryptedValue } from '@katahimo/core/ports';

/**
 * CryptoPortの開発用実装。
 *
 * 本番はテナントごとのDEKをCloud KMSでラップして保存するエンベロープ暗号化にする(Phase 5)。
 * ここでは、その日が来るまでローカル開発・PoC公開で動かせるよう、環境変数の
 * マスターキー1本からテナントごとの鍵をHKDF的に導出する簡易実装にとどめる。
 * 本番のKMS実装に差し替えてもデータ形式(EncryptedValue.keyVersion)は変えずに済むよう、
 * keyVersionは常に1を返す(実際のローテーションが必要になった時点でロジックを足す)。
 *
 * 暗号化アルゴリズムはAES-256-GCM(認証付き・値ごとにランダムなnonce)。
 * 同じ平文でも呼ぶたびに異なる暗号文になるため、決定的暗号化のような統計的漏洩がない。
 */
export class LocalCryptoPort implements CryptoPort {
  private readonly masterKey: Buffer;

  constructor(masterKeyHex: string) {
    if (!/^[0-9a-f]{64}$/i.test(masterKeyHex)) {
      throw new Error(
        'LOCAL_DEV_MASTER_KEY は32バイト(64桁の16進数)で指定してください。' +
          "生成例: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
      );
    }
    this.masterKey = Buffer.from(masterKeyHex, 'hex');
  }

  private deriveTenantKey(tenantId: string): Buffer {
    // 本番のKMSエンベロープ暗号化に置き換わるまでの簡易導出。
    // テナントIDをHMACではなくSHA-256で単純に鍵に混ぜているだけなので、本番では使わない。
    return createHash('sha256').update(this.masterKey).update(':crypto:').update(tenantId).digest();
  }

  async encrypt(tenantId: string, plaintext: string): Promise<EncryptedValue> {
    const key = this.deriveTenantKey(tenantId);
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const payload = Buffer.concat([nonce, authTag, encrypted]);
    return { ciphertext: payload.toString('base64'), keyVersion: 1 };
  }

  async decrypt(tenantId: string, value: EncryptedValue): Promise<string> {
    const key = this.deriveTenantKey(tenantId);
    const payload = Buffer.from(value.ciphertext, 'base64');
    const nonce = payload.subarray(0, 12);
    const authTag = payload.subarray(12, 28);
    const encrypted = payload.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  }
}
