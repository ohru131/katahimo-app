import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { CUSTOMER_NOTE_PHOTO_MAX_BYTES } from '@katahimo/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DemoMigration } from './database';
import { applyPendingMigrations } from './database';

/**
 * 直前のコミットで足したテーブル(customerNotes/reservations/billing/optimization/transport)の
 * CHECK制約・一意制約が、実際のPostgres(PGlite/WASM)で効いていることを固定する。
 *
 * checkConstraints.test.ts と同じ狙い・同じ作りにしている(そちらのdocコメント参照)。
 * CHECK制約はテーブル所有者/superuserでもバイパスされないため、RLSのテナントコンテキストを
 * 張らずに既定の接続のまま検証できる。各制約について「正常値は通る」「不正値は拒否される」の
 * 両方を確認し、拒否側は狙った制約名がエラーメッセージに含まれることまで見る
 * (NOT NULL/FK/他のCHECKなど別の理由で偶然落ちて合格したことにならないようにするため)。
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
  /** coupon_redemptionsのcoupon_redemptions_tenant_daily_report_fk用の親行。 */
  dailyReportId: string;
}

/** マイグレーションを当て、各テストで共通に使うテナント/スタッフ/顧客/日報を用意する。 */
async function createFixture(): Promise<Fixture> {
  const client = new PGlite();
  await client.waitReady;
  await applyPendingMigrations(client, loadMigrations());

  const {
    rows: [tenant],
  } = await client.query<{ id: string }>(
    "INSERT INTO tenants (name, slug) VALUES ('テスト法人', 'new-schema-constraints') RETURNING id;",
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

/** テストの都度、他のテストと衝突しない新しいスタッフを1件作る(一意制約を避けるため)。 */
async function createStaff(client: PGlite, tenantId: string): Promise<string> {
  const {
    rows: [row],
  } = await client.query<{ id: string }>(
    "INSERT INTO staff (tenant_id, name, email) VALUES ($1, '補助スタッフ', $2) RETURNING id;",
    [tenantId, `extra-staff-${randomUUID()}@example.test`],
  );
  if (!row) throw new Error('スタッフの準備に失敗しました');
  return row.id;
}

/** service_menus に1件作る(reservationsのFK用)。 */
async function createServiceMenu(client: PGlite, tenantId: string, code: string): Promise<string> {
  const {
    rows: [row],
  } = await client.query<{ id: string }>(
    `INSERT INTO service_menus (tenant_id, code, name, duration_minutes, base_price_yen)
     VALUES ($1, $2, 'テストメニュー', 60, 3000) RETURNING id;`,
    [tenantId, code],
  );
  if (!row) throw new Error('サービスメニューの準備に失敗しました');
  return row.id;
}

/** reservations に1件作る(reservation_assignments等のFK用)。 */
async function createReservation(
  client: PGlite,
  tenantId: string,
  customerId: string,
  serviceMenuId: string,
): Promise<string> {
  const {
    rows: [row],
  } = await client.query<{ id: string }>(
    `INSERT INTO reservations (tenant_id, customer_id, service_menu_id, source, start_at, end_at)
     VALUES ($1, $2, $3, 'web', '2026-04-01 09:00:00+09', '2026-04-01 10:00:00+09') RETURNING id;`,
    [tenantId, customerId, serviceMenuId],
  );
  if (!row) throw new Error('予約の準備に失敗しました');
  return row.id;
}

/** invoices に1件作る(invoice_linesのFK用。draftのまま金額は全て0で作る)。 */
async function createInvoice(
  client: PGlite,
  tenantId: string,
  customerId: string,
  invoiceNo: string,
): Promise<string> {
  const {
    rows: [row],
  } = await client.query<{ id: string }>(
    `INSERT INTO invoices
       (tenant_id, customer_id, invoice_no, status, billing_period_start, billing_period_end,
        subtotal_yen, discount_yen, tax_yen, total_yen)
     VALUES ($1, $2, $3, 'draft', '2026-04-01', '2026-04-30', 0, 0, 0, 0) RETURNING id;`,
    [tenantId, customerId, invoiceNo],
  );
  if (!row) throw new Error('請求書の準備に失敗しました');
  return row.id;
}

/** receipts に1件作る(invoice_linesのFK用)。 */
async function createReceipt(
  client: PGlite,
  tenantId: string,
  staffId: string,
  customerId: string,
): Promise<string> {
  const {
    rows: [row],
  } = await client.query<{ id: string }>(
    `INSERT INTO receipts (tenant_id, staff_id, customer_id, receipt_timestamp, billing_type, file_key, content_type)
     VALUES ($1, $2, $3, now(), 'customer_billable', $4, 'image/jpeg') RETURNING id;`,
    [tenantId, staffId, customerId, `receipt-key-${randomUUID()}`],
  );
  if (!row) throw new Error('領収書の準備に失敗しました');
  return row.id;
}

/** coupons に1件作る(coupon_redemptionsのFK用)。 */
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

/** coupon_redemptions に1件作る(invoice_linesのcoupon_discount行のFK用)。 */
async function createCouponRedemption(
  client: PGlite,
  tenantId: string,
  dailyReportId: string,
  couponId: string,
): Promise<string> {
  const {
    rows: [row],
  } = await client.query<{ id: string }>(
    `INSERT INTO coupon_redemptions (tenant_id, daily_report_id, coupon_id, discount_kind, discount_amount_yen)
     VALUES ($1, $2, $3, 'amount', 500) RETURNING id;`,
    [tenantId, dailyReportId, couponId],
  );
  if (!row) throw new Error('クーポン適用記録の準備に失敗しました');
  return row.id;
}

/** customer_notes に1件作る(customer_note_photosのFK用)。 */
async function createCustomerNote(
  client: PGlite,
  tenantId: string,
  customerId: string,
  staffId: string,
): Promise<string> {
  const {
    rows: [row],
  } = await client.query<{ id: string }>(
    `INSERT INTO customer_notes (tenant_id, customer_id, author_staff_id, category)
     VALUES ($1, $2, $3, 'chart') RETURNING id;`,
    [tenantId, customerId, staffId],
  );
  if (!row) throw new Error('カルテ記載の準備に失敗しました');
  return row.id;
}

/** trait_definitions に1件作る(customer_traits/staff_traitsのFK用。値の型はbool固定で足りる)。 */
async function createTraitDefinition(
  client: PGlite,
  tenantId: string,
  subjectKind: 'customer' | 'staff',
  code: string,
): Promise<string> {
  const {
    rows: [row],
  } = await client.query<{ id: string }>(
    `INSERT INTO trait_definitions (tenant_id, subject_kind, code, name, value_type)
     VALUES ($1, $2, $3, 'テスト項目', 'bool') RETURNING id;`,
    [tenantId, subjectKind, code],
  );
  if (!row) throw new Error('特性項目の準備に失敗しました');
  return row.id;
}

/** transport_allowance_rules に1件作る(travel_legsのFK用)。 */
async function createTransportAllowanceRule(
  client: PGlite,
  tenantId: string,
  transportMode: string,
  effectiveFrom: string,
): Promise<string> {
  const {
    rows: [row],
  } = await client.query<{ id: string }>(
    `INSERT INTO transport_allowance_rules (tenant_id, transport_mode, calc_kind, unit_amount_yen, effective_from)
     VALUES ($1, $2, 'per_km', 30, $3) RETURNING id;`,
    [tenantId, transportMode, effectiveFrom],
  );
  if (!row) throw new Error('移動手当単価の準備に失敗しました');
  return row.id;
}

describe('新規テーブルのCHECK制約が不正値のINSERTを拒否する(PGlite)', () => {
  let fixture: Fixture;

  beforeAll(async () => {
    fixture = await createFixture();
  }, 60_000);

  afterAll(async () => {
    await fixture?.client.close();
  });

  describe('customer_notes_category_check', () => {
    it('許可された区分は通る', async () => {
      await expect(
        fixture.client.query(
          `INSERT INTO customer_notes (tenant_id, customer_id, author_staff_id, category)
           VALUES ($1, $2, $3, 'chart');`,
          [fixture.tenantId, fixture.customerId, fixture.staffId],
        ),
      ).resolves.toBeDefined();
    });

    it('未知の区分は拒否される', async () => {
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO customer_notes (tenant_id, customer_id, author_staff_id, category)
           VALUES ($1, $2, $3, 'でたらめ');`,
          [fixture.tenantId, fixture.customerId, fixture.staffId],
        ),
        'customer_notes_category_check',
      );
    });
  });

  describe('customer_notes_resolved_pair_check', () => {
    it('resolved_atとresolved_by_staff_idが両方null、または両方入っていれば通る', async () => {
      await expect(
        fixture.client.query(
          `INSERT INTO customer_notes (tenant_id, customer_id, author_staff_id, category)
           VALUES ($1, $2, $3, 'carry_over');`,
          [fixture.tenantId, fixture.customerId, fixture.staffId],
        ),
      ).resolves.toBeDefined();

      await expect(
        fixture.client.query(
          `INSERT INTO customer_notes
             (tenant_id, customer_id, author_staff_id, category, resolved_at, resolved_by_staff_id)
           VALUES ($1, $2, $3, 'carry_over', now(), $3);`,
          [fixture.tenantId, fixture.customerId, fixture.staffId],
        ),
      ).resolves.toBeDefined();
    });

    it('resolved_atだけ入っていると拒否される', async () => {
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO customer_notes (tenant_id, customer_id, author_staff_id, category, resolved_at)
           VALUES ($1, $2, $3, 'carry_over', now());`,
          [fixture.tenantId, fixture.customerId, fixture.staffId],
        ),
        'customer_notes_resolved_pair_check',
      );
    });

    it('resolved_by_staff_idだけ入っていると拒否される', async () => {
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO customer_notes
             (tenant_id, customer_id, author_staff_id, category, resolved_by_staff_id)
           VALUES ($1, $2, $3, 'carry_over', $3);`,
          [fixture.tenantId, fixture.customerId, fixture.staffId],
        ),
        'customer_notes_resolved_pair_check',
      );
    });
  });

  describe('customer_note_photos_byte_size_check', () => {
    it('1バイト以上、上限(CUSTOMER_NOTE_PHOTO_MAX_BYTES)以下は通る', async () => {
      const noteId = await createCustomerNote(
        fixture.client,
        fixture.tenantId,
        fixture.customerId,
        fixture.staffId,
      );
      await expect(
        fixture.client.query(
          `INSERT INTO customer_note_photos
             (tenant_id, note_id, uploaded_by_staff_id, file_key, content_type, byte_size, sort_order)
           VALUES ($1, $2, $3, 'key-ok', 'image/jpeg', $4, 0);`,
          [fixture.tenantId, noteId, fixture.staffId, CUSTOMER_NOTE_PHOTO_MAX_BYTES],
        ),
      ).resolves.toBeDefined();
    });

    it('0バイトは拒否される', async () => {
      const noteId = await createCustomerNote(
        fixture.client,
        fixture.tenantId,
        fixture.customerId,
        fixture.staffId,
      );
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO customer_note_photos
             (tenant_id, note_id, uploaded_by_staff_id, file_key, content_type, byte_size, sort_order)
           VALUES ($1, $2, $3, 'key-zero', 'image/jpeg', 0, 0);`,
          [fixture.tenantId, noteId, fixture.staffId],
        ),
        'customer_note_photos_byte_size_check',
      );
    });

    it('上限を超えると拒否される', async () => {
      const noteId = await createCustomerNote(
        fixture.client,
        fixture.tenantId,
        fixture.customerId,
        fixture.staffId,
      );
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO customer_note_photos
             (tenant_id, note_id, uploaded_by_staff_id, file_key, content_type, byte_size, sort_order)
           VALUES ($1, $2, $3, 'key-over', 'image/jpeg', $4, 0);`,
          [fixture.tenantId, noteId, fixture.staffId, CUSTOMER_NOTE_PHOTO_MAX_BYTES + 1],
        ),
        'customer_note_photos_byte_size_check',
      );
    });
  });

  describe('customer_note_photos_sort_order_check', () => {
    // sortOrderに一意制約は無い(customerNotes.tsのコメント参照。並び替えのUPDATEが
    // 一意制約と衝突するため)。そのため同じ記載に同じsort_orderの2枚目は拒否されず、
    // 決定性は「ORDER BY sort_order, id」側で担保する方針であることをここで固定する。
    it('同じ記載に同じsort_orderの2枚目でも通る(一意制約を持たせない方針)', async () => {
      const noteId = await createCustomerNote(
        fixture.client,
        fixture.tenantId,
        fixture.customerId,
        fixture.staffId,
      );
      await expect(
        fixture.client.query(
          `INSERT INTO customer_note_photos
             (tenant_id, note_id, uploaded_by_staff_id, file_key, content_type, byte_size, sort_order)
           VALUES ($1, $2, $3, 'key-sort-1', 'image/jpeg', 1000, 0);`,
          [fixture.tenantId, noteId, fixture.staffId],
        ),
      ).resolves.toBeDefined();

      await expect(
        fixture.client.query(
          `INSERT INTO customer_note_photos
             (tenant_id, note_id, uploaded_by_staff_id, file_key, content_type, byte_size, sort_order)
           VALUES ($1, $2, $3, 'key-sort-2', 'image/jpeg', 1000, 0);`,
          [fixture.tenantId, noteId, fixture.staffId],
        ),
      ).resolves.toBeDefined();
    });

    it('負のsort_orderは拒否される', async () => {
      const noteId = await createCustomerNote(
        fixture.client,
        fixture.tenantId,
        fixture.customerId,
        fixture.staffId,
      );
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO customer_note_photos
             (tenant_id, note_id, uploaded_by_staff_id, file_key, content_type, byte_size, sort_order)
           VALUES ($1, $2, $3, 'key-sort-neg', 'image/jpeg', 1000, -1);`,
          [fixture.tenantId, noteId, fixture.staffId],
        ),
        'customer_note_photos_sort_order_check',
      );
    });
  });

  describe('service_menus_duration_minutes_check', () => {
    it('1〜1440分は通る', async () => {
      await expect(
        fixture.client.query(
          `INSERT INTO service_menus (tenant_id, code, name, duration_minutes, base_price_yen)
           VALUES ($1, 'DURATION-OK', 'テストメニュー', 60, 3000);`,
          [fixture.tenantId],
        ),
      ).resolves.toBeDefined();
    });

    it('0分は拒否される', async () => {
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO service_menus (tenant_id, code, name, duration_minutes, base_price_yen)
           VALUES ($1, 'DURATION-ZERO', 'テストメニュー', 0, 3000);`,
          [fixture.tenantId],
        ),
        'service_menus_duration_minutes_check',
      );
    });

    it('1441分は拒否される', async () => {
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO service_menus (tenant_id, code, name, duration_minutes, base_price_yen)
           VALUES ($1, 'DURATION-OVER', 'テストメニュー', 1441, 3000);`,
          [fixture.tenantId],
        ),
        'service_menus_duration_minutes_check',
      );
    });
  });

  describe('reservations_time_order_check', () => {
    it('end_at > start_atは通る', async () => {
      const serviceMenuId = await createServiceMenu(fixture.client, fixture.tenantId, 'TIME-ORDER-OK');
      await expect(
        fixture.client.query(
          `INSERT INTO reservations (tenant_id, customer_id, service_menu_id, source, start_at, end_at)
           VALUES ($1, $2, $3, 'web', '2026-04-01 09:00:00+09', '2026-04-01 10:00:00+09');`,
          [fixture.tenantId, fixture.customerId, serviceMenuId],
        ),
      ).resolves.toBeDefined();
    });

    it('end_at <= start_atは拒否される', async () => {
      const serviceMenuId = await createServiceMenu(fixture.client, fixture.tenantId, 'TIME-ORDER-NG');
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO reservations (tenant_id, customer_id, service_menu_id, source, start_at, end_at)
           VALUES ($1, $2, $3, 'web', '2026-04-01 10:00:00+09', '2026-04-01 09:00:00+09');`,
          [fixture.tenantId, fixture.customerId, serviceMenuId],
        ),
        'reservations_time_order_check',
      );
    });
  });

  describe('reservations_cancelled_at_check / reservations_completed_at_check', () => {
    it('状態とタイムスタンプが揃っていれば通る', async () => {
      const serviceMenuId = await createServiceMenu(fixture.client, fixture.tenantId, 'STATUS-TS-OK');

      await expect(
        fixture.client.query(
          `INSERT INTO reservations
             (tenant_id, customer_id, service_menu_id, status, source, start_at, end_at, cancelled_at)
           VALUES ($1, $2, $3, 'cancelled', 'web', '2026-04-02 09:00:00+09', '2026-04-02 10:00:00+09', now());`,
          [fixture.tenantId, fixture.customerId, serviceMenuId],
        ),
      ).resolves.toBeDefined();

      await expect(
        fixture.client.query(
          `INSERT INTO reservations
             (tenant_id, customer_id, service_menu_id, status, source, start_at, end_at, completed_at)
           VALUES ($1, $2, $3, 'completed', 'web', '2026-04-02 11:00:00+09', '2026-04-02 12:00:00+09', now());`,
          [fixture.tenantId, fixture.customerId, serviceMenuId],
        ),
      ).resolves.toBeDefined();
    });

    it('cancelledなのにcancelled_atが無いと拒否される', async () => {
      const serviceMenuId = await createServiceMenu(fixture.client, fixture.tenantId, 'STATUS-TS-NG-CANCEL');
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO reservations
             (tenant_id, customer_id, service_menu_id, status, source, start_at, end_at)
           VALUES ($1, $2, $3, 'cancelled', 'web', '2026-04-02 09:00:00+09', '2026-04-02 10:00:00+09');`,
          [fixture.tenantId, fixture.customerId, serviceMenuId],
        ),
        'reservations_cancelled_at_check',
      );
    });

    it('completedなのにcompleted_atが無いと拒否される', async () => {
      const serviceMenuId = await createServiceMenu(
        fixture.client,
        fixture.tenantId,
        'STATUS-TS-NG-COMPLETE',
      );
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO reservations
             (tenant_id, customer_id, service_menu_id, status, source, start_at, end_at)
           VALUES ($1, $2, $3, 'completed', 'web', '2026-04-02 09:00:00+09', '2026-04-02 10:00:00+09');`,
          [fixture.tenantId, fixture.customerId, serviceMenuId],
        ),
        'reservations_completed_at_check',
      );
    });
  });

  describe('reservation_assignments_primary_uidx', () => {
    it('主担当は1予約に1人まで(unassigned_atを入れた行は数えない)', async () => {
      const serviceMenuId = await createServiceMenu(fixture.client, fixture.tenantId, 'ASSIGN-PRIMARY');
      const reservationId = await createReservation(
        fixture.client,
        fixture.tenantId,
        fixture.customerId,
        serviceMenuId,
      );
      const staffB = await createStaff(fixture.client, fixture.tenantId);

      const {
        rows: [first],
      } = await fixture.client.query<{ id: string }>(
        `INSERT INTO reservation_assignments (tenant_id, reservation_id, staff_id, role)
         VALUES ($1, $2, $3, 'primary') RETURNING id;`,
        [fixture.tenantId, reservationId, fixture.staffId],
      );
      if (!first) throw new Error('主担当の準備に失敗しました');

      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO reservation_assignments (tenant_id, reservation_id, staff_id, role)
           VALUES ($1, $2, $3, 'primary');`,
          [fixture.tenantId, reservationId, staffB],
        ),
        'reservation_assignments_primary_uidx',
      );

      // 1人目の割当を外せば、2人目を主担当にできる(外した行は一意索引の対象外になるため)。
      await fixture.client.query('UPDATE reservation_assignments SET unassigned_at = now() WHERE id = $1;', [
        first.id,
      ]);

      await expect(
        fixture.client.query(
          `INSERT INTO reservation_assignments (tenant_id, reservation_id, staff_id, role)
           VALUES ($1, $2, $3, 'primary');`,
          [fixture.tenantId, reservationId, staffB],
        ),
      ).resolves.toBeDefined();
    });
  });

  describe('staff_availabilities_target_check', () => {
    it('weekdayのみ、またはspecific_dateのみは通る', async () => {
      await expect(
        fixture.client.query(
          `INSERT INTO staff_availabilities (tenant_id, staff_id, kind, weekday, start_time, end_time)
           VALUES ($1, $2, 'available', 2, '09:00', '17:00');`,
          [fixture.tenantId, fixture.staffId],
        ),
      ).resolves.toBeDefined();

      await expect(
        fixture.client.query(
          `INSERT INTO staff_availabilities (tenant_id, staff_id, kind, specific_date, start_time, end_time)
           VALUES ($1, $2, 'unavailable', '2026-04-20', '09:00', '17:00');`,
          [fixture.tenantId, fixture.staffId],
        ),
      ).resolves.toBeDefined();
    });

    it('両方null、または両方入っていると拒否される', async () => {
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO staff_availabilities (tenant_id, staff_id, kind, start_time, end_time)
           VALUES ($1, $2, 'available', '09:00', '17:00');`,
          [fixture.tenantId, fixture.staffId],
        ),
        'staff_availabilities_target_check',
      );

      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO staff_availabilities
             (tenant_id, staff_id, kind, weekday, specific_date, start_time, end_time)
           VALUES ($1, $2, 'available', 2, '2026-04-20', '09:00', '17:00');`,
          [fixture.tenantId, fixture.staffId],
        ),
        'staff_availabilities_target_check',
      );
    });
  });

  describe('staff_availabilities_time_order_check', () => {
    it('end_time > start_timeは通る', async () => {
      await expect(
        fixture.client.query(
          `INSERT INTO staff_availabilities (tenant_id, staff_id, kind, weekday, start_time, end_time)
           VALUES ($1, $2, 'available', 3, '09:00', '17:00');`,
          [fixture.tenantId, fixture.staffId],
        ),
      ).resolves.toBeDefined();
    });

    it('end_time <= start_timeは拒否される', async () => {
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO staff_availabilities (tenant_id, staff_id, kind, weekday, start_time, end_time)
           VALUES ($1, $2, 'available', 4, '17:00', '09:00');`,
          [fixture.tenantId, fixture.staffId],
        ),
        'staff_availabilities_time_order_check',
      );
    });
  });

  describe('invoices_total_consistency_check', () => {
    it('subtotal - discount + tax = totalなら通る', async () => {
      await expect(
        fixture.client.query(
          `INSERT INTO invoices
             (tenant_id, customer_id, invoice_no, status, billing_period_start, billing_period_end,
              subtotal_yen, discount_yen, tax_yen, total_yen)
           VALUES ($1, $2, 'TOTAL-OK', 'draft', '2026-04-01', '2026-04-30', 10000, 1000, 900, 9900);`,
          [fixture.tenantId, fixture.customerId],
        ),
      ).resolves.toBeDefined();
    });

    it('一致しない場合は拒否される', async () => {
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO invoices
             (tenant_id, customer_id, invoice_no, status, billing_period_start, billing_period_end,
              subtotal_yen, discount_yen, tax_yen, total_yen)
           VALUES ($1, $2, 'TOTAL-NG', 'draft', '2026-04-01', '2026-04-30', 10000, 1000, 900, 12345);`,
          [fixture.tenantId, fixture.customerId],
        ),
        'invoices_total_consistency_check',
      );
    });
  });

  describe('invoices_issued_at_check / invoices_paid_at_check', () => {
    it('draftはissued_atがnull、open以降はissued_atありで通る', async () => {
      await expect(
        fixture.client.query(
          `INSERT INTO invoices
             (tenant_id, customer_id, invoice_no, status, billing_period_start, billing_period_end,
              subtotal_yen, discount_yen, tax_yen, total_yen)
           VALUES ($1, $2, 'ISSUED-DRAFT-OK', 'draft', '2026-04-01', '2026-04-30', 0, 0, 0, 0);`,
          [fixture.tenantId, fixture.customerId],
        ),
      ).resolves.toBeDefined();

      await expect(
        fixture.client.query(
          `INSERT INTO invoices
             (tenant_id, customer_id, invoice_no, status, billing_period_start, billing_period_end,
              subtotal_yen, discount_yen, tax_yen, total_yen, issued_at)
           VALUES ($1, $2, 'ISSUED-OPEN-OK', 'open', '2026-04-01', '2026-04-30', 0, 0, 0, 0, now());`,
          [fixture.tenantId, fixture.customerId],
        ),
      ).resolves.toBeDefined();
    });

    it('draftなのにissued_atが入っていると拒否される', async () => {
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO invoices
             (tenant_id, customer_id, invoice_no, status, billing_period_start, billing_period_end,
              subtotal_yen, discount_yen, tax_yen, total_yen, issued_at)
           VALUES ($1, $2, 'ISSUED-DRAFT-NG', 'draft', '2026-04-01', '2026-04-30', 0, 0, 0, 0, now());`,
          [fixture.tenantId, fixture.customerId],
        ),
        'invoices_issued_at_check',
      );
    });

    it('openなのにissued_atが無いと拒否される', async () => {
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO invoices
             (tenant_id, customer_id, invoice_no, status, billing_period_start, billing_period_end,
              subtotal_yen, discount_yen, tax_yen, total_yen)
           VALUES ($1, $2, 'ISSUED-OPEN-NG', 'open', '2026-04-01', '2026-04-30', 0, 0, 0, 0);`,
          [fixture.tenantId, fixture.customerId],
        ),
        'invoices_issued_at_check',
      );
    });

    it('paidにはpaid_atが必要(無いと拒否される)', async () => {
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO invoices
             (tenant_id, customer_id, invoice_no, status, billing_period_start, billing_period_end,
              subtotal_yen, discount_yen, tax_yen, total_yen, issued_at)
           VALUES ($1, $2, 'PAID-NG', 'paid', '2026-04-01', '2026-04-30', 0, 0, 0, 0, now());`,
          [fixture.tenantId, fixture.customerId],
        ),
        'invoices_paid_at_check',
      );
    });

    it('paidでpaid_atがあれば通る', async () => {
      await expect(
        fixture.client.query(
          `INSERT INTO invoices
             (tenant_id, customer_id, invoice_no, status, billing_period_start, billing_period_end,
              subtotal_yen, discount_yen, tax_yen, total_yen, issued_at, paid_at)
           VALUES ($1, $2, 'PAID-OK', 'paid', '2026-04-01', '2026-04-30', 0, 0, 0, 0, now(), now());`,
          [fixture.tenantId, fixture.customerId],
        ),
      ).resolves.toBeDefined();
    });
  });

  describe('invoice_lines_amount_sign_check', () => {
    it('coupon_discountは0以下、adjustmentは正負どちらも、それ以外は0以上が通る', async () => {
      const invoiceId = await createInvoice(
        fixture.client,
        fixture.tenantId,
        fixture.customerId,
        'LINES-SIGN-OK',
      );
      const couponId = await createCoupon(fixture.client, fixture.tenantId, 'SIGN-OK-COUPON');
      const couponRedemptionId = await createCouponRedemption(
        fixture.client,
        fixture.tenantId,
        fixture.dailyReportId,
        couponId,
      );

      await expect(
        fixture.client.query(
          `INSERT INTO invoice_lines
             (tenant_id, invoice_id, line_no, kind, description, amount_yen, coupon_redemption_id)
           VALUES ($1, $2, 1, 'coupon_discount', '割引', -500, $3);`,
          [fixture.tenantId, invoiceId, couponRedemptionId],
        ),
      ).resolves.toBeDefined();

      await expect(
        fixture.client.query(
          `INSERT INTO invoice_lines (tenant_id, invoice_id, line_no, kind, description, amount_yen)
           VALUES ($1, $2, 2, 'adjustment', '調整(マイナス)', -1000);`,
          [fixture.tenantId, invoiceId],
        ),
      ).resolves.toBeDefined();

      await expect(
        fixture.client.query(
          `INSERT INTO invoice_lines (tenant_id, invoice_id, line_no, kind, description, amount_yen)
           VALUES ($1, $2, 3, 'adjustment', '調整(プラス)', 1000);`,
          [fixture.tenantId, invoiceId],
        ),
      ).resolves.toBeDefined();

      await expect(
        fixture.client.query(
          `INSERT INTO invoice_lines (tenant_id, invoice_id, line_no, kind, description, amount_yen)
           VALUES ($1, $2, 4, 'service', 'サービス提供', 3000);`,
          [fixture.tenantId, invoiceId],
        ),
      ).resolves.toBeDefined();
    });

    it('coupon_discountに正の金額を入れると拒否される', async () => {
      const invoiceId = await createInvoice(
        fixture.client,
        fixture.tenantId,
        fixture.customerId,
        'LINES-SIGN-NG',
      );
      const couponId = await createCoupon(fixture.client, fixture.tenantId, 'SIGN-NG-COUPON');
      const couponRedemptionId = await createCouponRedemption(
        fixture.client,
        fixture.tenantId,
        fixture.dailyReportId,
        couponId,
      );

      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO invoice_lines
             (tenant_id, invoice_id, line_no, kind, description, amount_yen, coupon_redemption_id)
           VALUES ($1, $2, 1, 'coupon_discount', '割引(符号ミス)', 500, $3);`,
          [fixture.tenantId, invoiceId, couponRedemptionId],
        ),
        'invoice_lines_amount_sign_check',
      );
    });
  });

  describe('invoice_lines_source_check', () => {
    it('receipt_billableはreceipt_idがあれば通る', async () => {
      const invoiceId = await createInvoice(
        fixture.client,
        fixture.tenantId,
        fixture.customerId,
        'LINES-SOURCE-OK',
      );
      const receiptId = await createReceipt(
        fixture.client,
        fixture.tenantId,
        fixture.staffId,
        fixture.customerId,
      );

      await expect(
        fixture.client.query(
          `INSERT INTO invoice_lines (tenant_id, invoice_id, line_no, kind, description, amount_yen, receipt_id)
           VALUES ($1, $2, 1, 'receipt_billable', '立替', 1000, $3);`,
          [fixture.tenantId, invoiceId, receiptId],
        ),
      ).resolves.toBeDefined();
    });

    it('receipt_billableなのにreceipt_idが無いと拒否される', async () => {
      const invoiceId = await createInvoice(
        fixture.client,
        fixture.tenantId,
        fixture.customerId,
        'LINES-SOURCE-NG',
      );

      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO invoice_lines (tenant_id, invoice_id, line_no, kind, description, amount_yen)
           VALUES ($1, $2, 1, 'receipt_billable', '立替(根拠なし)', 1000);`,
          [fixture.tenantId, invoiceId],
        ),
        'invoice_lines_source_check',
      );
    });
  });

  describe('invoice_lines_tenant_receipt_uidx(同じ領収書を2つの明細に載せられない=二重請求防止)', () => {
    it('同一receipt_idの2件目のINSERTは拒否される', async () => {
      const invoiceId = await createInvoice(
        fixture.client,
        fixture.tenantId,
        fixture.customerId,
        'LINES-RECEIPT-DUP',
      );
      const receiptId = await createReceipt(
        fixture.client,
        fixture.tenantId,
        fixture.staffId,
        fixture.customerId,
      );

      await fixture.client.query(
        `INSERT INTO invoice_lines (tenant_id, invoice_id, line_no, kind, description, amount_yen, receipt_id)
         VALUES ($1, $2, 1, 'receipt_billable', '立替1', 1000, $3);`,
        [fixture.tenantId, invoiceId, receiptId],
      );

      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO invoice_lines (tenant_id, invoice_id, line_no, kind, description, amount_yen, receipt_id)
           VALUES ($1, $2, 2, 'receipt_billable', '立替2(重複)', 1000, $3);`,
          [fixture.tenantId, invoiceId, receiptId],
        ),
        'invoice_lines_tenant_receipt_uidx',
      );
    });
  });

  describe('payments_refunded_amount_check', () => {
    it('返金額が決済額以下なら通る', async () => {
      await expect(
        fixture.client.query(
          `INSERT INTO payments
             (tenant_id, customer_id, status, method_kind, amount_yen, refunded_amount_yen, paid_at)
           VALUES ($1, $2, 'succeeded', 'onsite_cash', 1000, 500, now());`,
          [fixture.tenantId, fixture.customerId],
        ),
      ).resolves.toBeDefined();
    });

    it('返金額が決済額を超えると拒否される', async () => {
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO payments
             (tenant_id, customer_id, status, method_kind, amount_yen, refunded_amount_yen, paid_at)
           VALUES ($1, $2, 'succeeded', 'onsite_cash', 1000, 1500, now());`,
          [fixture.tenantId, fixture.customerId],
        ),
        'payments_refunded_amount_check',
      );
    });
  });

  describe('payments_stripe_id_presence_check', () => {
    it('cardならPaymentIntentあり、onsite_cashならPaymentIntent無しで通る', async () => {
      await expect(
        fixture.client.query(
          `INSERT INTO payments (tenant_id, customer_id, status, method_kind, amount_yen, stripe_payment_intent_id)
           VALUES ($1, $2, 'requires_payment_method', 'card', 1000, 'pi_presence_ok');`,
          [fixture.tenantId, fixture.customerId],
        ),
      ).resolves.toBeDefined();

      await expect(
        fixture.client.query(
          `INSERT INTO payments (tenant_id, customer_id, status, method_kind, amount_yen)
           VALUES ($1, $2, 'requires_payment_method', 'onsite_cash', 1000);`,
          [fixture.tenantId, fixture.customerId],
        ),
      ).resolves.toBeDefined();
    });

    it('cardなのにPaymentIntentが無いと拒否される', async () => {
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO payments (tenant_id, customer_id, status, method_kind, amount_yen)
           VALUES ($1, $2, 'requires_payment_method', 'card', 1000);`,
          [fixture.tenantId, fixture.customerId],
        ),
        'payments_stripe_id_presence_check',
      );
    });

    it('onsite_cashなのにPaymentIntentがあると拒否される', async () => {
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO payments (tenant_id, customer_id, status, method_kind, amount_yen, stripe_payment_intent_id)
           VALUES ($1, $2, 'requires_payment_method', 'onsite_cash', 1000, 'pi_should_not_exist');`,
          [fixture.tenantId, fixture.customerId],
        ),
        'payments_stripe_id_presence_check',
      );
    });
  });

  describe('payments_paid_at_check', () => {
    it('succeededでpaid_atがあれば通る', async () => {
      await expect(
        fixture.client.query(
          `INSERT INTO payments
             (tenant_id, customer_id, status, method_kind, amount_yen, stripe_payment_intent_id, paid_at)
           VALUES ($1, $2, 'succeeded', 'card', 1000, 'pi_paid_ok', now());`,
          [fixture.tenantId, fixture.customerId],
        ),
      ).resolves.toBeDefined();
    });

    it('succeededなのにpaid_atが無いと拒否される', async () => {
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO payments
             (tenant_id, customer_id, status, method_kind, amount_yen, stripe_payment_intent_id)
           VALUES ($1, $2, 'succeeded', 'card', 1000, 'pi_paid_missing');`,
          [fixture.tenantId, fixture.customerId],
        ),
        'payments_paid_at_check',
      );
    });
  });

  describe('stripe_webhook_events_tenant_event_uk(冪等化)', () => {
    it('同じstripe_event_idの2件目のINSERTは拒否される', async () => {
      await fixture.client.query(
        `INSERT INTO stripe_webhook_events (tenant_id, stripe_event_id, event_type, payload)
         VALUES ($1, 'evt_dup', 'payment_intent.succeeded', '{}'::jsonb);`,
        [fixture.tenantId],
      );

      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO stripe_webhook_events (tenant_id, stripe_event_id, event_type, payload)
           VALUES ($1, 'evt_dup', 'payment_intent.succeeded', '{}'::jsonb);`,
          [fixture.tenantId],
        ),
        'stripe_webhook_events_tenant_event_uk',
      );
    });
  });

  describe('trait_definitions_scale_check', () => {
    it("valueType='scale'は範囲ありで、それ以外は範囲無しで通る", async () => {
      await expect(
        fixture.client.query(
          `INSERT INTO trait_definitions (tenant_id, subject_kind, code, name, value_type, scale_min, scale_max)
           VALUES ($1, 'customer', 'SCALE-OK', 'テスト項目', 'scale', 1, 5);`,
          [fixture.tenantId],
        ),
      ).resolves.toBeDefined();

      await expect(
        fixture.client.query(
          `INSERT INTO trait_definitions (tenant_id, subject_kind, code, name, value_type)
           VALUES ($1, 'customer', 'BOOL-OK', 'テスト項目', 'bool');`,
          [fixture.tenantId],
        ),
      ).resolves.toBeDefined();
    });

    it("valueType='scale'なのに範囲が無いと拒否される", async () => {
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO trait_definitions (tenant_id, subject_kind, code, name, value_type)
           VALUES ($1, 'customer', 'SCALE-MISSING', 'テスト項目', 'scale');`,
          [fixture.tenantId],
        ),
        'trait_definitions_scale_check',
      );
    });

    it("valueType='bool'なのに範囲が入っていると拒否される", async () => {
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO trait_definitions (tenant_id, subject_kind, code, name, value_type, scale_min, scale_max)
           VALUES ($1, 'customer', 'BOOL-WITH-RANGE', 'テスト項目', 'bool', 1, 5);`,
          [fixture.tenantId],
        ),
        'trait_definitions_scale_check',
      );
    });
  });

  describe('trait_definitions_choices_check', () => {
    it("valueType='choice'は選択肢ありで、それ以外は選択肢無しで通る", async () => {
      await expect(
        fixture.client.query(
          `INSERT INTO trait_definitions (tenant_id, subject_kind, code, name, value_type, choices)
           VALUES ($1, 'customer', 'CHOICE-OK', 'テスト項目', 'choice', '["犬", "猫"]'::jsonb);`,
          [fixture.tenantId],
        ),
      ).resolves.toBeDefined();
    });

    it("valueType='choice'なのに選択肢が無い(NULL)と拒否される", async () => {
      // CHECK式には choices IS NOT NULL を明示的に含める必要がある(optimization.tsのコメント参照)。
      // jsonb_typeof(NULL) はfalseではなくNULLを返すため、これが無いと choices=NULL の行で
      // 式全体がNULLになり、PostgreSQLはNULL評価のCHECK制約を「違反ではない」として素通りさせる。
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO trait_definitions (tenant_id, subject_kind, code, name, value_type)
           VALUES ($1, 'customer', 'CHOICE-MISSING', 'テスト項目', 'choice');`,
          [fixture.tenantId],
        ),
        'trait_definitions_choices_check',
      );
    });

    it("valueType='choice'なのに選択肢が空配列だと拒否される", async () => {
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO trait_definitions (tenant_id, subject_kind, code, name, value_type, choices)
           VALUES ($1, 'customer', 'CHOICE-EMPTY', 'テスト項目', 'choice', '[]'::jsonb);`,
          [fixture.tenantId],
        ),
        'trait_definitions_choices_check',
      );
    });

    it("valueType='bool'なのに選択肢が入っていると拒否される", async () => {
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO trait_definitions (tenant_id, subject_kind, code, name, value_type, choices)
           VALUES ($1, 'customer', 'BOOL-WITH-CHOICES', 'テスト項目', 'bool', '["犬"]'::jsonb);`,
          [fixture.tenantId],
        ),
        'trait_definitions_choices_check',
      );
    });
  });

  describe('customer_traits_exactly_one_value_check', () => {
    it('value_bool/value_int/value_textのうちちょうど1つが入っていれば通る', async () => {
      const definitionId = await createTraitDefinition(
        fixture.client,
        fixture.tenantId,
        'customer',
        'CT-EXACTLY-OK',
      );
      await expect(
        fixture.client.query(
          `INSERT INTO customer_traits (tenant_id, customer_id, definition_id, value_bool)
           VALUES ($1, $2, $3, true);`,
          [fixture.tenantId, fixture.customerId, definitionId],
        ),
      ).resolves.toBeDefined();
    });

    it('どれも入っていないと拒否される', async () => {
      const definitionId = await createTraitDefinition(
        fixture.client,
        fixture.tenantId,
        'customer',
        'CT-EXACTLY-ZERO',
      );
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO customer_traits (tenant_id, customer_id, definition_id)
           VALUES ($1, $2, $3);`,
          [fixture.tenantId, fixture.customerId, definitionId],
        ),
        'customer_traits_exactly_one_value_check',
      );
    });

    it('2つ入っていると拒否される', async () => {
      const definitionId = await createTraitDefinition(
        fixture.client,
        fixture.tenantId,
        'customer',
        'CT-EXACTLY-TWO',
      );
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO customer_traits (tenant_id, customer_id, definition_id, value_bool, value_int)
           VALUES ($1, $2, $3, true, 1);`,
          [fixture.tenantId, fixture.customerId, definitionId],
        ),
        'customer_traits_exactly_one_value_check',
      );
    });
  });

  describe('staff_traits_exactly_one_value_check', () => {
    it('value_bool/value_int/value_textのうちちょうど1つが入っていれば通る', async () => {
      const definitionId = await createTraitDefinition(
        fixture.client,
        fixture.tenantId,
        'staff',
        'ST-EXACTLY-OK',
      );
      await expect(
        fixture.client.query(
          `INSERT INTO staff_traits (tenant_id, staff_id, definition_id, value_text)
           VALUES ($1, $2, $3, '几帳面');`,
          [fixture.tenantId, fixture.staffId, definitionId],
        ),
      ).resolves.toBeDefined();
    });

    it('どれも入っていないと拒否される', async () => {
      const definitionId = await createTraitDefinition(
        fixture.client,
        fixture.tenantId,
        'staff',
        'ST-EXACTLY-ZERO',
      );
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO staff_traits (tenant_id, staff_id, definition_id)
           VALUES ($1, $2, $3);`,
          [fixture.tenantId, fixture.staffId, definitionId],
        ),
        'staff_traits_exactly_one_value_check',
      );
    });

    it('2つ入っていると拒否される', async () => {
      const definitionId = await createTraitDefinition(
        fixture.client,
        fixture.tenantId,
        'staff',
        'ST-EXACTLY-TWO',
      );
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO staff_traits (tenant_id, staff_id, definition_id, value_int, value_text)
           VALUES ($1, $2, $3, 1, 'テキストも');`,
          [fixture.tenantId, fixture.staffId, definitionId],
        ),
        'staff_traits_exactly_one_value_check',
      );
    });
  });

  describe('staff_customer_compatibilities_score_check', () => {
    it('1〜5、またはnullは通る', async () => {
      for (const score of [1, 5, null]) {
        const staffId = await createStaff(fixture.client, fixture.tenantId);
        await expect(
          fixture.client.query(
            `INSERT INTO staff_customer_compatibilities (tenant_id, staff_id, customer_id, score)
             VALUES ($1, $2, $3, $4);`,
            [fixture.tenantId, staffId, fixture.customerId, score],
          ),
        ).resolves.toBeDefined();
      }
    });

    it('0は拒否される', async () => {
      const staffId = await createStaff(fixture.client, fixture.tenantId);
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO staff_customer_compatibilities (tenant_id, staff_id, customer_id, score)
           VALUES ($1, $2, $3, 0);`,
          [fixture.tenantId, staffId, fixture.customerId],
        ),
        'staff_customer_compatibilities_score_check',
      );
    });

    it('6は拒否される', async () => {
      const staffId = await createStaff(fixture.client, fixture.tenantId);
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO staff_customer_compatibilities (tenant_id, staff_id, customer_id, score)
           VALUES ($1, $2, $3, 6);`,
          [fixture.tenantId, staffId, fixture.customerId],
        ),
        'staff_customer_compatibilities_score_check',
      );
    });
  });

  describe('staff_customer_compatibilities_avoid_reason_check', () => {
    it('avoid=falseは理由が空でも通り、avoid=trueは理由があれば通る', async () => {
      const staffA = await createStaff(fixture.client, fixture.tenantId);
      await expect(
        fixture.client.query(
          `INSERT INTO staff_customer_compatibilities (tenant_id, staff_id, customer_id, avoid, reason)
           VALUES ($1, $2, $3, false, '');`,
          [fixture.tenantId, staffA, fixture.customerId],
        ),
      ).resolves.toBeDefined();

      const staffB = await createStaff(fixture.client, fixture.tenantId);
      await expect(
        fixture.client.query(
          `INSERT INTO staff_customer_compatibilities (tenant_id, staff_id, customer_id, avoid, reason)
           VALUES ($1, $2, $3, true, '過去にトラブルがあったため');`,
          [fixture.tenantId, staffB, fixture.customerId],
        ),
      ).resolves.toBeDefined();
    });

    it('avoid=trueなのに理由が空文字だと拒否される', async () => {
      const staffId = await createStaff(fixture.client, fixture.tenantId);
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO staff_customer_compatibilities (tenant_id, staff_id, customer_id, avoid, reason)
           VALUES ($1, $2, $3, true, '');`,
          [fixture.tenantId, staffId, fixture.customerId],
        ),
        'staff_customer_compatibilities_avoid_reason_check',
      );
    });
  });

  describe('transport_allowance_rules_unit_amount_check', () => {
    it('actual_costは単価null、それ以外は単価ありで通る', async () => {
      await expect(
        fixture.client.query(
          `INSERT INTO transport_allowance_rules (tenant_id, transport_mode, calc_kind, effective_from)
           VALUES ($1, 'public_transit', 'actual_cost', '2026-01-01');`,
          [fixture.tenantId],
        ),
      ).resolves.toBeDefined();

      await expect(
        fixture.client.query(
          `INSERT INTO transport_allowance_rules
             (tenant_id, transport_mode, calc_kind, unit_amount_yen, effective_from)
           VALUES ($1, 'car', 'per_km', 30, '2026-01-01');`,
          [fixture.tenantId],
        ),
      ).resolves.toBeDefined();
    });

    it('actual_costなのに単価が入っていると拒否される', async () => {
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO transport_allowance_rules
             (tenant_id, transport_mode, calc_kind, unit_amount_yen, effective_from)
           VALUES ($1, 'public_transit', 'actual_cost', 200, '2026-02-01');`,
          [fixture.tenantId],
        ),
        'transport_allowance_rules_unit_amount_check',
      );
    });

    it('per_kmなのに単価が無いと拒否される', async () => {
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO transport_allowance_rules (tenant_id, transport_mode, calc_kind, effective_from)
           VALUES ($1, 'car', 'per_km', '2026-02-01');`,
          [fixture.tenantId],
        ),
        'transport_allowance_rules_unit_amount_check',
      );
    });
  });

  describe('transport_allowance_rules_min_max_check', () => {
    it('min <= maxは通る', async () => {
      await expect(
        fixture.client.query(
          `INSERT INTO transport_allowance_rules
             (tenant_id, transport_mode, calc_kind, unit_amount_yen, min_amount_yen, max_amount_yen, effective_from)
           VALUES ($1, 'bicycle', 'per_trip', 100, 100, 500, '2026-01-01');`,
          [fixture.tenantId],
        ),
      ).resolves.toBeDefined();
    });

    it('max < minは拒否される', async () => {
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO transport_allowance_rules
             (tenant_id, transport_mode, calc_kind, unit_amount_yen, min_amount_yen, max_amount_yen, effective_from)
           VALUES ($1, 'bicycle', 'per_trip', 100, 500, 100, '2026-02-01');`,
          [fixture.tenantId],
        ),
        'transport_allowance_rules_min_max_check',
      );
    });

    it('min_amount_yenが負だと拒否される', async () => {
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO transport_allowance_rules
             (tenant_id, transport_mode, calc_kind, unit_amount_yen, min_amount_yen, effective_from)
           VALUES ($1, 'bicycle', 'per_trip', 100, -1, '2026-03-01');`,
          [fixture.tenantId],
        ),
        'transport_allowance_rules_min_max_check',
      );
    });
  });

  describe('travel_legs_allowance_pair_check', () => {
    it('allowance_yenとallowance_rule_idは両方null、または両方入っていれば通る', async () => {
      const ruleId = await createTransportAllowanceRule(
        fixture.client,
        fixture.tenantId,
        'car',
        '2026-04-01',
      );

      await expect(
        fixture.client.query(
          `INSERT INTO travel_legs (tenant_id, staff_id, business_date, sequence, leg_kind, transport_mode)
           VALUES ($1, $2, '2026-04-10', 1, 'commute', 'walk');`,
          [fixture.tenantId, fixture.staffId],
        ),
      ).resolves.toBeDefined();

      await expect(
        fixture.client.query(
          `INSERT INTO travel_legs
             (tenant_id, staff_id, business_date, sequence, leg_kind, transport_mode,
              allowance_yen, allowance_rule_id)
           VALUES ($1, $2, '2026-04-10', 2, 'to_visit', 'car', 300, $3);`,
          [fixture.tenantId, fixture.staffId, ruleId],
        ),
      ).resolves.toBeDefined();
    });

    it('allowance_yenだけ入っていると拒否される', async () => {
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO travel_legs
             (tenant_id, staff_id, business_date, sequence, leg_kind, transport_mode, allowance_yen)
           VALUES ($1, $2, '2026-04-11', 1, 'commute', 'car', 300);`,
          [fixture.tenantId, fixture.staffId],
        ),
        'travel_legs_allowance_pair_check',
      );
    });

    it('allowance_rule_idだけ入っていると拒否される', async () => {
      const ruleId = await createTransportAllowanceRule(
        fixture.client,
        fixture.tenantId,
        'car',
        '2026-05-01',
      );
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO travel_legs
             (tenant_id, staff_id, business_date, sequence, leg_kind, transport_mode, allowance_rule_id)
           VALUES ($1, $2, '2026-04-12', 1, 'commute', 'car', $3);`,
          [fixture.tenantId, fixture.staffId, ruleId],
        ),
        'travel_legs_allowance_pair_check',
      );
    });
  });

  describe('travel_legs_staff_date_sequence_uk', () => {
    it('同じスタッフ・同じ日・同じsequenceの2件目は拒否される', async () => {
      await fixture.client.query(
        `INSERT INTO travel_legs (tenant_id, staff_id, business_date, sequence, leg_kind, transport_mode)
         VALUES ($1, $2, '2026-04-15', 1, 'commute', 'car');`,
        [fixture.tenantId, fixture.staffId],
      );

      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO travel_legs (tenant_id, staff_id, business_date, sequence, leg_kind, transport_mode)
           VALUES ($1, $2, '2026-04-15', 1, 'to_visit', 'walk');`,
          [fixture.tenantId, fixture.staffId],
        ),
        'travel_legs_staff_date_sequence_uk',
      );
    });
  });

  describe('travel_legs_transport_mode_check', () => {
    it('許可された移動手段は通る', async () => {
      await expect(
        fixture.client.query(
          `INSERT INTO travel_legs (tenant_id, staff_id, business_date, sequence, leg_kind, transport_mode)
           VALUES ($1, $2, '2026-04-16', 1, 'commute', 'bicycle');`,
          [fixture.tenantId, fixture.staffId],
        ),
      ).resolves.toBeDefined();
    });

    it('未知の移動手段は拒否される', async () => {
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO travel_legs (tenant_id, staff_id, business_date, sequence, leg_kind, transport_mode)
           VALUES ($1, $2, '2026-04-17', 1, 'commute', 'でたらめ');`,
          [fixture.tenantId, fixture.staffId],
        ),
        'travel_legs_transport_mode_check',
      );
    });
  });
  /**
   * CodeRabbitのレビュー(PR #8)で指摘された穴に対する回帰テスト。
   * どれも「制約はあるのに、ある組み合わせでは効かない」種類の抜けだったので、
   * 効くようになったことを実際のPostgresで固定する。
   */
  describe('レビュー指摘への対応(取込元キーの対・特性の区別子・void後の再請求・Stripeの状態)', () => {
    it('取込元IDだけ入れた予約は拒否される(一意索引がNULL比較で重複を通してしまうため)', async () => {
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO reservations
             (tenant_id, customer_id, service_menu_id, status, source, start_at, end_at, external_id)
           VALUES ($1, $2, $3, 'requested', 'reserva',
                   '2026-05-01T09:00:00+09', '2026-05-01T11:00:00+09', 'RSV-1');`,
          [
            fixture.tenantId,
            fixture.customerId,
            await createServiceMenu(fixture.client, fixture.tenantId, 'EXT-1'),
          ],
        ),
        'reservations_external_pair_check',
      );
    });

    it('取込元だけ入れた予約も拒否される', async () => {
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO reservations
             (tenant_id, customer_id, service_menu_id, status, source, start_at, end_at, external_source)
           VALUES ($1, $2, $3, 'requested', 'reserva',
                   '2026-05-02T09:00:00+09', '2026-05-02T11:00:00+09', 'reserva');`,
          [
            fixture.tenantId,
            fixture.customerId,
            await createServiceMenu(fixture.client, fixture.tenantId, 'EXT-2'),
          ],
        ),
        'reservations_external_pair_check',
      );
    });

    it('取込元と取込元IDが揃っていれば受理される', async () => {
      const menuId = await createServiceMenu(fixture.client, fixture.tenantId, 'EXT-3');
      await expect(
        fixture.client.query(
          `INSERT INTO reservations
             (tenant_id, customer_id, service_menu_id, status, source, start_at, end_at,
              external_source, external_id)
           VALUES ($1, $2, $3, 'requested', 'reserva',
                   '2026-05-03T09:00:00+09', '2026-05-03T11:00:00+09', 'reserva', 'RSV-3');`,
          [fixture.tenantId, fixture.customerId, menuId],
        ),
      ).resolves.toBeDefined();
    });

    it('取込元IDだけ入れたサービスメニューは拒否される', async () => {
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO service_menus (tenant_id, code, name, duration_minutes, base_price_yen, external_id)
           VALUES ($1, 'EXT-ONLY-ID', 'テストメニュー', 60, 5000, 'SVC-1');`,
          [fixture.tenantId],
        ),
        'service_menus_external_pair_check',
      );
    });

    it('顧客側の特性値が、スタッフ側の特性項目を参照することはできない', async () => {
      // definition_subject_kind は既定値の 'customer' のまま入るので、複合FKは
      // (tenant_id, 'customer', そのID) を探しに行き、スタッフ側の項目には当たらない。
      const staffSideDefinitionId = await createTraitDefinition(
        fixture.client,
        fixture.tenantId,
        'staff',
        'STAFF-SIDE-ONLY',
      );
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO customer_traits (tenant_id, customer_id, definition_id, value_bool)
           VALUES ($1, $2, $3, true);`,
          [fixture.tenantId, fixture.customerId, staffSideDefinitionId],
        ),
        'customer_traits_tenant_definition_fk',
      );
    });

    it('スタッフ側の特性値が、顧客側の特性項目を参照することはできない', async () => {
      const customerSideDefinitionId = await createTraitDefinition(
        fixture.client,
        fixture.tenantId,
        'customer',
        'CUSTOMER-SIDE-ONLY',
      );
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO staff_traits (tenant_id, staff_id, definition_id, value_bool)
           VALUES ($1, $2, $3, true);`,
          [fixture.tenantId, fixture.staffId, customerSideDefinitionId],
        ),
        'staff_traits_tenant_definition_fk',
      );
    });

    it('区別子を書き換えて反対側を参照しようとしても拒否される', async () => {
      const staffSideDefinitionId = await createTraitDefinition(
        fixture.client,
        fixture.tenantId,
        'staff',
        'STAFF-SIDE-FORCED',
      );
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO customer_traits
             (tenant_id, customer_id, definition_id, definition_subject_kind, value_bool)
           VALUES ($1, $2, $3, 'staff', true);`,
          [fixture.tenantId, fixture.customerId, staffSideDefinitionId],
        ),
        'customer_traits_definition_subject_kind_check',
      );
    });

    it('無効にした明細があれば、同じ領収書を新しい請求書に載せ直せる', async () => {
      // 誤請求を void して作り直す運用。void 側の明細に superseded_at が入っていれば、
      // 二重請求防止の一意索引(有効な明細だけを対象にする)には引っかからない。
      const receiptId = await createReceipt(
        fixture.client,
        fixture.tenantId,
        fixture.staffId,
        fixture.customerId,
      );
      const voidedInvoiceId = await createInvoice(
        fixture.client,
        fixture.tenantId,
        fixture.customerId,
        'INV-VOIDED',
      );
      const reissuedInvoiceId = await createInvoice(
        fixture.client,
        fixture.tenantId,
        fixture.customerId,
        'INV-REISSUED',
      );
      await fixture.client.query(
        `INSERT INTO invoice_lines
           (tenant_id, invoice_id, line_no, kind, description, amount_yen, receipt_id, superseded_at)
         VALUES ($1, $2, 1, 'receipt_billable', 'ガレージ代', 1000, $3, now());`,
        [fixture.tenantId, voidedInvoiceId, receiptId],
      );

      await expect(
        fixture.client.query(
          `INSERT INTO invoice_lines
             (tenant_id, invoice_id, line_no, kind, description, amount_yen, receipt_id)
           VALUES ($1, $2, 1, 'receipt_billable', 'ガレージ代', 1000, $3);`,
          [fixture.tenantId, reissuedInvoiceId, receiptId],
        ),
      ).resolves.toBeDefined();
    });

    it('有効な明細が2つになる形では、同じ領収書を載せられない', async () => {
      const receiptId = await createReceipt(
        fixture.client,
        fixture.tenantId,
        fixture.staffId,
        fixture.customerId,
      );
      const firstInvoiceId = await createInvoice(
        fixture.client,
        fixture.tenantId,
        fixture.customerId,
        'INV-ACTIVE-1',
      );
      const secondInvoiceId = await createInvoice(
        fixture.client,
        fixture.tenantId,
        fixture.customerId,
        'INV-ACTIVE-2',
      );
      await fixture.client.query(
        `INSERT INTO invoice_lines
           (tenant_id, invoice_id, line_no, kind, description, amount_yen, receipt_id)
         VALUES ($1, $2, 1, 'receipt_billable', 'ガレージ代', 1000, $3);`,
        [fixture.tenantId, firstInvoiceId, receiptId],
      );

      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO invoice_lines
             (tenant_id, invoice_id, line_no, kind, description, amount_yen, receipt_id)
           VALUES ($1, $2, 1, 'receipt_billable', 'ガレージ代', 1000, $3);`,
          [fixture.tenantId, secondInvoiceId, receiptId],
        ),
        'invoice_lines_tenant_receipt_uidx',
      );
    });

    it("Stripeが返す 'requires_capture'(手動キャプチャ)は受理される", async () => {
      await expect(
        fixture.client.query(
          `INSERT INTO payments
             (tenant_id, customer_id, status, method_kind, amount_yen, stripe_payment_intent_id)
           VALUES ($1, $2, 'requires_capture', 'card', 5000, $3);`,
          [fixture.tenantId, fixture.customerId, `pi_capture_${randomUUID()}`],
        ),
      ).resolves.toBeDefined();
    });

    it("Stripeに存在しない 'failed' は拒否される", async () => {
      // 決済の失敗は 'requires_payment_method' に戻り、内容は failure_code/failure_message に入る。
      await expectRejectedByConstraint(
        fixture.client.query(
          `INSERT INTO payments
             (tenant_id, customer_id, status, method_kind, amount_yen, stripe_payment_intent_id)
           VALUES ($1, $2, 'failed', 'card', 5000, $3);`,
          [fixture.tenantId, fixture.customerId, `pi_failed_${randomUUID()}`],
        ),
        'payments_status_check',
      );
    });
  });
});
