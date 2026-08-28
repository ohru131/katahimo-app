import { resolveSession } from '@katahimo/core';
import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Container } from './container';

export const SESSION_COOKIE_NAME = 'katahimo_session';

/**
 * リクエストのCookieからログイン中ユーザーを解決する唯一の入口。
 *
 * CLAUDE.mdのセキュリティパターン(クライアント指定のスタッフ名/テナントIDを一切信用しない)
 * をAPI全体で1箇所に集約するためのヘルパー。各ルートはこの戻り値の`tenantId`/`staffId`だけを
 * 使い、リクエストボディやクエリパラメータのtenantId/staffId(があっても)は無視すること。
 */
export async function getAuthenticatedSession(c: Context, container: Container) {
  const cookieValue = getCookie(c, SESSION_COOKIE_NAME);
  if (!cookieValue) return null;
  return resolveSession(container, cookieValue);
}
