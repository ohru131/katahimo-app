import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { listCouponsForSelection, listReceiptsForStaff } from '@katahimo/core';
import * as schema from '@katahimo/db/schema';
import { serializeTransactions } from '@katahimo/db/serialize-transactions';
import type { Database } from '@katahimo/db/tenant-scope';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDemoContainer, type DemoContainer } from '../container';
import type { DemoMigration } from '../database';
import { applyPendingMigrations } from '../database';
import { ensureSeedStateTable, readSeedState, writeSeedState } from '../seedState';
import { seedDemoData } from './seedDemoData';
import { topUpDemoData } from './topUpDemoData';

const DRIZZLE_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../db/drizzle');

function loadMigrations(): DemoMigration[] {
  return readdirSync(DRIZZLE_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => ({ tag: name.replace(/\.sql$/, ''), sql: readFileSync(join(DRIZZLE_DIR, name), 'utf8') }));
}

/** 領収書画像の置き場。BrowserStoragePortはIndexedDB前提でNodeには無いため差し替える。 */
function useMemoryStorage(container: DemoContainer): void {
  const files = new Map<string, Uint8Array>();
  container.storage = {
    async put(key, contentType, body) {
      files.set(key, body);
      return { key, contentType, byteSize: body.byteLength };
    },
    async get(key) {
      return files.get(key) ?? null;
    },
    async delete(key) {
      files.delete(key);
    },
    async signedUrl(key) {
      return `memory://${key}`;
    },
  };
}

/** 日報の件数を業務日(JST)ごとに数える。 */
async function countReportsByDate(client: PGlite): Promise<Map<string, number>> {
  const { rows } = await client.query<{ d: string; n: number }>(
    'SELECT occurred_at::date::text AS d, count(*)::int AS n FROM daily_reports GROUP BY 1;',
  );
  return new Map(rows.map((row) => [row.d, row.n]));
}

/** シード済みのデモDBを1つ用意する。`seedDate` のJST正午に初回シードを流した状態になる。 */
async function setupSeededDemo(seedDate: string) {
  vi.useFakeTimers({ toFake: ['Date'] });
  // JSTの正午に固定する。UTCの深夜だと「JSTでは翌日」になり、期待する日付とずれる。
  vi.setSystemTime(new Date(`${seedDate}T03:00:00Z`));

  const client = new PGlite();
  await client.waitReady;
  await client.exec("SET TIME ZONE 'Asia/Tokyo';");
  await applyPendingMigrations(client, loadMigrations());
  await ensureSeedStateTable(client);

  const db = serializeTransactions(drizzle(client, { schema, casing: 'snake_case' }) as unknown as Database);
  const customerIdByName = new Map<string, string>();
  const container = createDemoContainer({ db, customerIdByName, addressLatLng: new Map() });
  useMemoryStorage(container);

  const seeded = await seedDemoData(container, () => {});
  for (const [name, id] of seeded.customerIdByName) customerIdByName.set(name, id);

  const store = {
    read: () => readSeedState(client),
    write: (state: Parameters<typeof writeSeedState>[1]) => writeSeedState(client, state),
  };
  return { client, container, customerIdByName, store };
}

afterEach(() => {
  vi.useRealTimers();
});

/**
 * デモデータはIndexedDBに残るため、初回に開いた日からしか履歴が伸びない。日を空けて
 * 開き直した訪問者が「過去のデータしか無い」画面を見ることになるのを防ぐのがこの追い足し。
 * ここが壊れると症状はCIに出ず、数日後に公開デモを開いた人にだけ出る。
 */
