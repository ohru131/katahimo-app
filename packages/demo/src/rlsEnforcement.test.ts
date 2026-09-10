import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DemoMigration } from './database';
import { applyPendingMigrations } from './database';

/**
 * Row Level Security が「実際に」クロステナントの読み書きを止めることを、本番と同じ
 * マイグレーションを当てた本物のPostgres(PGlite/WASM)で確かめる。
 *
 * packages/db ではなくここに置いているのは、PGliteに依存できるのがこのパッケージだけのため
 * (packages/db はNode/ブラウザ両方から使われるので、DBドライバを持ち込まない方針)。
 *
 * 【重要な前提】PGliteは既定でsuperuser(postgres)として繋がる。superuserはRLSを常に
 * バイパスするので、そのまま検証すると「何も検証していないのに通るテスト」になる。
 * そのため、
 *   - テーブル所有者ロール(katahimo_owner: NOSUPERUSER NOBYPASSRLS)でマイグレーションを当て、
 *   - アプリ接続ロール(katahimo_app: 同上、所有者でもない)で読み書きする
 * という本番に近い構成を作ったうえで検証する。
 * この前提自体が崩れていないことは「前提」のテストで固定している。
 */

const DRIZZLE_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../db/drizzle');

/** マイグレーションを当てて全テーブルを所有するロール(本番の katahimo 相当)。 */
const OWNER_ROLE = 'katahimo_owner';
/** アプリが接続に使うロール。テーブル所有者ですらないので、FORCEが無くてもRLSを受ける。 */
const APP_ROLE = 'katahimo_app';

function loadMigrations(): DemoMigration[] {
  return readdirSync(DRIZZLE_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => ({ tag: name.replace(/\.sql$/, ''), sql: readFileSync(join(DRIZZLE_DIR, name), 'utf8') }));
}

interface Fixture {
  client: PGlite;
  tenantA: string;
  tenantB: string;
}

/** 非特権ロールでスキーマを作り、テナントA/Bのデータをsuperuser権限で流し込んだDBを作る。 */
async function createFixture(): Promise<Fixture> {
  const client = new PGlite();
  await client.waitReady;

  await client.exec(`
    CREATE ROLE ${OWNER_ROLE} NOSUPERUSER NOBYPASSRLS NOLOGIN;
    CREATE ROLE ${APP_ROLE} NOSUPERUSER NOBYPASSRLS NOLOGIN;
    GRANT ALL ON SCHEMA public TO ${OWNER_ROLE};
    GRANT ${OWNER_ROLE} TO CURRENT_USER;
    GRANT ${APP_ROLE} TO CURRENT_USER;
  `);

  // 所有者ロールに切り替えてから当てることで、テーブルの所有者を非superuserにする。
  await client.exec(`SET ROLE ${OWNER_ROLE};`);
  await applyPendingMigrations(client, loadMigrations());
  await client.exec(`
    GRANT USAGE ON SCHEMA public TO ${APP_ROLE};
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE};
    RESET ROLE;
  `);

  // 準備はsuperuserのまま行う(RLSをバイパスできるので両テナント分を一度に入れられる)。
  const { rows } = await client.query<{ id: string; slug: string }>(
    "INSERT INTO tenants (name, slug) VALUES ('法人A', 'a'), ('法人B', 'b') RETURNING id, slug;",
  );
  const tenantA = rows.find((row) => row.slug === 'a')?.id;
  const tenantB = rows.find((row) => row.slug === 'b')?.id;
  if (!tenantA || !tenantB) throw new Error('テナントの準備に失敗しました');

  await client.query(
    "INSERT INTO staff (tenant_id, name, email) VALUES ($1, 'Aのスタッフ', 'a@example.test'), ($2, 'Bのスタッフ', 'b@example.test');",
    [tenantA, tenantB],
  );
  await client.query(
    "INSERT INTO customers (tenant_id, name, family_name, given_name) VALUES ($1, 'Aの利用者', 'A', '一郎'), ($2, 'Bの利用者', 'B', '二郎');",
    [tenantA, tenantB],
  );

  return { client, tenantA, tenantB };
}

