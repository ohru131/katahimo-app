import { DEFAULT_PROMPT_TEMPLATES, PROMPT_TEMPLATE_BODY_MAX_LENGTH } from '@katahimo/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import type { PromptTemplateDeps } from './promptTemplates';
import {
  getReportUiTexts,
  listPromptTemplatesForAdmin,
  listPromptTemplateVersions,
  resetPromptTemplateToDefault,
  resolvePromptTemplate,
  resolvePromptTemplates,
  savePromptTemplate,
} from './promptTemplates';
import { FakePromptTemplateRepository } from './testDoubles';

/**
 * GAS版 GeminiReport.js getPrompt の「シートにキーがあればその文面、無ければ既定」を、
 * prompt_templates(テナントごと・キーごとの最大版)で再現できているかを固定する。
 */
describe('プロンプト文面の解決(GAS版 getPrompt 相当)', () => {
  let deps: PromptTemplateDeps;
  const tenantId = 'tenant-1';
  const staffId = 'staff-1';

  beforeEach(() => {
    deps = { promptTemplates: new FakePromptTemplateRepository() };
  });

  it('テナントの版が無いキーは既定文面を返す', async () => {
    const resolved = await resolvePromptTemplate(deps, tenantId, 'daily_report');
    expect(resolved).toEqual({
      key: 'daily_report',
      body: DEFAULT_PROMPT_TEMPLATES.daily_report,
      version: null,
      templateId: null,
      isDefault: true,
    });
  });

  it('全キーを解決すると、版の無いキーも既定文面で埋まる', async () => {
    await savePromptTemplate(deps, tenantId, staffId, {
      key: 'accident_hint',
      body: 'このテナント独自の記載要領',
    });
    const all = await resolvePromptTemplates(deps, tenantId);

    expect(all.accident_hint.body).toBe('このテナント独自の記載要領');
    expect(all.accident_hint.isDefault).toBe(false);
    expect(all.daily_report.isDefault).toBe(true);
    expect(all.receipt_ocr.body).toBe(DEFAULT_PROMPT_TEMPLATES.receipt_ocr);
  });

  it('別テナントの版は見えない', async () => {
    await savePromptTemplate(deps, 'tenant-2', staffId, {
      key: 'accident_hint',
      body: 'よそのテナントの文面',
    });
    const resolved = await resolvePromptTemplate(deps, tenantId, 'accident_hint');
    expect(resolved.body).toBe(DEFAULT_PROMPT_TEMPLATES.accident_hint);
  });
});

