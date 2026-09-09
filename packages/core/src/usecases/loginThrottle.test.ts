import { beforeEach, describe, expect, it } from 'vitest';
import { LOGIN_LOCKOUT_MS, MAX_FAILED_LOGIN_ATTEMPTS } from '../domain';
import type { AuditEvent, AuditLogPort } from '../ports/audit';
import type { AuthDeps } from './auth';
import { login, registerStaff } from './auth';
import {
  FakePasswordHasherPort,
  FakePasswordResetCodeRepository,
  FakeSessionRepository,
  FakeStaffRepository,
  FakeTenantRepository,
} from './testDoubles';

/**
 * ログインの総当たり対策。パスワードの最低条件は8文字しか課していないので、
 * 何度でも試せる状態のままにはしない。一方で、恒久ロックにすると特定の人を
 * 狙って締め出せてしまう(業務が止まる)ため、時間で解ける形であることも固定する。
 */

class RecordingAuditLogPort implements AuditLogPort {
  readonly events: AuditEvent[] = [];
  recordDecrypt(): void {}
  record(event: AuditEvent): void {
    this.events.push(event);
  }
}

describe('ログイン試行の制限', () => {
  let deps: AuthDeps;
  let staffRepository: FakeStaffRepository;
  let audit: RecordingAuditLogPort;
  let staffId: string;

  const goodLogin = { tenantSlug: 'test-tenant', email: 'hanako@example.com', password: 'correct-horse' };
  const badLogin = { ...goodLogin, password: 'wrong-password' };

  beforeEach(async () => {
    staffRepository = new FakeStaffRepository();
    audit = new RecordingAuditLogPort();
    deps = {
      tenants: new FakeTenantRepository(),
      staff: staffRepository,
      sessions: new FakeSessionRepository(),
      passwordResetCodes: new FakePasswordResetCodeRepository(),
      passwordHasher: new FakePasswordHasherPort(),
      audit,
    };
    const tenant = await deps.tenants.create({ name: 'テスト法人', slug: 'test-tenant' });
    const created = await registerStaff(deps, {
      tenantId: tenant.id,
      name: '佐藤 花子',
      email: 'hanako@example.com',
      password: 'correct-horse',
      isAdmin: false,
    });
    staffId = created.id;
  });

  it('上限に達するまで失敗し続けると、正しいパスワードでもログインできなくなる', async () => {
    for (let i = 0; i < MAX_FAILED_LOGIN_ATTEMPTS; i++) {
      expect(await login(deps, badLogin)).toEqual({ ok: false, reason: 'invalid_credentials' });
    }

    const blocked = await login(deps, goodLogin);
    expect(blocked).toEqual({ ok: false, reason: 'invalid_credentials' });
  });

  it('上限に達していなければ、正しいパスワードでログインできる', async () => {
    for (let i = 0; i < MAX_FAILED_LOGIN_ATTEMPTS - 1; i++) {
      await login(deps, badLogin);
    }

    const result = await login(deps, goodLogin);
    expect(result.ok).toBe(true);
  });

  it('ログインに成功すると失敗回数がリセットされる(連続でない失敗を積み上げない)', async () => {
    for (let i = 0; i < MAX_FAILED_LOGIN_ATTEMPTS - 1; i++) {
      await login(deps, badLogin);
    }
    await login(deps, goodLogin);

    // リセットされているので、ここからさらに上限-1回失敗してもまだロックされない。
    for (let i = 0; i < MAX_FAILED_LOGIN_ATTEMPTS - 1; i++) {
      await login(deps, badLogin);
    }
    expect((await login(deps, goodLogin)).ok).toBe(true);
  });

  it('ロックは時間で解ける(締め出したままにしない)', async () => {
    for (let i = 0; i < MAX_FAILED_LOGIN_ATTEMPTS; i++) {
      await login(deps, badLogin);
    }
    expect((await login(deps, goodLogin)).ok).toBe(false);

    // ロック期限を過ぎた状態にする。
    staffRepository.setLockForTest(staffId, new Date(Date.now() - LOGIN_LOCKOUT_MS));
    expect((await login(deps, goodLogin)).ok).toBe(true);
  });

  it('ロック中かどうかで応答を変えない(反応の違いからアカウントの有無を探れないように)', async () => {
    for (let i = 0; i < MAX_FAILED_LOGIN_ATTEMPTS; i++) {
      await login(deps, badLogin);
    }

    const lockedAccount = await login(deps, goodLogin);
    const unknownAccount = await login(deps, { ...goodLogin, email: 'nobody@example.com' });
    expect(lockedAccount).toEqual(unknownAccount);
  });

  it('ログインの成否を監査ログに残す', async () => {
    await login(deps, badLogin);
    await login(deps, goodLogin);

    expect(audit.events.map((e) => e.type)).toEqual(['login_failed', 'login_succeeded']);
    expect(audit.events.every((e) => e.actorStaffId === staffId)).toBe(true);
  });
});