/**
 * 指定ロール・指定テナントコンテキストで処理を実行する。
 * 本番の withTenant() と同じく `set_config(..., true)`(=SET LOCAL)なので、
 * トランザクションを抜ければコンテキストは残らない。
 */
async function runAs<T>(
  client: PGlite,
  role: string,
  tenantId: string | null,
  fn: () => Promise<T>,
): Promise<T> {
  await client.exec('BEGIN;');
  try {
    // ロール名は同ファイル内の定数のみ。値ではないのでプレースホルダにできない。
    await client.query(`SET LOCAL ROLE ${role};`);
    if (tenantId !== null) {
      await client.query("SELECT set_config('app.tenant_id', $1, true);", [tenantId]);
    }
    return await fn();
  } finally {
    // 失敗したトランザクションでもCOMMITは静かにロールバックされる。
    await client.exec('COMMIT;');
  }
}

async function selectEmails(client: PGlite): Promise<string[]> {
  const { rows } = await client.query<{ email: string }>('SELECT email FROM staff ORDER BY email;');
  return rows.map((row) => row.email);
}

async function countRows(client: PGlite, table: string): Promise<number> {
  const { rows } = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table};`);
  return rows[0]?.n ?? 0;
}

describe('RLSがクロステナントのアクセスを止める(PGlite)', () => {
  let fixture: Fixture;

  beforeAll(async () => {
    fixture = await createFixture();
  }, 60_000);

  afterAll(async () => {
    await fixture?.client.close();
  });

  it('前提: 非特権ロールが作れていて、テーブル所有者もsuperuserではない', async () => {
    // ここが崩れると以降のテストは「何も検証していないのに通る」状態になる。
    const { rows: roles } = await fixture.client.query<{
      rolname: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>('SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = ANY($1) ORDER BY rolname;', [
      [OWNER_ROLE, APP_ROLE],
    ]);
    expect(roles).toEqual([
      { rolname: APP_ROLE, rolsuper: false, rolbypassrls: false },
      { rolname: OWNER_ROLE, rolsuper: false, rolbypassrls: false },
    ]);

    const { rows: tables } = await fixture.client.query<{
      relname: string;
      owner: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `SELECT c.relname, pg_get_userbyid(c.relowner) AS owner, c.relrowsecurity, c.relforcerowsecurity
         FROM pg_class c
        WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN ('staff', 'customers')
        ORDER BY c.relname;`,
    );
    expect(tables).toEqual([
      { relname: 'customers', owner: OWNER_ROLE, relrowsecurity: true, relforcerowsecurity: true },
      { relname: 'staff', owner: OWNER_ROLE, relrowsecurity: true, relforcerowsecurity: true },
    ]);
  });

  it('テナントAのコンテキストからはテナントBの行が見えない', async () => {
    const seen = await runAs(fixture.client, APP_ROLE, fixture.tenantA, async () => ({
      staff: await selectEmails(fixture.client),
      customers: await countRows(fixture.client, 'customers'),
    }));

    expect(seen.staff).toEqual(['a@example.test']);
    expect(seen.customers).toBe(1);
  });

  it('テナントBのコンテキストではB側だけが見える(Aに固定されているわけではない)', async () => {
    const emails = await runAs(fixture.client, APP_ROLE, fixture.tenantB, () => selectEmails(fixture.client));

    expect(emails).toEqual(['b@example.test']);
  });

  it('テナントAのコンテキストで tenant_id=B の行はINSERTできない(WITH CHECK)', async () => {
    const attempt = runAs(fixture.client, APP_ROLE, fixture.tenantA, () =>
      fixture.client.query(
        "INSERT INTO staff (tenant_id, name, email) VALUES ($1, '侵入', 'evil@example.test');",
        [fixture.tenantB],
      ),
    );

    await expect(attempt).rejects.toThrow(/row-level security/i);
    // 弾かれた行が残っていないこと(superuserで全テナントを見て確認する)。
    expect(await countRows(fixture.client, 'staff')).toBe(2);
  });

  it('テナントAのコンテキストからテナントBの行はUPDATEもDELETEもできない', async () => {
    const affected = await runAs(fixture.client, APP_ROLE, fixture.tenantA, async () => {
      const updated = await fixture.client.query(
        "UPDATE staff SET name = '書き換え' WHERE email = 'b@example.test';",
      );
      const deleted = await fixture.client.query("DELETE FROM staff WHERE email = 'b@example.test';");
      return { updated: updated.affectedRows, deleted: deleted.affectedRows };
    });

    expect(affected).toEqual({ updated: 0, deleted: 0 });
    const { rows } = await fixture.client.query<{ name: string }>(
      "SELECT name FROM staff WHERE email = 'b@example.test';",
    );
    expect(rows).toEqual([{ name: 'Bのスタッフ' }]);
  });

  it('トランザクションを抜けるとテナントコンテキストは残らない', async () => {
    await runAs(fixture.client, APP_ROLE, fixture.tenantA, () => selectEmails(fixture.client));

    // set_config(..., true) はトランザクション終了で巻き戻る。巻き戻った後の値は
    // NULLではなく空文字になるため、ポリシーの ::uuid キャストが 22P02 で落ちる。
    // 「エラーで止まる」のも安全側なので、漏れないことだけを固定する。
    const leaked = await runAs(fixture.client, APP_ROLE, null, () =>
      selectEmails(fixture.client).catch(() => [] as string[]),
    );
    expect(leaked).toEqual([]);
  });

  it('superuserはRLSをバイパスする(だからこのテストは非特権ロールで行う必要がある)', async () => {
    // 逆向きの確認。これが失敗するなら、上のテストは非特権ロールでなくても通ってしまう。
    const emails = await runAs(fixture.client, 'postgres', fixture.tenantA, () =>
      selectEmails(fixture.client),
    );

    expect(emails).toEqual(['a@example.test', 'b@example.test']);
  });
});

/**
 * FORCE ROW LEVEL SECURITY が効いていることの確認。
 *
 * PostgreSQLはテーブル所有者に対してRLSを適用しない(FORCEを付けない限り)。
 * 本番のマイグレーション実行ユーザ=アプリの接続ユーザがテーブル所有者になっている構成では、
 * FORCEの付け忘れがそのままテナント分離の消滅になる。
 *
 * 「ENABLEだけの同型テーブル」を並べて、そちらでは所有者に全行が見えることを同時に示す。
 * こうしておかないと、このテストが本当にFORCEを見ているのか区別できない。
 */
describe('FORCE ROW LEVEL SECURITY(テーブル所有者にもRLSを適用する)', () => {
  let fixture: Fixture;

  beforeAll(async () => {
    fixture = await createFixture();
    // 比較用: 本番と同じポリシーだが FORCE を付けないテーブル。
    await fixture.client.exec(`SET ROLE ${OWNER_ROLE};`);
    await fixture.client.exec(`
      CREATE TABLE enable_only_probe (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL);
      ALTER TABLE enable_only_probe ENABLE ROW LEVEL SECURITY;
      CREATE POLICY "tenant_isolation" ON enable_only_probe AS PERMISSIVE FOR ALL TO public
        USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
      RESET ROLE;
    `);
    await fixture.client.query('INSERT INTO enable_only_probe (tenant_id) VALUES ($1), ($2);', [
      fixture.tenantA,
      fixture.tenantB,
    ]);
  }, 60_000);

  afterAll(async () => {
    await fixture?.client.close();
  });

  it('FORCEありのテーブルは、所有者ロールでもテナントAの行しか見えない', async () => {
    const emails = await runAs(fixture.client, OWNER_ROLE, fixture.tenantA, () =>
      selectEmails(fixture.client),
    );

    expect(emails).toEqual(['a@example.test']);
  });

  it('FORCEなしのテーブルは、所有者ロールに全テナントの行が見えてしまう', async () => {
    // = FORCEを書き忘れたテーブルで実際に起きること。上のテストの判別力の裏付け。
    const seen = await runAs(fixture.client, OWNER_ROLE, fixture.tenantA, () =>
      countRows(fixture.client, 'enable_only_probe'),
    );

    expect(seen).toBe(2);
  });

  it('FORCEなしでも、所有者でないアプリロールにはRLSが効く', async () => {
    await fixture.client.exec(`GRANT SELECT ON enable_only_probe TO ${APP_ROLE};`);

    const seen = await runAs(fixture.client, APP_ROLE, fixture.tenantA, () =>
      countRows(fixture.client, 'enable_only_probe'),
    );

    expect(seen).toBe(1);
  });
});

/**
 * app.tenant_id を一度も設定していない接続から何も見えないこと。
 *
 * 別のPGliteインスタンスを立てるのは、一度でも set_config した接続では
 * 巻き戻し後の値がNULLではなく空文字になり、「未設定」の本来の姿を再現できないため。
 */
describe('テナントコンテキストを張らない接続(安全側に倒れること)', () => {
  let fixture: Fixture;

  beforeAll(async () => {
    fixture = await createFixture();
  }, 60_000);

  afterAll(async () => {
    await fixture?.client.close();
  });

  it('app.tenant_id が未設定なら1件も見えない', async () => {
    const result = await runAs(fixture.client, APP_ROLE, null, async () => {
      const { rows } = await fixture.client.query<{ setting: string | null }>(
        "SELECT current_setting('app.tenant_id', true) AS setting;",
      );
      return { setting: rows[0]?.setting ?? null, staff: await countRows(fixture.client, 'staff') };
    });

    expect(result.setting).toBeNull();
    expect(result.staff).toBe(0);
  });

  it('未設定のままではINSERTもできない', async () => {
    const attempt = runAs(fixture.client, APP_ROLE, null, () =>
      fixture.client.query(
        "INSERT INTO staff (tenant_id, name, email) VALUES ($1, '幽霊', 'ghost@example.test');",
        [fixture.tenantA],
      ),
    );

    await expect(attempt).rejects.toThrow(/row-level security/i);
  });
});

/**
 * coupons/coupon_redemptions(doc/14 4.1章)専用のフィクスチャ。既存のcreateFixture()を
 * 拡張しない理由: あちらは他の2つのdescribeブロック(FORCEの比較用テーブル・
 * 未設定コンテキストの検証)でも使い回されており、そちらの期待値(staffの件数等)に
 * 影響を与えたくないため、新テーブル専用に独立させる。
 */
interface CouponFixture {
  client: PGlite;
  tenantA: string;
  tenantB: string;
  couponA: string;
  couponB: string;
  dailyReportA: string;
  dailyReportB: string;
}

async function createCouponFixture(): Promise<CouponFixture> {
  const client = new PGlite();
  await client.waitReady;

  await client.exec(`
    CREATE ROLE ${OWNER_ROLE} NOSUPERUSER NOBYPASSRLS NOLOGIN;
    CREATE ROLE ${APP_ROLE} NOSUPERUSER NOBYPASSRLS NOLOGIN;
    GRANT ALL ON SCHEMA public TO ${OWNER_ROLE};
    GRANT ${OWNER_ROLE} TO CURRENT_USER;
    GRANT ${APP_ROLE} TO CURRENT_USER;
  `);

  await client.exec(`SET ROLE ${OWNER_ROLE};`);
  await applyPendingMigrations(client, loadMigrations());
  await client.exec(`
    GRANT USAGE ON SCHEMA public TO ${APP_ROLE};
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE};
    RESET ROLE;
  `);

  const { rows: tenantRows } = await client.query<{ id: string; slug: string }>(
    "INSERT INTO tenants (name, slug) VALUES ('法人A', 'coupon-a'), ('法人B', 'coupon-b') RETURNING id, slug;",
  );
  const tenantA = tenantRows.find((row) => row.slug === 'coupon-a')?.id;
  const tenantB = tenantRows.find((row) => row.slug === 'coupon-b')?.id;
  if (!tenantA || !tenantB) throw new Error('テナントの準備に失敗しました');

  const { rows: staffRows } = await client.query<{ id: string; tenant_id: string }>(
    "INSERT INTO staff (tenant_id, name, email) VALUES ($1, 'Aのスタッフ', 'coupon-a@example.test'), ($2, 'Bのスタッフ', 'coupon-b@example.test') RETURNING id, tenant_id;",
    [tenantA, tenantB],
  );
  const { rows: customerRows } = await client.query<{ id: string; tenant_id: string }>(
    "INSERT INTO customers (tenant_id, name, family_name, given_name) VALUES ($1, 'Aの利用者', 'A', '一郎'), ($2, 'Bの利用者', 'B', '二郎') RETURNING id, tenant_id;",
    [tenantA, tenantB],
  );
  const staffA = staffRows.find((row) => row.tenant_id === tenantA)?.id;
  const staffB = staffRows.find((row) => row.tenant_id === tenantB)?.id;
  const customerA = customerRows.find((row) => row.tenant_id === tenantA)?.id;
  const customerB = customerRows.find((row) => row.tenant_id === tenantB)?.id;
  if (!staffA || !staffB || !customerA || !customerB) throw new Error('スタッフ/顧客の準備に失敗しました');

  const { rows: reportRows } = await client.query<{ id: string; tenant_id: string }>(
    `INSERT INTO daily_reports (tenant_id, staff_id, customer_id, occurred_at)
     VALUES ($1, $2, $3, now()), ($4, $5, $6, now())
     RETURNING id, tenant_id;`,
    [tenantA, staffA, customerA, tenantB, staffB, customerB],
  );
  const dailyReportA = reportRows.find((row) => row.tenant_id === tenantA)?.id;
  const dailyReportB = reportRows.find((row) => row.tenant_id === tenantB)?.id;
  if (!dailyReportA || !dailyReportB) throw new Error('日報の準備に失敗しました');

  const { rows: couponRows } = await client.query<{ id: string; tenant_id: string }>(
    `INSERT INTO coupons (tenant_id, code, name, discount_kind, discount_amount_yen)
     VALUES ($1, 'A-COUPON', 'Aのクーポン', 'amount', 500), ($2, 'B-COUPON', 'Bのクーポン', 'amount', 500)
     RETURNING id, tenant_id;`,
    [tenantA, tenantB],
  );
  const couponA = couponRows.find((row) => row.tenant_id === tenantA)?.id;
  const couponB = couponRows.find((row) => row.tenant_id === tenantB)?.id;
  if (!couponA || !couponB) throw new Error('クーポンの準備に失敗しました');

  await client.query(
    `INSERT INTO coupon_redemptions (tenant_id, daily_report_id, coupon_id, discount_kind, discount_amount_yen)
     VALUES ($1, $2, $3, 'amount', 500), ($4, $5, $6, 'amount', 500);`,
    [tenantA, dailyReportA, couponA, tenantB, dailyReportB, couponB],
  );

  return { client, tenantA, tenantB, couponA, couponB, dailyReportA, dailyReportB };
}

describe('coupons/coupon_redemptionsがクロステナントのアクセスを止める(doc/14 4.1章)', () => {
  let fixture: CouponFixture;

  beforeAll(async () => {
    fixture = await createCouponFixture();
  }, 60_000);

  afterAll(async () => {
    await fixture?.client.close();
  });

  it('前提: couponsもcoupon_redemptionsもRLSがENABLE+FORCEされている', async () => {
    const { rows: tables } = await fixture.client.query<{
      relname: string;
      owner: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `SELECT c.relname, pg_get_userbyid(c.relowner) AS owner, c.relrowsecurity, c.relforcerowsecurity
         FROM pg_class c
        WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN ('coupons', 'coupon_redemptions')
        ORDER BY c.relname;`,
    );
    expect(tables).toEqual([
      { relname: 'coupon_redemptions', owner: OWNER_ROLE, relrowsecurity: true, relforcerowsecurity: true },
      { relname: 'coupons', owner: OWNER_ROLE, relrowsecurity: true, relforcerowsecurity: true },
    ]);
  });

  it('テナントAのコンテキストからはテナントBのクーポンが見えない', async () => {
    const codes = await runAs(fixture.client, APP_ROLE, fixture.tenantA, async () => {
      const { rows } = await fixture.client.query<{ code: string }>(
        'SELECT code FROM coupons ORDER BY code;',
      );
      return rows.map((row) => row.code);
    });

    expect(codes).toEqual(['A-COUPON']);
  });

  it('テナントAのコンテキストからはテナントBの適用記録(coupon_redemptions)が見えない', async () => {
    const count = await runAs(fixture.client, APP_ROLE, fixture.tenantA, () =>
      countRows(fixture.client, 'coupon_redemptions'),
    );

    expect(count).toBe(1);
  });

  it('テナントAのコンテキストで tenant_id=B のクーポンはINSERTできない(WITH CHECK)', async () => {
    const attempt = runAs(fixture.client, APP_ROLE, fixture.tenantA, () =>
      fixture.client.query(
        `INSERT INTO coupons (tenant_id, code, name, discount_kind, discount_amount_yen)
         VALUES ($1, '侵入クーポン', '侵入', 'amount', 100);`,
        [fixture.tenantB],
      ),
    );

    await expect(attempt).rejects.toThrow(/row-level security/i);
    expect(await countRows(fixture.client, 'coupons')).toBe(2);
  });

  it('テナントAのコンテキストからテナントBのクーポンはUPDATEもDELETEもできない', async () => {
    const affected = await runAs(fixture.client, APP_ROLE, fixture.tenantA, async () => {
      const updated = await fixture.client.query(
        "UPDATE coupons SET name = '書き換え' WHERE code = 'B-COUPON';",
      );
      const deleted = await fixture.client.query("DELETE FROM coupons WHERE code = 'B-COUPON';");
      return { updated: updated.affectedRows, deleted: deleted.affectedRows };
    });

    expect(affected).toEqual({ updated: 0, deleted: 0 });
    const { rows } = await fixture.client.query<{ name: string }>(
      "SELECT name FROM coupons WHERE code = 'B-COUPON';",
    );
    expect(rows).toEqual([{ name: 'Bのクーポン' }]);
  });

  it('テナントAのコンテキストからテナントBの適用記録はUPDATEもDELETEもできない', async () => {
    const affected = await runAs(fixture.client, APP_ROLE, fixture.tenantA, async () => {
      const updated = await fixture.client.query(
        'UPDATE coupon_redemptions SET note = $1 WHERE daily_report_id = $2;',
        ['書き換え', fixture.dailyReportB],
      );
      const deleted = await fixture.client.query(
        'DELETE FROM coupon_redemptions WHERE daily_report_id = $1;',
        [fixture.dailyReportB],
      );
      return { updated: updated.affectedRows, deleted: deleted.affectedRows };
    });

    expect(affected).toEqual({ updated: 0, deleted: 0 });
    expect(await countRows(fixture.client, 'coupon_redemptions')).toBe(2);
  });
});
