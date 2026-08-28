import type { Database } from '@katahimo/db';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Env } from './env';

export interface AppDeps {
  env: Env;
  db: Database;
}

export function createApp(deps: AppDeps) {
  const app = new Hono();

  /** Cloud Run のヘルスチェック用。DBに触らない軽量な生存確認。 */
  app.get('/api/health', (c) => c.json({ status: 'ok' }));

  /** DB接続まで含めた疎通確認。デプロイ直後の確認とローカル動作確認に使う。 */
  app.get('/api/health/db', async (c) => {
    try {
      const rows = await deps.db.execute<{ now: string }>(sql`SELECT now() AS now`);
      return c.json({ status: 'ok', now: rows[0]?.now ?? null });
    } catch (e) {
      return c.json({ status: 'error', message: e instanceof Error ? e.message : String(e) }, 503);
    }
  });

  app.notFound((c) => c.json({ code: 'not_found', message: '該当するAPIがありません' }, 404));

  return app;
}
