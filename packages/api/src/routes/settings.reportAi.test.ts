import { login, registerStaff } from '@katahimo/core';
import {
  FakePasswordHasherPort,
  FakePasswordResetCodeRepository,
  FakePromptTemplateRepository,
  FakeSessionRepository,
  FakeStaffRepository,
  FakeTenantRepository,
} from '@katahimo/core/test-utils';
import {
  FakeCustomerReportProfileRepository,
  FakeReportAiConfigRepository,
} from '@katahimo/core/test-utils/report-ai';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import type { Container } from '../container';
import { SESSION_COOKIE_NAME } from '../session';

/**
 * 日報AIの3軸の設定API(`/api/settings/admin/report-ai/*`)。
 *
 * Honoアプリを本番と同じ `createApp` で組み立て、Containerにインメモリのフェイクを差して
 * 叩く(公開デモ packages/demo が同じ `createApp` に別実装を差しているのと同じやり方)。
 * ここで確かめたいのは「誰が呼べるか(401/403)」「入力の形が違うときに400で理由が返るか」
 * 「ユースケースの判断(年齢帯の重なり等)が400として表に出るか」で、SQLそのものの検証は
 * PGliteを使う packages/demo 側で行う。
 */

const ADMIN = { email: 'admin@example.com', password: 'admin-password' };
const STAFF = { email: 'staff@example.com', password: 'staff-password' };

interface TestContext {
  app: ReturnType<typeof createApp>;
  adminCookie: string;
  staffCookie: string;
  /** 「DBが落ちた」ときの振る舞いを見るために、フェイクを差し替えられるようにしておく。 */
  reportAiConfig: FakeReportAiConfigRepository;
}

async function setup(): Promise<TestContext> {
  const deps = {
    tenants: new FakeTenantRepository(),
    staff: new FakeStaffRepository(),
    sessions: new FakeSessionRepository(),
    passwordResetCodes: new FakePasswordResetCodeRepository(),
    passwordHasher: new FakePasswordHasherPort(),
    promptTemplates: new FakePromptTemplateRepository(),
    reportAiConfig: new FakeReportAiConfigRepository(),
    customerReportProfiles: new FakeCustomerReportProfileRepository(),
  };
  // ここで使うルートが触るポートだけを持たせる(Container全体を組み立てる必要はない)。
  const container = deps as unknown as Container;

  const tenant = await deps.tenants.create({ name: 'テスト法人', slug: 'test-tenant' });
  for (const [person, isAdmin] of [
    [ADMIN, true],
    [STAFF, false],
  ] as const) {
    await registerStaff(deps, {
      tenantId: tenant.id,
      name: person.email,
      email: person.email,
      password: person.password,
      isAdmin,
    });
  }

  const cookies: string[] = [];
  for (const person of [ADMIN, STAFF]) {
    const result = await login(deps, {
      tenantSlug: 'test-tenant',
      email: person.email,
      password: person.password,
    });
    if (!result.ok) throw new Error('テストの前提(ログイン)が崩れています');
    cookies.push(`${SESSION_COOKIE_NAME}=${result.sessionCookieValue}`);
  }
  const [adminCookie, staffCookie] = cookies;
  if (!adminCookie || !staffCookie) throw new Error('テストの前提(ログイン)が崩れています');

  return {
    app: createApp(container, { secureCookies: false }),
    adminCookie,
    staffCookie,
    reportAiConfig: deps.reportAiConfig,
  };
}

/** 管理者としてJSONを送る。 */
function call(ctx: TestContext, method: string, path: string, body?: unknown, cookie?: string) {
  return ctx.app.request(`/api/settings/admin/report-ai${path}`, {
    method,
    headers: {
      cookie: cookie ?? ctx.adminCookie,
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const AGE_BAND_BODY = { label: '0〜6ヶ月', ageFromMonths: 0, ageToMonths: 6 };
const KEYWORD_BODY = {
  name: '追視',
  ageFromMonths: 0,
  ageToMonths: 6,
  educationLevelMin: 1,
  educationLevelMax: 5,
  stressLevelMin: 1,
  ageBandCodes: [] as string[],
};

describe('GET /api/settings/admin/report-ai', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await setup();
  });

  it('未ログインなら401', async () => {
    const res = await ctx.app.request('/api/settings/admin/report-ai');
    expect(res.status).toBe(401);
  });

  it('管理者でなければ403', async () => {
    const res = await call(ctx, 'GET', '', undefined, ctx.staffCookie);
    expect(res.status).toBe(403);
  });

  it('5種類の表をまとめて返す', async () => {
    const res = await call(ctx, 'GET', '');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ageBands: [],
      keywords: [],
      educationLevels: [],
      stressLevels: [],
      phrases: [],
    });
  });

  it('保存した行が一覧に出る', async () => {
    await call(ctx, 'PUT', '/age-bands/m0_6', AGE_BAND_BODY);
    const body = (await (await call(ctx, 'GET', '')).json()) as { ageBands: { code: string }[] };
    expect(body.ageBands.map((band) => band.code)).toEqual(['m0_6']);
  });
});

