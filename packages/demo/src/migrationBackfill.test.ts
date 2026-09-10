import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';
import type { DemoMigration } from './database';
import { applyPendingMigrations } from './database';

/**
 * CodeRabbit指摘対応(0011/0012/0013 backfill)の検証。
 *
 * checkConstraints.test.ts と同じ方式(本番と同じマイグレーションをPGlite/WASMの本物の
 * PostgreSQLへ当てる)だが、こちらは「途中まで当てた状態に旧形式の行を手で入れてから、
 * 続きのマイグレーションを当てる」必要があるため、applyPendingMigrations を同じclientに
 * 対して2回に分けて呼ぶ(台帳を見て未適用分だけを当てる実装なので、これができる。
 * database.ts の applyPendingMigrations 参照)。
 */

const DRIZZLE_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../db/drizzle');

/** 本番のマイグレーションSQLを、ファイル名順(=適用順)に全件読み込む。 */
function loadMigrations(): DemoMigration[] {
  return readdirSync(DRIZZLE_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => ({ tag: name.replace(/\.sql$/, ''), sql: readFileSync(join(DRIZZLE_DIR, name), 'utf8') }));
}

const ALL_MIGRATIONS = loadMigrations();

/** tagまで(それを含む)のマイグレーションだけを取り出す。ファイル名の連番=適用順。 */
function migrationsThrough(tag: string): DemoMigration[] {
  const index = ALL_MIGRATIONS.findIndex((m) => m.tag === tag);
  if (index === -1) throw new Error(`マイグレーション '${tag}' が見つかりません`);
  return ALL_MIGRATIONS.slice(0, index + 1);
}

/** 0011〜0013はdatabase.tsのREBUILD_REQUIRED_MIGRATIONS対象だが、このテストは増分適用
 * そのものを検証するためのものなので、作り直しルールを無効化して渡す(空配列)。 */
const NO_REBUILD_REQUIRED: readonly string[] = [];

/**
 * 空のPGliteを立てる。テストごとに作り直すのは、「途中まで当てた状態」を作るために
 * 台帳(demo_applied_migrations)の中身が他のテストと混ざらないようにするため。
 */
async function createClient(): Promise<PGlite> {
  const client = new PGlite();
  await client.waitReady;
  return client;
}

/** 旧形式の行を入れるのに必要な親行(テナント)。RLSはsuperuserでバイパスされるので設定は不要。 */
async function insertTenant(client: PGlite): Promise<string> {
  const {
    rows: [tenant],
  } = await client.query<{ id: string }>(
    "INSERT INTO tenants (name, slug) VALUES ('テスト法人', 'migration-backfill') RETURNING id;",
  );
  if (!tenant) throw new Error('テナントの準備に失敗しました');
  return tenant.id;
}

/** 勤怠・領収書の複合FK(tenant_id, staff_id)の参照先。 */
async function insertStaff(client: PGlite, tenantId: string): Promise<string> {
  const {
    rows: [staff],
  } = await client.query<{ id: string }>(
    "INSERT INTO staff (tenant_id, name, email) VALUES ($1, 'テストスタッフ', 'staff@example.test') RETURNING id;",
    [tenantId],
  );
  if (!staff) throw new Error('スタッフの準備に失敗しました');
  return staff.id;
}

/** 日報・世帯構成員の複合FK(tenant_id, customer_id)の参照先。 */
async function insertCustomer(client: PGlite, tenantId: string): Promise<string> {
  const {
    rows: [customer],
  } = await client.query<{ id: string }>(
    "INSERT INTO customers (tenant_id, name, family_name, given_name) VALUES ($1, 'テスト利用者', 'テスト', '太郎') RETURNING id;",
    [tenantId],
  );
  if (!customer) throw new Error('顧客の準備に失敗しました');
  return customer.id;
}

