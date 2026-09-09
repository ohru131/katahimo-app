import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import * as schema from './schema';

/**
 * 「全テーブルがRLSで守られている」ことの静的検査。
 *
 * drizzle-kitは `FORCE ROW LEVEL SECURITY` を生成しないため、drizzle/*.sql には手で
 * 追記している(0001_password_reset_and_initial_password.sql の冒頭コメント参照)。
 * FORCEが無いとテーブル所有者ロール(本番のマイグレーション実行ユーザ=アプリの接続ユーザ)
 * でRLSが素通りするので、追記を忘れるとテナント分離が丸ごと無効になる。
 *
 * 検査対象のテーブル一覧はここにベタ書きせず、必ず drizzle スキーマの export から集める。
 * そうしておかないと「新しいテーブルを足したがテスト側の一覧を更新しなかった」という、
 * 追記忘れとまったく同じ壊れ方をテスト自身がしてしまう。
 */

const DRIZZLE_DIR = join(dirname(fileURLToPath(import.meta.url)), '../drizzle');

/**
 * RLSを張らないテーブルのホワイトリスト。ここに足すのは「テナントを特定する前に読む
 * 必要がある」ものだけ(schema/tenants.ts のコメント参照)。
 * これ以外のテーブルは、追加された瞬間から自動的に検査対象になる。
 */
const RLS_EXEMPT_TABLES = ['tenants'];

const TENANT_POLICY_NAME = 'tenant_isolation';
const TENANT_COLUMN = 'tenant_id';

/** ポリシーが参照すべき式(schema/_rls.ts の TENANT_RLS_USING と同じもの)。 */
const TENANT_PREDICATE = "tenant_id = current_setting('app.tenant_id', true)::uuid";

// ---------------------------------------------------------------------------
// drizzle スキーマ側
// ---------------------------------------------------------------------------

interface SchemaTable {
  name: string;
  columns: string[];
  enableRLS: boolean;
  policies: string[];
}

