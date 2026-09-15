import { createCustomer, login, registerStaff } from '@katahimo/core';
import type { DailyReportDraft, ReceiptOcrResult, ReportAiPort } from '@katahimo/core/ports';
import {
  FakeAccidentReportRepository,
  FakeAppSettingsRepository,
  FakeCouponRedemptionRepository,
  FakeCouponRepository,
  FakeCryptoPort,
  FakeCustomerCouponRepository,
  FakeCustomerRepository,
  FakeDailyReportRepository,
  FakeFamilyMemberRepository,
  FakeNotifierPort,
  FakeOutboxRepository,
  FakePasswordHasherPort,
  FakePasswordResetCodeRepository,
  FakePromptTemplateRepository,
  FakeSessionRepository,
  FakeStaffRepository,
  FakeTenantRepository,
  FakeUnitOfWork,
} from '@katahimo/core/test-utils';
import {
  FakeCustomerReportProfileRepository,
  FakeReportAiConfigRepository,
  FakeReportAiGenerationRepository,
} from '@katahimo/core/test-utils/report-ai';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import type { Container } from '../container';
import { SESSION_COOKIE_NAME } from '../session';

/**
 * 日報の生成・保存APIが、入力の取り違え(対象児・AI生成の記録)を400で返し、
 * それ以外の失敗は500のままにすることを確かめる。
 *
 * settings.reportAi.test.ts と同じく、本番と同じ `createApp` にインメモリのフェイクを差して叩く。
 * 「何が400で、何が500か」はルートの catch がユースケースの検証エラーだけを拾うことで決まるので、
 * 実際にHTTPの応答まで通して固定する。
 */

const STAFF = { email: 'staff@example.com', password: 'staff-password' };

/** 生成そのものは主題ではないので、常に同じ下書きを返す。 */
class StubReportAiPort implements ReportAiPort {
  readonly reportModel = 'stub';

  async generateDailyReport(): Promise<DailyReportDraft> {
    return { warnings: [], internal: '社内向け', customer: '保護者向け', usedKeywords: [] };
  }

  async generateAccidentReport() {
    return { error: 'not used' };
  }

  async extractReceiptAmount(): Promise<ReceiptOcrResult> {
    return { amount: '', storeName: '', receiptDate: '', error: 'not used' };
  }
}

interface TestContext {
  app: ReturnType<typeof createApp>;
  cookie: string;
  tenantId: string;
  customerId: string;
  /** 別の顧客の子・別の顧客の生成を作るための顧客。 */
  otherCustomerId: string;
  familyMembers: FakeFamilyMemberRepository;
  reportAiConfig: FakeReportAiConfigRepository;
  reportAiGenerations: FakeReportAiGenerationRepository;
}