describe('0011: receipts.amount → amount_yen/amount_raw のbackfill', () => {
  let client: PGlite;

  afterEach(async () => {
    await client?.close();
  });

  it('amount_rawは元の文字列のまま残り、amount_yenは数値化できたものだけ入る', async () => {
    client = await createClient();
    await applyPendingMigrations(client, migrationsThrough('0010_updated_at_trigger'), NO_REBUILD_REQUIRED);
    const tenantId = await insertTenant(client);
    const staffId = await insertStaff(client, tenantId);

    const {
      rows: [commaReceipt],
    } = await client.query<{ id: string }>(
      `INSERT INTO receipts (tenant_id, staff_id, receipt_timestamp, amount, file_key, content_type)
       VALUES ($1, $2, now(), '1,000', 'file-key-1', 'image/jpeg') RETURNING id;`,
      [tenantId, staffId],
    );
    const {
      rows: [yenReceipt],
    } = await client.query<{ id: string }>(
      `INSERT INTO receipts (tenant_id, staff_id, receipt_timestamp, amount, file_key, content_type)
       VALUES ($1, $2, now(), '1000円', 'file-key-2', 'image/jpeg') RETURNING id;`,
      [tenantId, staffId],
    );
    const {
      rows: [emptyReceipt],
    } = await client.query<{ id: string }>(
      `INSERT INTO receipts (tenant_id, staff_id, receipt_timestamp, amount, file_key, content_type)
       VALUES ($1, $2, now(), '', 'file-key-3', 'image/jpeg') RETURNING id;`,
      [tenantId, staffId],
    );
    if (!commaReceipt || !yenReceipt || !emptyReceipt) throw new Error('領収書の準備に失敗しました');

    await applyPendingMigrations(
      client,
      migrationsThrough('0011_receipt_amount_integer'),
      NO_REBUILD_REQUIRED,
    );

    const { rows } = await client.query<{ id: string; amount_raw: string | null; amount_yen: number | null }>(
      'SELECT id, amount_raw, amount_yen FROM receipts WHERE id = ANY($1) ORDER BY amount_raw;',
      [[commaReceipt.id, yenReceipt.id, emptyReceipt.id]],
    );
    const byId = new Map(rows.map((r) => [r.id, r]));

    expect(byId.get(commaReceipt.id)).toEqual({ id: commaReceipt.id, amount_raw: '1,000', amount_yen: 1000 });
    expect(byId.get(yenReceipt.id)).toEqual({ id: yenReceipt.id, amount_raw: '1000円', amount_yen: null });
    expect(byId.get(emptyReceipt.id)).toEqual({ id: emptyReceipt.id, amount_raw: null, amount_yen: null });
  });

  // 負の金額を amount_yen に入れてしまうと、同じマイグレーションの最後に足す CHECK
  // (receipts_amount_yen_nonneg)が ADD CONSTRAINT 自体で失敗し、移行全体が止まる。
  // 「移行が完走すること」と「生値が残ること」の両方を固定する。
  it('負の金額は amount_yen に入れず、生値だけを残して移行が完走する', async () => {
    client = await createClient();
    await applyPendingMigrations(client, migrationsThrough('0010_updated_at_trigger'), NO_REBUILD_REQUIRED);
    const tenantId = await insertTenant(client);
    const staffId = await insertStaff(client, tenantId);

    const {
      rows: [negativeReceipt],
    } = await client.query<{ id: string }>(
      `INSERT INTO receipts (tenant_id, staff_id, receipt_timestamp, amount, file_key, content_type)
       VALUES ($1, $2, now(), '-500', 'file-key-negative', 'image/jpeg') RETURNING id;`,
      [tenantId, staffId],
    );
    if (!negativeReceipt) throw new Error('領収書の準備に失敗しました');

    await expect(
      applyPendingMigrations(client, migrationsThrough('0011_receipt_amount_integer'), NO_REBUILD_REQUIRED),
    ).resolves.toBeDefined();

    const { rows } = await client.query<{ amount_raw: string | null; amount_yen: number | null }>(
      'SELECT amount_raw, amount_yen FROM receipts WHERE id = $1;',
      [negativeReceipt.id],
    );
    expect(rows[0]).toEqual({ amount_raw: '-500', amount_yen: null });
  });
});

