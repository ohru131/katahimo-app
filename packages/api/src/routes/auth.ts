import {
  changePassword,
  login,
  MIN_PASSWORD_LENGTH,
  requestPasswordReset,
  resetPasswordWithCode,
} from '@katahimo/core';
import { Hono } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import type { Container } from '../container';
import { getAuthenticatedSession, SESSION_COOKIE_NAME } from '../session';

interface LoginBody {
  tenantSlug?: unknown;
  email?: unknown;
  password?: unknown;
}

export function createAuthRoutes(container: Container, isProduction: boolean) {
  const app = new Hono();

  app.post('/login', async (c) => {
    const body = (await c.req.json().catch(() => null)) as LoginBody | null;
    if (
      !body ||
      typeof body.tenantSlug !== 'string' ||
      typeof body.email !== 'string' ||
      typeof body.password !== 'string'
    ) {
      return c.json({ code: 'validation_failed', message: 'tenantSlug, email, password が必要です' }, 400);
    }

    const result = await login(container, {
      tenantSlug: body.tenantSlug,
      email: body.email,
      password: body.password,
    });

    if (!result.ok) {
      // テナント有無・認証情報の正誤いずれも同一のstatus/messageにし、
      // ステータスコードの違いからテナントslugの存在を推測できないようにする。
      return c.json({ code: 'unauthenticated', message: 'メールアドレスまたはパスワードが違います' }, 401);
    }

    setCookie(c, SESSION_COOKIE_NAME, result.sessionCookieValue, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'Lax',
      path: '/',
      expires: result.expiresAt,
    });

    return c.json({ staff: result.staff });
  });

  /**
   * パスワード再設定コードの発行。GAS版 Auth.js requestPasswordReset 相当。
   *
   * 宛先が存在するかどうかにかかわらず常に同じ応答を返す。ここで結果を出し分けると、
   * 誰でも「このメールアドレスがこの事業所に登録されているか」を確かめられてしまう
   * (GAS版はこれを返しており、ユーザー列挙ができる状態だった)。
   */
  app.post('/forgot-password', async (c) => {
    const body = (await c.req.json().catch(() => null)) as LoginBody | null;
    if (!body || typeof body.tenantSlug !== 'string' || typeof body.email !== 'string') {
      return c.json({ code: 'validation_failed', message: 'tenantSlug, email が必要です' }, 400);
    }
    await requestPasswordReset(container, { tenantSlug: body.tenantSlug, email: body.email });
    return c.json({ success: true });
  });

  /** 認証コードによるパスワード再設定。GAS版 Auth.js resetPasswordWithCode 相当。 */
  app.post('/reset-password', async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      tenantSlug?: unknown;
      email?: unknown;
      code?: unknown;
      newPassword?: unknown;
    } | null;
    if (
      !body ||
      typeof body.tenantSlug !== 'string' ||
      typeof body.email !== 'string' ||
      typeof body.code !== 'string' ||
      typeof body.newPassword !== 'string'
    ) {
      return c.json({ success: false, message: 'tenantSlug, email, code, newPassword が必要です' }, 400);
    }

    const result = await resetPasswordWithCode(container, {
      tenantSlug: body.tenantSlug,
      email: body.email,
      code: body.code,
      newPassword: body.newPassword,
    });
    if (!result.ok) {
      const message =
        result.reason === 'weak_password'
          ? `パスワードは${MIN_PASSWORD_LENGTH}文字以上にしてください`
          : '認証コードが正しくないか、有効期限が切れています';
      return c.json({ success: false, message }, 400);
    }
    return c.json({ success: true });
  });

  app.get('/me', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);
    return c.json({ staff: session });
  });

  app.post('/logout', (c) => {
    deleteCookie(c, SESSION_COOKIE_NAME, { path: '/' });
    return c.json({ ok: true });
  });

  /** ログイン中スタッフ自身のパスワード変更。GAS版Auth.js changePassword相当。 */
  app.post('/change-password', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);

    const body = (await c.req.json().catch(() => null)) as {
      currentPassword?: unknown;
      newPassword?: unknown;
    } | null;
    if (
      !body ||
      typeof body.currentPassword !== 'string' ||
      typeof body.newPassword !== 'string' ||
      !body.newPassword
    ) {
      return c.json({ success: false, message: 'currentPassword, newPassword が必要です' }, 400);
    }

    const result = await changePassword(
      container,
      session.tenantId,
      session.staffId,
      body.currentPassword,
      body.newPassword,
    );
    if (!result.ok) {
      const message =
        result.reason === 'incorrect_current_password'
          ? '現在のパスワードが正しくありません'
          : result.reason === 'weak_password'
            ? `パスワードは${MIN_PASSWORD_LENGTH}文字以上にしてください`
            : 'セッションが無効です';
      return c.json({ success: false, message }, 400);
    }
    return c.json({ success: true });
  });

  return app;
}