describe('topUpDemoData(日付が変わったあとの追い足し)', () => {
  it('前回作り終えた日の翌日から今日までを埋め、月が変われば領収書と誕生月も作り直す', async () => {
    const { client, container, customerIdByName, store } = await setupSeededDemo('2026-05-10');
    await store.write({ reportsThrough: '2026-05-10', receiptsMonth: '2026-05', birthdayMonth: '2026-05' });

    // --- 3日後に開き直す ---
    vi.setSystemTime(new Date('2026-05-13T03:00:00Z'));
    const before = await countReportsByDate(client);
    expect(before.get('2026-05-11')).toBeUndefined();

    const firstRun = await topUpDemoData(container, store, customerIdByName);
    expect(firstRun.addedDates).toEqual(['2026-05-11', '2026-05-12', '2026-05-13']);
    expect(firstRun.changed).toBe(true);
    // 呼び出し側はここを見て印を進める(日付を取り直すと、処理中に日をまたいだときに
    // 作っていない日を「作り終えた」ことにしてしまう)。
    expect(firstRun.reportsThrough).toBe('2026-05-13');

    const after = await countReportsByDate(client);
    for (const date of firstRun.addedDates) {
      expect(after.get(date) ?? 0).toBeGreaterThan(0);
      // 出勤簿は初回シードが「今週ぶん」として先に作っている日がある。それでも日報は入ること。
      const attendance = await client.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM attendance_days WHERE business_date = $1;',
        [date],
      );
      expect(attendance.rows[0]?.n ?? 0).toBeGreaterThan(0);
    }

    // --- 同じ日にもう一度呼んでも二重に入らない ---
    const secondRun = await topUpDemoData(container, store, customerIdByName);
    expect(secondRun.addedDates).toEqual([]);
    expect(await countReportsByDate(client)).toEqual(after);

    // --- 月をまたぐ ---
    vi.setSystemTime(new Date('2026-06-02T03:00:00Z'));
    const monthRun = await topUpDemoData(container, store, customerIdByName);
    expect(monthRun.addedDates.at(0)).toBe('2026-05-14');
    expect(monthRun.addedDates.at(-1)).toBe('2026-06-02');

    const tenantRows = await client.query<{ id: string }>('SELECT id FROM tenants LIMIT 1;');
    const tenantId = tenantRows.rows[0]?.id;
    if (!tenantId) throw new Error('デモテナントが作られていません');
    const staffRows = await client.query<{ id: string }>(
      "SELECT id FROM staff WHERE email = 'admin@demo.example.com' LIMIT 1;",
    );
    const adminStaffId = staffRows.rows[0]?.id;
    if (!adminStaffId) throw new Error('デモ管理者が作られていません');

    // 領収書一覧は月単位。月が変わったら、その月ぶんが入っていること。
    const receipts = await listReceiptsForStaff(container, tenantId, adminStaffId, '2026-06');
    expect(receipts?.receipts).toHaveLength(4);

    // 誕生月クーポンは「今月生まれ」の世帯にしか出ない。月が変わっても1件は出ること。
    const [firstCustomerId] = [...customerIdByName.values()];
    if (!firstCustomerId) throw new Error('デモ顧客が作られていません');
    const selectable = await listCouponsForSelection(container, tenantId, {
      customerId: firstCustomerId,
      onDate: '2026-06-02',
    });
    expect(selectable.find((c) => c.code === 'BIRTHDAY10')?.birthdaySubjectName).toBeTruthy();

    const state = await readSeedState(client);
    expect(state).toEqual({
      reportsThrough: '2026-06-02',
      receiptsMonth: '2026-06',
      birthdayMonth: '2026-06',
    });
  }, 180_000);

  /**
   * この仕組みを入れる前に公開デモを開いた訪問者のIndexedDBには、記録テーブルが空のまま
   * 残っている。そこで日報の最終日から「どこまで作ったか」を推測できないと、既存の訪問者だけ
   * 追い足しが効かない(あるいは同じ日を二重に作る)。
   */
  it('記録が無いDBでも、日報の最終日から続きを作る', async () => {
    const { client, container, customerIdByName, store } = await setupSeededDemo('2026-05-10');
    expect(await readSeedState(client)).toBeNull();

    vi.setSystemTime(new Date('2026-05-12T03:00:00Z'));
    const result = await topUpDemoData(container, store, customerIdByName);
    expect(result.addedDates).toEqual(['2026-05-11', '2026-05-12']);

    const counts = await countReportsByDate(client);
    expect(counts.get('2026-05-10') ?? 0).toBeGreaterThan(0);
    expect(counts.get('2026-05-11') ?? 0).toBeGreaterThan(0);
    expect(counts.get('2026-05-12') ?? 0).toBeGreaterThan(0);
  }, 180_000);
});
