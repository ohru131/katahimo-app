import { resolveSession } from '@katahimo/core';
import type { ResolvedSession } from '@katahimo/core/usecases';
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

/**
 * 管理者以外は自分自身のstaffIdに強制し、管理者だけが明示的なstaffIdクエリで
 * 他スタッフを指定できるようにする。
 *
 * 移植元: gas-childcare-visit-app/PastSchedule.js の resolvePastScheduleTargetStaffName_
 * (getPastScheduleAccessContext_とセットで使われるパターン)と同じ考え方。この関数は
 * 「管理者が他スタッフの勤怠を閲覧/編集する」機能を追加するたびに複製せず、ここに集約する。
 */
export function resolveAttendanceTargetStaffId(
  session: ResolvedSession,
  requestedStaffId: string | undefined,
): string {
  if (!session.isAdmin) return session.staffId;
  const requested = (requestedStaffId ?? '').trim();
  return requested || session.staffId;
}
