import {
  generateAccidentReportDraft,
  generateDailyReportDraft,
  getCustomerHistory,
  saveAccidentReport,
  saveDailyReport,
  sendVisitCompleteNotification,
} from '@katahimo/core';
import { couponIdsSchema } from '@katahimo/shared';
import { Hono } from 'hono';
import type { Container } from '../container';
import { getAuthenticatedSession, resolveReportTargetStaffId } from '../session';

const HISTORY_LIMIT = 5;

/**
 * 事故報告/ヒヤリハットの種別。packages/db/src/schema/accidentReports.ts の
 * accident_reports_report_type_check と一致させる(doc/14 D項)。DB側の制約は「最後の砦」で、
 * ここで弾いておかないとGAS版のシートに任意の文字列がそのまま書き出されてしまう。
 */
export const ACCIDENT_REPORT_TYPES = ['事故報告', 'ヒヤリハット'] as const;
export type AccidentReportType = (typeof ACCIDENT_REPORT_TYPES)[number];

export function isAccidentReportType(value: unknown): value is AccidentReportType {
  return (ACCIDENT_REPORT_TYPES as readonly unknown[]).includes(value);
}

/**
 * PSI/満足度評価。packages/db/src/schema/dailyReports.ts の
 * daily_reports_risk_rating_check/es_rating_check と一致させる(doc/14 D項)。
 */
export function isValidRating(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5;
}

