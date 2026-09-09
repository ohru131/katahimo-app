import type { TenantKeyRecord, TenantKeyRepositoryPort } from '@katahimo/core/ports';
import { beforeEach, describe, expect, it } from 'vitest';
import { LocalKmsPort } from '../local-kms/localKmsPort';
import { LocalCryptoPort } from './localCryptoPort';

/**
 * DEKの世代が並存できることを固定する。
 *
 * 1テナント1鍵しか持てないと、鍵を差し替えた瞬間に既存の暗号文がすべて読めなくなる。
 * つまりローテーションが実質できず、鍵が漏れた疑いがあっても打てる手が無い状態になる。
 * 「新しい世代で書きつつ、古い世代の値はそのまま読める」ことが、ローテーションを
 * 現実に実行できるための前提。
 */

/** tenant_keys のインメモリ実装(世代ごとに1行)。 */
class InMemoryTenantKeyRepository implements TenantKeyRepositoryPort {
  readonly rows: TenantKeyRecord[] = [];

  async findCurrent(tenantId: string): Promise<TenantKeyRecord | null> {
    return (
      this.rows.filter((r) => r.tenantId === tenantId).sort((a, b) => b.dekVersion - a.dekVersion)[0] ?? null
    );
  }

  async findByVersion(tenantId: string, dekVersion: number): Promise<TenantKeyRecord | null> {
    return this.rows.find((r) => r.tenantId === tenantId && r.dekVersion === dekVersion) ?? null;
  }

  async create(
    tenantId: string,
    dekVersion: number,
    wrappedDek: string,
    kekVersion: number,
  ): Promise<TenantKeyRecord> {
    const existing = await this.findByVersion(tenantId, dekVersion);
    if (existing) return existing;
    const record: TenantKeyRecord = { tenantId, dekVersion, wrappedDek, kekVersion, revokedAt: null };
    this.rows.push(record);
    return record;
  }

  async updateWrappedDek(
    tenantId: string,
    dekVersion: number,
    wrappedDek: string,
    kekVersion: number,
  ): Promise<void> {
    const row = this.rows.find((r) => r.tenantId === tenantId && r.dekVersion === dekVersion);
    if (!row) return;
    row.wrappedDek = wrappedDek;
    row.kekVersion = kekVersion;
  }

  async revoke(tenantId: string): Promise<void> {
    for (const row of this.rows) {
      if (row.tenantId === tenantId) row.revokedAt = new Date();
    }
  }
}

const KEK = 'a'.repeat(64);
const tenantId = '11111111-1111-1111-1111-111111111111';

describe('LocalCryptoPort のDEK世代管理', () => {
  let tenantKeys: InMemoryTenantKeyRepository;
  let crypto: LocalCryptoPort;

  beforeEach(() => {
    tenantKeys = new InMemoryTenantKeyRepository();
    crypto = new LocalCryptoPort(tenantKeys, new LocalKmsPort(KEK));
  });

  it('初回の暗号化で第1世代のDEKを生成する', async () => {
    const encrypted = await crypto.encrypt(tenantId, '緊急連絡先');
    expect(encrypted.keyVersion).toBe(1);
    expect(tenantKeys.rows).toHaveLength(1);
    // ラップされた状態でしか保存しない(平文のDEKがDBに乗らない)。
    expect(tenantKeys.rows[0]?.wrappedDek).not.toContain('緊急連絡先');
  });

  it('ローテーション後、新しい書き込みは新世代の鍵で暗号化される', async () => {
    await crypto.encrypt(tenantId, '旧');
    const newVersion = await crypto.rotate(tenantId);

    expect(newVersion).toBe(2);
    expect((await crypto.encrypt(tenantId, '新')).keyVersion).toBe(2);
    expect(tenantKeys.rows).toHaveLength(2);
  });

  it('ローテーション後も、旧世代で暗号化された値をそのまま復号できる', async () => {
    const before = await crypto.encrypt(tenantId, '避難場所: 第一小学校');
    await crypto.rotate(tenantId);
    const after = await crypto.encrypt(tenantId, '避難場所: 第二小学校');

    expect(before.keyVersion).toBe(1);
    expect(after.keyVersion).toBe(2);
    expect(await crypto.decrypt(tenantId, before)).toBe('避難場所: 第一小学校');
    expect(await crypto.decrypt(tenantId, after)).toBe('避難場所: 第二小学校');
  });

  it('プロセスをまたいでも(キャッシュが空でも)旧世代を復号できる', async () => {
    const before = await crypto.encrypt(tenantId, 'メモ');
    await crypto.rotate(tenantId);

    // 同じDBを見る別インスタンス = 再起動後の状態。
    const restarted = new LocalCryptoPort(tenantKeys, new LocalKmsPort(KEK));
    expect(await restarted.decrypt(tenantId, before)).toBe('メモ');
  });

  it('世代が存在しない暗号文は、黙って別の鍵で読まずエラーにする', async () => {
    const encrypted = await crypto.encrypt(tenantId, 'メモ');
    await expect(crypto.decrypt(tenantId, { ...encrypted, keyVersion: 99 })).rejects.toThrow(
      /世代のDEKが見つかりません/,
    );
  });

  it('暗号学的削除の後は、どの世代も復号できない', async () => {
    const first = await crypto.encrypt(tenantId, '解約前1');
    await crypto.rotate(tenantId);
    const second = await crypto.encrypt(tenantId, '解約前2');

    await tenantKeys.revoke(tenantId);
    const afterRevoke = new LocalCryptoPort(tenantKeys, new LocalKmsPort(KEK));

    await expect(afterRevoke.decrypt(tenantId, first)).rejects.toThrow(/暗号学的削除/);
    await expect(afterRevoke.decrypt(tenantId, second)).rejects.toThrow(/暗号学的削除/);
  });

  it('同じ平文でも毎回異なる暗号文になる(決定的暗号化ではない)', async () => {
    const a = await crypto.encrypt(tenantId, '同じ値');
    const b = await crypto.encrypt(tenantId, '同じ値');
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(await crypto.decrypt(tenantId, a)).toBe('同じ値');
    expect(await crypto.decrypt(tenantId, b)).toBe('同じ値');
  });
});