async function setup(): Promise<TestContext> {
  const dailyReports = new FakeDailyReportRepository();
  const couponRedemptions = new FakeCouponRedemptionRepository();
  const customers = new FakeCustomerRepository();
  const familyMembers = new FakeFamilyMemberRepository();
  const deps = {
    tenants: new FakeTenantRepository(),
    staff: new FakeStaffRepository(),
    sessions: new FakeSessionRepository(),
    passwordResetCodes: new FakePasswordResetCodeRepository(),
    passwordHasher: new FakePasswordHasherPort(),
    promptTemplates: new FakePromptTemplateRepository(),
    appSettings: new FakeAppSettingsRepository(),
    crypto: new FakeCryptoPort(),
    reportAi: new StubReportAiPort(),
    reportAiFactory: { create: () => new StubReportAiPort() },
    reportAiConfig: new FakeReportAiConfigRepository(),
    customerReportProfiles: new FakeCustomerReportProfileRepository(),
    reportAiGenerations: new FakeReportAiGenerationRepository(),
    customers,
    familyMembers,
    dailyReports,
    accidentReports: new FakeAccidentReportRepository(),
    coupons: new FakeCouponRepository(),
    couponRedemptions,
    customerCoupons: new FakeCustomerCouponRepository(),
    notifier: new FakeNotifierPort(),
    mirror: new FakeOutboxRepository(),
    unitOfWork: new FakeUnitOfWork([dailyReports, couponRedemptions]),
  };
  // ここで使うルートが触るポートだけを持たせる(Container全体を組み立てる必要はない)。
  const container = deps as unknown as Container;

  const tenant = await deps.tenants.create({ name: 'テスト法人', slug: 'test-tenant' });
  await registerStaff(deps, {
    tenantId: tenant.id,
    name: '佐藤 花子',
    email: STAFF.email,
    password: STAFF.password,
    isAdmin: false,
  });
  const result = await login(deps, {
    tenantSlug: 'test-tenant',
    email: STAFF.email,
    password: STAFF.password,
  });
  if (!result.ok) throw new Error('テストの前提(ログイン)が崩れています');

  const customerDeps = { customers, familyMembers };
  const customer = await createCustomer(customerDeps, { tenantId: tenant.id, name: '田中 一郎' });
  const otherCustomer = await createCustomer(customerDeps, { tenantId: tenant.id, name: '鈴木 次郎' });

  return {
    app: createApp(container, { secureCookies: false }),
    cookie: `${SESSION_COOKIE_NAME}=${result.sessionCookieValue}`,
    tenantId: tenant.id,
    customerId: customer.id,
    otherCustomerId: otherCustomer.id,
    familyMembers,
    reportAiConfig: deps.reportAiConfig,
    reportAiGenerations: deps.reportAiGenerations,
  };
}

function call(ctx: TestContext, path: string, body: unknown) {
  return ctx.app.request(`/api/reports${path}`, {
    method: 'POST',
    headers: { cookie: ctx.cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** その顧客の子を1人作り、IDを返す。 */
async function addChild(ctx: TestContext, customerId: string): Promise<string> {
  const created = await ctx.familyMembers.createMany([
    {
      tenantId: ctx.tenantId,
      customerId,
      name: '太郎',
      dobDate: '2025-01-15',
      dobRaw: '2025-01-15',
      info: '',
      allergyStatus: 'unknown',
      allergyNote: null,
    },
  ]);
  const member = created[0];
  if (!member) throw new Error('テストの前提が崩れています');
  return member.id;
}

describe('POST /api/reports/daily/generate', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await setup();
  });

  it('他の顧客の子を対象児に指定すれば400', async () => {
    const otherChild = await addChild(ctx, ctx.otherCustomerId);
    const res = await call(ctx, '/daily/generate', {
      text: 'よく遊んでいました',
      customerId: ctx.customerId,
      familyMemberId: otherChild,
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { message: string }).toMatchObject({
      code: 'validation_failed',
      message: '対象児が見つかりません',
    });
  });

  it('検証エラー以外(設定の読み取り失敗)は400にせず500にする', async () => {
    ctx.reportAiConfig.loadAll = () => Promise.reject(new Error('DBに繋がりません'));
    const res = await call(ctx, '/daily/generate', {
      text: 'よく遊んでいました',
      customerId: ctx.customerId,
    });
    expect(res.status).toBe(500);
  });
});

describe('POST /api/reports/daily', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await setup();
  });

  it('他の顧客の子を対象児に指定すれば400', async () => {
    const otherChild = await addChild(ctx, ctx.otherCustomerId);
    const res = await call(ctx, '/daily', {
      customerId: ctx.customerId,
      targetFamilyMemberId: otherChild,
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { message: string }).toMatchObject({
      success: false,
      message: '対象児が見つかりません',
    });
  });

  it('検証エラー以外(保存先の失敗)は400にせず500にする', async () => {
    ctx.familyMembers.listByCustomerId = () => Promise.reject(new Error('DBに繋がりません'));
    const res = await call(ctx, '/daily', {
      customerId: ctx.customerId,
      targetFamilyMemberId: 'any-id',
    });
    expect(res.status).toBe(500);
  });
});
