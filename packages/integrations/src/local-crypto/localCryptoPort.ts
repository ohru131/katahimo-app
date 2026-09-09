import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type {
  AuditLogPort,
  CryptoPort,
  EncryptedValue,
  KeyManagementPort,
  TenantKeyRepositoryPort,
} from '@katahimo/core/ports';

interface CachedDek {
  dek: Buffer;
  dekVersion: number;
}

/** 初回に生成するDEKの世代番号。 */
const FIRST_DEK_VERSION = 1;

function cacheKey(tenantId: string, dekVersion: number): string {
  return `${tenantId}/${dekVersion}`;
}

/**
 * CryptoPortの実装。テナントごとのDEK(データ暗号化鍵)によるエンベロープ暗号化を行う。
 *
 * 旧実装(マスターキー1本からSHA256でテナント鍵を都度導出)は、マスターキーが漏れれば
 * 全テナントの鍵を誰でも再計算できてしまい、実質「鍵を1本共有しているのと同じ」だった
 * (2026-08 データベース構造レビューで指摘)。この実装ではDEKをテナントごとに
 * `crypto.randomBytes`で独立に生成し、平文のままでは保存せず、常に
 * KeyManagementPort(KEK)でラップした状態のみをTenantKeyRepositoryPort経由でDBへ永続化する。
 *
 * DEKは初回アクセス時に遅延生成し(getOrCreateCurrentDek)、アンラップ結果をプロセス内メモリに
 * キャッシュする(プロセス生存期間のみ有効。DEKの実体をリクエストのたびにKMS/DBへ
 * 問い合わせるコストを避けるため)。KEKローテーション(rewrap)はDEKの値自体を変えないため、
 * このキャッシュに影響しない。
 *
 * DEKの世代(dekVersion)は並存する。暗号化は常に最新世代で行い、復号は暗号文に記録された
 * 世代の鍵を引いて行う。こうしておかないと、DEKを差し替えた瞬間に既存の暗号文がすべて
 * 読めなくなり、ローテーションが実質できない。`rotate()`は新しい世代を1つ足すだけで、
 * 既存データはそのまま読める(全体の再暗号化は、必要になった時点で別途バッチで行う)。
 *
 * アルゴリズムはAES-256-GCM(認証付き・値ごとにランダムなnonce)。同じ平文でも呼ぶたびに
 * 異なる暗号文になるため、決定的暗号化のような統計的漏洩がない。
 */
export class LocalCryptoPort implements CryptoPort {
  /** テナント → 現行世代のDEK。 */
  private readonly currentDekCache = new Map<string, CachedDek>();
  /** `tenantId/dekVersion` → DEK。過去世代の復号に使う。 */
  private readonly dekByVersionCache = new Map<string, Buffer>();

  constructor(
    private readonly tenantKeys: TenantKeyRepositoryPort,
    private readonly kms: KeyManagementPort,
    private readonly auditLog?: AuditLogPort,
  ) {}

  private assertUsable(tenantId: string, record: { revokedAt: Date | null }): void {
    if (record.revokedAt) {
      throw new Error(
        `テナント(${tenantId})の鍵は暗号学的削除(解約処理)済みのため、このテナントのデータは復号できません。`,
      );
    }
  }

  /** 暗号化に使う現行世代。まだ1つも無ければ第1世代を生成する。 */
  private async getOrCreateCurrentDek(tenantId: string): Promise<CachedDek> {
    const cached = this.currentDekCache.get(tenantId);
    if (cached) return cached;

    let record = await this.tenantKeys.findCurrent(tenantId);
    if (record) this.assertUsable(tenantId, record);
    if (!record) {
      const dek = randomBytes(32);
      const wrapped = await this.kms.wrap(dek);
      record = await this.tenantKeys.create(
        tenantId,
        FIRST_DEK_VERSION,
        wrapped.ciphertext,
        wrapped.kekVersion,
      );
    }

    const dek = await this.kms.unwrap({ ciphertext: record.wrappedDek, kekVersion: record.kekVersion });
    const entry: CachedDek = { dek, dekVersion: record.dekVersion };
    this.currentDekCache.set(tenantId, entry);
    this.dekByVersionCache.set(cacheKey(tenantId, record.dekVersion), dek);
    return entry;
  }

  /** 復号に使う、暗号文に記録された世代の鍵。 */
  private async getDekByVersion(tenantId: string, dekVersion: number): Promise<Buffer> {
    const cached = this.dekByVersionCache.get(cacheKey(tenantId, dekVersion));
    if (cached) return cached;

    const record = await this.tenantKeys.findByVersion(tenantId, dekVersion);
    if (!record) {
      throw new Error(
        `暗号文が指す世代のDEKが見つかりません(tenantId=${tenantId}, keyVersion=${dekVersion})。` +
          '鍵の世代を削除すると、その世代で暗号化した値は復号できなくなります。',
      );
    }
    this.assertUsable(tenantId, record);

    const dek = await this.kms.unwrap({ ciphertext: record.wrappedDek, kekVersion: record.kekVersion });
    this.dekByVersionCache.set(cacheKey(tenantId, dekVersion), dek);
    return dek;
  }

  /**
   * 新しい世代のDEKを作り、以後の暗号化をそちらへ切り替える。既存の暗号文は
   * 記録された世代の鍵でそのまま復号できるため、この操作だけで既存データが壊れることはない。
   * 返すのは新しい世代番号。
   */
  async rotate(tenantId: string): Promise<number> {
    const current = await this.tenantKeys.findCurrent(tenantId);
    if (current) this.assertUsable(tenantId, current);
    const nextVersion = (current?.dekVersion ?? 0) + 1;

    const dek = randomBytes(32);
    const wrapped = await this.kms.wrap(dek);
    const created = await this.tenantKeys.create(
      tenantId,
      nextVersion,
      wrapped.ciphertext,
      wrapped.kekVersion,
    );

    this.currentDekCache.set(tenantId, { dek, dekVersion: created.dekVersion });
    this.dekByVersionCache.set(cacheKey(tenantId, created.dekVersion), dek);
    return created.dekVersion;
  }

  async encrypt(tenantId: string, plaintext: string): Promise<EncryptedValue> {
    const { dek, dekVersion } = await this.getOrCreateCurrentDek(tenantId);
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', dek, nonce);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const payload = Buffer.concat([nonce, authTag, encrypted]);
    return { ciphertext: payload.toString('base64'), keyVersion: dekVersion };
  }

  async decrypt(tenantId: string, value: EncryptedValue): Promise<string> {
    // 暗号文に記録された世代の鍵で復号する。現行世代と一致している必要はない
    // (ローテーション後も、それ以前に書かれた値をそのまま読めるようにするため)。
    const dek = await this.getDekByVersion(tenantId, value.keyVersion);
    this.auditLog?.recordDecrypt({ tenantId });
    const payload = Buffer.from(value.ciphertext, 'base64');
    const nonce = payload.subarray(0, 12);
    const authTag = payload.subarray(12, 28);
    const encrypted = payload.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', dek, nonce);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  }
}
