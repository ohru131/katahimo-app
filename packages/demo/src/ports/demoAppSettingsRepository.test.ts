import type {
  AppSettingsPatchInput,
  AppSettingsRecord,
  AppSettingsRepositoryPort,
} from '@katahimo/core/ports';
import { describe, expect, it } from 'vitest';
import { DemoAppSettingsRepository } from './demoAppSettingsRepository';

/** 実際に永続化された内容を覗けるだけのフェイク。 */
class FakePersistentRepository implements AppSettingsRepositoryPort {
  readonly receivedPatches: AppSettingsPatchInput[] = [];
  private record: AppSettingsRecord | null = null;

  async find(): Promise<AppSettingsRecord | null> {
    return this.record;
  }

  async upsert(tenantId: string, patch: AppSettingsPatchInput): Promise<AppSettingsRecord> {
    this.receivedPatches.push(patch);
    this.record = {
      tenantId,
      geminiApiKey: null,
      geminiReportModel: null,
      geminiOcrModel: null,
      gchatReportWebhookUrl: null,
      gchatReceiptWebhookUrl: null,
      ...this.record,
      ...patch,
    };
    return this.record;
  }
}

const TENANT = 'tenant-1';
const SECRET = { ciphertext: 'ENC:sk-visitor-key', keyVersion: 1 };

describe('DemoAppSettingsRepository', () => {
  it('APIキーやWebhook URLを永続化層へ渡さない', async () => {
    const persistent = new FakePersistentRepository();
    const repository = new DemoAppSettingsRepository(persistent);

    await repository.upsert(TENANT, {
      geminiApiKey: SECRET,
      gchatReportWebhookUrl: SECRET,
      gchatReceiptWebhookUrl: SECRET,
      geminiReportModel: 'gemini-2.5-flash',
    });

    // デモの暗号鍵は公開されているため、訪問者の本物のキーをDBへ書いてはいけない。
    expect(persistent.receivedPatches).toEqual([{ geminiReportModel: 'gemini-2.5-flash' }]);
    const stored = await persistent.find();
    expect(stored?.geminiApiKey).toBeNull();
    expect(stored?.gchatReportWebhookUrl).toBeNull();
  });

  it('秘密項目はメモリから読み戻せる(同一セッション内では使える)', async () => {
    const repository = new DemoAppSettingsRepository(new FakePersistentRepository());
    await repository.upsert(TENANT, { geminiApiKey: SECRET, geminiOcrModel: 'gemini-2.5-flash-lite' });

    const found = await repository.find(TENANT);
    expect(found?.geminiApiKey).toEqual(SECRET);
    expect(found?.geminiOcrModel).toBe('gemini-2.5-flash-lite');
  });

  it('部分更新では、patchに含まれない秘密項目を消さない', async () => {
    const repository = new DemoAppSettingsRepository(new FakePersistentRepository());
    await repository.upsert(TENANT, { geminiApiKey: SECRET });
    await repository.upsert(TENANT, { geminiReportModel: 'gemini-2.5-pro' });

    const found = await repository.find(TENANT);
    expect(found?.geminiApiKey).toEqual(SECRET);
    expect(found?.geminiReportModel).toBe('gemini-2.5-pro');
  });

  it('明示的にnullを渡した場合は秘密項目を消す', async () => {
    const repository = new DemoAppSettingsRepository(new FakePersistentRepository());
    await repository.upsert(TENANT, { geminiApiKey: SECRET });
    await repository.upsert(TENANT, { geminiApiKey: null });

    expect((await repository.find(TENANT))?.geminiApiKey).toBeNull();
  });

  it('永続化層が空でも秘密項目だけで設定を返す', async () => {
    const repository = new DemoAppSettingsRepository(new FakePersistentRepository());
    expect(await repository.find(TENANT)).toBeNull();

    await repository.upsert(TENANT, { geminiApiKey: SECRET });
    expect((await repository.find(TENANT))?.geminiApiKey).toEqual(SECRET);
  });

  it('テナントごとに秘密を分離する', async () => {
    const repository = new DemoAppSettingsRepository(new FakePersistentRepository());
    await repository.upsert(TENANT, { geminiApiKey: SECRET });
    expect((await repository.find('tenant-2'))?.geminiApiKey ?? null).toBeNull();
  });
});
