import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DemoMigration } from './database';
import { applyPendingMigrations } from './database';

/**
 * doc/14 F項・G項: 日付・時刻・緯度経度を型のある列に変えた「目的」そのものが実際に成立する
 * ことを、本番と同じマイグレーションを当てた本物のPostgres(PGlite/WASM)で固定する
 * (checkConstraints.test.tsと同じ方式。CHECK制約の合否だけでなく、型にしたことで可能になった
 * 往復・集計・範囲検索を確認する)。
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
    "INSERT INTO tenants (name, slug) VALUES ('テスト法人', 'typed-columns') RETURNING id;",
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

describe('型にした列が実際に使える(PGlite)', () => {
  let fixture: Fixture;

  beforeAll(async () => {
    fixture = await createFixture();
  }, 60_000);

  afterAll(async () => {
    await fixture?.client.close();
  });

  describe('daily_reports.started_at / ended_at(doc/14 F項)', () => {
    it('日跨ぎ勤務(22:00〜翌01:00)を保存して再取得すると、3時間の滞在時間として計算できる', async () => {
      const {
        rows: [inserted],
      } = await fixture.client.query<{ id: string }>(
        `INSERT INTO daily_reports (tenant_id, staff_id, customer_id, occurred_at, started_at, ended_at)
         VALUES ($1, $2, $3, '2026-08-30 22:00:00+09', '2026-08-30 22:00:00+09', '2026-08-31 01:00:00+09')
         RETURNING id;`,
        [fixture.tenantId, fixture.staffId, fixture.customerId],
      );
      if (!inserted) throw new Error('insert failed');

      const {
        rows: [row],
      } = await fixture.client.query<{ started_at: Date; ended_at: Date; duration_minutes: number }>(
        `SELECT started_at, ended_at, EXTRACT(EPOCH FROM (ended_at - started_at)) / 60 AS duration_minutes
         FROM daily_reports WHERE id = $1;`,
        [inserted.id],
      );
      expect(row?.ended_at.getTime()).toBeGreaterThan(row?.started_at.getTime() ?? 0);
      expect(Number(row?.duration_minutes)).toBe(180);
    });

    it('未入力(NULL)がNULLのまま往復する(空文字と区別できる)', async () => {
      const {
        rows: [inserted],
      } = await fixture.client.query<{ id: string }>(
        `INSERT INTO daily_reports (tenant_id, staff_id, customer_id, occurred_at, started_at, ended_at)
         VALUES ($1, $2, $3, now(), NULL, NULL)
         RETURNING id;`,
        [fixture.tenantId, fixture.staffId, fixture.customerId],
      );
      if (!inserted) throw new Error('insert failed');

      const {
        rows: [row],
      } = await fixture.client.query<{ started_at: Date | null; ended_at: Date | null }>(
        'SELECT started_at, ended_at FROM daily_reports WHERE id = $1;',
        [inserted.id],
      );
      expect(row?.started_at).toBeNull();
      expect(row?.ended_at).toBeNull();
    });
  });

  describe('family_members.dob_date(doc/14 F項: 範囲検索)', () => {
    it('生年月日の範囲でSQLから絞り込める(文字列のままではできなかった集計)', async () => {
      const members: Array<[string, string | null]> = [
        ['2015年生', '2015-04-10'],
        ['2019年生', '2019-07-01'],
        ['2022年生', '2022-12-31'],
        ['解析できない表記', null],
      ];
      for (const [name, dobDate] of members) {
        await fixture.client.query(
          'INSERT INTO family_members (tenant_id, customer_id, name, dob_date, dob_raw) VALUES ($1, $2, $3, $4, $5);',
          [fixture.tenantId, fixture.customerId, name, dobDate, dobDate ?? '不明'],
        );
      }

      const { rows } = await fixture.client.query<{ count: number }>(
        `SELECT COUNT(*) FROM family_members
         WHERE tenant_id = $1 AND dob_date BETWEEN '2015-01-01' AND '2020-12-31';`,
        [fixture.tenantId],
      );
      // 2015年生・2019年生の2件だけが範囲に入る(2022年生は範囲外、解析できない表記はdob_dateが
      // NULLなのでBETWEENに一致しない)。
      expect(Number(rows[0]?.count)).toBe(2);
    });
  });

  describe('customers.lat / customers.lng(doc/14 G項)', () => {
    it('numeric(9,6)で保存した値が、丸め誤差なく往復する', async () => {
      const {
        rows: [inserted],
      } = await fixture.client.query<{ id: string }>(
        `INSERT INTO customers (tenant_id, name, family_name, given_name, lat, lng, lat_lng_raw)
         VALUES ($1, 'テスト利用者2', 'テスト', '次郎', 38.263133, 140.869398, '38.263133, 140.869398')
         RETURNING id;`,
        [fixture.tenantId],
      );
      if (!inserted) throw new Error('insert failed');

      const {
        rows: [row],
      } = await fixture.client.query<{ lat: string; lng: string }>(
        'SELECT lat, lng FROM customers WHERE id = $1;',
        [inserted.id],
      );
      expect(Number(row?.lat)).toBe(38.263133);
      expect(Number(row?.lng)).toBe(140.869398);
    });
  });
});
