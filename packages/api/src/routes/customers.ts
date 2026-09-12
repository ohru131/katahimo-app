import {
  getCustomerDetail,
  listCustomers,
  searchCustomersByFamilyName,
  updateCustomerBirthday,
} from '@katahimo/core';
import { customerUpdateRequestSchema } from '@katahimo/shared';
import { Hono } from 'hono';
import type { Container } from '../container';
import { getAuthenticatedSession } from '../session';

export function createCustomerRoutes(container: Container) {
  const app = new Hono();

  /**
   * `familyName`クエリ省略時は有効な顧客を全件返す(GAS版Main.js fetchDataFromSheetが顧客DB全件を
   * 一度にクライアントへ返し、名前の部分一致・地区絞り込み・並び替えはブラウザ側で行っていたのと
   * 同じ「訪問先一覧」タブの既定表示に使う)。`familyName`を指定した場合のみ、従来通り苗字の
   * ブラインドインデックス完全一致検索を行う。tenantIdは必ずセッションから取得したものだけを使い、
   * クエリパラメータでtenantIdを受け取ることはしない(他テナントの顧客を覗けてしまうため)。
   */
  app.get('/', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);

    const familyName = c.req.query('familyName');
    if (!familyName) {
      const { customers, cities } = await listCustomers(container, session.tenantId);
      return c.json({ customers, cities });
    }

    const results = await searchCustomersByFamilyName(container, session.tenantId, familyName);
    return c.json({ customers: results });
  });

  /**
   * 顧客1件の全項目(世帯構成員含む)を復号して返す詳細取得。
   * こちらもtenantIdはセッション由来のものだけを使う(URLのcustomerIdだけでは他テナントの
   * 顧客IDを推測して覗かれる心配は無いが、念のためfindByIdもtenant_idでスコープする)。
   */
  app.get('/:id', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);

    const customerId = c.req.param('id');
    const detail = await getCustomerDetail(container, session.tenantId, customerId);
    if (!detail) return c.json({ code: 'not_found', message: '顧客が見つかりません' }, 404);

    return c.json({ customer: detail });
  });

  /**
   * 顧客の生年月日を登録・更新する(誕生月クーポンの判定に使う。doc/14 §9)。
   *
   * 受け付けるのは生年月日だけ。他の項目はRESERVA CSVの取込が正で、画面から直しても
   * 次の取込で消えるため編集させない(@katahimo/shared の customerUpdateRequestSchema 参照)。
   * 請求額に影響する情報なので、クーポンマスタの編集と同じく管理者だけに許す。
   */
  app.patch('/:id', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);
    if (!session.isAdmin) return c.json({ code: 'forbidden', message: '権限がありません' }, 403);

    const body = await c.req.json().catch(() => null);
    const parsed = customerUpdateRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, message: '入力内容を確認してください' }, 400);
    }

    const updated = await updateCustomerBirthday(
      container,
      session.tenantId,
      c.req.param('id'),
      parsed.data.dob,
    );
    if (!updated) return c.json({ code: 'not_found', message: '顧客が見つかりません' }, 404);
    return c.json({ success: true });
  });

  return app;
}
