import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { DrizzleAttendanceDayRepository } from '@katahimo/db/repositories';
import * as schema from '@katahimo/db/schema';
import { serializeTransactions } from '@katahimo/db/serialize-transactions';
import type { Database } from '@katahimo/db/tenant-scope';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { DemoMigration } from './database';
import { applyPendingMigrations, REBUILD_REQUIRED_MIGRATIONS } from './database';

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
    // 「今の全マイグレーションが当たっている状態」に、次のリリースで1件増えた状況を再現する。
    // (0000だけ当ててから残りを当てる形だと、作り直し対象の 0005 が未適用なので
    // 増分ではなく再構築の経路に入ってしまい、増分適用の検証にならない。)
    const isFresh = await applyPendingMigrations(client, migrations);
    expect(isFresh).toBe(true);
    await client.exec("INSERT INTO tenants (name, slug) VALUES ('テスト法人', 'demo');");
    const probe: DemoMigration = { tag: '9999_probe', sql: 'CREATE TABLE probe (id int);' };
    expect(await tableExists(client, 'probe')).toBe(false);

    const secondRun = await applyPendingMigrations(client, [...migrations, probe]);

    // 追加分だけが当たり、シード投入は要求されず、入力済みのデータも残る。
    expect(secondRun).toBe(false);
    expect(await appliedTags(client)).toEqual([...migrations.map((m) => m.tag), probe.tag].sort());
    expect(await tableExists(client, 'probe')).toBe(true);
    const { rows } = await client.query<{ slug: string }>('SELECT slug FROM tenants;');
    expect(rows).toEqual([{ slug: 'demo' }]);
  });

  it('台帳はあるが作り直し対象(0005)が未適用なら、作り直してシード投入を要求する', async () => {
    // 暗号化列を持つ旧スキーマまで当たっていて、暗号文の行が残っているデモDBを再現する。
    const [firstRebuildTag] = REBUILD_REQUIRED_MIGRATIONS;
    if (!firstRebuildTag) throw new Error('REBUILD_REQUIRED_MIGRATIONS が空です');
    const rebuildIndex = migrations.findIndex((m) => m.tag === firstRebuildTag);
    expect(rebuildIndex).toBeGreaterThan(0);
    const legacy = migrations.slice(0, rebuildIndex);
    // 旧スキーマを当てる段階では作り直しルールを外す(そうしないとガードに引っかかる)。
    const firstRun = await applyPendingMigrations(client, legacy, []);
    expect(firstRun).toBe(true);
    await client.exec("INSERT INTO tenants (name, slug) VALUES ('テスト法人', 'demo');");
    expect(await appliedTags(client)).not.toContain(firstRebuildTag);

    const secondRun = await applyPendingMigrations(client, migrations);

    // 増分ではなく作り直し: 既存行は消え、全マイグレーションが当たり、シード投入が必要になる。
    expect(secondRun).toBe(true);
    expect(await appliedTags(client)).toEqual(migrations.map((m) => m.tag));
    const { rows } = await client.query<{ count: string }>('SELECT count(*)::text AS count FROM tenants;');
    expect(rows[0]?.count).toBe('0');
  });

  it('0005適用直後に起動が止まった状態(0006未適用)でも、既定の設定で作り直してシード投入を要求する', async () => {
    // 0005はコミット済み(台帳にもある)だが、0006がまだ当たっていない状態を再現する。
    const rebuildIndex = migrations.findIndex((m) => m.tag === '0005_drop_field_encryption');
    expect(rebuildIndex).toBeGreaterThan(0);
    const upToAndIncluding0005 = migrations.slice(0, rebuildIndex + 1);
    const firstRun = await applyPendingMigrations(client, upToAndIncluding0005, []);
    expect(firstRun).toBe(true);
    expect(await appliedTags(client)).toContain('0005_drop_field_encryption');
    expect(await appliedTags(client)).not.toContain('0006_plaintext_columns');

    // 既定のREBUILD_REQUIRED_MIGRATIONS(0005・0006の両方)で、フルのマイグレーションを当てる。
    const secondRun = await applyPendingMigrations(client, migrations);

    // 0005だけを見ていたら isFresh=false になってしまうところを、0006も列挙しているので
    // 作り直し経路に入り、シード投入が必要と判定される。
    expect(secondRun).toBe(true);
    expect(await appliedTags(client)).toEqual(migrations.map((m) => m.tag));
  });

  it('作り直し対象のタグが実在しなければ起動を止める(タイポで黙って無効にならない)', async () => {
    await expect(applyPendingMigrations(client, migrations, ['nonexistent'])).rejects.toThrow(
      /'nonexistent' が見つかりません/,
    );
    // 既定の REBUILD_REQUIRED_MIGRATIONS 自体が実在するタグだけで構成されていることも固定する。
    for (const tag of REBUILD_REQUIRED_MIGRATIONS) {
      expect(migrations.map((m) => m.tag)).toContain(tag);
    }
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

  /**
   * SQLの適用と台帳への記録が別コミットだと、その間に落ちたときに
   * 「適用済みだが記録されていない」状態が残り、次の起動で同じSQLを流して
   * 「テーブルが既に存在する」で落ちる(リセットするまで直らない)。
   *
   * 台帳側のCHECK制約で記録だけを失敗させ、SQLの適用が巻き戻ることを確かめる。
   * 同じトランザクションになっていなければ、marker テーブルが残って落ちる。
   */
  it('台帳への記録が失敗したらSQLの適用も巻き戻す', async () => {
    // 特定のタグだけ記録できない台帳を先に作っておく(実装側は CREATE TABLE IF NOT EXISTS)。
    await client.exec(`
      CREATE TABLE demo_applied_migrations (
        tag text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT reject_marker CHECK (tag <> '9999_marker')
      );
    `);
    const rejected: DemoMigration = {
      tag: '9999_marker',
      sql: 'CREATE TABLE marker (id int);',
    };

    // 合成マイグレーションだけを渡すので、作り直しルール(実在チェック)は外しておく。
    await expect(applyPendingMigrations(client, [rejected], [])).rejects.toThrow();

    // 記録に失敗した以上、テーブルも作られていないこと。
    expect(await tableExists(client, 'marker')).toBe(false);
    expect(await appliedTags(client)).toEqual([]);
  });

  it('マイグレーションを1件も読めなければ起動を止める', async () => {
    await expect(applyPendingMigrations(client, [])).rejects.toThrow(
      'マイグレーションSQLを読み込めませんでした',
    );
  });
});

