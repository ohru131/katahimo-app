import { serve } from '@hono/node-server';
import { getDatabase } from '@katahimo/db';
import { sql } from 'drizzle-orm';
import { createApp } from './app';
import { loadEnv } from './env';
import { loadDotenv } from './loadDotenv';
import { createContainer } from './nodeContainer';

loadDotenv();
const env = loadEnv();
const db = getDatabase();
const app = createApp(createContainer(env, db), {
  allowedOrigins: env.ALLOWED_ORIGINS,
  secureCookies: env.NODE_ENV === 'production',
  async pingDataStore() {
    const rows = await db.execute<{ now: string }>(sql`SELECT now() AS now`);
    return rows[0]?.now ?? null;
  },
});

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`katahimo API を起動しました: http://localhost:${info.port}`);
});
