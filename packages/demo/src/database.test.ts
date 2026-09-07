import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { DemoMigration } from './database';
import { applyPendingMigrations } from './database';

const DRIZZLE_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../db/drizzle');

/** 本番と同じマイグレーションSQLを読む(ブラウザ側は import.meta.glob で同じものを集める)。 */
function loadMigrations(): DemoMigration[] {
  return readdirSync(DRIZZLE_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => ({ tag: name.replace(/\.sql$/, ''), sql: readFileSync(join(DRIZZLE_DIR, name), 'utf8') }));
}

async function tableExists(client: PGlite, name: string): Promise<boolean> {
  const { rows } = await client.query<{ exists: boolean }>('SELECT to_regclass($1) IS NOT NULL AS exists;', [
    `public.${name}`,
  ]);
  return rows[0]?.exists === true;
}

async function appliedTags(client: PGlite): Promise<string[]> {
  const { rows } = await client.query<{ tag: string }>(
    'SELECT tag FROM demo_applied_migrations ORDER BY tag;',
  );
  return rows.map((row) => row.tag);
}

/**
 * デモは訪問者のブラウザ(IndexedDB)にDBを持つため、スキーマ変更のたびに
 * 「既に一度デモを開いた人のDB」が取り残される。本番の migrate() と同じく
 * 適用済みを台帳で覚えて未適用分だけ当てることを、実際のPostgresで固定する。
 */
describe('applyPendingMigrations', () => {
  let client: PGlite;
  let migrations: DemoMigration[];

  beforeEach(async () => {
    client = new PGlite();
    await client.waitReady;
    migrations = loadMigrations();
    // 2件以上ある状態を前提にしたテストなので、そこも一緒に固定する。
    expect(migrations.length).toBeGreaterThan(1);
  });

  it('空のDBには全て当てて、台帳に記録する', async () => {
    const isFresh = await applyPendingMigrations(client, migrations);

    expect(isFresh).toBe(true);
    expect(await appliedTags(client)).toEqual(migrations.map((m) => m.tag));
    expect(await tableExists(client, 'tenants')).toBe(true);
    expect(await tableExists(client, 'password_reset_codes')).toBe(true);
  });

  it('2回目の起動では何も当てず、シード投入も要求しない', async () => {
    await applyPendingMigrations(client, migrations);
    const { rows: before } = await client.query<{ id: string }>(
      "INSERT INTO tenants (name, slug) VALUES ('テスト法人', 'demo') RETURNING id;",
    );

    const isFresh = await applyPendingMigrations(client, migrations);

    expect(isFresh).toBe(false);
    // 既存データが消えていないこと(作り直しに入っていない)。
    const { rows: after } = await client.query<{ id: string }>('SELECT id FROM tenants;');
    expect(after).toEqual(before);
  });

  it('台帳があって未適用が残っているDBには、その分だけを当てる(既存データは残す)', async () => {
    // 「0000だけ当たっている状態」を作る。これが本来の増分適用の対象。
    const [first, ...rest] = migrations;
    if (!first) throw new Error('マイグレーションが空です');
    const isFresh = await applyPendingMigrations(client, [first]);
    expect(isFresh).toBe(true);
    expect(await tableExists(client, 'password_reset_codes')).toBe(false);
    await client.exec("INSERT INTO tenants (name, slug) VALUES ('テスト法人', 'demo');");

    const secondRun = await applyPendingMigrations(client, migrations);

    // 追加分が当たり、シード投入は要求されず、入力済みのデータも残る。
    expect(secondRun).toBe(false);
    expect(await appliedTags(client)).toEqual(migrations.map((m) => m.tag));
    expect(await tableExists(client, 'password_reset_codes')).toBe(true);
    const { rows } = await client.query<{ slug: string }>('SELECT slug FROM tenants;');
    expect(rows).toEqual([{ slug: 'demo' }]);
    for (const migration of rest) expect(await appliedTags(client)).toContain(migration.tag);
  });

  it('台帳が無い時代のDBは作り直す(古いスキーマのまま使わせない)', async () => {
    // 台帳を持たない実装が作ったDBを再現する: 0000だけを直に流す。
    const [first] = migrations;
    if (!first) throw new Error('マイグレーションが空です');
    await client.exec(first.sql);
    await client.exec("INSERT INTO tenants (name, slug) VALUES ('テスト法人', 'demo');");
    expect(await tableExists(client, 'demo_applied_migrations')).toBe(false);

    const isFresh = await applyPendingMigrations(client, migrations);

    // 作り直したのでシード投入が必要になり、追加分のスキーマも揃っている。
    expect(isFresh).toBe(true);
    expect(await appliedTags(client)).toEqual(migrations.map((m) => m.tag));
    expect(await tableExists(client, 'password_reset_codes')).toBe(true);
    const { rows } = await client.query<{ count: string }>('SELECT count(*)::text AS count FROM tenants;');
    expect(rows[0]?.count).toBe('0');
  });

  it('マイグレーションを1件も読めなければ起動を止める', async () => {
    await expect(applyPendingMigrations(client, [])).rejects.toThrow(
      'マイグレーションSQLを読み込めませんでした',
    );
  });
});
