import { beforeEach, describe, expect, it } from 'vitest';
import type { AuthDeps } from './auth';
import { decodeSessionCookie, login, registerStaff, resolveSession } from './auth';
import {
  FakeBlindIndexPort,
  FakeCryptoPort,
  FakePasswordHasherPort,
  FakeSessionRepository,
  FakeStaffRepository,
  FakeTenantRepository,
} from './testDoubles';

describe('login / registerStaff / resolveSession', () => {
  let deps: AuthDeps;
  let tenantId: string;

  beforeEach(async () => {
    deps = {
      tenants: new FakeTenantRepository(),
      staff: new FakeStaffRepository(),
      sessions: new FakeSessionRepository(),
      crypto: new FakeCryptoPort(),
      blindIndex: new FakeBlindIndexPort(),
      passwordHasher: new FakePasswordHasherPort(),
    };
    const tenant = await deps.tenants.create({ name: 'テスト法人', slug: 'test-tenant' });
    tenantId = tenant.id;
    await registerStaff(deps, {
      tenantId,
      name: '佐藤 花子',
      email: 'hanako@example.com',
      password: 'correct-horse',
      isAdmin: false,
    });
  });

  it('正しいテナント・メール・パスワードでログインできる', async () => {
    const result = await login(deps, {
      tenantSlug: 'test-tenant',
      email: 'hanako@example.com',
      password: 'correct-horse',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.staff.name).toBe('佐藤 花子');
    expect(result.staff.email).toBe('hanako@example.com');
    expect(result.staff.isAdmin).toBe(false);

    const decoded = decodeSessionCookie(result.sessionCookieValue);
    expect(decoded?.tenantId).toBe(tenantId);
  });

  it('メールの大文字小文字・前後空白の表記ゆれがあってもログインできる(正規化されるため)', async () => {
    const result = await login(deps, {
      tenantSlug: 'test-tenant',
      email: '  Hanako@Example.com  ',
      password: 'correct-horse',
    });
    expect(result.ok).toBe(true);
  });

  it('パスワードが違えばログインできない', async () => {
    const result = await login(deps, {
      tenantSlug: 'test-tenant',
      email: 'hanako@example.com',
      password: 'wrong-password',
    });
    expect(result).toEqual({ ok: false, reason: 'invalid_credentials' });
  });

  it('存在しないテナントslugではログインできない', async () => {
    const result = await login(deps, {
      tenantSlug: 'no-such-tenant',
      email: 'hanako@example.com',
      password: 'correct-horse',
    });
    expect(result).toEqual({ ok: false, reason: 'tenant_not_found' });
  });

  it('ログイン成功後のセッションCookieでresolveSessionが本人を解決できる', async () => {
    const loginResult = await login(deps, {
      tenantSlug: 'test-tenant',
      email: 'hanako@example.com',
      password: 'correct-horse',
    });
    if (!loginResult.ok) throw new Error('unreachable');

    const resolved = await resolveSession(deps, loginResult.sessionCookieValue);
    expect(resolved?.name).toBe('佐藤 花子');
    expect(resolved?.tenantId).toBe(tenantId);
  });

  it('不正なCookie値(区切りが無い等)はnullを返す', async () => {
    expect(await resolveSession(deps, 'not-a-valid-cookie-value')).toBeNull();
  });
});