export function createReportRoutes(container: Container) {
  const app = new Hono();

  /** 保育日報の下書きをAI生成する(GAS版generateReportWithWarnings相当)。 */
  app.post('/daily/generate', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);

    const body = await c.req.json().catch(() => null);
    if (typeof body?.text !== 'string' || !body.text.trim()) {
      return c.json({ code: 'validation_failed', message: 'text が必要です' }, 400);
    }

    const draft = await generateDailyReportDraft(container, session.tenantId, {
      text: body.text,
      start: typeof body.start === 'string' ? body.start : undefined,
      end: typeof body.end === 'string' ? body.end : undefined,
    });
    return c.json({ draft });
  });

  /** 事故報告/ヒヤリハットの下書きをAI生成する(GAS版generateAccidentReport相当)。 */
  app.post('/accident/generate', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);

    const body = await c.req.json().catch(() => null);
    if (typeof body?.text !== 'string' || !body.text.trim()) {
      return c.json({ code: 'validation_failed', message: 'text が必要です' }, 400);
    }

    const draft = await generateAccidentReportDraft(container, session.tenantId, {
      text: body.text,
      start: typeof body.start === 'string' ? body.start : undefined,
      end: typeof body.end === 'string' ? body.end : undefined,
    });
    return c.json({ draft });
  });

  /** 保育日報を保存する。GAS版Main.js saveReportに対応。 */
  app.post('/daily', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);

    const body = await c.req.json().catch(() => null);
    if (typeof body?.customerId !== 'string' || !body.customerId) {
      return c.json({ code: 'validation_failed', message: 'customerId が必要です' }, 400);
    }
    // undefined/nullは「未評価」として許容する(DB側もNULLABLE)。値がある場合だけ範囲を見る。
    if (body.riskRating != null && !isValidRating(body.riskRating)) {
      return c.json({ code: 'validation_failed', message: 'riskRating は1〜5の整数にしてください' }, 400);
    }
    if (body.esRating != null && !isValidRating(body.esRating)) {
      return c.json({ code: 'validation_failed', message: 'esRating は1〜5の整数にしてください' }, 400);
    }
    // couponIds(doc/14 4.1章)は「文字列かどうか」ではなく実際の形(UUID文字列の配列)を見る。
    // 省略はサーバー側で「クーポン無し」として扱う(空配列)。
    let couponIds: string[] = [];
    if (body.couponIds !== undefined) {
      const parsed = couponIdsSchema.safeParse(body.couponIds);
      if (!parsed.success) {
        return c.json(
          { code: 'validation_failed', message: 'couponIds はUUID文字列の配列にしてください' },
          400,
        );
      }
      couponIds = parsed.data;
    }

    const staffId = resolveReportTargetStaffId(session, body.staffId);
    try {
      const report = await saveDailyReport(container, session.tenantId, {
        reportId: typeof body.reportId === 'string' ? body.reportId : undefined,
        staffId,
        customerId: body.customerId,
        reportDate: typeof body.reportDate === 'string' ? body.reportDate : undefined,
        startTime: typeof body.startTime === 'string' ? body.startTime : '',
        endTime: typeof body.endTime === 'string' ? body.endTime : '',
        inputText: typeof body.inputText === 'string' ? body.inputText : '',
        internalText: typeof body.internalText === 'string' ? body.internalText : '',
        customerText: typeof body.customerText === 'string' ? body.customerText : '',
        riskRating: isValidRating(body.riskRating) ? body.riskRating : null,
        esRating: isValidRating(body.esRating) ? body.esRating : null,
        couponIds,
      });
      return c.json({ success: true, report });
    } catch (e) {
      return c.json({ success: false, message: e instanceof Error ? e.message : String(e) }, 400);
    }
  });

  /** 事故報告/ヒヤリハットを保存する。GAS版Main.js saveAccidentReportに対応。 */
  app.post('/accident', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);

    const body = await c.req.json().catch(() => null);
    if (typeof body?.customerId !== 'string' || !body.customerId) {
      return c.json({ code: 'validation_failed', message: 'customerId が必要です' }, 400);
    }
    // undefinedは「省略」として許容する(saveAccidentReport側で'事故報告'にフォールバックする)。
    // 値がある場合は、文字列かどうかではなく許可された2値かどうかを見る(doc/14 D項)。
    if (body.reportType !== undefined && !isAccidentReportType(body.reportType)) {
      return c.json(
        {
          code: 'validation_failed',
          message: `reportType は ${ACCIDENT_REPORT_TYPES.join('・')} のいずれかにしてください`,
        },
        400,
      );
    }

    const staffId = resolveReportTargetStaffId(session, body.staffId);
    try {
      const report = await saveAccidentReport(container, session.tenantId, {
        reportId: typeof body.reportId === 'string' ? body.reportId : undefined,
        staffId,
        customerId: body.customerId,
        reportType: isAccidentReportType(body.reportType) ? body.reportType : undefined,
        targetName: typeof body.targetName === 'string' ? body.targetName : '',
        targetDob: typeof body.targetDob === 'string' ? body.targetDob : '',
        occurrenceTime: typeof body.occurrenceTime === 'string' ? body.occurrenceTime : '',
        location: typeof body.location === 'string' ? body.location : '',
        accidentContent: typeof body.accidentContent === 'string' ? body.accidentContent : '',
        situation: typeof body.situation === 'string' ? body.situation : '',
        immediateResponse: typeof body.immediateResponse === 'string' ? body.immediateResponse : '',
        parentCorrespondence: typeof body.parentCorrespondence === 'string' ? body.parentCorrespondence : '',
        diagnosisTreatment: typeof body.diagnosisTreatment === 'string' ? body.diagnosisTreatment : '',
        prevention: typeof body.prevention === 'string' ? body.prevention : '',
        inputText: typeof body.inputText === 'string' ? body.inputText : '',
      });
      return c.json({ success: true, report });
    } catch (e) {
      return c.json({ success: false, message: e instanceof Error ? e.message : String(e) }, 400);
    }
  });

  /** 「訪問完了」通知のみ送信する(DB書き込みなし)。GAS版sendVisitComplete相当。 */
  app.post('/visit-complete', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);

    const body = await c.req.json().catch(() => null);
    if (
      typeof body?.customerId !== 'string' ||
      typeof body?.visitDate !== 'string' ||
      typeof body?.startTime !== 'string' ||
      typeof body?.endTime !== 'string'
    ) {
      return c.json({ success: false, message: 'customerId, visitDate, startTime, endTime が必要です' }, 400);
    }

    const staffId = resolveReportTargetStaffId(session, body.staffId);
    try {
      await sendVisitCompleteNotification(container, session.tenantId, {
        staffId,
        customerId: body.customerId,
        visitDate: body.visitDate,
        startTime: body.startTime,
        endTime: body.endTime,
      });
      return c.json({ success: true });
    } catch (e) {
      return c.json({ success: false, message: e instanceof Error ? e.message : String(e) }, 400);
    }
  });

  /** 顧客の活動記録(日報+事故報告)を新しい順に取得する。GAS版getCustomerReports相当。 */
  app.get('/history', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);

    const customerId = c.req.query('customerId');
    if (!customerId) {
      return c.json({ code: 'validation_failed', message: 'customerId クエリパラメータが必要です' }, 400);
    }
    const beforeParam = c.req.query('before');
    const before = beforeParam ? new Date(beforeParam) : null;
    if (before && Number.isNaN(before.getTime())) {
      return c.json({ code: 'validation_failed', message: 'before は有効なISO日時にしてください' }, 400);
    }

    const items = await getCustomerHistory(container, session.tenantId, customerId, before, HISTORY_LIMIT);
    return c.json({ items });
  });

  return app;
}
