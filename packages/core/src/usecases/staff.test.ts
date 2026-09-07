import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthDeps } from './auth';
import { changePassword, login, registerStaff } from './auth';
import { requestPasswordReset, resetPasswordWithCode } from './passwordReset';
import type { StaffAdminDeps, StaffDeps } from './staff';
import {
  createStaffWithInitialPassword,
  listActiveStaffForAdmin,
  listStaffForAdmin,
  resetStaffPasswordByAdmin,
  updateStaffByAdmin,
} from './staff';
import {
  FakeMailer,
  FakePasswordHasherPort,
  FakePasswordResetCodeRepository,
  FakeSessionRepository,
  FakeStaffRepository,
  FakeTenantRepository,
} from './testDoubles';

describe('listActiveStaffForAdmin', () => {
  let deps: StaffDeps;
  let authDeps: AuthDeps;
  let staffRepo: FakeStaffRepository;
  const tenantId = 'tenant-1';

  beforeEach(() => {
    staffRepo = new FakeStaffRepository();
    deps = { staff: staffRepo };
    authDeps = {
      tenants: new FakeTenantRepository(),
      staff: staffRepo,
      sessions: new FakeSessionRepository(),
      passwordResetCodes: new FakePasswordResetCodeRepository(),
      passwordHasher: new FakePasswordHasherPort(),
    };
  });

  it('氏名を復号し、単純な文字列比較で並び替えて返す', async () => {
    await registerStaff(authDeps, {
      tenantId,
      name: '鈴木 三郎',
      email: 'suzuki@example.com',
      password: 'pw',
      isAdmin: false,
    });
    await registerStaff(authDeps, {
      tenantId,
      name: '佐藤 花子',
      email: 'sato@example.com',
      password: 'pw',
      isAdmin: true,
    });

    const result = await listActiveStaffForAdmin(deps, tenantId);
    expect(result.map((s) => s.name)).toEqual(['佐藤 花子', '鈴木 三郎']);
  });

  it('退職済み(退職日が今日以前)のスタッフは除外する', async () => {
    const active = await registerStaff(authDeps, {
      tenantId,
      name: '田中 一郎',
      email: 'tanaka@example.com',
      password: 'pw',
      isAdmin: false,
    });
    const retired = await registerStaff(authDeps, {
      tenantId,
      name: '高橋 四郎',
      email: 'takahashi@example.com',
      password: 'pw',
      isAdmin: false,
    });
    staffRepo.setRetirementDateForTest(tenantId, retired.id, '2020-01-01');

    const result = await listActiveStaffForAdmin(deps, tenantId);
    expect(result.map((s) => s.id)).toEqual([active.id]);
  });

  it('別テナントのスタッフは含めない', async () => {
    await registerStaff(authDeps, {
      tenantId: 'tenant-1',
      name: '佐藤 花子',
      email: 'sato@example.com',
      password: 'pw',
      isAdmin: false,
    });
    await registerStaff(authDeps, {
      tenantId: 'tenant-2',
      name: '鈴木 三郎',
      email: 'suzuki@example.com',
      password: 'pw',
      isAdmin: false,
    });

    const result = await listActiveStaffForAdmin(deps, 'tenant-1');
    expect(result.map((s) => s.name)).toEqual(['佐藤 花子']);
  });
});

/**
 * 管理者によるスタッフ登録・更新。認証情報を触るうえ、間違えると
 * 「誰も管理者設定に入れない」といった詰み方をするため、拒否すべき操作を厚く見る。
 */
