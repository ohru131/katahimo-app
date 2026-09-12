import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DemoMigration } from './database';
import { applyPendingMigrations } from './database';

/**
 * doc/14 §4: CHECK制約が「実際に」不正値のINSERTを拒否することを、本番と同じマイグレーションを
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

/** 本番のマイグレーションSQLを、ファイル名順(=適用順)に全件読み込む。 */
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
  /** coupon_redemptionsのcoupon_redemptions_tenant_report_customer_fk用の親行。 */
  dailyReportId: string;
}

/** マイグレーションを当て、CHECK制約のテストに必要な親行(テナント/スタッフ/顧客/日報)を用意する。 */
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

  const {
    rows: [dailyReport],
  } = await client.query<{ id: string }>(
    'INSERT INTO daily_reports (tenant_id, staff_id, customer_id, occurred_at) VALUES ($1, $2, $3, now()) RETURNING id;',
    [tenant.id, staff.id, customer.id],
  );
  if (!dailyReport) throw new Error('日報の準備に失敗しました');

  return {
    client,
    tenantId: tenant.id,
    staffId: staff.id,
    customerId: customer.id,
    dailyReportId: dailyReport.id,
  };
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

  describe('attendance_days_row_data_object(doc/14 §2)', () => {
    // row_data(jsonb)の中身の形はアプリ境界(attendanceRowDataSchema)で検証しており、DB側は
    // 「そもそもオブジェクトかどうか」だけを縛っている。その最低線が実際に効いていることを
    // 固定する(配列やスカラを入れられると、アプリが visits/officeWork を読む前に壊れる)。
    it('オブジェクトのrow_dataは通る', async () => {
      await expect(
        fixture.client.query(
          `INSERT INTO attendance_days (tenant_id, staff_id, business_date, row_data)
           VALUES ($1, $2, '2026-03-01', $3::jsonb);`,
          [fixture.tenantId, fixture.staffId, '{"visits":[{"place":"○○様宅","start":"09:00"}]}'],
        ),
      ).resolves.toBeDefined();
    });

    it('配列のrow_dataは拒否される', async () => {
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO attendance_days (tenant_id, staff_id, business_date, row_data)
           VALUES ($1, $2, '2026-03-02', '[]'::jsonb);`,
          [fixture.tenantId, fixture.staffId],
        ),
        'attendance_days_row_data_object',
      );
    });

    it('スカラのrow_dataは拒否される', async () => {
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO attendance_days (tenant_id, staff_id, business_date, row_data)
           VALUES ($1, $2, '2026-03-03', '"C"'::jsonb);`,
          [fixture.tenantId, fixture.staffId],
        ),
        'attendance_days_row_data_object',
      );
    });
  });

  describe('daily_reports_time_order(doc/14 §6)', () => {
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
      // 変換を経た後の値がCHECK制約を通ることを固定する(doc/14 §6の検証項目)。
      await expect(
        fixture.client.query(
          `INSERT INTO daily_reports (tenant_id, staff_id, customer_id, occurred_at, started_at, ended_at)
           VALUES ($1, $2, $3, now(), '2026-08-30 22:00:00+09', '2026-08-31 01:00:00+09');`,
          [fixture.tenantId, fixture.staffId, fixture.customerId],
        ),
      ).resolves.toBeDefined();
    });
  });

  describe('customers_lat_range / customers_lng_range(doc/14 §7)', () => {
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

  describe('coupons_discount_kind_check / coupons_discount_value_check(doc/14 §9)', () => {
    it("discount_kind='amount'でdiscount_amount_yenのみ入っている(discount_percentはNULL)組み合わせは通る", async () => {
      await expect(
        fixture.client.query(
          `INSERT INTO coupons (tenant_id, code, name, discount_kind, discount_amount_yen)
           VALUES ($1, 'AMOUNT-OK', '金額引き', 'amount', 500);`,
          [fixture.tenantId],
        ),
      ).resolves.toBeDefined();
    });

    it("discount_kind='percent'でdiscount_percentのみ入っている(discount_amount_yenはNULL)組み合わせは通る", async () => {
      await expect(
        fixture.client.query(
          `INSERT INTO coupons (tenant_id, code, name, discount_kind, discount_percent)
           VALUES ($1, 'PERCENT-OK', '率引き', 'percent', 10);`,
          [fixture.tenantId],
        ),
      ).resolves.toBeDefined();
    });

    it('未知のdiscount_kindは拒否される', async () => {
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO coupons (tenant_id, code, name, discount_kind, discount_amount_yen)
           VALUES ($1, 'BAD-KIND', 'でたらめ', 'でたらめ', 500);`,
          [fixture.tenantId],
        ),
        'coupons_discount_kind_check',
      );
    });

    it("discount_kind='percent'なのにdiscount_amount_yenが入っていると拒否される(率引きなのに金額も入っている)", async () => {
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO coupons (tenant_id, code, name, discount_kind, discount_percent, discount_amount_yen)
           VALUES ($1, 'PERCENT-BAD', '率引きのはずが金額も', 'percent', 10, 500);`,
          [fixture.tenantId],
        ),
        'coupons_discount_value_check',
      );
    });

    it("discount_kind='amount'なのにdiscount_percentが入っていると拒否される(金額引きなのに率も入っている)", async () => {
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO coupons (tenant_id, code, name, discount_kind, discount_amount_yen, discount_percent)
           VALUES ($1, 'AMOUNT-BAD', '金額引きのはずが率も', 'amount', 500, 10);`,
          [fixture.tenantId],
        ),
        'coupons_discount_value_check',
      );
    });

    it("discount_kind='amount'なのに両方NULLだと拒否される(金額が抜けている)", async () => {
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO coupons (tenant_id, code, name, discount_kind)
           VALUES ($1, 'AMOUNT-MISSING', '金額が無い', 'amount');`,
          [fixture.tenantId],
        ),
        'coupons_discount_value_check',
      );
    });
  });

  describe('coupons_discount_amount_yen_check / coupons_discount_percent_check', () => {
    it('負のdiscount_amount_yenは拒否される', async () => {
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO coupons (tenant_id, code, name, discount_kind, discount_amount_yen)
           VALUES ($1, 'AMOUNT-NEG', '負の金額', 'amount', -1);`,
          [fixture.tenantId],
        ),
        'coupons_discount_amount_yen_check',
      );
    });

    it('discount_percentが0以下は拒否される', async () => {
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO coupons (tenant_id, code, name, discount_kind, discount_percent)
           VALUES ($1, 'PERCENT-ZERO', '0%引き', 'percent', 0);`,
          [fixture.tenantId],
        ),
        'coupons_discount_percent_check',
      );
    });

    it('discount_percentが101以上は拒否される', async () => {
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO coupons (tenant_id, code, name, discount_kind, discount_percent)
           VALUES ($1, 'PERCENT-OVER', '101%引き', 'percent', 101);`,
          [fixture.tenantId],
        ),
        'coupons_discount_percent_check',
      );
    });
  });

  describe('coupons_valid_period_check', () => {
    it('valid_from <= valid_to、またはどちらかがnullなら通る', async () => {
      const cases: [string, string][] = [
        ["'2026-01-01'", "'2026-12-31'"],
        ["'2026-01-01'", "'2026-01-01'"],
        ['null', "'2026-12-31'"],
        ["'2026-01-01'", 'null'],
        ['null', 'null'],
      ];
      for (const [index, [validFrom, validTo]] of cases.entries()) {
        await expect(
          fixture.client.query(
            `INSERT INTO coupons (tenant_id, code, name, discount_kind, discount_amount_yen, valid_from, valid_to)
             VALUES ($1, $2, '期間テスト', 'amount', 100, ${validFrom}, ${validTo});`,
            [fixture.tenantId, `PERIOD-OK-${index}`],
          ),
        ).resolves.toBeDefined();
      }
    });

    it('valid_to < valid_from(有効期間の逆転)は拒否される', async () => {
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO coupons (tenant_id, code, name, discount_kind, discount_amount_yen, valid_from, valid_to)
           VALUES ($1, 'PERIOD-REVERSED', '期間逆転', 'amount', 100, '2026-12-31', '2026-01-01');`,
          [fixture.tenantId],
        ),
        'coupons_valid_period_check',
      );
    });
  });

  describe('coupons_tenant_code_uidx', () => {
    it('同じテナント内で同じcodeを2回登録すると拒否される', async () => {
      await fixture.client.query(
        `INSERT INTO coupons (tenant_id, code, name, discount_kind, discount_amount_yen)
         VALUES ($1, 'DUP-CODE', '1つ目', 'amount', 100);`,
        [fixture.tenantId],
      );
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO coupons (tenant_id, code, name, discount_kind, discount_amount_yen)
           VALUES ($1, 'DUP-CODE', '2つ目(重複)', 'amount', 200);`,
          [fixture.tenantId],
        ),
        'coupons_tenant_code_uidx',
      );
    });
  });

  describe('coupon_redemptions_discount_kind_check / coupon_redemptions_discount_value_check', () => {
    /** coupon_redemptionsのcoupon_redemptions_tenant_coupon_fk用に、その場でクーポンを1件作る。 */
    async function createCoupon(client: PGlite, tenantId: string, code: string): Promise<string> {
      const {
        rows: [row],
      } = await client.query<{ id: string }>(
        `INSERT INTO coupons (tenant_id, code, name, discount_kind, discount_amount_yen)
         VALUES ($1, $2, 'テストクーポン', 'amount', 500) RETURNING id;`,
        [tenantId, code],
      );
      if (!row) throw new Error('クーポンの準備に失敗しました');
      return row.id;
    }

    it("discount_kind='amount'/'percent'それぞれ、値の組み合わせが正しければ通る", async () => {
      const amountCouponId = await createCoupon(fixture.client, fixture.tenantId, 'REDEEM-AMOUNT');
      await expect(
        fixture.client.query(
          `INSERT INTO coupon_redemptions (tenant_id, daily_report_id, customer_id, coupon_id, discount_kind, discount_amount_yen)
           VALUES ($1, $2, $3, $4, 'amount', 500);`,
          [fixture.tenantId, fixture.dailyReportId, fixture.customerId, amountCouponId],
        ),
      ).resolves.toBeDefined();

      const percentCouponId = await createCoupon(fixture.client, fixture.tenantId, 'REDEEM-PERCENT');
      await expect(
        fixture.client.query(
          `INSERT INTO coupon_redemptions (tenant_id, daily_report_id, customer_id, coupon_id, discount_kind, discount_percent)
           VALUES ($1, $2, $3, $4, 'percent', 10);`,
          [fixture.tenantId, fixture.dailyReportId, fixture.customerId, percentCouponId],
        ),
      ).resolves.toBeDefined();
    });

    it('未知のdiscount_kindは拒否される', async () => {
      const couponId = await createCoupon(fixture.client, fixture.tenantId, 'REDEEM-BADKIND');
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO coupon_redemptions (tenant_id, daily_report_id, customer_id, coupon_id, discount_kind, discount_amount_yen)
           VALUES ($1, $2, $3, $4, 'でたらめ', 500);`,
          [fixture.tenantId, fixture.dailyReportId, fixture.customerId, couponId],
        ),
        'coupon_redemptions_discount_kind_check',
      );
    });

    it("discount_kind='percent'なのにdiscount_amount_yenが入っていると拒否される(適用記録側も同じ組み合わせを縛る)", async () => {
      const couponId = await createCoupon(fixture.client, fixture.tenantId, 'REDEEM-MISMATCH');
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO coupon_redemptions
             (tenant_id, daily_report_id, customer_id, coupon_id, discount_kind, discount_percent, discount_amount_yen)
           VALUES ($1, $2, $3, $4, 'percent', 10, 500);`,
          [fixture.tenantId, fixture.dailyReportId, fixture.customerId, couponId],
        ),
        'coupon_redemptions_discount_value_check',
      );
    });
  });

  describe('coupon_redemptions_discount_amount_yen_check / coupon_redemptions_discount_percent_check', () => {
    /** coupon_redemptionsのcoupon_redemptions_tenant_coupon_fk用に、その場でクーポンを1件作る。 */
    async function createCoupon(client: PGlite, tenantId: string, code: string): Promise<string> {
      const {
        rows: [row],
      } = await client.query<{ id: string }>(
        `INSERT INTO coupons (tenant_id, code, name, discount_kind, discount_amount_yen)
         VALUES ($1, $2, 'テストクーポン', 'amount', 500) RETURNING id;`,
        [tenantId, code],
      );
      if (!row) throw new Error('クーポンの準備に失敗しました');
      return row.id;
    }

    it('正の金額・1〜100の率はそれぞれ通る(couponsマスタと同じ値域)', async () => {
      const amountCouponId = await createCoupon(fixture.client, fixture.tenantId, 'REDEEM-RANGE-AMOUNT');
      await expect(
        fixture.client.query(
          `INSERT INTO coupon_redemptions (tenant_id, daily_report_id, customer_id, coupon_id, discount_kind, discount_amount_yen)
           VALUES ($1, $2, $3, $4, 'amount', 500);`,
          [fixture.tenantId, fixture.dailyReportId, fixture.customerId, amountCouponId],
        ),
      ).resolves.toBeDefined();

      const percentCouponId = await createCoupon(fixture.client, fixture.tenantId, 'REDEEM-RANGE-PERCENT');
      await expect(
        fixture.client.query(
          `INSERT INTO coupon_redemptions (tenant_id, daily_report_id, customer_id, coupon_id, discount_kind, discount_percent)
           VALUES ($1, $2, $3, $4, 'percent', 100);`,
          [fixture.tenantId, fixture.dailyReportId, fixture.customerId, percentCouponId],
        ),
      ).resolves.toBeDefined();
    });

    it('負のdiscount_amount_yenは拒否される(適用記録は請求に使うスナップショットなので値域もDBで縛る)', async () => {
      const couponId = await createCoupon(fixture.client, fixture.tenantId, 'REDEEM-AMOUNT-NEG');
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO coupon_redemptions (tenant_id, daily_report_id, customer_id, coupon_id, discount_kind, discount_amount_yen)
           VALUES ($1, $2, $3, $4, 'amount', -1);`,
          [fixture.tenantId, fixture.dailyReportId, fixture.customerId, couponId],
        ),
        'coupon_redemptions_discount_amount_yen_check',
      );
    });

    it('discount_percentが0以下は拒否される', async () => {
      const couponId = await createCoupon(fixture.client, fixture.tenantId, 'REDEEM-PERCENT-ZERO');
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO coupon_redemptions (tenant_id, daily_report_id, customer_id, coupon_id, discount_kind, discount_percent)
           VALUES ($1, $2, $3, $4, 'percent', 0);`,
          [fixture.tenantId, fixture.dailyReportId, fixture.customerId, couponId],
        ),
        'coupon_redemptions_discount_percent_check',
      );
    });

    it('discount_percentが101以上は拒否される', async () => {
      const couponId = await createCoupon(fixture.client, fixture.tenantId, 'REDEEM-PERCENT-OVER');
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO coupon_redemptions (tenant_id, daily_report_id, customer_id, coupon_id, discount_kind, discount_percent)
           VALUES ($1, $2, $3, $4, 'percent', 101);`,
          [fixture.tenantId, fixture.dailyReportId, fixture.customerId, couponId],
        ),
        'coupon_redemptions_discount_percent_check',
      );
    });
  });

  describe('coupon_redemptions_report_coupon_uidx(同じ日報に同じクーポンを2回付けられない)', () => {
    it('同一(tenant_id, daily_report_id, coupon_id)の2回目のINSERTは拒否される', async () => {
      const {
        rows: [coupon],
      } = await fixture.client.query<{ id: string }>(
        `INSERT INTO coupons (tenant_id, code, name, discount_kind, discount_amount_yen)
         VALUES ($1, 'DUP-REDEEM', 'テストクーポン', 'amount', 500) RETURNING id;`,
        [fixture.tenantId],
      );
      if (!coupon) throw new Error('クーポンの準備に失敗しました');

      await fixture.client.query(
        `INSERT INTO coupon_redemptions (tenant_id, daily_report_id, customer_id, coupon_id, discount_kind, discount_amount_yen)
         VALUES ($1, $2, $3, $4, 'amount', 500);`,
        [fixture.tenantId, fixture.dailyReportId, fixture.customerId, coupon.id],
      );

      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO coupon_redemptions (tenant_id, daily_report_id, customer_id, coupon_id, discount_kind, discount_amount_yen)
           VALUES ($1, $2, $3, $4, 'amount', 500);`,
          [fixture.tenantId, fixture.dailyReportId, fixture.customerId, coupon.id],
        ),
        'coupon_redemptions_report_coupon_uidx',
      );
    });
  });
});
