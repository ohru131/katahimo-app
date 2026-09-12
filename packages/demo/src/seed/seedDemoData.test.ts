import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { listCouponsForSelection } from '@katahimo/core';
import * as schema from '@katahimo/db/schema';
import { serializeTransactions } from '@katahimo/db/serialize-transactions';
import type { Database } from '@katahimo/db/tenant-scope';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, expect, it } from 'vitest';
import { createDemoContainer } from '../container';
import type { DemoMigration } from '../database';
import { applyPendingMigrations } from '../database';
import { seedDemoData } from './seedDemoData';

const DRIZZLE_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../db/drizzle');

function loadMigrations(): DemoMigration[] {
  return readdirSync(DRIZZLE_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => ({ tag: name.replace(/\.sql$/, ''), sql: readFileSync(join(DRIZZLE_DIR, name), 'utf8') }));
}

/**
 * 公開デモのシードを最後まで流せることを確かめる。
 *
 * デモはGitHub Pagesに自動デプロイされ、訪問者のブラウザでこのシードが走る。ここが途中で
 * 例外になると、デモは進捗バーのまま何も表示されない状態で止まる(CIは通ったまま公開される)。
 * スキーマやusecaseの制約を足したときに真っ先に壊れるのがここなので、通しで1回流しておく。
 */
describe('seedDemoData(公開デモの初期データ投入)', () => {
  it('最後まで流れ、誕生月クーポンが1世帯目の選択肢に出る', async () => {
    const client = new PGlite();
    await client.waitReady;
    // 出勤簿・勤怠がJST基準の業務日で入るよう、openDemoDatabase()と同じ設定にする。
    await client.exec("SET TIME ZONE 'Asia/Tokyo';");
    await applyPendingMigrations(client, loadMigrations());

    // PGliteは接続が1本なので、本番のデモと同じくトランザクションを直列化する
    // (usecasesのPromise.all(...)でBEGINが入れ子にならないようにするため)。
    const db = serializeTransactions(
      drizzle(client, { schema, casing: 'snake_case' }) as unknown as Database,
    );
    const customerIdByName = new Map<string, string>();
    const container = createDemoContainer({ db, customerIdByName, addressLatLng: new Map() });

    const seeded = await seedDemoData(container, () => {});
    expect(seeded.customerIdByName.size).toBeGreaterThan(0);

    // 1世帯目の代表者には「今月」の生年月日を入れてあるので、誕生月クーポンが選択肢に出る。
    const [firstCustomerId] = [...seeded.customerIdByName.values()];
    if (!firstCustomerId) throw new Error('デモ顧客が作られていません');
    const tenantRows = await client.query<{ id: string }>('SELECT id FROM tenants LIMIT 1;');
    const tenantId = tenantRows.rows[0]?.id;
    if (!tenantId) throw new Error('デモテナントが作られていません');

    const today = new Date().toISOString().slice(0, 10);
    const selectable = await listCouponsForSelection(container, tenantId, {
      customerId: firstCustomerId,
      onDate: today,
    });
    const birthday = selectable.find((c) => c.code === 'BIRTHDAY10');
    expect(birthday?.birthdaySubjectName).toBeTruthy();

    // 配布型クーポン(THANKS1000)は配った1世帯目にだけ出る。
    expect(selectable.some((c) => c.code === 'THANKS1000')).toBe(true);
  }, 120_000);
});