describe('管理者によるスタッフ管理', () => {
  let deps: StaffAdminDeps;
  // 認証系のusecase(login/changePassword)は StaffAdminDeps に含まれない依存
  // (tenants/passwordResetCodes)も要るので、組み立て時のものをそのまま持っておく。
  let authDeps: AuthDeps;
  let mailer: FakeMailer;
  let tenantId: string;
  let adminStaffId: string;

  beforeEach(async () => {
    mailer = new FakeMailer();
    authDeps = {
      tenants: new FakeTenantRepository(),
      staff: new FakeStaffRepository(),
      sessions: new FakeSessionRepository(),
      passwordResetCodes: new FakePasswordResetCodeRepository(),
      passwordHasher: new FakePasswordHasherPort(),
    };
    deps = { ...authDeps, mailer };
    const tenant = await authDeps.tenants.create({ name: 'テスト法人', slug: 'admin-tenant' });
    tenantId = tenant.id;
    const admin = await registerStaff(authDeps, {
      tenantId,
      name: '管理 太郎',
      email: 'admin@example.com',
      password: 'admin-password',
      isAdmin: true,
    });
    adminStaffId = admin.id;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** 初期パスワードはメール本文にしか出ないので、そこから取り出す。 */
  function initialPasswordFromMail(): string {
    const match = mailer.last?.body.match(/初期パスワード: (\S+)/);
    if (!match?.[1]) throw new Error(`初期パスワードがメール本文にありません: ${mailer.last?.body}`);
    return match[1];
  }

  it('初期パスワードをメールで送り、それでログインできる', async () => {
    const created = await createStaffWithInitialPassword(deps, tenantId, {
      name: '新人 次郎',
      email: 'Jiro@Example.com',
      isAdmin: false,
    });
    expect(created.ok).toBe(true);
    expect(mailer.last?.to).toBe('jiro@example.com');

    const result = await login(authDeps, {
      tenantSlug: 'admin-tenant',
      email: 'jiro@example.com',
      password: initialPasswordFromMail(),
    });
    expect(result.ok).toBe(true);
    // 初期パスワードのままなので、画面側に変更を強制させるフラグが立っている。
    if (result.ok) expect(result.staff.mustChangePassword).toBe(true);
  });

  it('本人がパスワードを変更すると強制変更フラグが下りる', async () => {
    const created = await createStaffWithInitialPassword(deps, tenantId, {
      name: '新人 次郎',
      email: 'jiro@example.com',
      isAdmin: false,
    });
    if (!created.ok) throw new Error('前提の登録に失敗しました');

    const changed = await changePassword(
      authDeps,
      tenantId,
      created.staffId,
      initialPasswordFromMail(),
      'my-own-password',
    );
    expect(changed).toEqual({ ok: true });

    const result = await login(authDeps, {
      tenantSlug: 'admin-tenant',
      email: 'jiro@example.com',
      password: 'my-own-password',
    });
    if (!result.ok) throw new Error('変更後のログインに失敗しました');
    expect(result.staff.mustChangePassword).toBe(false);
  });

  it('同じメールアドレスは登録できない', async () => {
    const result = await createStaffWithInitialPassword(deps, tenantId, {
      name: '重複 三郎',
      email: 'admin@example.com',
      isAdmin: false,
    });
    expect(result).toEqual({ ok: false, reason: 'email_taken' });
    expect(mailer.sent).toHaveLength(0);
  });

  it('氏名が空・メールアドレスの形が違う場合は登録しない', async () => {
    expect(
      await createStaffWithInitialPassword(deps, tenantId, { name: '  ', email: 'a@b.co', isAdmin: false }),
    ).toEqual({ ok: false, reason: 'invalid_input' });
    expect(
      await createStaffWithInitialPassword(deps, tenantId, {
        name: '四郎',
        email: 'not-mail',
        isAdmin: false,
      }),
    ).toEqual({ ok: false, reason: 'invalid_input' });
    expect(mailer.sent).toHaveLength(0);
  });

  it('管理者が自分の管理者権限を外すこと・自分を退職扱いにすることは拒否する', async () => {
    expect(await updateStaffByAdmin(deps, tenantId, adminStaffId, adminStaffId, { isAdmin: false })).toEqual({
      ok: false,
      reason: 'cannot_change_own_role',
    });
    expect(
      await updateStaffByAdmin(deps, tenantId, adminStaffId, adminStaffId, { retirementDate: '2020-01-01' }),
    ).toEqual({ ok: false, reason: 'cannot_change_own_role' });
  });

  it('退職日を過去にするとログインを切る', async () => {
    const created = await createStaffWithInitialPassword(deps, tenantId, {
      name: '退職 五郎',
      email: 'goro@example.com',
      isAdmin: false,
    });
    if (!created.ok) throw new Error('前提の登録に失敗しました');
    await login(authDeps, {
      tenantSlug: 'admin-tenant',
      email: 'goro@example.com',
      password: initialPasswordFromMail(),
    });
    const sessions = deps.sessions as FakeSessionRepository;
    expect(sessions.countForStaff(tenantId, created.staffId)).toBe(1);

    expect(
      await updateStaffByAdmin(deps, tenantId, adminStaffId, created.staffId, {
        retirementDate: '2020-01-01',
      }),
    ).toEqual({ ok: true });
    expect(sessions.countForStaff(tenantId, created.staffId)).toBe(0);
  });

  it('初期パスワードの再発行でログインを切り、新しいパスワードを送る', async () => {
    const created = await createStaffWithInitialPassword(deps, tenantId, {
      name: '再発行 六郎',
      email: 'rokuro@example.com',
      isAdmin: false,
    });
    if (!created.ok) throw new Error('前提の登録に失敗しました');
    const first = initialPasswordFromMail();
    await login(authDeps, {
      tenantSlug: 'admin-tenant',
      email: 'rokuro@example.com',
      password: first,
    });

    expect(await resetStaffPasswordByAdmin(deps, tenantId, created.staffId)).toEqual({
      ok: true,
      mailDelivered: true,
    });
    const second = initialPasswordFromMail();
    expect(second).not.toBe(first);
    expect((deps.sessions as FakeSessionRepository).countForStaff(tenantId, created.staffId)).toBe(0);

    const old = await login(authDeps, {
      tenantSlug: 'admin-tenant',
      email: 'rokuro@example.com',
      password: first,
    });
    expect(old.ok).toBe(false);
  });

  it('メールを送れなくてもアカウントは作られ、再発行を促せる状態になる', async () => {
    // 送信に失敗したのに「作成失敗」と返すと、やり直してもメールアドレス重複で
    // 弾かれるだけで、誰も知らないパスワードのアカウントが残ってしまう。
    const failing = new FakeMailer();
    failing.failNextForTest();
    // 送信失敗はサーバーログに出す設計なので、テスト出力を汚さないよう黙らせる。
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await createStaffWithInitialPassword({ ...deps, mailer: failing }, tenantId, {
      name: '不通 八郎',
      email: 'hachiro@example.com',
      isAdmin: false,
    });
    expect(result).toMatchObject({ ok: true, mailDelivered: false });

    // 同じメールアドレスで作り直せない=アカウントは残っている。
    expect(
      await createStaffWithInitialPassword(deps, tenantId, {
        name: '不通 八郎',
        email: 'hachiro@example.com',
        isAdmin: false,
      }),
    ).toEqual({ ok: false, reason: 'email_taken' });

    // 再発行でメールを送り直せる。
    if (!result.ok) throw new Error('前提の登録に失敗しました');
    expect(await resetStaffPasswordByAdmin(deps, tenantId, result.staffId)).toEqual({
      ok: true,
      mailDelivered: true,
    });
  });

  it('初期パスワードの再発行で、未使用の再設定コードも無効化する', async () => {
    // 残っていると、再発行した初期パスワードを古いコードで上書きできてしまう。
    const created = await createStaffWithInitialPassword(deps, tenantId, {
      name: 'コード 九郎',
      email: 'kuro@example.com',
      isAdmin: false,
    });
    if (!created.ok) throw new Error('前提の登録に失敗しました');

    const resetDeps = { ...deps, ...authDeps, mailer, resetCodePepper: 'test-pepper' };
    await requestPasswordReset(resetDeps, { tenantSlug: 'admin-tenant', email: 'kuro@example.com' });
    const code = mailer.last?.body.match(/認証コード: (\d{6})/)?.[1];
    if (!code) throw new Error('認証コードがメール本文にありません');

    await resetStaffPasswordByAdmin(deps, tenantId, created.staffId);

    expect(
      await resetPasswordWithCode(resetDeps, {
        tenantSlug: 'admin-tenant',
        email: 'kuro@example.com',
        code,
        newPassword: 'code-should-not-work',
      }),
    ).toEqual({ ok: false, reason: 'invalid_code' });
  });

  it('一覧は在籍中を先に、同じ区分では氏名順に並べる', async () => {
    for (const [name, email] of [
      ['山田 花子', 'yamada@example.com'],
      ['青木 一郎', 'aoki@example.com'],
    ] as const) {
      await createStaffWithInitialPassword(deps, tenantId, { name, email, isAdmin: false });
    }
    const yamada = (await listStaffForAdmin(deps, tenantId)).find((s) => s.name === '山田 花子');
    if (!yamada) throw new Error('前提のスタッフが見つかりません');
    await updateStaffByAdmin(deps, tenantId, adminStaffId, yamada.id, { retirementDate: '2020-01-01' });

    const rows = await listStaffForAdmin(deps, tenantId);
    expect(rows.map((r) => r.name)).toEqual(['管理 太郎', '青木 一郎', '山田 花子']);
    expect(rows.at(-1)?.retired).toBe(true);
  });
});