describe('0012: attendance_days.row_data(列記号形式)→ visits/officeWork のbackfill', () => {
  let client: PGlite;

  afterEach(async () => {
    await client?.close();
  });

  it('列記号形式の行が、値を1つも失わずvisits/officeWorkの新形式になる', async () => {
    client = await createClient();
    await applyPendingMigrations(
      client,
      migrationsThrough('0011_receipt_amount_integer'),
      NO_REBUILD_REQUIRED,
    );
    const tenantId = await insertTenant(client);
    const staffId = await insertStaff(client, tenantId);

    // #1〜#3訪問・事務作業2件・出退勤距離・買物代行・備考まで、全列を埋めた行(値の消失が
    // 無いことを確認するため、変換対象になりうる列を全部使う)。
    const fullColumnRow = {
      C: '○○様宅',
      D: '09:00',
      E: '09:30',
      H: '15',
      I: '晴れ',
      L: '△△様宅',
      M: '10:00',
      N: '10:30',
      Q: '20',
      R: '曇り',
      U: '××様宅',
      V: '11:00',
      W: '11:30',
      X: '事務作業A',
      Y: '13:00',
      Z: '13:30',
      AA: '事務作業B',
      AB: '14:00',
      AC: '14:30',
      AG: '1.5',
      AH: '2.5',
      AI: '3.5',
      AJ: '4.5',
      AN: '2',
      AO: '備考です',
    };

    const {
      rows: [fullRow],
    } = await client.query<{ id: string }>(
      `INSERT INTO attendance_days (tenant_id, staff_id, business_date, row_data)
       VALUES ($1, $2, '2026-03-01', $3::jsonb) RETURNING id;`,
      [tenantId, staffId, JSON.stringify(fullColumnRow)],
    );
    // 先頭(#1訪問)は空だが#2訪問(L/M)に値がある行: trimTrailingEmptyは「末尾」からしか
    // 取り除かないため、#1訪問の空オブジェクトは位置合わせのために残り、#3訪問(末尾の空)
    // だけが取り除かれることを確認する。
    const {
      rows: [trailingEmptyRow],
    } = await client.query<{ id: string }>(
      `INSERT INTO attendance_days (tenant_id, staff_id, business_date, row_data)
       VALUES ($1, $2, '2026-03-02', $3::jsonb) RETURNING id;`,
      [tenantId, staffId, JSON.stringify({ L: '△△様宅', M: '10:00' })],
    );
    // 既に新形式の行は触らないことを確認する行。
    const newFormatPayload = { visits: [{ place: '新形式', start: '09:00' }] };
    const {
      rows: [newFormatRow],
    } = await client.query<{ id: string }>(
      `INSERT INTO attendance_days (tenant_id, staff_id, business_date, row_data)
       VALUES ($1, $2, '2026-03-03', $3::jsonb) RETURNING id;`,
      [tenantId, staffId, JSON.stringify(newFormatPayload)],
    );
    // 列記号キーを1つも持たない空の行も触らないことを確認する行。
    const {
      rows: [emptyRow],
    } = await client.query<{ id: string }>(
      `INSERT INTO attendance_days (tenant_id, staff_id, business_date, row_data)
       VALUES ($1, $2, '2026-03-04', '{}'::jsonb) RETURNING id;`,
      [tenantId, staffId],
    );
    if (!fullRow || !trailingEmptyRow || !newFormatRow || !emptyRow) {
      throw new Error('勤怠行の準備に失敗しました');
    }

    await applyPendingMigrations(
      client,
      migrationsThrough('0012_attendance_row_data_shape'),
      NO_REBUILD_REQUIRED,
    );

    const { rows } = await client.query<{ id: string; row_data: unknown }>(
      'SELECT id, row_data FROM attendance_days WHERE id = ANY($1);',
      [[fullRow.id, trailingEmptyRow.id, newFormatRow.id, emptyRow.id]],
    );
    const byId = new Map(rows.map((r) => [r.id, r.row_data as Record<string, unknown>]));

    // 全列を埋めた行: fromColumnRow()の対応関係通りに変換され、値が1つも失われていないこと。
    expect(byId.get(fullRow.id)).toEqual({
      visits: [
        {
          place: '○○様宅',
          start: '09:00',
          end: '09:30',
          weatherAfter: '晴れ',
          plannedMoveMin: 15,
          distanceKm: 1.5,
        },
        {
          place: '△△様宅',
          start: '10:00',
          end: '10:30',
          weatherAfter: '曇り',
          plannedMoveMin: 20,
          distanceKm: 2.5,
        },
        { place: '××様宅', start: '11:00', end: '11:30' },
      ],
      officeWork: [
        { name: '事務作業A', start: '13:00', end: '13:30' },
        { name: '事務作業B', start: '14:00', end: '14:30' },
      ],
      commuteDistanceKm: 3.5,
      returnDistanceKm: 4.5,
      shoppingErrandCount: 2,
      note: '備考です',
    });

    // #2訪問だけ入力した行: #1訪問(空)は先頭に残り、#3訪問(末尾の空)だけ取り除かれる。
    expect(byId.get(trailingEmptyRow.id)).toEqual({
      visits: [{}, { place: '△△様宅', start: '10:00' }],
    });

    // 新形式・空の行は触られていないこと。
    expect(byId.get(newFormatRow.id)).toEqual(newFormatPayload);
    expect(byId.get(emptyRow.id)).toEqual({});
  });
});