describe('PUT/DELETE /api/settings/admin/report-ai/age-bands/:code', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await setup();
  });

  it('管理者でなければ403', async () => {
    const res = await call(ctx, 'PUT', '/age-bands/m0_6', AGE_BAND_BODY, ctx.staffCookie);
    expect(res.status).toBe(403);
  });

  it('URLのcodeを識別子としてupsertする', async () => {
    const res = await call(ctx, 'PUT', '/age-bands/m0_6', AGE_BAND_BODY);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ageBand: { code: 'm0_6', label: '0〜6ヶ月' } });
  });

  it('月齢の範囲が逆なら400(どの項目が悪いかをメッセージに出す)', async () => {
    const res = await call(ctx, 'PUT', '/age-bands/m0_6', { ...AGE_BAND_BODY, ageToMonths: 0 });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string; message: string };
    expect(body.code).toBe('validation_failed');
    expect(body.message).toContain('ageToMonths');
  });

  it('他の年齢帯と月齢が重なれば400(ユースケースの日本語メッセージをそのまま返す)', async () => {
    await call(ctx, 'PUT', '/age-bands/m0_6', AGE_BAND_BODY);
    const res = await call(ctx, 'PUT', '/age-bands/m3_9', {
      label: '3〜9ヶ月',
      ageFromMonths: 3,
      ageToMonths: 9,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { success: boolean; message: string };
    expect(body.success).toBe(false);
    expect(body.message).toContain('重なっています');
  });

  it('削除できる。無いコードは404', async () => {
    await call(ctx, 'PUT', '/age-bands/m0_6', AGE_BAND_BODY);
    const deleted = await call(ctx, 'DELETE', '/age-bands/m0_6');
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ success: true });

    const missing = await call(ctx, 'DELETE', '/age-bands/m0_6');
    expect(missing.status).toBe(404);
  });
});

describe('PUT /api/settings/admin/report-ai/keywords/:code', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await setup();
  });

  it('管理者でなければ403', async () => {
    const res = await call(ctx, 'PUT', '/keywords/K01', KEYWORD_BODY, ctx.staffCookie);
    expect(res.status).toBe(403);
  });

  it('URLのcodeを識別子としてupsertし、相性の良い年齢帯コードも返す', async () => {
    await call(ctx, 'PUT', '/age-bands/m0_6', AGE_BAND_BODY);
    const res = await call(ctx, 'PUT', '/keywords/K01', { ...KEYWORD_BODY, ageBandCodes: ['m0_6'] });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      keyword: { code: 'K01', name: '追視', ageBandCodes: ['m0_6'], active: true },
    });
  });

  it('★の上限が下限より小さければ400', async () => {
    const res = await call(ctx, 'PUT', '/keywords/K01', {
      ...KEYWORD_BODY,
      educationLevelMin: 5,
      educationLevelMax: 1,
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { code: string }).toMatchObject({ code: 'validation_failed' });
  });

  it('登録されていない年齢帯コードを指定すれば400', async () => {
    const res = await call(ctx, 'PUT', '/keywords/K01', { ...KEYWORD_BODY, ageBandCodes: ['no_such'] });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { success: boolean; message: string };
    expect(body.success).toBe(false);
    expect(body.message).toContain('no_such');
  });
});

describe('PUT /api/settings/admin/report-ai/education-levels/:level・stress-levels/:level', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await setup();
  });

  it('管理者でなければ403', async () => {
    const res = await call(ctx, 'PUT', '/education-levels/2', { label: '標準' }, ctx.staffCookie);
    expect(res.status).toBe(403);
  });

  it('URLのlevelを識別子として教育関心度★の定義をupsertする', async () => {
    const res = await call(ctx, 'PUT', '/education-levels/2', {
      label: '標準',
      description: '一般的な家庭',
      maxKeywords: 1,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ educationLevel: { level: 2, label: '標準', maxKeywords: 1 } });
  });

  it('1〜5以外のlevelは400', async () => {
    for (const level of ['0', '6', 'abc', '2.5']) {
      const res = await call(ctx, 'PUT', `/education-levels/${level}`, { label: '標準' });
      expect(res.status).toBe(400);
    }
  });

  it('ストレス度の定義もlevelでupsertする', async () => {
    const res = await call(ctx, 'PUT', '/stress-levels/1', {
      label: '余裕なし',
      criteria: '表情が硬い',
      keywordsEnabled: false,
      escalationRequired: true,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      stressLevel: { level: 1, label: '余裕なし', keywordsEnabled: false, escalationRequired: true },
    });
  });

  it('ストレス度も1〜5以外のlevelは400', async () => {
    const res = await call(ctx, 'PUT', '/stress-levels/9', { label: '余裕なし' });
    expect(res.status).toBe(400);
  });

  it('labelが空なら400', async () => {
    const res = await call(ctx, 'PUT', '/stress-levels/1', { label: '   ' });
    expect(res.status).toBe(400);
    expect((await res.json()) as { code: string }).toMatchObject({ code: 'validation_failed' });
  });
});

