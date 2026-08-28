import { searchCustomersByFamilyName } from '@katahimo/core';
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

  return app;
}
