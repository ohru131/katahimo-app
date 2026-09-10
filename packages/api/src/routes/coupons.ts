import {
  createCoupon,
  formatJstDateKey,
  listCouponsForAdmin,
  listCouponsForSelection,
  updateCoupon,
} from '@katahimo/core';
import type { CouponInputInvalidReason } from '@katahimo/core/usecases';
import { businessDateSchema, couponCreateRequestSchema, couponUpdateRequestSchema } from '@katahimo/shared';
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
   * 日報画面の「クーポンを選ぶ」セレクタ用。active かつ対象日に有効なものだけを返す
   * (doc/14 4.1章)。管理者以外(現場スタッフ)も日報保存のために必要なので、
   * 認証済みであれば誰でも呼べる(routes/staff.tsのGET /と同じ、閲覧だけの緩さ)。
   *
   * dateクエリは'YYYY-MM-DD'。省略時は「今日」(JST)。
   */
  app.get('/', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);

    const dateParam = c.req.query('date');
    if (dateParam !== undefined && !businessDateSchema.safeParse(dateParam).success) {
      return c.json({ code: 'validation_failed', message: 'date はYYYY-MM-DD形式で指定してください' }, 400);
    }
    const onDate = dateParam ?? formatJstDateKey(new Date());

    const coupons = await listCouponsForSelection(container, session.tenantId, onDate);
    return c.json({ coupons });
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
    case 'code_taken':
      return 'そのコードは既に使われています';
    default: {
      const exhaustiveCheck: never = reason;
      return exhaustiveCheck;
    }
  }
}
