import { beforeEach, describe, expect, it } from 'vitest';
import { login, registerStaff } from './auth';
import type { PasswordResetDeps } from './passwordReset';
import { requestPasswordReset, resetPasswordWithCode } from './passwordReset';
import {
  FakeMailer,
  FakePasswordHasherPort,
  FakePasswordResetCodeRepository,
  FakeSessionRepository,
  FakeStaffRepository,
  FakeTenantRepository,
} from './testDoubles';

const TENANT_SLUG = 'test-tenant';
const EMAIL = 'hanako@example.com';
const NEW_PASSWORD = 'brand-new-password';

/** メール本文に載った6桁コードを取り出す(利用者がメールを見て入力するのと同じ経路)。 */
function codeFromMail(mailer: FakeMailer): string {
  const match = mailer.last?.body.match(/認証コード: (\d{6})/);
  if (!match?.[1]) throw new Error(`認証コードがメール本文にありません: ${mailer.last?.body}`);
  return match[1];
}

/**
 * GAS版 Auth.js の requestPasswordReset / resetPasswordWithCode に対応する経路。
 * 認証情報を書き換える処理なので、成功経路よりも「失敗すべきときに失敗すること」を厚く見る。
 */
describe('パスワード再設定', () => {
  let deps: PasswordResetDeps;
  let mailer: FakeMailer;
  let tenantId: string;
  let staffId: string;

  beforeEach(async () => {
    mailer = new FakeMailer();
    deps = {
      tenants: new FakeTenantRepository(),
      staff: new FakeStaffRepository(),
      sessions: new FakeSessionRepository(),
      passwordResetCodes: new FakePasswordResetCodeRepository(),
      passwordHasher: new FakePasswordHasherPort(),
      mailer,
    };
    const tenant = await deps.tenants.create({ name: 'テスト法人', slug: TENANT_SLUG });
    tenantId = tenant.id;
    const created = await registerStaff(
      { ...deps },
      {
        tenantId,
        name: '佐藤 花子',
        email: EMAIL,
        password: 'original-password',
        isAdmin: false,
      },
    );
    staffId = created.id;
  });

  it('コードをメールで送り、そのコードで再設定できる', async () => {
    await requestPasswordReset(deps, { tenantSlug: TENANT_SLUG, email: EMAIL });

    expect(mailer.sent).toHaveLength(1);
    expect(mailer.last?.to).toBe(EMAIL);
    // 新しいパスワードそのものをメールに書かない(再設定は本人が画面で決める)。
    expect(mailer.last?.body).not.toContain(NEW_PASSWORD);

    const result = await resetPasswordWithCode(deps, {
      tenantSlug: TENANT_SLUG,
      email: EMAIL,
      code: codeFromMail(mailer),
      newPassword: NEW_PASSWORD,
    });
    expect(result).toEqual({ ok: true });

    const after = await login({ ...deps }, { tenantSlug: TENANT_SLUG, email: EMAIL, password: NEW_PASSWORD });
    expect(after.ok).toBe(true);
  });

  it('存在しないメールアドレスでも同じ結果にする(利用者の存在を漏らさない)', async () => {
    await expect(
      requestPasswordReset(deps, { tenantSlug: TENANT_SLUG, email: 'nobody@example.com' }),
    ).resolves.toBeUndefined();
    await expect(
      requestPasswordReset(deps, { tenantSlug: 'no-such-tenant', email: EMAIL }),
    ).resolves.toBeUndefined();
    expect(mailer.sent).toHaveLength(0);

    // 再設定側も、宛先が無いことと「コードが違う」ことを区別できないようにする。
    const result = await resetPasswordWithCode(deps, {
      tenantSlug: TENANT_SLUG,
      email: 'nobody@example.com',
      code: '000000',
      newPassword: NEW_PASSWORD,
    });
    expect(result).toEqual({ ok: false, reason: 'invalid_code' });
  });

  it('退職済みのスタッフにはコードを送らない', async () => {
    (deps.staff as FakeStaffRepository).setRetirementDateForTest(tenantId, staffId, '2020-01-01');
    await requestPasswordReset(deps, { tenantSlug: TENANT_SLUG, email: EMAIL });
    expect(mailer.sent).toHaveLength(0);
  });

  it('期限が切れたコードでは再設定できない', async () => {
    await requestPasswordReset(deps, { tenantSlug: TENANT_SLUG, email: EMAIL });
    const code = codeFromMail(mailer);
    (deps.passwordResetCodes as FakePasswordResetCodeRepository).expireAllForTest();

    const result = await resetPasswordWithCode(deps, {
      tenantSlug: TENANT_SLUG,
      email: EMAIL,
      code,
      newPassword: NEW_PASSWORD,
    });
    expect(result).toEqual({ ok: false, reason: 'invalid_code' });
  });

  it('誤入力が続いたコードは、正しいコードを入れても無効になる', async () => {
    await requestPasswordReset(deps, { tenantSlug: TENANT_SLUG, email: EMAIL });
    const code = codeFromMail(mailer);
    const wrong = code === '000000' ? '111111' : '000000';

    for (let i = 0; i < 5; i++) {
      const attempt = await resetPasswordWithCode(deps, {
        tenantSlug: TENANT_SLUG,
        email: EMAIL,
        code: wrong,
        newPassword: NEW_PASSWORD,
      });
      expect(attempt).toEqual({ ok: false, reason: 'invalid_code' });
    }

    const result = await resetPasswordWithCode(deps, {
      tenantSlug: TENANT_SLUG,
      email: EMAIL,
      code,
      newPassword: NEW_PASSWORD,
    });
    expect(result).toEqual({ ok: false, reason: 'invalid_code' });
  });

  it('一度使ったコードは使い回せない', async () => {
    await requestPasswordReset(deps, { tenantSlug: TENANT_SLUG, email: EMAIL });
    const code = codeFromMail(mailer);
    await resetPasswordWithCode(deps, {
      tenantSlug: TENANT_SLUG,
      email: EMAIL,
      code,
      newPassword: NEW_PASSWORD,
    });

    const again = await resetPasswordWithCode(deps, {
      tenantSlug: TENANT_SLUG,
      email: EMAIL,
      code,
      newPassword: 'yet-another-password',
    });
    expect(again).toEqual({ ok: false, reason: 'invalid_code' });
  });

  it('コードを再発行すると、前のコードは使えなくなる', async () => {
    await requestPasswordReset(deps, { tenantSlug: TENANT_SLUG, email: EMAIL });
    const first = codeFromMail(mailer);
    await requestPasswordReset(deps, { tenantSlug: TENANT_SLUG, email: EMAIL });
    const second = codeFromMail(mailer);
    expect(mailer.sent).toHaveLength(2);

    const stale = await resetPasswordWithCode(deps, {
      tenantSlug: TENANT_SLUG,
      email: EMAIL,
      code: first,
      newPassword: NEW_PASSWORD,
    });
    expect(stale).toEqual({ ok: false, reason: 'invalid_code' });

    const fresh = await resetPasswordWithCode(deps, {
      tenantSlug: TENANT_SLUG,
      email: EMAIL,
      code: second,
      newPassword: NEW_PASSWORD,
    });
    expect(fresh).toEqual({ ok: true });
  });

  it('短すぎるパスワードは受け付けない', async () => {
    await requestPasswordReset(deps, { tenantSlug: TENANT_SLUG, email: EMAIL });
    const result = await resetPasswordWithCode(deps, {
      tenantSlug: TENANT_SLUG,
      email: EMAIL,
      code: codeFromMail(mailer),
      newPassword: 'short',
    });
    expect(result).toEqual({ ok: false, reason: 'weak_password' });
  });

  it('再設定すると既存のログインを全て切る', async () => {
    const sessions = deps.sessions as FakeSessionRepository;
    await login({ ...deps }, { tenantSlug: TENANT_SLUG, email: EMAIL, password: 'original-password' });
    await login({ ...deps }, { tenantSlug: TENANT_SLUG, email: EMAIL, password: 'original-password' });
    expect(sessions.countForStaff(tenantId, staffId)).toBe(2);

    await requestPasswordReset(deps, { tenantSlug: TENANT_SLUG, email: EMAIL });
    await resetPasswordWithCode(deps, {
      tenantSlug: TENANT_SLUG,
      email: EMAIL,
      code: codeFromMail(mailer),
      newPassword: NEW_PASSWORD,
    });

    expect(sessions.countForStaff(tenantId, staffId)).toBe(0);
  });
});
