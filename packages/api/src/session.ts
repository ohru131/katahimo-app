import { resolveSession } from '@katahimo/core';
import type { ResolvedSession } from '@katahimo/core/usecases';
import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Container } from './container';

export const SESSION_COOKIE_NAME = 'katahimo_session';

/**
 * 1リクエスト内でのセッション解決結果。
 *
 * 初期パスワードの強制変更チェック(requirePasswordChangeGuard)がミドルウェアで
 * セッションを引くため、そのままだとルート側の解決と合わせて毎回2回DBを引くことになる。
 * Contextはリクエストごとに使い捨てなので、それをキーに結果を覚えておく。
 */
const resolvedSessions = new WeakMap<Context, ResolvedSession | null>();

/**
 * リクエストのCookieからログイン中ユーザーを解決する唯一の入口。
 *
 * CLAUDE.mdのセキュリティパターン(クライアント指定のスタッフ名/テナントIDを一切信用しない)
 * をAPI全体で1箇所に集約するためのヘルパー。各ルートはこの戻り値の`tenantId`/`staffId`だけを
 * 使い、リクエストボディやクエリパラメータのtenantId/staffId(があっても)は無視すること。
 */
export async function getAuthenticatedSession(
  c: Context,
  container: Container,
): Promise<ResolvedSession | null> {
  const cached = resolvedSessions.get(c);
  if (cached !== undefined) return cached;

  const cookieValue = getCookie(c, SESSION_COOKIE_NAME);
  const session = cookieValue ? await resolveSession(container, cookieValue) : null;
  resolvedSessions.set(c, session);
  return session;
}

/**
 * 初期パスワードのままのスタッフに、パスワード変更以外のAPIを使わせない。
 *
 * 画面側だけで変更を促しても、APIを直接叩けば通ってしまう。「変更するまで使えない」を
 * 成り立たせるのはサーバー側なので、全ルートの手前で1箇所だけ見る。
 *
 * ログイン・ログアウト・自分の状態確認・パスワード変更だけは通す
 * (通さないとパスワードを変更する手段が無くなる)。
 */
const PASSWORD_CHANGE_ALLOWED_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/me',
  '/api/auth/change-password',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
]);

export function requirePasswordChangeGuard(container: Container): MiddlewareHandler {
  return async (c, next) => {
    if (PASSWORD_CHANGE_ALLOWED_PATHS.has(new URL(c.req.url).pathname)) return next();

    const session = await getAuthenticatedSession(c, container);
    if (session?.mustChangePassword) {
      return c.json(
        {
          code: 'password_change_required',
          message: '初期パスワードのままです。パスワードを変更してください。',
        },
        403,
      );
    }
    return next();
  };
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

/**
 * 日報/事故報告/領収書登録用。管理者以外は自分自身のstaffIdに強制し、管理者だけが
 * 明示的なstaffId指定で他スタッフの名義の報告を保存できるようにする。
 *
 * GAS版Main.js saveReport/saveAccidentReportの
 * `if (!session.isAdmin || !reportData.staffName) { reportData.staffName = session.name; }`
 * と同じ規則(resolveAttendanceTargetStaffIdと判定ロジックは同一だが、CLAUDE.mdの方針
 * (アクセスコンテキストごとに独立実装する)に沿って報告系専用の関数として分けている)。
 */
export function resolveReportTargetStaffId(
  session: ResolvedSession,
  requestedStaffId: string | undefined,
): string {
  if (!session.isAdmin) return session.staffId;
  const requested = (requestedStaffId ?? '').trim();
  return requested || session.staffId;
}

/**
 * 「予定」タブ用。管理者以外は自分自身のstaffIdに強制し、管理者だけが明示的なstaffId指定で
 * 他スタッフの予定を閲覧できるようにする。
 *
 * 移植元: gas-childcare-visit-app/Schedule.js の resolveScheduleTargetStaffName_と同じ考え方
 * (判定ロジックはresolveAttendanceTargetStaffIdと同一だが、CLAUDE.mdの方針
 * (アクセスコンテキストごとに独立実装する)に沿って予定系専用の関数として分けている)。
 */
export function resolveScheduleTargetStaffId(
  session: ResolvedSession,
  requestedStaffId: string | undefined,
): string {
  if (!session.isAdmin) return session.staffId;
  const requested = (requestedStaffId ?? '').trim();
  return requested || session.staffId;
}
