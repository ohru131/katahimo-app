import {
  createStaffWithInitialPassword,
  listActiveStaffForAdmin,
  listStaffForAdmin,
  resetStaffPasswordByAdmin,
  updateStaffByAdmin,
} from '@katahimo/core';
import { Hono } from 'hono';
import type { Container } from '../container';
import { getAuthenticatedSession } from '../session';

/** 'YYYY-MM-DD' か、在籍中に戻すnullか。 */
function parseRetirementDate(value: unknown): { ok: true; value: string | null } | { ok: false } {
  if (value === null) return { ok: true, value: null };
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return { ok: false };
  return { ok: true, value };
}

export function createStaffRoutes(container: Container) {
  const app = new Hono();

  /**
   * 管理者向け「対象スタッフ」一覧(退職者を除く)。予定/勤怠タブの管理者用スタッフ選択に使う。
   * 管理者以外が呼んだ場合は空配列を返す(GAS版getActiveStaffNamesForAdminと同じ挙動)。
   */
  app.get('/', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);
    if (!session.isAdmin) return c.json({ staff: [] });

    const staff = await listActiveStaffForAdmin(container, session.tenantId);
    return c.json({ staff });
  });

  /**
   * 管理者のスタッフ管理画面用。退職済みも含む全件を返す。
   *
   * 「対象スタッフ」セレクタ用の `GET /` と用途が違う(あちらは退職者を除いた氏名だけ)ので
   * 別ルートにしている。管理者以外は空配列ではなく403にする。閲覧できないことを
   * はっきりさせたいのと、こちらはメールアドレスを含むため。
   */
  app.get('/admin', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);
    if (!session.isAdmin) return c.json({ code: 'forbidden', message: '権限がありません' }, 403);

    return c.json({ staff: await listStaffForAdmin(container, session.tenantId) });
  });

  /** 管理者によるスタッフ登録。初期パスワードを発行して本人のメールへ送る。 */
  app.post('/admin', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);
    if (!session.isAdmin) return c.json({ code: 'forbidden', message: '権限がありません' }, 403);

    const body = (await c.req.json().catch(() => null)) as {
      name?: unknown;
      email?: unknown;
      isAdmin?: unknown;
    } | null;
    if (!body || typeof body.name !== 'string' || typeof body.email !== 'string') {
      return c.json({ success: false, message: 'name, email が必要です' }, 400);
    }

    const result = await createStaffWithInitialPassword(container, session.tenantId, {
      name: body.name,
      email: body.email,
      isAdmin: body.isAdmin === true,
    });
    if (!result.ok) {
      const message =
        result.reason === 'email_taken'
          ? 'そのメールアドレスは既に登録されています'
          : '氏名とメールアドレスを正しく入力してください';
      return c.json({ success: false, message }, 400);
    }
    return c.json({ success: true, staffId: result.staffId });
  });

  /** 管理者によるスタッフ情報(氏名・権限・退職日)の更新。 */
  app.patch('/admin/:staffId', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);
    if (!session.isAdmin) return c.json({ code: 'forbidden', message: '権限がありません' }, 403);

    const body = (await c.req.json().catch(() => null)) as {
      name?: unknown;
      isAdmin?: unknown;
      retirementDate?: unknown;
    } | null;
    if (!body) return c.json({ success: false, message: 'リクエストの形式が不正です' }, 400);

    // 指定された項目だけを渡す。retirementDateはnullが「在籍中に戻す」の意味を持つので、
    // 「キーが無い(変更しない)」と区別する必要がある。
    const patch: { name?: string; isAdmin?: boolean; retirementDate?: string | null } = {};
    if (body.name !== undefined) {
      if (typeof body.name !== 'string') return c.json({ success: false, message: 'nameが不正です' }, 400);
      patch.name = body.name;
    }
    if (body.isAdmin !== undefined) {
      if (typeof body.isAdmin !== 'boolean') {
        return c.json({ success: false, message: 'isAdminが不正です' }, 400);
      }
      patch.isAdmin = body.isAdmin;
    }
    if (body.retirementDate !== undefined) {
      const parsed = parseRetirementDate(body.retirementDate);
      if (!parsed.ok) {
        return c.json({ success: false, message: '退職日はYYYY-MM-DD形式で指定してください' }, 400);
      }
      patch.retirementDate = parsed.value;
    }

    const result = await updateStaffByAdmin(
      container,
      session.tenantId,
      session.staffId,
      c.req.param('staffId'),
      patch,
    );
    if (!result.ok) {
      const message =
        result.reason === 'not_found'
          ? 'スタッフが見つかりません'
          : result.reason === 'cannot_change_own_role'
            ? '自分自身の管理者権限を外すこと・自分を退職扱いにすることはできません'
            : '入力内容を確認してください';
      return c.json({ success: false, message }, result.reason === 'not_found' ? 404 : 400);
    }
    return c.json({ success: true });
  });

  /** 管理者による初期パスワードの再発行。再設定メールが届かない場合の逃げ道。 */
  app.post('/admin/:staffId/reset-password', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);
    if (!session.isAdmin) return c.json({ code: 'forbidden', message: '権限がありません' }, 403);

    const result = await resetStaffPasswordByAdmin(container, session.tenantId, c.req.param('staffId'));
    if (!result.ok) return c.json({ success: false, message: 'スタッフが見つかりません' }, 404);
    return c.json({ success: true });
  });

  return app;
}
