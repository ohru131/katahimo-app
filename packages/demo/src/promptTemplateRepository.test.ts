import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import type { AppendPromptTemplateResult, PromptTemplateRecord } from '@katahimo/core/ports';
import { DrizzlePromptTemplateRepository } from '@katahimo/db/repositories';
import * as schema from '@katahimo/db/schema';
import type { Database } from '@katahimo/db/tenant-scope';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import type { DemoMigration } from './database';
import { applyPendingMigrations } from './database';

/**
 * prompt_templates のリポジトリ実装を、本番と同じマイグレーションを当てた本物のPostgres
 * (PGlite/WASM)で動かす。
 *
 * 【ここに置く理由】rlsEnforcement.test.ts と同じで、PGliteに依存できるのがこのパッケージだけのため
 * (packages/db はブラウザからも使うのでDBドライバを持ち込まない)。
 *
 * 【インメモリのフェイクでは足りない理由】このリポジトリは「キーごとの最大版」を副問い合わせの
 * JOINで、「変わっていなければ積まない」の判定を `SELECT ... FOR UPDATE` と同じトランザクションで
 * 行う。どちらもSQLが通るかどうかが要点で、フェイク(FakePromptTemplateRepository)では
 * 何も確かめられない。
 */

/** appendIfChanged が積んだ版を取り出す。積まれなかった場合はテストを落とす。 */
function appended(result: AppendPromptTemplateResult): PromptTemplateRecord {
  if (!result.appended) throw new Error('版が積まれるはずの操作で appended:false が返った');
  return result.record;
}

const DRIZZLE_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../db/drizzle');

/** drizzle が吐いたマイグレーションをファイル名順に読む(本番と同じSQLをPGliteに当てるため)。 */
function loadMigrations(): DemoMigration[] {
  return readdirSync(DRIZZLE_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => ({ tag: name.replace(/\.sql$/, ''), sql: readFileSync(join(DRIZZLE_DIR, name), 'utf8') }));
}

describe('DrizzlePromptTemplateRepository(PGlite)', () => {
  let repo: DrizzlePromptTemplateRepository;
  let tenantId: string;
  let otherTenantId: string;
  let staffId: string;

  beforeAll(async () => {
    const client = new PGlite();
    await client.waitReady;
    await applyPendingMigrations(client, loadMigrations());

    const { rows: tenants } = await client.query<{ id: string }>(
      `INSERT INTO tenants (name, slug) VALUES ('テスト法人', 'prompt-templates'), ('別法人', 'prompt-templates-other')
       RETURNING id;`,
    );
    tenantId = tenants[0]?.id ?? '';
    otherTenantId = tenants[1]?.id ?? '';
    const {
      rows: [staff],
    } = await client.query<{ id: string }>(
      "INSERT INTO staff (tenant_id, name, email) VALUES ($1, 'テスト管理者', 'admin@example.test') RETURNING id;",
      [tenantId],
    );
    staffId = staff?.id ?? '';

    repo = new DrizzlePromptTemplateRepository(
      drizzle(client, { schema, casing: 'snake_case' }) as unknown as Database,
    );
  });

  it('1版も無いテナントには何も返らない(呼び出し側が既定文面へフォールバックする)', async () => {
    expect(await repo.findLatestAll(tenantId)).toEqual([]);
    expect(await repo.findLatest(tenantId, 'daily_report')).toBeNull();
    expect(await repo.listVersions(tenantId, 'daily_report')).toEqual([]);
  });

  it('版番号は(テナント, キー)ごとに1から採番され、有効な版は最大版になる', async () => {
    const first = appended(
      await repo.appendIfChanged(
        tenantId,
        {
          key: 'daily_report',
          body: '一版目 {anonymizedText}',
          note: '最初の調整',
          createdByStaffId: staffId,
        },
        '既定の文面',
      ),
    );
    expect(first.version).toBe(1);
    expect(first.createdByStaffId).toBe(staffId);
    expect(first.createdAt).toBeInstanceOf(Date);

    const second = appended(
      await repo.appendIfChanged(
        tenantId,
        { key: 'daily_report', body: '二版目 {anonymizedText}', note: '', createdByStaffId: null },
        '既定の文面',
      ),
    );
    expect(second.version).toBe(2);

    // 別のキーは別系列で1から。
    const hint = appended(
      await repo.appendIfChanged(
        tenantId,
        { key: 'accident_hint', body: '記載要領', note: '', createdByStaffId: null },
        '既定の文面',
      ),
    );
    expect(hint.version).toBe(1);

    expect((await repo.findLatest(tenantId, 'daily_report'))?.body).toBe('二版目 {anonymizedText}');
    expect((await repo.listVersions(tenantId, 'daily_report')).map((row) => row.version)).toEqual([2, 1]);
  });

  it('findLatestAll はキーごとの最新版だけを返す', async () => {
    const rows = await repo.findLatestAll(tenantId);
    expect(rows.map((row) => [row.key, row.version]).sort()).toEqual([
      ['accident_hint', 1],
      ['daily_report', 2],
    ]);
  });

  it('別テナントの版は混ざらない', async () => {
    await repo.appendIfChanged(
      otherTenantId,
      { key: 'daily_report', body: 'よその文面 {anonymizedText}', note: '', createdByStaffId: null },
      '既定の文面',
    );
    expect((await repo.findLatest(otherTenantId, 'daily_report'))?.version).toBe(1);
    expect((await repo.findLatest(tenantId, 'daily_report'))?.version).toBe(2);
  });

  it('同じ文面を2回積んでも版は増えない(判定が書き込みと同じトランザクションにある)', async () => {
    const before = await repo.listVersions(tenantId, 'accident_hint');
    const again = await repo.appendIfChanged(
      tenantId,
      { key: 'accident_hint', body: '記載要領', note: '二度目', createdByStaffId: null },
      '既定の文面',
    );
    expect(again.appended).toBe(false);
    expect(again.appended === false && again.current?.version).toBe(1);
    expect(await repo.listVersions(tenantId, 'accident_hint')).toHaveLength(before.length);
  });

  it('1版も無いキーは、渡した既定文面と同じなら積まない', async () => {
    const result = await repo.appendIfChanged(
      tenantId,
      { key: 'receipt_ocr', body: '既定のOCR文面', note: '', createdByStaffId: null },
      '既定のOCR文面',
    );
    expect(result).toEqual({ appended: false, current: null });
    expect(await repo.listVersions(tenantId, 'receipt_ocr')).toEqual([]);
  });

  it('空白だけの文面はDBのCHECK制約で弾かれる', async () => {
    const error = await repo
      .appendIfChanged(
        tenantId,
        { key: 'daily_report', body: '   ', note: '', createdByStaffId: null },
        '既定の文面',
      )
      .then(
        () => null,
        (e: unknown) => e,
      );
    // drizzleがドライバのエラーを cause に包むので、狙った制約で落ちたかはそちらで見る
    // (NOT NULLや別のCHECKで偶然落ちて合格したことにならないようにするため)。
    const cause = (error as { cause?: { constraint?: string } } | null)?.cause;
    expect(cause?.constraint).toBe('prompt_templates_body_not_blank');
  });
});
