import {
  assignCouponToCustomer,
  createCoupon,
  formatJstDateKey,
  listCouponsForAdmin,
  listCouponsForSelection,
  listCustomerCoupons,
  unassignCouponFromCustomer,
  updateCoupon,
} from '@katahimo/core';
import type { CouponInputInvalidReason } from '@katahimo/core/usecases';
import {
  businessDateSchema,
  couponCreateRequestSchema,
  couponUpdateRequestSchema,
  customerCouponUpsertRequestSchema,
  idSchema,
} from '@katahimo/shared';
import { Hono } from 'hono';
import type { ZodError } from 'zod';
import type { Container } from '../container';
import { getAuthenticatedSession } from '../session';

/** zodのissuesを、routes/attendance.tsと同じ`{パス: メッセージ}`の形に変換する。 */
function toFieldErrors(error: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    fields[issue.path.length > 0 ? issue.path.join('.') : '(root)'] = issue.message;
  }
  return fields;
}

/**
 * 管理者によるクーポン登録・更新はテナント越え・権限昇格に直結するため、routes/staff.tsの
 * 管理者向けルートと同じ判定(session.isAdmin)を、緩めずそのまま使う。
 */
export function createCouponRoutes(container: Container) {
  const app = new Hono();

  /**
   * 日報画面の「クーポンを選ぶ」セレクタ用。その顧客がその日に使える条件を満たすものだけを
   * 返す(doc/14 §9)。誕生月でない月の誕生月クーポン・その顧客に配られていないクーポンは
   * 出さないので、スタッフが条件を1件ずつ確かめる必要がない。管理者以外(現場スタッフ)も
   * 日報保存のために必要なので、認証済みであれば誰でも呼べる
   * (routes/staff.tsのGET /と同じ、閲覧だけの緩さ)。
   *
   * customerIdクエリは必須(顧客ごとに使えるものが変わるため)。
   * dateクエリは'YYYY-MM-DD'。省略時は「今日」(JST)。
   * reportIdクエリは編集中の日報。その日報が既に使っている分を「使用済み」に数えないために渡す。
   */
  app.get('/', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);

    const customerId = idSchema.safeParse(c.req.query('customerId'));
    if (!customerId.success) {
      return c.json({ code: 'validation_failed', message: 'customerId を指定してください' }, 400);
    }

    const dateParam = c.req.query('date');
    if (dateParam !== undefined && !businessDateSchema.safeParse(dateParam).success) {
      return c.json({ code: 'validation_failed', message: 'date はYYYY-MM-DD形式で指定してください' }, 400);
    }
    const onDate = dateParam ?? formatJstDateKey(new Date());

    const reportId = c.req.query('reportId');
    if (reportId !== undefined && !idSchema.safeParse(reportId).success) {
      return c.json({ code: 'validation_failed', message: 'reportId の形式が不正です' }, 400);
    }

    const coupons = await listCouponsForSelection(container, session.tenantId, {
      customerId: customerId.data,
      onDate,
      excludeDailyReportId: reportId ?? null,
    });
    return c.json({ coupons });
  });

  /**
   * 顧客に配ってあるクーポンの一覧(管理画面)。配布状況は請求額に影響するため、
   * クーポンマスタの編集と同じく管理者だけが見られるようにする。
   */
  app.get('/admin/customers/:customerId', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);
    if (!session.isAdmin) return c.json({ code: 'forbidden', message: '権限がありません' }, 403);

    const coupons = await listCustomerCoupons(container, session.tenantId, c.req.param('customerId'));
    return c.json({ coupons });
  });

  /** 管理者が顧客にクーポンを配る(既に配ってあれば有効期間・メモを上書きする)。 */
  app.put('/admin/customers/:customerId', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);
    if (!session.isAdmin) return c.json({ code: 'forbidden', message: '権限がありません' }, 403);

    const body = await c.req.json().catch(() => null);
    const parsed = customerCouponUpsertRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { success: false, message: '入力内容を確認してください', fields: toFieldErrors(parsed.error) },
        400,
      );
    }

    const result = await assignCouponToCustomer(
      container,
      session.tenantId,
      c.req.param('customerId'),
      parsed.data,
    );
    if (!result.ok) {
      const status = result.reason === 'coupon_not_found' ? 404 : 400;
      const message =
        result.reason === 'coupon_not_found'
          ? 'クーポンが見つかりません'
          : '有効期間の終了日は開始日以降にしてください';
      return c.json({ success: false, message }, status);
    }
    return c.json({ success: true });
  });

  /** 管理者が顧客への配布を取り消す。過去の適用記録(coupon_redemptions)は残る。 */
  app.delete('/admin/customers/:customerId/:couponId', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);
    if (!session.isAdmin) return c.json({ code: 'forbidden', message: '権限がありません' }, 403);

    const removed = await unassignCouponFromCustomer(
      container,
      session.tenantId,
      c.req.param('customerId'),
      c.req.param('couponId'),
    );
    if (!removed) return c.json({ success: false, message: '割り当てが見つかりません' }, 404);
    return c.json({ success: true });
  });

  /** 管理者のクーポン管理画面用。廃止済みも含む全件。 */
  app.get('/admin', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);
    if (!session.isAdmin) return c.json({ code: 'forbidden', message: '権限がありません' }, 403);

    const coupons = await listCouponsForAdmin(container, session.tenantId);
    return c.json({ coupons });
  });

  /** 管理者によるクーポン登録。 */
  app.post('/admin', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);
    if (!session.isAdmin) return c.json({ code: 'forbidden', message: '権限がありません' }, 403);

    const body = await c.req.json().catch(() => null);
    const parsed = couponCreateRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { success: false, message: '入力内容を確認してください', fields: toFieldErrors(parsed.error) },
        400,
      );
    }

    const result = await createCoupon(container, session.tenantId, parsed.data);
    if (!result.ok) {
      return c.json({ success: false, message: couponInvalidReasonMessage(result.reason) }, 400);
    }
    return c.json({ success: true, couponId: result.couponId });
  });

  /** 管理者によるクーポンの更新(部分更新)。廃止(active=false)もここで行う。 */
  app.patch('/admin/:couponId', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);
    if (!session.isAdmin) return c.json({ code: 'forbidden', message: '権限がありません' }, 403);

    const body = await c.req.json().catch(() => null);
    const parsed = couponUpdateRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { success: false, message: '入力内容を確認してください', fields: toFieldErrors(parsed.error) },
        400,
      );
    }

    const result = await updateCoupon(container, session.tenantId, c.req.param('couponId'), parsed.data);
    if (!result.ok) {
      const status = result.reason === 'not_found' ? 404 : 400;
      const message =
        result.reason === 'not_found'
          ? 'クーポンが見つかりません'
          : couponInvalidReasonMessage(result.reason);
      return c.json({ success: false, message }, status);
    }
    return c.json({ success: true });
  });

  return app;
}

/** createCoupon/updateCouponのreason(コード)を、画面表示用の日本語メッセージに変換する。 */
function couponInvalidReasonMessage(reason: CouponInputInvalidReason | 'code_taken'): string {
  switch (reason) {
    case 'code_required':
      return 'コードを入力してください';
    case 'name_required':
      return '名前を入力してください';
    case 'discount_value_mismatch':
      return '割引種別と金額/率の組み合わせを確認してください';
    case 'discount_amount_yen_invalid':
      return '金額は0以上の整数で入力してください';
    case 'discount_percent_invalid':
      return '割引率は1〜100の整数で入力してください';
    case 'valid_period_reversed':
      return '有効期間の終了日は開始日以降にしてください';
    case 'birthday_subject_mismatch':
      return '誕生月クーポンは対象者(世帯代表/世帯構成員)を選んでください';
    case 'code_taken':
      return 'そのコードは既に使われています';
    default: {
      const exhaustiveCheck: never = reason;
      return exhaustiveCheck;
    }
  }
}