describe('PUT /api/settings/admin/report-ai/phrases', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await setup();
  });

  it('管理者でなければ403', async () => {
    const res = await call(ctx, 'PUT', '/phrases', { phrases: [] }, ctx.staffCookie);
    expect(res.status).toBe(403);
  });

  it('全件入れ替えて、入れ替え後の一覧を返す', async () => {
    const first = await call(ctx, 'PUT', '/phrases', {
      phrases: [
        { kind: 'encourage', body: '今日もお疲れさまでした' },
        { kind: 'avoid', body: '問題児' },
      ],
    });
    expect(first.status).toBe(200);
    expect(((await first.json()) as { phrases: unknown[] }).phrases).toHaveLength(2);

    const second = await call(ctx, 'PUT', '/phrases', {
      phrases: [{ kind: 'encourage', body: 'よく眠れていました' }],
    });
    const body = (await second.json()) as { phrases: { body: string }[] };
    expect(body.phrases.map((phrase) => phrase.body)).toEqual(['よく眠れていました']);
  });

  it('phrasesが無い・kindが不明なら400', async () => {
    expect((await call(ctx, 'PUT', '/phrases', {})).status).toBe(400);
    const res = await call(ctx, 'PUT', '/phrases', { phrases: [{ kind: 'unknown', body: 'x' }] });
    expect(res.status).toBe(400);
    expect((await res.json()) as { code: string }).toMatchObject({ code: 'validation_failed' });
  });

  it('避ける表現にストレス度の範囲を付ければ400(全日報に効くので範囲を持てない)', async () => {
    const res = await call(ctx, 'PUT', '/phrases', {
      phrases: [{ kind: 'avoid', body: '問題児', stressLevelMin: 1, stressLevelMax: 3 }],
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { message: string }).toMatchObject({ code: 'validation_failed' });
  });

  it('検証エラー以外(保存先の失敗)は400にせず500にする', async () => {
    ctx.reportAiConfig.replacePhrases = () => Promise.reject(new Error('DBに繋がりません'));
    const res = await call(ctx, 'PUT', '/phrases', {
      phrases: [{ kind: 'encourage', body: '今日もお疲れさまでした' }],
    });
    expect(res.status).toBe(500);
  });
});

describe('POST /api/settings/admin/report-ai/import', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await setup();
  });

  it('管理者でなければ403', async () => {
    const res = await call(ctx, 'POST', '/import', {}, ctx.staffCookie);
    expect(res.status).toBe(403);
  });

  it('種類ごとの反映件数を返す', async () => {
    const res = await call(ctx, 'POST', '/import', {
      ageBands: [{ code: 'm0_6', label: '0〜6ヶ月', ageFromMonths: 0, ageToMonths: 6 }],
      keywords: [{ ...KEYWORD_BODY, code: 'K01', ageBandCodes: ['m0_6'] }],
      educationLevels: [{ level: 2, label: '標準' }],
      // daily_report は {anonymizedText} を含まない文面を受け付けない(スタッフの入力がAIに届かなくなるため)。
      promptTemplates: [{ key: 'daily_report', body: '取込した文面: {anonymizedText}' }],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      result: {
        ageBands: 1,
        keywords: 1,
        educationLevels: 1,
        stressLevels: 0,
        phrases: 0,
        promptTemplates: 1,
      },
    });
  });

  it('未知のプロンプトキーは400', async () => {
    const res = await call(ctx, 'POST', '/import', {
      promptTemplates: [{ key: 'no_such_key', body: 'x' }],
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { code: string }).toMatchObject({ code: 'validation_failed' });
  });

  it('取込の中で年齢帯が重なっていれば400', async () => {
    const res = await call(ctx, 'POST', '/import', {
      ageBands: [
        { code: 'm0_6', label: '0〜6ヶ月', ageFromMonths: 0, ageToMonths: 6 },
        { code: 'm3_9', label: '3〜9ヶ月', ageFromMonths: 3, ageToMonths: 9 },
      ],
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { message: string }).message).toContain('重なっています');
  });
});
