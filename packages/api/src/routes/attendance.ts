import {
  getAttendanceDay,
  getAttendanceMonth,
  getAttendanceScheduleEvents,
  saveAttendanceDay,
} from '@katahimo/core';
import type { AttendanceRowData } from '@katahimo/core/domain';
import { attendanceRowDataSchema, MAX_OFFICE_WORK, MAX_VISITS } from '@katahimo/shared';
import { Hono } from 'hono';
import type { Container } from '../container';
import { getAuthenticatedSession, resolveAttendanceTargetStaffId } from '../session';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const YEAR_MONTH_PATTERN = /^\d{4}-\d{2}$/;
/** 1リクエストで取得できる日数の上限。GAS版PastSchedule.jsのPAST_SCHEDULE_WEEK_MAX_DAYSと同じ考え方。 */
const WEEK_RANGE_MAX_DAYS = 31;

type RowDataValidation =
  | { ok: true; rowData: AttendanceRowData }
  | { ok: false; message: string; fields?: Record<string, string> };

/**
 * リクエストのrowDataを attendanceRowDataSchema(@katahimo/shared)で検証する。
 * どのフィールドが悪いかクライアントに分かるように、zodのissueをfields(パス→メッセージ)に
 * 詰めて返す(apiErrorSchema.fields、packages/shared/src/contracts/common.ts参照)。
 *
 * 件数の上限(MAX_VISITS/MAX_OFFICE_WORK)はattendanceRowDataSchema自体には無い
 * (データの形としては訪問件数に上限を持たせない、というdoc/14 §2の判断)。上限チェックは
 * アプリの入口であるここで行い、超えた場合は理由と解消時期が分かるメッセージで拒否する。
 * 黙って4件目以降を捨てると、給与に直結する値が気付かれないまま失われるため。
 */
function validateRowData(input: unknown): RowDataValidation {
  const parsed = attendanceRowDataSchema.safeParse(input);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      fields[issue.path.length > 0 ? issue.path.join('.') : '(root)'] = issue.message;
    }
    return { ok: false, message: 'rowDataの形式が正しくありません', fields };
  }

  const { visits, officeWork } = parsed.data;
  if (visits && visits.length > MAX_VISITS) {
    return {
      ok: false,
      message:
        `訪問は${MAX_VISITS}件までです(勤怠計算がGAS版と一致することを保証している範囲。` +
        `${MAX_VISITS + 1}件以上は段階2の正規化で対応する)`,
      fields: { visits: `${MAX_VISITS}件を超えています` },
    };
  }
  if (officeWork && officeWork.length > MAX_OFFICE_WORK) {
    return {
      ok: false,
      message:
        `事務作業は${MAX_OFFICE_WORK}件までです(勤怠計算がGAS版と一致することを保証している範囲。` +
        `${MAX_OFFICE_WORK + 1}件以上は段階2の正規化で対応する)`,
      fields: { officeWork: `${MAX_OFFICE_WORK}件を超えています` },
    };
  }

  return { ok: true, rowData: parsed.data };
}

export function createAttendanceRoutes(container: Container) {
  const app = new Hono();

  /**
   * 指定日の勤怠(入力列+派生値)を取得する。staffIdクエリは管理者だけが有効
   * (resolveAttendanceTargetStaffId参照)。
   */
  app.get('/day', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);

    const date = c.req.query('date');
    if (!date || !DATE_PATTERN.test(date)) {
      return c.json(
        { code: 'validation_failed', message: 'date(YYYY-MM-DD)クエリパラメータが必要です' },
        400,
      );
    }

    const staffId = resolveAttendanceTargetStaffId(session, c.req.query('staffId'));
    const result = await getAttendanceDay(container, session.tenantId, staffId, date);
    return c.json({ attendance: result });
  });

  /** 指定日の入力列を丸ごと保存する。 */
  app.put('/day', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);

    const body = await c.req.json().catch(() => null);
    const date = body?.date;
    if (typeof date !== 'string' || !DATE_PATTERN.test(date)) {
      return c.json({ code: 'validation_failed', message: 'date(YYYY-MM-DD)が必要です' }, 400);
    }

    const validation = validateRowData(body?.rowData);
    if (!validation.ok) {
      return c.json(
        { code: 'validation_failed', message: validation.message, fields: validation.fields },
        400,
      );
    }

    const staffId = resolveAttendanceTargetStaffId(session, body?.staffId);
    const result = await saveAttendanceDay(container, session.tenantId, staffId, date, validation.rowData);
    return c.json({ attendance: result });
  });

  /** 指定月('YYYY-MM')の勤怠を集計して返す。 */
  app.get('/month', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);

    const yearMonth = c.req.query('month');
    if (!yearMonth || !YEAR_MONTH_PATTERN.test(yearMonth)) {
      return c.json({ code: 'validation_failed', message: 'month(YYYY-MM)クエリパラメータが必要です' }, 400);
    }

    const staffId = resolveAttendanceTargetStaffId(session, c.req.query('staffId'));
    const result = await getAttendanceMonth(container, session.tenantId, staffId, yearMonth);
    return c.json({ month: result });
  });

  /**
   * 指定期間('YYYY-MM-DD'両端含む)の勤怠を、週間予定UI(Googleカレンダー風表示)用の
   * イベント配列として返す。実際のGoogleカレンダーからではなく、保存済みの出勤簿の記録を
   * そのままイベント化しているだけの閲覧専用API(GAS版PastSchedule.jsのgetWeeklyScheduleForStaff
   * と同じ設計)。
   */
  app.get('/week', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);

    const start = c.req.query('start');
    const end = c.req.query('end');
    if (!start || !end || !DATE_PATTERN.test(start) || !DATE_PATTERN.test(end)) {
      return c.json(
        { code: 'validation_failed', message: 'start・end(YYYY-MM-DD)クエリパラメータが必要です' },
        400,
      );
    }
    const dayCount = Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1;
    if (Number.isNaN(dayCount) || dayCount < 1 || dayCount > WEEK_RANGE_MAX_DAYS) {
      return c.json(
        {
          code: 'validation_failed',
          message: `取得できる日数の上限(${WEEK_RANGE_MAX_DAYS}日)を超えています`,
        },
        400,
      );
    }

    const staffId = resolveAttendanceTargetStaffId(session, c.req.query('staffId'));
    const events = await getAttendanceScheduleEvents(container, session.tenantId, staffId, start, end);
    return c.json({ events });
  });

  return app;
}
