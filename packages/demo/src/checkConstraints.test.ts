import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DemoMigration } from './database';
import { applyPendingMigrations } from './database';

/**
 * doc/14 D項: CHECK制約が「実際に」不正値のINSERTを拒否することを、本番と同じマイグレーションを
 * 当てた本物のPostgres(PGlite/WASM)で確かめる。
 *
 * rlsEnforcement.test.ts と違い、CHECK制約はテーブル所有者/superuserでも(RLSと違って)
 * バイパスされないため、ロールを作り分ける必要はなく、既定の接続のまま検証できる。
 *
 * 各制約について「正常値は通る」「不正値は拒否される」の両方を確認する。片方だけだと
 * 制約名の書き間違い(=実際には何も縛っていない)に気付けないため。拒否側は、エラーメッセージに
 * その制約名が含まれることまで見て、NOT NULL/FK等の別の理由で落ちて偶然テストが通る
 * (何も検証していないのに合格する)ことを防ぐ。
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

/** マイグレーションを当て、CHECK制約のテストに必要な親行(テナント/スタッフ/顧客)を用意する。 */
async function createFixture(): Promise<Fixture> {
  const client = new PGlite();
  await client.waitReady;
  await applyPendingMigrations(client, loadMigrations());

  const {
    rows: [tenant],
  } = await client.query<{ id: string }>(
    "INSERT INTO tenants (name, slug) VALUES ('テスト法人', 'check-constraints') RETURNING id;",
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

/**
 * 拒否されることと、その理由が狙った制約であることをまとめて確認する。
 * PostgreSQLはCHECK制約違反を `constraint_name` を含むエラーメッセージ(23514)で返す。
 */
async function expectRejectedByConstraint(promise: Promise<unknown>, constraintName: string): Promise<void> {
  await expect(promise).rejects.toThrow(new RegExp(constraintName));
}

describe('CHECK制約が不正値のINSERTを拒否する(PGlite)', () => {
  let fixture: Fixture;

  beforeAll(async () => {
    fixture = await createFixture();
  }, 60_000);

  afterAll(async () => {
    await fixture?.client.close();
  });

  describe('outbox_jobs_status_check', () => {
    it('許可された値(pending/processing/done/failed)は通る', async () => {
      for (const status of ['pending', 'processing', 'done', 'failed']) {
        await expect(
          fixture.client.query(
            "INSERT INTO outbox_jobs (tenant_id, kind, target_id, idempotency_key, status) VALUES ($1, 'daily_report', gen_random_uuid(), $2, $3);",
            [fixture.tenantId, `status-ok-${status}`, status],
          ),
        ).resolves.toBeDefined();
      }
    });

    it('未知のstatusは拒否される', async () => {
      await expectRejectedByConstraint(
        fixture.client.query(
          "INSERT INTO outbox_jobs (tenant_id, kind, target_id, idempotency_key, status) VALUES ($1, 'daily_report', gen_random_uuid(), 'status-ng', 'でたらめ');",
          [fixture.tenantId],
        ),
        'outbox_jobs_status_check',
      );
    });
  });

  describe('outbox_jobs_kind_check', () => {
    it('MirrorKindの許可値は通る', async () => {
      for (const kind of [
        'attendance_day',
        'attendance_aggregate',
        'daily_report',
        'accident_report',
        'receipt',
      ]) {
        await expect(
          fixture.client.query(
            'INSERT INTO outbox_jobs (tenant_id, kind, target_id, idempotency_key) VALUES ($1, $2, gen_random_uuid(), $3);',
            [fixture.tenantId, kind, `kind-ok-${kind}`],
          ),
        ).resolves.toBeDefined();
      }
    });

    it('MirrorKindに無い種別(例: 廃止されたcalendar_event)は拒否される', async () => {
      await expectRejectedByConstraint(
        fixture.client.query(
          "INSERT INTO outbox_jobs (tenant_id, kind, target_id, idempotency_key) VALUES ($1, 'calendar_event', gen_random_uuid(), 'kind-ng');",
          [fixture.tenantId],
        ),
        'outbox_jobs_kind_check',
      );
    });
  });

  describe('outbox_jobs_attempts_check', () => {
    it('0以上のattemptsは通る', async () => {
      await expect(
        fixture.client.query(
          "INSERT INTO outbox_jobs (tenant_id, kind, target_id, idempotency_key, attempts) VALUES ($1, 'daily_report', gen_random_uuid(), 'attempts-ok', 3);",
          [fixture.tenantId],
        ),
      ).resolves.toBeDefined();
    });

    it('負のattemptsは拒否される', async () => {
      await expectRejectedByConstraint(
        fixture.client.query(
          "INSERT INTO outbox_jobs (tenant_id, kind, target_id, idempotency_key, attempts) VALUES ($1, 'daily_report', gen_random_uuid(), 'attempts-ng', -1);",
          [fixture.tenantId],
        ),
        'outbox_jobs_attempts_check',
      );
    });
  });

  describe('accident_reports_report_type_check', () => {
    it("日本語の許可値('事故報告'/'ヒヤリハット')は通る", async () => {
      for (const reportType of ['事故報告', 'ヒヤリハット']) {
        await expect(
          fixture.client.query(
            'INSERT INTO accident_reports (tenant_id, staff_id, customer_id, occurred_at, report_type) VALUES ($1, $2, $3, now(), $4);',
            [fixture.tenantId, fixture.staffId, fixture.customerId, reportType],
          ),
        ).resolves.toBeDefined();
      }
    });

    it('許可外の文字列は拒否される', async () => {
      await expectRejectedByConstraint(
        fixture.client.query(
          "INSERT INTO accident_reports (tenant_id, staff_id, customer_id, occurred_at, report_type) VALUES ($1, $2, $3, now(), 'でたらめ');",
          [fixture.tenantId, fixture.staffId, fixture.customerId],
        ),
        'accident_reports_report_type_check',
      );
    });
  });

  describe('daily_reports_risk_rating_check / daily_reports_es_rating_check', () => {
    it('1〜5、またはnullは通る', async () => {
      for (const riskRating of [1, 5, null]) {
        await expect(
          fixture.client.query(
            'INSERT INTO daily_reports (tenant_id, staff_id, customer_id, occurred_at, risk_rating, es_rating) VALUES ($1, $2, $3, now(), $4, $4);',
            [fixture.tenantId, fixture.staffId, fixture.customerId, riskRating],
          ),
        ).resolves.toBeDefined();
      }
    });

    it('範囲外のrisk_ratingは拒否される', async () => {
      await expectRejectedByConstraint(
        fixture.client.query(
          'INSERT INTO daily_reports (tenant_id, staff_id, customer_id, occurred_at, risk_rating) VALUES ($1, $2, $3, now(), -999);',
          [fixture.tenantId, fixture.staffId, fixture.customerId],
        ),
        'daily_reports_risk_rating_check',
      );
    });

    it('範囲外のes_ratingは拒否される', async () => {
      await expectRejectedByConstraint(
        fixture.client.query(
          'INSERT INTO daily_reports (tenant_id, staff_id, customer_id, occurred_at, es_rating) VALUES ($1, $2, $3, now(), 0);',
          [fixture.tenantId, fixture.staffId, fixture.customerId],
        ),
        'daily_reports_es_rating_check',
      );
    });
  });

  describe('staff_failed_login_attempts_check', () => {
    it('0以上は通る', async () => {
      await expect(
        fixture.client.query(
          "INSERT INTO staff (tenant_id, name, email, failed_login_attempts) VALUES ($1, '正常スタッフ', 'ok-staff@example.test', 2);",
          [fixture.tenantId],
        ),
      ).resolves.toBeDefined();
    });

    it('負の値は拒否される', async () => {
      await expectRejectedByConstraint(
        fixture.client.query(
          "INSERT INTO staff (tenant_id, name, email, failed_login_attempts) VALUES ($1, '不正スタッフ', 'ng-staff@example.test', -1);",
          [fixture.tenantId],
        ),
        'staff_failed_login_attempts_check',
      );
    });
  });

  describe('password_reset_codes_failed_attempts_check', () => {
    it('0以上は通る', async () => {
      await expect(
        fixture.client.query(
          "INSERT INTO password_reset_codes (tenant_id, staff_id, code_verifier, expires_at, failed_attempts) VALUES ($1, $2, 'verifier-ok', now() + interval '1 hour', 1);",
          [fixture.tenantId, fixture.staffId],
        ),
      ).resolves.toBeDefined();
    });

    it('負の値は拒否される', async () => {
      await expectRejectedByConstraint(
        fixture.client.query(
          "INSERT INTO password_reset_codes (tenant_id, staff_id, code_verifier, expires_at, failed_attempts) VALUES ($1, $2, 'verifier-ng', now() + interval '1 hour', -1);",
          [fixture.tenantId, fixture.staffId],
        ),
        'password_reset_codes_failed_attempts_check',
      );
    });
  });

  describe('receipts_amount_yen_nonneg', () => {
    it('nullまたは0以上のamount_yenは通る', async () => {
      for (const amountYen of [null, 0, 1200]) {
        await expect(
          fixture.client.query(
            `INSERT INTO receipts (tenant_id, staff_id, receipt_timestamp, amount_yen, file_key, content_type)
             VALUES ($1, $2, now(), $3, 'file-key', 'image/jpeg');`,
            [fixture.tenantId, fixture.staffId, amountYen],
          ),
        ).resolves.toBeDefined();
      }
    });

    it('負のamount_yenは拒否される', async () => {
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO receipts (tenant_id, staff_id, receipt_timestamp, amount_yen, file_key, content_type)
           VALUES ($1, $2, now(), -1, 'file-key', 'image/jpeg');`,
          [fixture.tenantId, fixture.staffId],
        ),
        'receipts_amount_yen_nonneg',
      );
    });
  });

  describe('receipts_billing_type_check', () => {
    it("許可された値('customer_billable'/'company_expense')は通る", async () => {
      await expect(
        fixture.client.query(
          `INSERT INTO receipts (tenant_id, staff_id, customer_id, receipt_timestamp, billing_type, file_key, content_type)
           VALUES ($1, $2, $3, now(), 'customer_billable', 'file-key', 'image/jpeg');`,
          [fixture.tenantId, fixture.staffId, fixture.customerId],
        ),
      ).resolves.toBeDefined();
      await expect(
        fixture.client.query(
          `INSERT INTO receipts (tenant_id, staff_id, receipt_timestamp, billing_type, file_key, content_type)
           VALUES ($1, $2, now(), 'company_expense', 'file-key', 'image/jpeg');`,
          [fixture.tenantId, fixture.staffId],
        ),
      ).resolves.toBeDefined();
    });

    it('列を省略した場合は既定値company_expenseになる(取りこぼしが顧客請求に転ばないため)', async () => {
      const {
        rows: [row],
      } = await fixture.client.query<{ billing_type: string }>(
        `INSERT INTO receipts (tenant_id, staff_id, receipt_timestamp, file_key, content_type)
         VALUES ($1, $2, now(), 'file-key', 'image/jpeg') RETURNING billing_type;`,
        [fixture.tenantId, fixture.staffId],
      );
      expect(row?.billing_type).toBe('company_expense');
    });

    it('許可外の文字列は拒否される', async () => {
      // customer_idを埋めて receipts_billable_requires_customer には引っかからないようにし、
      // billing_type_checkだけを狙って落とす(そうしないと「顧客未紐付け」の理由で偶然弾かれて
      // しまい、billing_type_checkを検証したことにならない)。
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO receipts (tenant_id, staff_id, customer_id, receipt_timestamp, billing_type, file_key, content_type)
           VALUES ($1, $2, $3, now(), 'でたらめ', 'file-key', 'image/jpeg');`,
          [fixture.tenantId, fixture.staffId, fixture.customerId],
        ),
        'receipts_billing_type_check',
      );
    });
  });

  describe('receipts_billable_requires_customer', () => {
    it('顧客に紐付くcustomer_billableと、顧客に紐付かないcompany_expenseは通る', async () => {
      await expect(
        fixture.client.query(
          `INSERT INTO receipts (tenant_id, staff_id, customer_id, receipt_timestamp, billing_type, file_key, content_type)
           VALUES ($1, $2, $3, now(), 'customer_billable', 'file-key', 'image/jpeg');`,
          [fixture.tenantId, fixture.staffId, fixture.customerId],
        ),
      ).resolves.toBeDefined();
      await expect(
        fixture.client.query(
          `INSERT INTO receipts (tenant_id, staff_id, receipt_timestamp, billing_type, file_key, content_type)
           VALUES ($1, $2, now(), 'company_expense', 'file-key', 'image/jpeg');`,
          [fixture.tenantId, fixture.staffId],
        ),
      ).resolves.toBeDefined();
    });

    it('顧客に紐付かないのにcustomer_billableは拒否される(うっかり顧客に請求する事故を防ぐ)', async () => {
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO receipts (tenant_id, staff_id, receipt_timestamp, billing_type, file_key, content_type)
           VALUES ($1, $2, now(), 'customer_billable', 'file-key', 'image/jpeg');`,
          [fixture.tenantId, fixture.staffId],
        ),
        'receipts_billable_requires_customer',
      );
    });
  });

  describe('tenant_keys_version_check', () => {
    it('dek_version/kek_versionが1以上は通る', async () => {
      await expect(
        fixture.client.query(
          "INSERT INTO tenant_keys (tenant_id, dek_version, wrapped_dek, kek_version) VALUES ($1, 1, 'wrapped-ok', 1);",
          [fixture.tenantId],
        ),
      ).resolves.toBeDefined();
    });

    it('0以下のdek_versionは拒否される', async () => {
      await expectRejectedByConstraint(
        fixture.client.query(
          "INSERT INTO tenant_keys (tenant_id, dek_version, wrapped_dek, kek_version) VALUES ($1, 0, 'wrapped-ng', 1);",
          [fixture.tenantId],
        ),
        'tenant_keys_version_check',
      );
    });

    it('0以下のkek_versionは拒否される', async () => {
      await expectRejectedByConstraint(
        fixture.client.query(
          "INSERT INTO tenant_keys (tenant_id, dek_version, wrapped_dek, kek_version) VALUES ($1, 2, 'wrapped-ng-kek', 0);",
          [fixture.tenantId],
        ),
        'tenant_keys_version_check',
      );
    });
  });

  describe('daily_reports_time_order(doc/14 F項)', () => {
    it('started_at <= ended_at、またはどちらかがnullなら通る', async () => {
      for (const [startedAt, endedAt] of [
        ["'2026-08-30 09:00:00+09'", "'2026-08-30 11:00:00+09'"],
        ["'2026-08-30 09:00:00+09'", "'2026-08-30 09:00:00+09'"],
        ['null', "'2026-08-30 11:00:00+09'"],
        ["'2026-08-30 09:00:00+09'", 'null'],
        ['null', 'null'],
      ]) {
        await expect(
          fixture.client.query(
            `INSERT INTO daily_reports (tenant_id, staff_id, customer_id, occurred_at, started_at, ended_at)
             VALUES ($1, $2, $3, now(), ${startedAt}, ${endedAt});`,
            [fixture.tenantId, fixture.staffId, fixture.customerId],
          ),
        ).resolves.toBeDefined();
      }
    });

    it('ended_at < started_atは拒否される', async () => {
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO daily_reports (tenant_id, staff_id, customer_id, occurred_at, started_at, ended_at)
           VALUES ($1, $2, $3, now(), '2026-08-30 09:00:00+09', '2026-08-30 08:00:00+09');`,
          [fixture.tenantId, fixture.staffId, fixture.customerId],
        ),
        'daily_reports_time_order',
      );
    });

    it('日跨ぎ勤務(22:00〜翌01:00)は、endedAtを翌日にずらして保存すれば通る', async () => {
      // usecases/reports.tsのcomputeDailyReportTimesが行う「end<startなら翌日にずらす」
      // 変換を経た後の値がCHECK制約を通ることを固定する(doc/14 F項の検証項目)。
      await expect(
        fixture.client.query(
          `INSERT INTO daily_reports (tenant_id, staff_id, customer_id, occurred_at, started_at, ended_at)
           VALUES ($1, $2, $3, now(), '2026-08-30 22:00:00+09', '2026-08-31 01:00:00+09');`,
          [fixture.tenantId, fixture.staffId, fixture.customerId],
        ),
      ).resolves.toBeDefined();
    });
  });

  describe('customers_lat_range / customers_lng_range(doc/14 G項)', () => {
    it('値域内、またはnullは通る', async () => {
      for (const [lat, lng] of [
        ['38.26', '140.87'],
        ['-90', '-180'],
        ['90', '180'],
        ['null', 'null'],
      ]) {
        await expect(
          fixture.client.query(
            `INSERT INTO customers (tenant_id, name, family_name, given_name, lat, lng)
             VALUES ($1, 'テスト利用者', 'テスト', '太郎', ${lat}, ${lng});`,
            [fixture.tenantId],
          ),
        ).resolves.toBeDefined();
      }
    });

    it('緯度が値域外(-90〜90の外)は拒否される', async () => {
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO customers (tenant_id, name, family_name, given_name, lat)
           VALUES ($1, 'テスト利用者', 'テスト', '太郎', 91);`,
          [fixture.tenantId],
        ),
        'customers_lat_range',
      );
    });

    it('経度が値域外(-180〜180の外)は拒否される', async () => {
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO customers (tenant_id, name, family_name, given_name, lng)
           VALUES ($1, 'テスト利用者', 'テスト', '太郎', 181);`,
          [fixture.tenantId],
        ),
        'customers_lng_range',
      );
    });
  });
});