/** camelCase のカラム名を、drizzle の casing: 'snake_case' が実際に発行する名前に揃える。 */
function toSnakeCase(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

/**
 * 引数を unknown で受けるのは、`Object.values(schema)` の要素型(テーブルごとの具象型の
 * union)に対して `value is PgTable` を直接書くと、型述語の代入互換性検査で弾かれるため。
 */
function isPgTable(value: unknown): value is PgTable {
  return is(value, PgTable);
}

/** schema/index.ts が export しているテーブルを全部集める(名前のベタ書きをしない)。 */
function collectSchemaTables(): SchemaTable[] {
  return Object.values(schema)
    .filter(isPgTable)
    .map((table) => {
      const config = getTableConfig(table);
      return {
        name: config.name,
        columns: config.columns.map((column) => toSnakeCase(column.name)),
        enableRLS: config.enableRLS,
        policies: config.policies.map((policy) => policy.name),
      };
    })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

// ---------------------------------------------------------------------------
// マイグレーションSQL側
// ---------------------------------------------------------------------------

/** テーブル名。`"staff"` / `staff` / `"public"."staff"` のどれでも拾う。 */
const TABLE_REF = String.raw`(?:"?public"?\.)?"?([A-Za-z_][\w$]*)"?`;
const POLICY_REF = String.raw`"?([A-Za-z_][\w$]*)"?`;

const RLS_TOGGLE_RE = new RegExp(
  String.raw`ALTER\s+TABLE\s+(?:ONLY\s+)?${TABLE_REF}\s+(ENABLE|DISABLE|NO\s+FORCE|FORCE)\s+ROW\s+LEVEL\s+SECURITY`,
  'gi',
);
// ポリシー本文は次の `;` まで。USING/WITH CHECK の中に `;` は出てこない。
const CREATE_POLICY_RE = new RegExp(
  String.raw`CREATE\s+POLICY\s+${POLICY_REF}\s+ON\s+${TABLE_REF}([^;]*)`,
  'gi',
);
const DROP_POLICY_RE = new RegExp(
  String.raw`DROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?${POLICY_REF}\s+ON\s+${TABLE_REF}`,
  'gi',
);

type SqlEvent =
  | { at: number; kind: 'toggle'; table: string; action: 'enable' | 'disable' | 'force' | 'noforce' }
  | { at: number; kind: 'createPolicy'; table: string; policy: string; body: string }
  | { at: number; kind: 'dropPolicy'; table: string; policy: string };

/** RLSの最終状態。マイグレーションを先頭から順に畳み込んだ結果。 */
interface RlsState {
  enabled: boolean;
  forced: boolean;
  /** ポリシー名 -> `CREATE POLICY` の本文(USING / WITH CHECK を含む)。 */
  policies: Map<string, string>;
}

/** drizzle/*.sql を適用順(ファイル名順)に連結する。 */
function loadMigrationSql(): string {
  const files = readdirSync(DRIZZLE_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  if (files.length === 0) throw new Error(`マイグレーションSQLが見つかりません: ${DRIZZLE_DIR}`);
  return files.map((name) => readFileSync(join(DRIZZLE_DIR, name), 'utf8')).join('\n');
}

function normalizeAction(raw: string): 'enable' | 'disable' | 'force' | 'noforce' {
  const collapsed = raw.replace(/\s+/g, ' ').toUpperCase();
  if (collapsed === 'ENABLE') return 'enable';
  if (collapsed === 'DISABLE') return 'disable';
  if (collapsed === 'NO FORCE') return 'noforce';
  return 'force';
}

/**
 * 「あとから DISABLE / DROP POLICY した」も正しく効かせるため、単なる有無ではなく
 * 出現順に畳み込む。マイグレーションは追記式なので、最後の状態が本番の状態になる。
 */
function parseRlsStates(sql: string): Map<string, RlsState> {
  const events: SqlEvent[] = [];

  for (const m of sql.matchAll(RLS_TOGGLE_RE)) {
    const [, table, action] = m;
    if (table && action) events.push({ at: m.index, kind: 'toggle', table, action: normalizeAction(action) });
  }
  for (const m of sql.matchAll(CREATE_POLICY_RE)) {
    const [, policy, table, body] = m;
    if (policy && table) events.push({ at: m.index, kind: 'createPolicy', table, policy, body: body ?? '' });
  }
  for (const m of sql.matchAll(DROP_POLICY_RE)) {
    const [, policy, table] = m;
    if (policy && table) events.push({ at: m.index, kind: 'dropPolicy', table, policy });
  }
  events.sort((a, b) => a.at - b.at);

  const states = new Map<string, RlsState>();
  const stateOf = (table: string): RlsState => {
    const existing = states.get(table);
    if (existing) return existing;
    const created: RlsState = { enabled: false, forced: false, policies: new Map() };
    states.set(table, created);
    return created;
  };

  for (const event of events) {
    const state = stateOf(event.table);
    if (event.kind === 'toggle') {
      if (event.action === 'enable') state.enabled = true;
      else if (event.action === 'disable') state.enabled = false;
      else if (event.action === 'force') state.forced = true;
      else state.forced = false;
    } else if (event.kind === 'createPolicy') {
      state.policies.set(event.policy, event.body);
    } else {
      state.policies.delete(event.policy);
    }
  }
  return states;
}

// ---------------------------------------------------------------------------

const schemaTables = collectSchemaTables();
const rlsStates = parseRlsStates(loadMigrationSql());
const protectedTables = schemaTables.filter((table) => !RLS_EXEMPT_TABLES.includes(table.name));

describe('RLSの静的検査', () => {
  it('drizzleスキーマからテーブルを収集できている', () => {
    // 収集に失敗して0件になると、以降の検査が「全部合格」に化けてしまう。
    expect(schemaTables.map((table) => table.name)).toContain('staff');
    expect(protectedTables.length).toBeGreaterThan(5);
  });

  it('SQLパーサが ENABLE / FORCE / ポリシーを実際に読めている', () => {
    // 正規表現が壊れて何も拾わなくなると、これも「全部合格」に化ける。
    const staff = rlsStates.get('staff');
    expect(staff).toBeDefined();
    expect(staff?.enabled).toBe(true);
    expect(staff?.forced).toBe(true);
    expect(staff?.policies.has(TENANT_POLICY_NAME)).toBe(true);
    // ENABLE と FORCE を取り違えていないこと(片方だけのテーブルを作って確かめる)。
    const onlyEnabled = parseRlsStates('ALTER TABLE "x" ENABLE ROW LEVEL SECURITY;').get('x');
    expect(onlyEnabled).toEqual({ enabled: true, forced: false, policies: new Map() });
    const onlyForced = parseRlsStates('ALTER TABLE "x" FORCE ROW LEVEL SECURITY;').get('x');
    expect(onlyForced).toEqual({ enabled: false, forced: true, policies: new Map() });
    // あとから外した場合は「無い」と判定されること。
    const revoked = parseRlsStates(
      'ALTER TABLE "x" ENABLE ROW LEVEL SECURITY;\nALTER TABLE "x" NO FORCE ROW LEVEL SECURITY;',
    ).get('x');
    expect(revoked?.forced).toBe(false);
  });

  it('除外リストは実在するテーブルだけを指している', () => {
    const names = schemaTables.map((table) => table.name);
    for (const exempt of RLS_EXEMPT_TABLES) expect(names).toContain(exempt);
  });

  it('除外テーブルにRLSが付いたら除外リストを見直す', () => {
    for (const exempt of RLS_EXEMPT_TABLES) {
      expect(rlsStates.get(exempt)?.enabled ?? false).toBe(false);
    }
  });

  it('除外テーブル以外は全て tenant_id を持つ', () => {
    // tenant_id が無いテーブルは tenant_isolation ポリシーを張れない = 除外扱いになりがち。
    const missing = protectedTables.filter((table) => !table.columns.includes(TENANT_COLUMN));
    expect(missing.map((table) => table.name)).toEqual([]);
  });

  describe.each(protectedTables.map((table) => [table.name, table] as const))('%s', (name, table) => {
    it('マイグレーションSQLに ENABLE と FORCE の両方がある', () => {
      const state = rlsStates.get(name);
      expect(state, `${name}: マイグレーションSQLにRLSの記述がありません`).toBeDefined();
      expect(state?.enabled, `${name}: ENABLE ROW LEVEL SECURITY がありません`).toBe(true);
      expect(
        state?.forced,
        `${name}: FORCE ROW LEVEL SECURITY がありません。drizzle-kitは生成しないので手で追記が必要です`,
      ).toBe(true);
    });

    it(`マイグレーションSQLに ${TENANT_POLICY_NAME} ポリシーがあり USING と WITH CHECK を持つ`, () => {
      const body = rlsStates.get(name)?.policies.get(TENANT_POLICY_NAME);
      expect(body, `${name}: CREATE POLICY "${TENANT_POLICY_NAME}" がありません`).toBeDefined();
      const normalized = (body ?? '').replace(/\s+/g, ' ');
      // USING だけだと読み取りしか守れず、他テナントのtenant_idでのINSERTが通ってしまう。
      expect(normalized, `${name}: ポリシーに USING がありません`).toMatch(/USING\s*\(/i);
      expect(normalized, `${name}: ポリシーに WITH CHECK がありません`).toMatch(/WITH CHECK\s*\(/i);
      const occurrences = normalized.split(TENANT_PREDICATE).length - 1;
      expect(occurrences, `${name}: USING と WITH CHECK の両方がテナント条件になっていません`).toBe(2);
    });

    it('drizzleスキーマ側も enableRLS() とポリシーを宣言している', () => {
      // SQLだけ正しくてもスキーマ側が欠けていると、次の drizzle-kit generate で
      // 「RLSを外す」差分が生成されてしまう。
      expect(table.enableRLS, `${name}: schema定義に .enableRLS() がありません`).toBe(true);
      expect(
        table.policies,
        `${name}: schema定義に pgPolicy('${TENANT_POLICY_NAME}') がありません`,
      ).toContain(TENANT_POLICY_NAME);
    });
  });
});
