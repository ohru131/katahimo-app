import { loadDotenv } from './loadDotenv';

loadDotenv();

import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDatabase } from './client';

const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL が設定されていません(.env.example を参照)');

const db = createDatabase(url);
await migrate(db, { migrationsFolder: new URL('../drizzle', import.meta.url).pathname });
console.log('マイグレーションを適用しました');
process.exit(0);
