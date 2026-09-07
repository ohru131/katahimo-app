import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AuthDeps } from './auth';
import { login, registerStaff } from './auth';
import type { PasswordResetDeps } from './passwordReset';
import { computeResetCodeVerifier, requestPasswordReset, resetPasswordWithCode } from './passwordReset';
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
  /** login/registerStaff用。再設定側はセッションを直接触らないので依存に持たない。 */
  let authDeps: AuthDeps;
  let sessions: FakeSessionRepository;
  let mailer: FakeMailer;
  let tenantId: string;
  let staffId: string;

  beforeEach(async () => {
    mailer = new FakeMailer();
    sessions = new FakeSessionRepository();
    deps = {
      tenants: new FakeTenantRepository(),
      // 本物の実装と同じく、パスワードの差し替えと同じ操作でセッションを消させる。
      staff: new FakeStaffRepository(sessions),
      passwordResetCodes: new FakePasswordResetCodeRepository(),
      passwordHasher: new FakePasswordHasherPort(),
      mailer,
      resetCodePepper: 'test-pepper',
    };
    authDeps = { ...deps, sessions };
    const tenant = await deps.tenants.create({ name: 'テスト法人', slug: TENANT_SLUG });
    tenantId = tenant.id;
    const created = await registerStaff(authDeps, {
      tenantId,
      name: '佐藤 花子',
      email: EMAIL,
      password: 'original-password',
      isAdmin: false,
    });
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

    const after = await login(authDeps, { tenantSlug: TENANT_SLUG, email: EMAIL, password: NEW_PASSWORD });
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

  /**
   * コードの消費とパスワードの書き込みを1つのトランザクションにまとめられない
   * (別リポジトリなので)ため、書き込み側に楽観ロックを置いている。その効きを固定する。
   *
   * ここが抜けると、端末を紛失したスタッフを管理者が締め出しても、生きている
   * 再設定コードを持っている側があとから自分のパスワードへ巻き戻せてしまう。
   */
  it('コードを使ってから書き込むまでに別経路がパスワードを差し替えていたら、再設定を捨てる', async () => {
    await requestPasswordReset(deps, { tenantSlug: TENANT_SLUG, email: EMAIL });
    const code = codeFromMail(mailer);

    // コードの消費直後に管理者が初期パスワードを再発行した、という割り込みを再現する。
    const codes = deps.passwordResetCodes;
    const consume = codes.verifyAndConsume.bind(codes);
    codes.verifyAndConsume = async (input) => {
      const outcome = await consume(input);
      await deps.staff.replacePassword({
        tenantId,
        staffId,
        passwordHash: 'HASH:admin-reissued',
        mustChangePassword: true,
        revokeSessions: true,
      });
      return outcome;
    };

    const result = await resetPasswordWithCode(deps, {
      tenantSlug: TENANT_SLUG,
      email: EMAIL,
      code,
      newPassword: NEW_PASSWORD,
    });
    expect(result).toEqual({ ok: false, reason: 'invalid_code' });

    // 管理者が発行したほうが残る(再設定に上書きされていない)。
    const record = await deps.staff.findById(tenantId, staffId);
    expect(record?.passwordHash).toBe('HASH:admin-reissued');
    expect(record?.mustChangePassword).toBe(true);

    const after = await login(authDeps, { tenantSlug: TENANT_SLUG, email: EMAIL, password: NEW_PASSWORD });
    expect(after.ok).toBe(false);
  });

  /**
   * 書き込みが失敗したときに「パスワードだけ変わった」「セッションだけ残った」という
   * 中途半端な状態を残さないこと。コードは消費済みになるが、それは再発行でやり直せる。
   */
  it('セッション破棄が失敗したらパスワードも書き換えない', async () => {
    await requestPasswordReset(deps, { tenantSlug: TENANT_SLUG, email: EMAIL });
    const code = codeFromMail(mailer);
    await login(authDeps, { tenantSlug: TENANT_SLUG, email: EMAIL, password: 'original-password' });
    const before = await deps.staff.findById(tenantId, staffId);

    sessions.deleteAllForStaff = async () => {
      throw new Error('セッションの破棄に失敗しました');
    };

    await expect(
      resetPasswordWithCode(deps, {
        tenantSlug: TENANT_SLUG,
        email: EMAIL,
        code,
        newPassword: NEW_PASSWORD,
      }),
    ).rejects.toThrow('セッションの破棄に失敗しました');

    // パスワードは元のまま。新しいパスワードでは入れない。
    const after = await deps.staff.findById(tenantId, staffId);
    expect(after?.passwordHash).toBe(before?.passwordHash);
  });

  it('パスワードの書き込みが失敗したら元のパスワードのまま残る', async () => {
    await requestPasswordReset(deps, { tenantSlug: TENANT_SLUG, email: EMAIL });
    const code = codeFromMail(mailer);
    const before = await deps.staff.findById(tenantId, staffId);

    deps.staff.replacePassword = async () => {
      throw new Error('パスワードの書き込みに失敗しました');
    };

    await expect(
      resetPasswordWithCode(deps, {
        tenantSlug: TENANT_SLUG,
        email: EMAIL,
        code,
        newPassword: NEW_PASSWORD,
      }),
    ).rejects.toThrow('パスワードの書き込みに失敗しました');

    const after = await deps.staff.findById(tenantId, staffId);
    expect(after?.passwordHash).toBe(before?.passwordHash);
    expect(after?.mustChangePassword).toBe(false);
  });

  it('再設定すると既存のログインを全て切る', async () => {
    await login(authDeps, { tenantSlug: TENANT_SLUG, email: EMAIL, password: 'original-password' });
    await login(authDeps, { tenantSlug: TENANT_SLUG, email: EMAIL, password: 'original-password' });
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

/**
 * 6桁のコードは100万通りしかない。単純なハッシュをDBに置くと、DBが漏れた時点で
 * 全パターンを試して有効なコードを復元できてしまう。DBに置かないペッパーが
 * 必要な形(HMAC)になっていることを固定する。
 */
describe('computeResetCodeVerifier', () => {
  it('ペッパーが違えば別の値になる', () => {
    expect(computeResetCodeVerifier('pepper-a', '123456')).not.toBe(
      computeResetCodeVerifier('pepper-b', '123456'),
    );
  });

  it('ペッパー無しのSHA-256とは一致しない(総当たりで逆算できない)', () => {
    const plainSha256 = createHash('sha256').update('123456', 'utf8').digest('hex');
    expect(computeResetCodeVerifier('pepper-a', '123456')).not.toBe(plainSha256);
  });

  it('同じペッパー・同じコードなら同じ値になる', () => {
    expect(computeResetCodeVerifier('pepper-a', '123456')).toBe(
      computeResetCodeVerifier('pepper-a', '123456'),
    );
  });
});
