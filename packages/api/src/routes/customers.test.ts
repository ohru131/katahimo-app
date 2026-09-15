import { login, registerStaff } from '@katahimo/core';
import type { CustomerRecord, CustomerRepositoryPort } from '@katahimo/core/ports';
import {
  FakeCustomerRepository,
  FakeFamilyMemberRepository,
  FakePasswordHasherPort,
  FakePasswordResetCodeRepository,
  FakeSessionRepository,
  FakeStaffRepository,
  FakeTenantRepository,
} from '@katahimo/core/test-utils';
import { FakeCustomerReportProfileRepository } from '@katahimo/core/test-utils/report-ai';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import type { Container } from '../container';
import { SESSION_COOKIE_NAME } from '../session';

/**
 * 顧客詳細に付く「家庭ごとの日報AI設定(教育関心度★とメモ)」のAPI。
 *
 * 組み立て方は settings.reportAi.test.ts と同じで、本番と同じ `createApp` に
 * インメモリのフェイクを差したContainerを渡す。
 */

const ADMIN = { email: 'admin@example.com', password: 'admin-password' };
const STAFF = { email: 'staff@example.com', password: 'staff-password' };
/** 顧客IDはuuidでないと400になる(uuid列との比較でPostgreSQLが例外を投げるのを入口で防ぐため)。 */
const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111';
const MISSING_CUSTOMER_ID = '22222222-2222-4222-8222-222222222222';

interface TestContext {
  app: ReturnType<typeof createApp>;
  adminCookie: string;
  staffCookie: string;
}

/**
 * 顧客1件を持つだけのリポジトリ。フェイク(FakeCustomerRepository)が振るIDはuuidではなく、
 * 入口のuuid検証を通せないため、IDだけを差し替えた行を返す。
 */
function customerRepositoryWith(record: CustomerRecord): CustomerRepositoryPort {
  return {
    async findById(tenantId: string, customerId: string) {
      return record.tenantId === tenantId && record.id === customerId ? record : null;
    },
  } as unknown as CustomerRepositoryPort;
}

async function setup(): Promise<TestContext> {
  const tenants = new FakeTenantRepository();
  const tenant = await tenants.create({ name: 'テスト法人', slug: 'test-tenant' });
  const seed = await new FakeCustomerRepository().create({
    tenantId: tenant.id,
    name: '山田 太郎',
    familyName: '山田',
    givenName: '太郎',
  });

  const deps = {
    tenants,
    staff: new FakeStaffRepository(),
    sessions: new FakeSessionRepository(),
    passwordResetCodes: new FakePasswordResetCodeRepository(),
    passwordHasher: new FakePasswordHasherPort(),
    customers: customerRepositoryWith({ ...seed, id: CUSTOMER_ID }),
    familyMembers: new FakeFamilyMemberRepository(),
    customerReportProfiles: new FakeCustomerReportProfileRepository(),
  };
  const container = deps as unknown as Container;

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

  return { app: createApp(container, { secureCookies: false }), adminCookie, staffCookie };
}

function call(ctx: TestContext, method: string, path: string, body?: unknown, cookie?: string) {
  return ctx.app.request(`/api/customers${path}`, {
    method,
    headers: { cookie: cookie ?? ctx.staffCookie, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('GET /api/customers/:id の reportProfile', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await setup();
  });

  it('未ログインなら401', async () => {
    const res = await ctx.app.request(`/api/customers/${CUSTOMER_ID}`);
    expect(res.status).toBe(401);
  });

  it('未設定の家庭は null(顧客の他の項目はそのまま)', async () => {
    const res = await call(ctx, 'GET', `/${CUSTOMER_ID}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      customer: { id: string; name: string; reportProfile: unknown };
    };
    expect(body.customer.id).toBe(CUSTOMER_ID);
    expect(body.customer.name).toBe('山田 太郎');
    expect(body.customer.reportProfile).toBeNull();
  });

  it('保存済みなら★とメモを返す', async () => {
    await call(ctx, 'PUT', `/${CUSTOMER_ID}/report-profile`, { educationLevel: 4, note: '教育熱心' });
    const body = (await (await call(ctx, 'GET', `/${CUSTOMER_ID}`)).json()) as {
      customer: { reportProfile: { educationLevel: number; note: string } };
    };
    expect(body.customer.reportProfile).toEqual({ educationLevel: 4, note: '教育熱心' });
  });

  it('存在しない顧客は404', async () => {
    const res = await call(ctx, 'GET', `/${MISSING_CUSTOMER_ID}`);
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/customers/:id/report-profile', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await setup();
  });

  it('未ログインなら401', async () => {
    const res = await ctx.app.request(`/api/customers/${CUSTOMER_ID}/report-profile`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ educationLevel: null, note: '' }),
    });
    expect(res.status).toBe(401);
  });

  it('管理者でなくても保存できる(担当者も★を付けられる)', async () => {
    const res = await call(ctx, 'PUT', `/${CUSTOMER_ID}/report-profile`, {
      educationLevel: 3,
      note: '用語より様子を知りたいとのこと',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      reportProfile: { educationLevel: 3, note: '用語より様子を知りたいとのこと' },
    });
  });

  it('★は null(未設定に戻す)を受け付ける', async () => {
    await call(
      ctx,
      'PUT',
      `/${CUSTOMER_ID}/report-profile`,
      { educationLevel: 5, note: 'x' },
      ctx.adminCookie,
    );
    const res = await call(ctx, 'PUT', `/${CUSTOMER_ID}/report-profile`, { educationLevel: null, note: '' });
    expect(await res.json()).toEqual({ reportProfile: { educationLevel: null, note: '' } });
  });

  it('★が1〜5の外・本文が無いなら400', async () => {
    expect((await call(ctx, 'PUT', `/${CUSTOMER_ID}/report-profile`, { educationLevel: 6 })).status).toBe(
      400,
    );
    const res = await call(ctx, 'PUT', `/${CUSTOMER_ID}/report-profile`, undefined);
    expect(res.status).toBe(400);
    expect((await res.json()) as { code: string }).toMatchObject({ code: 'validation_failed' });
  });

  it('IDがuuidでなければ400', async () => {
    const res = await call(ctx, 'PUT', '/not-a-uuid/report-profile', { educationLevel: null, note: '' });
    expect(res.status).toBe(400);
  });

  it('存在しない顧客は404', async () => {
    const res = await call(ctx, 'PUT', `/${MISSING_CUSTOMER_ID}/report-profile`, {
      educationLevel: null,
      note: '',
    });
    expect(res.status).toBe(404);
  });
});
