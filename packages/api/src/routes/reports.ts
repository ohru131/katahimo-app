import {
  type GenerateDailyReportDraftInput,
  generateAccidentReportDraft,
  generateDailyReportDraft,
  getCustomerHistory,
  getReportAiLevelsForStaff,
  getReportUiTexts,
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
 * accident_reports_report_type_check と一致させる(doc/db/guidelines.md §4)。DB側の制約は「最後の砦」で、
 * ここで弾いておかないとGAS版のシートに任意の文字列がそのまま書き出されてしまう。
 */
export const ACCIDENT_REPORT_TYPES = ['事故報告', 'ヒヤリハット'] as const;
export type AccidentReportType = (typeof ACCIDENT_REPORT_TYPES)[number];

/** 外から来た値が区分値(ACCIDENT_REPORT_TYPES)のどちらかかを判定する。 */
export function isAccidentReportType(value: unknown): value is AccidentReportType {
  return (ACCIDENT_REPORT_TYPES as readonly unknown[]).includes(value);
}

/**
 * ストレス度(PSI評価)/満足度評価。packages/db/src/schema/dailyReports.ts の
 * daily_reports_stress_level_check/es_rating_check と一致させる(doc/db/guidelines.md §4)。
 */
export function isValidRating(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5;
}

/**
 * 外から来た値を「UUID等のID文字列 または null」として読む。
 * 空文字は「未選択」と同じ扱いで null にする(画面のセレクトが未選択を空文字で送るため)。
 * 文字列でも null でもない値は undefined を返し、呼び出し側が400にする。
 */
function readOptionalId(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export type ParsedGenerateDailyReportBody =
  | { ok: true; input: Omit<GenerateDailyReportDraftInput, 'staffId'> }
  | { ok: false; message: string };

/**
 * `POST /daily/generate` のリクエストボディを読む。
 *
 * 【ルートから切り出している理由】Honoアプリ全体(認証・Container)を組み立てるテストが
 * このパッケージには無いので、csrf.test.ts と同じ方針で入口の判定だけを純粋関数にして
 * テストできるようにしている。staffId はここでは読まない(セッションと突き合わせて決める値で、
 * リクエストの値をそのまま信用してはいけない。session.ts の resolveReportTargetStaffId が
 * 管理者かどうかを見て決める)。
 */
export function parseGenerateDailyReportBody(body: unknown): ParsedGenerateDailyReportBody {
  const raw = (body ?? {}) as Record<string, unknown>;
  if (typeof raw.text !== 'string' || !raw.text.trim()) {
    return { ok: false, message: 'text が必要です' };
  }
  if (typeof raw.customerId !== 'string' || !raw.customerId.trim()) {
    return { ok: false, message: 'customerId が必要です' };
  }
  const familyMemberId = readOptionalId(raw.familyMemberId);
  if (familyMemberId === undefined) {
    return { ok: false, message: 'familyMemberId は文字列かnullにしてください' };
  }
  // 未評価(null/省略)を許す。値がある場合だけ daily_reports_stress_level_check と同じ範囲を見る。
  if (raw.stressLevel != null && !isValidRating(raw.stressLevel)) {
    return { ok: false, message: 'stressLevel は1〜5の整数にしてください' };
  }
  return {
    ok: true,
    input: {
      text: raw.text,
      start: typeof raw.start === 'string' ? raw.start : undefined,
      end: typeof raw.end === 'string' ? raw.end : undefined,
      reportDate: typeof raw.reportDate === 'string' ? raw.reportDate : undefined,
      customerId: raw.customerId.trim(),
      familyMemberId,
      stressLevel: isValidRating(raw.stressLevel) ? raw.stressLevel : null,
    },
  };
}

/** 日報・事故報告・AI生成・領収書OCRのルートをまとめる。 */
export function createReportRoutes(container: Container) {
  const app = new Hono();

  /**
   * 入力欄のプレースホルダー・記載要領。GAS版 Main.js getUiConfig に対応する。
   * テナントが管理画面で文面を編集していればその版、していなければ既定文面が返る。
   */
  app.get('/ui-texts', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);

    const texts = await getReportUiTexts(container, session.tenantId);
    return c.json(texts);
  });

  /**
   * 教育関心度★・ストレス度(PSI)のテナント設定。一般スタッフ向け(顧客詳細の★設定と、
   * 日報入力画面のPSI判定基準の表示に使う)。行が無いレベルは含まない。
   */
  app.get('/ai-config', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);

    const levels = await getReportAiLevelsForStaff(container, session.tenantId);
    return c.json(levels);
  });

  /** 保育日報の下書きをAI生成する(GAS版generateReportWithWarnings相当)。 */
  app.post('/daily/generate', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);

    const body = await c.req.json().catch(() => null);
    const parsed = parseGenerateDailyReportBody(body);
    if (!parsed.ok) return c.json({ code: 'validation_failed', message: parsed.message }, 400);

    const staffId = resolveReportTargetStaffId(session, body?.staffId);
    try {
      const draft = await generateDailyReportDraft(container, session.tenantId, {
        ...parsed.input,
        staffId,
      });
      return c.json({ draft });
    } catch (e) {
      // 生成そのものの失敗は warnings に詰めて返る(GAS版と同じ)。ここに来るのは
      // 対象児の取り違えなど、入力が通ってはいけない場合だけ。
      return c.json({ code: 'validation_failed', message: e instanceof Error ? e.message : String(e) }, 400);
    }
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
    if (body.stressLevel != null && !isValidRating(body.stressLevel)) {
      return c.json({ code: 'validation_failed', message: 'stressLevel は1〜5の整数にしてください' }, 400);
    }
    if (body.esRating != null && !isValidRating(body.esRating)) {
      return c.json({ code: 'validation_failed', message: 'esRating は1〜5の整数にしてください' }, 400);
    }
    // couponIds(doc/db/guidelines.md §9)は「文字列かどうか」ではなく実際の形(UUID文字列の配列)を見る。
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
    const targetFamilyMemberId = readOptionalId(body.targetFamilyMemberId);
    if (targetFamilyMemberId === undefined) {
      return c.json(
        { code: 'validation_failed', message: 'targetFamilyMemberId は文字列かnullにしてください' },
        400,
      );
    }
    const aiGenerationId = readOptionalId(body.aiGenerationId);
    if (aiGenerationId === undefined) {
      return c.json(
        { code: 'validation_failed', message: 'aiGenerationId は文字列かnullにしてください' },
        400,
      );
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
        stressLevel: isValidRating(body.stressLevel) ? body.stressLevel : null,
        esRating: isValidRating(body.esRating) ? body.esRating : null,
        targetFamilyMemberId,
        aiGenerationId,
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
    // 値がある場合は、文字列かどうかではなく許可された2値かどうかを見る(doc/db/guidelines.md §4)。
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