/**
 * attendance_days.row_data は本リポジトリで初めて使う jsonb 列。drizzle の PgJsonb は書き込みで
 * JSON.stringify し、読み出しは「文字列なら parse、オブジェクトならそのまま」なので、
 * ドライバ(PGlite)がどちらを返しても壊れないはずだが、二重に文字列化されたり
 * 文字列のまま返ってきたりしないことを本物のPostgresで固定する。
 */
describe('attendance_days.row_data(jsonb)の往復', () => {
  it('upsertしたオブジェクトが同じ形で読み戻せる', async () => {
    const client = new PGlite();
    await client.waitReady;
    await applyPendingMigrations(client, loadMigrations());
    const db = serializeTransactions(
      drizzle(client, { schema, casing: 'snake_case' }) as unknown as Database,
    );

    const { rows: tenants } = await client.query<{ id: string }>(
      "INSERT INTO tenants (name, slug) VALUES ('テスト法人', 'demo') RETURNING id;",
    );
    const tenantId = tenants[0]?.id;
    if (!tenantId) throw new Error('テナントの準備に失敗しました');
    const { rows: staff } = await client.query<{ id: string }>(
      "INSERT INTO staff (tenant_id, name, email) VALUES ($1, 'スタッフ', 's@example.test') RETURNING id;",
      [tenantId],
    );
    const staffId = staff[0]?.id;
    if (!staffId) throw new Error('スタッフの準備に失敗しました');

    const repo = new DrizzleAttendanceDayRepository(db);
    const rowData = { C: '田中', D: '10:00' };
    await repo.upsert(tenantId, staffId, '2026-09-01', rowData);

    const record = await repo.findByStaffAndDate(tenantId, staffId, '2026-09-01');
    if (!record) throw new Error('勤怠が見つかりません');
    expect(typeof record.rowData).toBe('object');
    expect(record.rowData).toEqual(rowData);

    const month = await repo.listByStaffAndMonth(tenantId, staffId, '2026-09');
    expect(month.map((r) => r.rowData)).toEqual([rowData]);

    await client.close();
  });
});

/**
 * findExistingDedupeKeys()のアプリ側チェックをすり抜けても(同時に同じ領収書が2リクエストで
 * 登録される競合状態)、DB側の一意インデックスで最終的に止まることを本物のPostgresで固定する。
 */
describe('receipts_tenant_dedupe_key_uidx(dedupeKeyがある行だけの一意インデックス)', () => {
  it('同一テナント・同一dedupeKeyの2行目はINSERTできない', async () => {
    const client = new PGlite();
    await client.waitReady;
    await applyPendingMigrations(client, loadMigrations());

    const { rows: tenants } = await client.query<{ id: string }>(
      "INSERT INTO tenants (name, slug) VALUES ('テスト法人', 'demo') RETURNING id;",
    );
    const tenantId = tenants[0]?.id;
    if (!tenantId) throw new Error('テナントの準備に失敗しました');
    const { rows: staffRows } = await client.query<{ id: string }>(
      "INSERT INTO staff (tenant_id, name, email) VALUES ($1, 'スタッフ', 's@example.test') RETURNING id;",
      [tenantId],
    );
    const staffId = staffRows[0]?.id;
    if (!staffId) throw new Error('スタッフの準備に失敗しました');

    const insertReceipt = (dedupeKey: string | null) =>
      client.query(
        `INSERT INTO receipts (tenant_id, staff_id, receipt_timestamp, dedupe_key, file_key, content_type)
         VALUES ($1, $2, now(), $3, 'file-key', 'image/jpeg');`,
        [tenantId, staffId, dedupeKey],
      );

    await insertReceipt('same-key');
    await expect(insertReceipt('same-key')).rejects.toThrow(/duplicate key value/i);

    // dedupeKeyがnullの行同士は重複とみなさない(金額/店舗名が空で判定対象外の領収書)。
    await expect(insertReceipt(null)).resolves.toBeDefined();
    await expect(insertReceipt(null)).resolves.toBeDefined();

    await client.close();
  });
});