describe('プロンプト文面の保存(版を積む)', () => {
  let deps: PromptTemplateDeps;
  const tenantId = 'tenant-1';
  const staffId = 'staff-1';

  beforeEach(() => {
    deps = { promptTemplates: new FakePromptTemplateRepository() };
  });

  it('保存するたびに版が1つ増え、有効な文面は最新版になる', async () => {
    const first = await savePromptTemplate(deps, tenantId, staffId, {
      key: 'daily_report',
      body: '一版目 {anonymizedText}',
      note: '最初の調整',
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.template.version).toBe(1);

    const second = await savePromptTemplate(deps, tenantId, staffId, {
      key: 'daily_report',
      body: '二版目 {anonymizedText}',
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.template.version).toBe(2);

    const resolved = await resolvePromptTemplate(deps, tenantId, 'daily_report');
    expect(resolved.body).toBe('二版目 {anonymizedText}');
    expect(resolved.version).toBe(2);
    expect(resolved.isDefault).toBe(false);

    // 古い版は消さない(どの文面で生成した日報かを後から辿るため)。
    const versions = await listPromptTemplateVersions(deps, tenantId, 'daily_report');
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    expect(versions[1]?.note).toBe('最初の調整');
    expect(versions[1]?.createdByStaffId).toBe(staffId);
  });

  it('空白だけの文面は保存しない(指示ゼロでAIに書かせることになる)', async () => {
    const result = await savePromptTemplate(deps, tenantId, staffId, {
      key: 'accident_hint',
      body: '  \n ',
    });
    expect(result).toEqual({ ok: false, message: '文面を入力してください。' });
    expect(await listPromptTemplateVersions(deps, tenantId, 'accident_hint')).toHaveLength(0);
  });

  it('上限を超える文面は保存しない(DBのCHECK制約と同じ判定を入口で行う)', async () => {
    const result = await savePromptTemplate(deps, tenantId, staffId, {
      key: 'accident_hint',
      body: 'あ'.repeat(PROMPT_TEMPLATE_BODY_MAX_LENGTH + 1),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('文字以内');
    expect(await listPromptTemplateVersions(deps, tenantId, 'accident_hint')).toHaveLength(0);
  });

  it('日報・事故報告で {anonymizedText} が消えている文面は保存しない', async () => {
    for (const key of ['daily_report', 'accident_report'] as const) {
      const result = await savePromptTemplate(deps, tenantId, staffId, {
        key,
        body: '時間情報: {timeInfo} だけの文面',
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.message).toContain('{anonymizedText}');
    }
  });

  it('差し込みを使わないキーは {anonymizedText} が無くても保存できる', async () => {
    const result = await savePromptTemplate(deps, tenantId, staffId, {
      key: 'daily_memo_placeholder',
      body: '①今日やったこと',
    });
    expect(result.ok).toBe(true);
  });

  it('いま有効な文面と同じ内容なら版を増やさない', async () => {
    const sameAsDefault = await savePromptTemplate(deps, tenantId, staffId, {
      key: 'daily_report',
      body: DEFAULT_PROMPT_TEMPLATES.daily_report,
    });
    expect(sameAsDefault).toEqual({ ok: false, message: '文面が変わっていません。' });

    await savePromptTemplate(deps, tenantId, staffId, {
      key: 'daily_report',
      body: '編集した文面 {anonymizedText}',
    });
    const again = await savePromptTemplate(deps, tenantId, staffId, {
      key: 'daily_report',
      body: '編集した文面 {anonymizedText}',
    });
    expect(again).toEqual({ ok: false, message: '文面が変わっていません。' });
    expect(await listPromptTemplateVersions(deps, tenantId, 'daily_report')).toHaveLength(1);
  });

  it('未知のキーはDBのCHECK制約に当てる前に弾く', async () => {
    const result = await savePromptTemplate(deps, tenantId, staffId, {
      key: 'でたらめなキー',
      body: '何か {anonymizedText}',
    });
    expect(result).toEqual({ ok: false, message: '不明なプロンプトの種類です。' });
  });
});

describe('既定の文面に戻す', () => {
  let deps: PromptTemplateDeps;
  const tenantId = 'tenant-1';
  const staffId = 'staff-1';

  beforeEach(() => {
    deps = { promptTemplates: new FakePromptTemplateRepository() };
  });

  it('既定文面を新しい版として積む(前の版は残る)', async () => {
    await savePromptTemplate(deps, tenantId, staffId, {
      key: 'daily_report',
      body: '編集した文面 {anonymizedText}',
    });
    const result = await resetPromptTemplateToDefault(deps, tenantId, staffId, 'daily_report');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.template.version).toBe(2);
    expect(result.template.body).toBe(DEFAULT_PROMPT_TEMPLATES.daily_report);

    const versions = await listPromptTemplateVersions(deps, tenantId, 'daily_report');
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    expect(versions[0]?.note).toBe('既定の文面に戻す');
    expect(versions[1]?.body).toBe('編集した文面 {anonymizedText}');
  });

  it('すでに既定の文面なら何もしない', async () => {
    const result = await resetPromptTemplateToDefault(deps, tenantId, staffId, 'daily_report');
    expect(result).toEqual({ ok: false, message: 'すでに既定の文面です。' });
    expect(await listPromptTemplateVersions(deps, tenantId, 'daily_report')).toHaveLength(0);
  });

  it('既定が空のキー(文体ルール)は戻せない(空の文面は版として積めない)', async () => {
    await savePromptTemplate(deps, tenantId, staffId, {
      key: 'daily_report_stance',
      body: '評価口調を避ける',
    });
    const result = await resetPromptTemplateToDefault(deps, tenantId, staffId, 'daily_report_stance');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('既定の文面がありません');
    expect(await listPromptTemplateVersions(deps, tenantId, 'daily_report_stance')).toHaveLength(1);
  });

  it('未知のキーは弾く', async () => {
    const result = await resetPromptTemplateToDefault(deps, tenantId, staffId, 'でたらめなキー');
    expect(result).toEqual({ ok: false, message: '不明なプロンプトの種類です。' });
  });
});

describe('管理画面の一覧', () => {
  let deps: PromptTemplateDeps;
  const tenantId = 'tenant-1';
  const staffId = 'staff-1';

  beforeEach(() => {
    deps = { promptTemplates: new FakePromptTemplateRepository() };
  });

  it('全キーを、版の有無と既定文面・使える差し込み変数つきで返す', async () => {
    await savePromptTemplate(deps, tenantId, staffId, {
      key: 'daily_report',
      body: '編集した文面 {anonymizedText}',
      note: 'PSI3の文面を控えめに',
    });
    const list = await listPromptTemplatesForAdmin(deps, tenantId);

    const daily = list.find((row) => row.key === 'daily_report');
    expect(daily?.label).toBe('保育日報の生成');
    expect(daily?.body).toBe('編集した文面 {anonymizedText}');
    expect(daily?.version).toBe(1);
    expect(daily?.isDefault).toBe(false);
    expect(daily?.note).toBe('PSI3の文面を控えめに');
    expect(daily?.updatedAt).toBeInstanceOf(Date);
    expect(daily?.defaultBody).toBe(DEFAULT_PROMPT_TEMPLATES.daily_report);
    // 日報だけが3軸の差し込みまで使える。
    expect(daily?.placeholders).toEqual([
      'anonymizedText',
      'timeInfo',
      'childContext',
      'keywordGuide',
      'toneGuide',
    ]);

    const accident = list.find((row) => row.key === 'accident_report');
    expect(accident?.isDefault).toBe(true);
    expect(accident?.version).toBeNull();
    expect(accident?.updatedAt).toBeNull();
    expect(accident?.placeholders).toEqual(['anonymizedText', 'timeInfo']);

    // UI文言のキーは差し込み無しでそのまま表示する。
    expect(list.find((row) => row.key === 'accident_hint')?.placeholders).toEqual([]);
    expect(list).toHaveLength(8);
  });
});

describe('入力欄の文言(GAS版 getUiConfig 相当)', () => {
  let deps: PromptTemplateDeps;
  const tenantId = 'tenant-1';
  const staffId = 'staff-1';

  beforeEach(() => {
    deps = { promptTemplates: new FakePromptTemplateRepository() };
  });

  it('版が無ければ既定文面、あればテナントの文面を返す', async () => {
    const before = await getReportUiTexts(deps, tenantId);
    expect(before).toEqual({
      dailyMemoPlaceholder: DEFAULT_PROMPT_TEMPLATES.daily_memo_placeholder,
      accidentMemoPlaceholder: DEFAULT_PROMPT_TEMPLATES.accident_memo_placeholder,
      accidentHint: DEFAULT_PROMPT_TEMPLATES.accident_hint,
      hiyariHint: DEFAULT_PROMPT_TEMPLATES.hiyari_hint,
    });

    await savePromptTemplate(deps, tenantId, staffId, {
      key: 'daily_memo_placeholder',
      body: '①今日やったこと ②ご家庭の様子 ③振り返り',
    });
    const after = await getReportUiTexts(deps, tenantId);
    expect(after.dailyMemoPlaceholder).toBe('①今日やったこと ②ご家庭の様子 ③振り返り');
    expect(after.hiyariHint).toBe(DEFAULT_PROMPT_TEMPLATES.hiyari_hint);
  });
});
