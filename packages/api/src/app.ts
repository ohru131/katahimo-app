import { Hono } from 'hono';
import type { Container } from './container';
import { createAttendanceRoutes } from './routes/attendance';
import { createAuthRoutes } from './routes/auth';
import { createCustomerRoutes } from './routes/customers';
import { createReceiptRoutes } from './routes/receipts';
import { createReportRoutes } from './routes/reports';
import { createScheduleRoutes } from './routes/schedule';
import { createSettingsRoutes } from './routes/settings';
import { createStaffRoutes } from './routes/staff';
import { requirePasswordChangeGuard } from './session';

export interface CreateAppOptions {
  /** セッションCookieにSecure属性を付けるか(本番はtrue)。 */
  secureCookies: boolean;
  /**
   * `/api/health/db` の実装。データストアへの疎通確認結果(現在時刻)を返す。
   * 省略するとこのルート自体を生やさない(ブラウザ内で動く公開デモのように、
   * 外部DBへの疎通という概念がない構成のため)。
   */
  pingDataStore?: () => Promise<string | null>;
}

/**
 * HonoアプリをContainerから組み立てる。ここでは依存の「組み立て方」を一切知らないので、
 * Node+PostgreSQL(createContainer)でもブラウザ+PGlite(packages/demo)でも同じルート実装が動く。
 */
export function createApp(container: Container, options: CreateAppOptions) {
  const app = new Hono();

  /** Cloud Run のヘルスチェック用。DBに触らない軽量な生存確認。 */
  app.get('/api/health', (c) => c.json({ status: 'ok' }));

  /**
   * DB接続まで含めた疎通確認。デプロイ直後の確認とローカル動作確認に使う。
   *
   * 失敗の詳細はサーバーログにだけ出し、レスポンスには含めない。このルートには認証が
   * 掛かっていないため、接続文字列やホスト名を含むドライバのエラーメッセージをそのまま
   * 返すと、誰でも読める場所にDBの内部情報を晒すことになる。
   */
  const pingDataStore = options.pingDataStore;
  if (pingDataStore) {
    app.get('/api/health/db', async (c) => {
      try {
        return c.json({ status: 'ok', now: await pingDataStore() });
      } catch (e) {
        console.error('[health] データストアへの疎通確認に失敗しました', e);
        return c.json({ status: 'error' }, 503);
      }
    });
  }

  // 初期パスワードのままのスタッフを、パスワード変更以外のAPIから締め出す。
  // ルートを足すたびに書き足す必要がないよう、全ルートの手前に1つだけ置く。
  app.use('/api/*', requirePasswordChangeGuard(container));

  app.route('/api/auth', createAuthRoutes(container, options.secureCookies));
  app.route('/api/customers', createCustomerRoutes(container));
  app.route('/api/attendance', createAttendanceRoutes(container));
  app.route('/api/reports', createReportRoutes(container));
  app.route('/api/receipts', createReceiptRoutes(container));
  app.route('/api/schedule', createScheduleRoutes(container));
  app.route('/api/settings', createSettingsRoutes(container));
  app.route('/api/staff', createStaffRoutes(container));

  app.notFound((c) => c.json({ code: 'not_found', message: '該当するAPIがありません' }, 404));

  return app;
}