describe('0013: 生年月日/緯度経度/開始終了時刻のbackfill', () => {
  let client: PGlite;

  afterEach(async () => {
    await client?.close();
  });

  it('raw列は元の表記のまま残り、解析できたものだけ型付き列に入る。日跨ぎのended_atは翌日になる', async () => {
    client = await createClient();
    await applyPendingMigrations(
      client,
      migrationsThrough('0012_attendance_row_data_shape'),
      NO_REBUILD_REQUIRED,
    );
    const tenantId = await insertTenant(client);
    const staffId = await insertStaff(client, tenantId);
    const customerId = await insertCustomer(client, tenantId);

    // family_members.dob: 解析できる表記とできない表記(年月のみ)。
    const {
      rows: [dobOk],
    } = await client.query<{ id: string }>(
      `INSERT INTO family_members (tenant_id, customer_id, name, dob) VALUES ($1, $2, '子ども1', '1990/1/28') RETURNING id;`,
      [tenantId, customerId],
    );
    const {
      rows: [dobBad],
    } = await client.query<{ id: string }>(
      `INSERT INTO family_members (tenant_id, customer_id, name, dob) VALUES ($1, $2, '子ども2', '1990.1') RETURNING id;`,
      [tenantId, customerId],
    );
    if (!dobOk || !dobBad) throw new Error('family_membersの準備に失敗しました');

    // accident_reports.target_dob: family_members.dobと同じparse_date_only()を通るので、
    // 解析できる表記が1件あれば共有ロジックであることの確認として十分。
    const {
      rows: [targetDobOk],
    } = await client.query<{ id: string }>(
      `INSERT INTO accident_reports (tenant_id, staff_id, customer_id, occurred_at, report_type, target_dob)
       VALUES ($1, $2, $3, now(), '事故報告', '1990/1/28') RETURNING id;`,
      [tenantId, staffId, customerId],
    );
    if (!targetDobOk) throw new Error('accident_reportsの準備に失敗しました');

    // customers.lat_lng: 解析できる表記とできない表記(値域外)。
    await client.query('UPDATE customers SET lat_lng = $1 WHERE id = $2;', ['38.26, 140.87', customerId]);
    const {
      rows: [customerBad],
    } = await client.query<{ id: string }>(
      `INSERT INTO customers (tenant_id, name, family_name, given_name, lat_lng)
       VALUES ($1, 'テスト利用者2', 'テスト', '次郎', '200, 140.87') RETURNING id;`,
      [tenantId],
    );
    if (!customerBad) throw new Error('customersの準備に失敗しました');

    // daily_reports: 日跨ぎ勤務(22:00〜翌01:00)。
    const {
      rows: [overnightReport],
    } = await client.query<{ id: string }>(
      `INSERT INTO daily_reports (tenant_id, staff_id, customer_id, occurred_at, start_time, end_time)
       VALUES ($1, $2, $3, '2026-03-10 22:00:00+09', '22:00', '01:00') RETURNING id;`,
      [tenantId, staffId, customerId],
    );
    if (!overnightReport) throw new Error('daily_reportsの準備に失敗しました');

    await applyPendingMigrations(
      client,
      migrationsThrough('0013_typed_dates_and_coordinates'),
      NO_REBUILD_REQUIRED,
    );

    // dateカラムはPGliteのクライアントがJSのDateオブジェクトへ変換して返すため、
    // to_charでYYYY-MM-DD文字列に揃えてから比較する(タイムゾーンずれの余地を無くす)。
    const { rows: familyRows } = await client.query<{
      id: string;
      dob_raw: string | null;
      dob_date: string | null;
    }>(
      "SELECT id, dob_raw, to_char(dob_date, 'YYYY-MM-DD') AS dob_date FROM family_members WHERE id = ANY($1);",
      [[dobOk.id, dobBad.id]],
    );
    const familyById = new Map(familyRows.map((r) => [r.id, r]));
    expect(familyById.get(dobOk.id)).toEqual({ id: dobOk.id, dob_raw: '1990/1/28', dob_date: '1990-01-28' });
    expect(familyById.get(dobBad.id)).toEqual({ id: dobBad.id, dob_raw: '1990.1', dob_date: null });

    const { rows: accidentRows } = await client.query<{
      id: string;
      target_dob_raw: string;
      target_dob_date: string | null;
    }>(
      "SELECT id, target_dob_raw, to_char(target_dob_date, 'YYYY-MM-DD') AS target_dob_date FROM accident_reports WHERE id = $1;",
      [targetDobOk.id],
    );
    expect(accidentRows[0]).toEqual({
      id: targetDobOk.id,
      target_dob_raw: '1990/1/28',
      target_dob_date: '1990-01-28',
    });

    const { rows: customerRows } = await client.query<{
      id: string;
      lat_lng_raw: string | null;
      lat: string | null;
      lng: string | null;
    }>('SELECT id, lat_lng_raw, lat, lng FROM customers WHERE id = ANY($1);', [[customerId, customerBad.id]]);
    const customerById = new Map(customerRows.map((r) => [r.id, r]));
    expect(customerById.get(customerId)).toEqual({
      id: customerId,
      lat_lng_raw: '38.26, 140.87',
      lat: '38.260000',
      lng: '140.870000',
    });
    expect(customerById.get(customerBad.id)).toEqual({
      id: customerBad.id,
      lat_lng_raw: '200, 140.87',
      lat: null,
      lng: null,
    });

    const { rows: reportRows } = await client.query<{ started_at: string; ended_at: string }>(
      'SELECT started_at, ended_at FROM daily_reports WHERE id = $1;',
      [overnightReport.id],
    );
    const report = reportRows[0];
    if (!report) throw new Error('daily_reportsの読み出しに失敗しました');
    expect(new Date(report.started_at).toISOString()).toBe('2026-03-10T13:00:00.000Z'); // JST 3/10 22:00
    // end_time='01:00'は同じreportDate(3/10)の01:00(=started_atより前)と解釈されたあと
    // +1日される結果、JSTで3/11 01:00になる(UTCでは日付が繰り上がる前の3/10のまま)。
    expect(new Date(report.ended_at).toISOString()).toBe('2026-03-10T16:00:00.000Z'); // JST 3/11 01:00
  });
});
