import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushAfterWrites } from './demoApi';

/**
 * 書き出し(IndexedDBへのフラッシュ)の失敗を、どこまでリクエストの失敗として
 * 扱うかを固定する。ここを間違えるとコミット済みの書き込みをクライアントが
 * やり直し、日報や領収書が二重に登録される。
 */
describe('flushAfterWrites', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** 日報の保存を模したアプリ。レスポンスに採番済みIDを載せる。 */
  function createApp(persistence: Parameters<typeof flushAfterWrites>[0]) {
    const app = new Hono();
    app.use('*', flushAfterWrites(persistence));
    app.post('/api/reports/daily', (c) => c.json({ success: true, report: { id: 'report-1' } }));
    app.get('/api/customers', (c) => c.json({ customers: [] }));
    return app;
  }

  it('更新系リクエストの後に書き出す', async () => {
    const flush = vi.fn().mockResolvedValue(undefined);
    const onFailure = vi.fn();
    const res = await createApp({ flush, onFailure }).request('/api/reports/daily', { method: 'POST' });

    expect(res.status).toBe(200);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(onFailure).not.toHaveBeenCalled();
  });

  it('読み取りだけのリクエストでは書き出さない', async () => {
    const flush = vi.fn().mockResolvedValue(undefined);
    const res = await createApp({ flush, onFailure: vi.fn() }).request('/api/customers');

    expect(res.status).toBe(200);
    expect(flush).not.toHaveBeenCalled();
  });

  it('書き出しに失敗しても成功レスポンスをそのまま返す', async () => {
    // ここでエラーレスポンスに差し替えると、クライアントは採番済みの reportId を
    // 受け取れず、次の保存が新規作成として飛んで日報が二重に登録される。
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const flush = vi.fn().mockRejectedValue(new Error('QuotaExceededError'));
    const onFailure = vi.fn();
    const res = await createApp({ flush, onFailure }).request('/api/reports/daily', { method: 'POST' });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, report: { id: 'report-1' } });
  });

  it('書き出しに失敗したことは画面へ知らせる', async () => {
    // 握りつぶすと「保存しました」と出たままリロードで消える。
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = new Error('QuotaExceededError');
    const onFailure = vi.fn();
    await createApp({ flush: vi.fn().mockRejectedValue(error), onFailure }).request('/api/reports/daily', {
      method: 'POST',
    });

    expect(onFailure).toHaveBeenCalledWith(error);
  });
});
