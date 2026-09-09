import { beforeEach, describe, expect, it } from 'vitest';
import type { SettingsDeps } from './settings';
import {
  getAdminSettings,
  resolveGeminiApiKey,
  saveGeminiApiKey,
  saveGeminiModelSettings,
  saveGoogleChatWebhookSettings,
} from './settings';
import { FakeAppSettingsRepository, FakeCryptoPort } from './testDoubles';

describe('管理者設定(app_settings)', () => {
  let deps: SettingsDeps;
  const tenantId = 'tenant-1';

  beforeEach(() => {
    deps = { appSettings: new FakeAppSettingsRepository(), crypto: new FakeCryptoPort() };
  });

  it('未設定時はGemini APIキーが未設定扱い/Webhook URLが空文字、モデルはデフォルト値を返す', async () => {
    const settings = await getAdminSettings(deps, tenantId);
    expect(settings).toEqual({
      hasGeminiApiKey: false,
      geminiApiKeyPreview: null,
      geminiReportModel: 'gemini-2.5-flash',
      geminiOcrModel: 'gemini-2.5-flash-lite',
      gchatReportWebhookUrl: '',
      gchatReceiptWebhookUrl: '',
    });
  });

  it('Gemini APIキーを保存しても平文は返らず、設定済みフラグと末尾4文字だけが返る', async () => {
    const apiKey = 'AIzaSy-secret-value-1234';
    const result = await saveGeminiApiKey(deps, tenantId, apiKey);
    expect(result.ok).toBe(true);

    const settings = await getAdminSettings(deps, tenantId);
    expect(settings.hasGeminiApiKey).toBe(true);
    expect(settings.geminiApiKeyPreview).toBe('1234');
    // レスポンスのどこにも平文(や暗号文)が混ざっていないことを、JSON全体で固定する。
    const serialized = JSON.stringify(settings);
    expect(serialized).not.toContain(apiKey);
    expect(serialized).not.toContain('AIzaSy');
    expect(serialized).not.toContain('ENC:');
    // 末尾4文字より手前の部分が1文字も漏れていないこと。
    expect(serialized).not.toContain(apiKey.slice(0, -4));
    expect(Object.keys(settings)).not.toContain('geminiApiKey');
  });

  it('短すぎるキーはマスクの意味がないため末尾を出さない(設定済みだけを返す)', async () => {
    await saveGeminiApiKey(deps, tenantId, 'short123');
    const settings = await getAdminSettings(deps, tenantId);
    expect(settings.hasGeminiApiKey).toBe(true);
    expect(settings.geminiApiKeyPreview).toBeNull();
    expect(JSON.stringify(settings)).not.toContain('short123');
  });

  it('空文字でのGemini APIキー保存は拒否され、既存の値が保持される', async () => {
    await saveGeminiApiKey(deps, tenantId, 'sk-existing-key-abcd');
    const result = await saveGeminiApiKey(deps, tenantId, '   ');
    expect(result.ok).toBe(false);
    const settings = await getAdminSettings(deps, tenantId);
    expect(settings.hasGeminiApiKey).toBe(true);
    expect(settings.geminiApiKeyPreview).toBe('abcd');
    expect(await resolveGeminiApiKey(deps, tenantId)).toBe('sk-existing-key-abcd');
  });

  it('resolveGeminiApiKeyはサーバー内部用に平文を返す(未設定なら空文字)', async () => {
    expect(await resolveGeminiApiKey(deps, tenantId)).toBe('');
    await saveGeminiApiKey(deps, tenantId, 'sk-server-side-key');
    expect(await resolveGeminiApiKey(deps, tenantId)).toBe('sk-server-side-key');
  });

  it('モデル設定を保存できる。どちらか一方でも空なら拒否される', async () => {
    const result = await saveGeminiModelSettings(deps, tenantId, 'gemini-3.0-pro', 'gemini-3.0-flash');
    expect(result.ok).toBe(true);
    expect(await getAdminSettings(deps, tenantId)).toMatchObject({
      geminiReportModel: 'gemini-3.0-pro',
      geminiOcrModel: 'gemini-3.0-flash',
    });

    const rejected = await saveGeminiModelSettings(deps, tenantId, '', 'gemini-3.0-flash');
    expect(rejected.ok).toBe(false);
    expect(await getAdminSettings(deps, tenantId)).toMatchObject({
      geminiReportModel: 'gemini-3.0-pro',
      geminiOcrModel: 'gemini-3.0-flash',
    });
  });

  it('Webhook URLを保存できる。どちらか一方でも空なら拒否される', async () => {
    const result = await saveGoogleChatWebhookSettings(
      deps,
      tenantId,
      'https://chat.googleapis.com/report',
      'https://chat.googleapis.com/receipt',
    );
    expect(result.ok).toBe(true);
    expect(await getAdminSettings(deps, tenantId)).toMatchObject({
      gchatReportWebhookUrl: 'https://chat.googleapis.com/report',
      gchatReceiptWebhookUrl: 'https://chat.googleapis.com/receipt',
    });

    const rejected = await saveGoogleChatWebhookSettings(deps, tenantId, '', 'https://chat.googleapis.com/x');
    expect(rejected.ok).toBe(false);
  });

  it('別テナントの設定は互いに影響しない', async () => {
    await saveGeminiApiKey(deps, 'tenant-1', 'tenant-1-api-key-aaaa');
    await saveGeminiApiKey(deps, 'tenant-2', 'tenant-2-api-key-bbbb');
    expect((await getAdminSettings(deps, 'tenant-1')).geminiApiKeyPreview).toBe('aaaa');
    expect((await getAdminSettings(deps, 'tenant-2')).geminiApiKeyPreview).toBe('bbbb');
    expect(await resolveGeminiApiKey(deps, 'tenant-1')).toBe('tenant-1-api-key-aaaa');
    expect(await resolveGeminiApiKey(deps, 'tenant-2')).toBe('tenant-2-api-key-bbbb');
  });
});
