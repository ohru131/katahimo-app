import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DemoMigration } from './database';
import { applyPendingMigrations } from './database';

/**
 * doc/14 §5: `updated_at` はアプリのコードではなく、DBのトリガー(set_updated_at)が
 * `now()` で更新する方針にした。本番と同じマイグレーションを当てた本物のPostgres
 * (PGlite/WASM)で、その実挙動を固定する(checkConstraints.test.ts と同じ方式)。
 *
 * `customers` を特に検証するのは回帰テストのため: customerRepository.ts の
 * `update()`/`deactivate()` は `updated_at` を SET しておらず、トリガー導入前は
 * `customers.updated_at` が行を作った時刻のまま永久に進まないという不具合があった。
 */

const DRIZZLE_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../db/drizzle');

function loadMigrations(): DemoMigration[] {
  return readdirSync(DRIZZLE_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => ({ tag: name.replace(/\.sql$/, ''), sql: readFileSync(join(DRIZZLE_DIR, name), 'utf8') }));
}

interface Fixture {
  client: PGlite;
  tenantId: string;
  staffId: string;
  customerId: string;
}

async function createFixture(): Promise<Fixture> {
  const client = new PGlite();
  await client.waitReady;
  await applyPendingMigrations(client, loadMigrations());

  const {
    rows: [tenant],
  } = await client.query<{ id: string }>(
    "INSERT INTO tenants (name, slug) VALUES ('テスト法人', 'updated-at-trigger') RETURNING id;",
  );
  if (!tenant) throw new Error('テナントの準備に失敗しました');

  const {
    rows: [staff],
  } = await client.query<{ id: string }>(
    "INSERT INTO staff (tenant_id, name, email) VALUES ($1, 'テストスタッフ', 'staff@example.test') RETURNING id;",
    [tenant.id],
  );
  if (!staff) throw new Error('スタッフの準備に失敗しました');

  const {
    rows: [customer],
  } = await client.query<{ id: string }>(
    "INSERT INTO customers (tenant_id, name, family_name, given_name) VALUES ($1, 'テスト利用者', 'テスト', '太郎') RETURNING id;",
    [tenant.id],
  );
  if (!customer) throw new Error('顧客の準備に失敗しました');

  return { client, tenantId: tenant.id, staffId: staff.id, customerId: customer.id };
}

interface Timestamps {
  createdAt: Date;
  updatedAt: Date;
}

/**
 * PGliteは timestamptz を(pgのtext形式ではなく)Date型で返す。文字列比較にすると
 * ミリ秒未満の丸めで見かけ上一致/不一致になりうるため、Dateのまま扱う。
 */
async function readTimestamps(client: PGlite, table: string, id: string): Promise<Timestamps> {
  const { rows } = await client.query<{ created_at: Date; updated_at: Date }>(
    `SELECT created_at, updated_at FROM ${table} WHERE id = $1;`,
    [id],
  );
  const row = rows[0];
  if (!row) throw new Error(`${table}(${id})が見つかりません`);
  return { createdAt: row.created_at, updatedAt: row.updated_at };
}

describe('updated_atトリガー(PGlite)', () => {
  let fixture: Fixture;

  beforeAll(async () => {
    fixture = await createFixture();
  }, 60_000);

  afterAll(async () => {
    await fixture?.client.close();
  });

  describe('customers(回帰テスト: customerRepository は updated_at をSETしていない)', () => {
    it('UPDATEすると updated_at が進む', async () => {
      const before = await readTimestamps(fixture.client, 'customers', fixture.customerId);

      // クロックの解像度に関わらず前後関係を確実に検出できるよう、わずかに待ってから更新する。
      await fixture.client.query('SELECT pg_sleep(0.01);');
      // updatedAtRepository同様、アプリ側は updated_at 以外の列だけをSETする想定。
      await fixture.client.query("UPDATE customers SET memo = '更新した' WHERE id = $1;", [
        fixture.customerId,
      ]);

      const after = await readTimestamps(fixture.client, 'customers', fixture.customerId);
      expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
    });

    it('deactivate相当(deactivated_atだけのUPDATE)でも updated_at が進む', async () => {
      const before = await readTimestamps(fixture.client, 'customers', fixture.customerId);

      await fixture.client.query('SELECT pg_sleep(0.01);');
      // customerRepository.deactivate() と同じく updated_at 抜きのSET。
      await fixture.client.query('UPDATE customers SET deactivated_at = now() WHERE id = $1;', [
        fixture.customerId,
      ]);

      const after = await readTimestamps(fixture.client, 'customers', fixture.customerId);
      expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
    });
  });

  it('アプリから updated_at を明示指定しても、トリガーの now() に上書きされる', async () => {
    // 「唯一の真実はDBにある」という意図した挙動そのものを固定する。過去日を指定しても
    // 実行時刻(now())にならないと、この改修の目的(書き忘れても壊れない)が成立しない。
    const explicitPast = '2000-01-01T00:00:00Z';
    const beforeQuery = new Date();

    await fixture.client.query("UPDATE customers SET memo = '過去日指定', updated_at = $2 WHERE id = $1;", [
      fixture.customerId,
      explicitPast,
    ]);

    const { updatedAt } = await readTimestamps(fixture.client, 'customers', fixture.customerId);
    expect(updatedAt.getTime()).toBeGreaterThanOrEqual(beforeQuery.getTime() - 1000);
    expect(updatedAt.getTime()).not.toBe(new Date(explicitPast).getTime());
  });

  it('created_at はUPDATEで変わらない', async () => {
    const before = await readTimestamps(fixture.client, 'customers', fixture.customerId);

    await fixture.client.query('SELECT pg_sleep(0.01);');
    await fixture.client.query("UPDATE customers SET memo = 'created_atは不変' WHERE id = $1;", [
      fixture.customerId,
    ]);

    const after = await readTimestamps(fixture.client, 'customers', fixture.customerId);
    expect(after.createdAt.getTime()).toBe(before.createdAt.getTime());
  });

  it('staff(customers以外でも張られていることの一般確認)でも updated_at が進む', async () => {
    const before = await readTimestamps(fixture.client, 'staff', fixture.staffId);

    await fixture.client.query('SELECT pg_sleep(0.01);');
    await fixture.client.query("UPDATE staff SET name = '更新後の名前' WHERE id = $1;", [fixture.staffId]);

    const after = await readTimestamps(fixture.client, 'staff', fixture.staffId);
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
  });
});
