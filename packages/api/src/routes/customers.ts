import { getCustomerDetail, searchCustomersByFamilyName } from '@katahimo/core';
import { Hono } from 'hono';
import type { Container } from '../container';
import { getAuthenticatedSession } from '../session';

export function createCustomerRoutes(container: Container) {
  const app = new Hono();

  /**
   * 苗字(姓)の完全一致検索。tenantIdは必ずセッションから取得したものだけを使い、
   * クエリパラメータでtenantIdを受け取ることはしない(他テナントの顧客を覗けてしまうため)。
   */
  app.get('/', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);

    const familyName = c.req.query('familyName');
    if (!familyName) {
      return c.json({ code: 'validation_failed', message: 'familyNameクエリパラメータが必要です' }, 400);
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

  return app;
}
