import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import * as schema from './schema';

/**
 * 「updated_at列を持つ全テーブルにトリガーが張られている」ことの静的検査。
 *
 * doc/14 §5: 更新日時はDBトリガー(set_updated_at)で一元管理する方針にした。
 * アプリのコードがSETし忘れても(実際に customers で起きていた)DBが強制するので壊れない、
 * という前提のため、トリガーの張り忘れ自体は rlsPolicies.test.ts の「RLSの張り忘れ」と
 * 同じ重さの事故になる。書き方もそれに合わせる。
 *
 * 検査対象のテーブル一覧はここにベタ書きせず、必ず drizzle スキーマの export から
 * updated_at 列を持つものを集める。ベタ書きすると「テーブルを足したがテスト側の一覧を
 * 更新しなかった」という、トリガーの張り忘れと全く同じ壊れ方をテスト自身がしてしまう。
 */

const DRIZZLE_DIR = join(dirname(fileURLToPath(import.meta.url)), '../drizzle');

const UPDATED_AT_COLUMN = 'updated_at';
const TRIGGER_FUNCTION = 'set_updated_at';

// ---------------------------------------------------------------------------
// drizzle スキーマ側
// ---------------------------------------------------------------------------

interface SchemaTable {
  name: string;
  columns: string[];
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
      };
    })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

// ---------------------------------------------------------------------------
// マイグレーションSQL側
// ---------------------------------------------------------------------------

/** テーブル名・トリガー名・関数名。`"customers"` / `customers` / `"public"."customers"` のどれでも拾う。 */
const IDENT = String.raw`"?([A-Za-z_][\w$]*)"?`;
const TABLE_REF = String.raw`(?:"?public"?\.)?${IDENT}`;

// トリガー本体(タイミング・イベント・EXECUTE FUNCTION)は次の `;` まで。
// このリポジトリのトリガー定義にセミコロンを含む式は無い(RLSポリシーのUSING/WITH CHECKと同様)。
const CREATE_TRIGGER_RE = new RegExp(
  String.raw`CREATE\s+TRIGGER\s+${IDENT}\s+([^;]*?)\s+ON\s+${TABLE_REF}\s+FOR\s+EACH\s+ROW\s+EXECUTE\s+(?:FUNCTION|PROCEDURE)\s+${IDENT}\s*\(\s*\)`,
  'gi',
);
const DROP_TRIGGER_RE = new RegExp(
  String.raw`DROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?${IDENT}\s+ON\s+${TABLE_REF}`,
  'gi',
);

type SqlEvent =
  | { at: number; kind: 'create'; table: string; trigger: string; timingEvent: string; fn: string }
  | { at: number; kind: 'drop'; table: string; trigger: string };

/** トリガーの最終状態。マイグレーションを先頭から順に畳み込んだ結果。 */
interface TriggerState {
  /** トリガー名 -> (タイミング・イベント句, 呼び出す関数名)。 */
  triggers: Map<string, { timingEvent: string; fn: string }>;
}

/** drizzle/*.sql を適用順(ファイル名順)に連結する。 */
function loadMigrationSql(): string {
  const files = readdirSync(DRIZZLE_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  if (files.length === 0) throw new Error(`マイグレーションSQLが見つかりません: ${DRIZZLE_DIR}`);
  return files.map((name) => readFileSync(join(DRIZZLE_DIR, name), 'utf8')).join('\n');
}

/**
 * 「あとから DROP TRIGGER した」も正しく効かせるため、単なる有無ではなく出現順に畳み込む。
 * マイグレーションは追記式なので、最後の状態が本番の状態になる(rlsPolicies.test.ts と同じ考え方)。
 */
function parseTriggerStates(sql: string): Map<string, TriggerState> {
  const events: SqlEvent[] = [];

  for (const m of sql.matchAll(CREATE_TRIGGER_RE)) {
    const [, trigger, timingEvent, table, fn] = m;
    if (trigger && table && fn) {
      events.push({ at: m.index, kind: 'create', table, trigger, timingEvent: timingEvent ?? '', fn });
    }
  }
  for (const m of sql.matchAll(DROP_TRIGGER_RE)) {
    const [, trigger, table] = m;
    if (trigger && table) events.push({ at: m.index, kind: 'drop', table, trigger });
  }
  events.sort((a, b) => a.at - b.at);

  const states = new Map<string, TriggerState>();
  const stateOf = (table: string): TriggerState => {
    const existing = states.get(table);
    if (existing) return existing;
    const created: TriggerState = { triggers: new Map() };
    states.set(table, created);
    return created;
  };

  for (const event of events) {
    const state = stateOf(event.table);
    if (event.kind === 'create') {
      state.triggers.set(event.trigger, { timingEvent: event.timingEvent, fn: event.fn });
    } else {
      state.triggers.delete(event.trigger);
    }
  }
  return states;
}

/** テーブルに `set_updated_at` を BEFORE UPDATE で呼ぶトリガーが(畳み込んだ結果)存在するか。 */
function hasUpdatedAtTrigger(state: TriggerState | undefined): boolean {
  if (!state) return false;
  for (const { timingEvent, fn } of state.triggers.values()) {
    if (fn !== TRIGGER_FUNCTION) continue;
    const normalized = timingEvent.replace(/\s+/g, ' ').toUpperCase();
    if (normalized.includes('BEFORE') && normalized.includes('UPDATE')) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------

const schemaTables = collectSchemaTables();
const triggerStates = parseTriggerStates(loadMigrationSql());
const tablesWithUpdatedAt = schemaTables.filter((table) => table.columns.includes(UPDATED_AT_COLUMN));
const tablesWithoutUpdatedAt = schemaTables.filter((table) => !table.columns.includes(UPDATED_AT_COLUMN));

describe('updated_atトリガーの静的検査', () => {
  it('drizzleスキーマからupdated_at列を持つテーブルを収集できている', () => {
    // 収集に失敗して0件になると、以降の検査が「全部合格」に化けてしまう。
    expect(tablesWithUpdatedAt.map((table) => table.name)).toContain('customers');
    expect(tablesWithUpdatedAt.length).toBeGreaterThan(5);
  });

  it('SQLパーサが実際に CREATE TRIGGER / DROP TRIGGER を読めている', () => {
    // 正規表現が壊れて何も拾わなくなると、これも「全部合格」に化ける。
    const customers = triggerStates.get('customers');
    expect(customers).toBeDefined();
    expect(hasUpdatedAtTrigger(customers)).toBe(true);

    // あとから DROP した場合は「無い」と判定されること。
    const revoked = parseTriggerStates(
      [
        'CREATE TRIGGER "x_set_updated_at" BEFORE UPDATE ON "x" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();',
        'DROP TRIGGER "x_set_updated_at" ON "x";',
      ].join('\n'),
    ).get('x');
    expect(hasUpdatedAtTrigger(revoked)).toBe(false);

    // AFTER や別関数を取り違えていないこと。
    const wrongTiming = parseTriggerStates(
      'CREATE TRIGGER "y_t" AFTER UPDATE ON "y" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();',
    ).get('y');
    expect(hasUpdatedAtTrigger(wrongTiming)).toBe(false);
    const wrongFn = parseTriggerStates(
      'CREATE TRIGGER "z_t" BEFORE UPDATE ON "z" FOR EACH ROW EXECUTE FUNCTION "some_other_fn"();',
    ).get('z');
    expect(hasUpdatedAtTrigger(wrongFn)).toBe(false);
  });

  describe.each(tablesWithUpdatedAt.map((table) => [table.name, table] as const))('%s', (name) => {
    it(`マイグレーションSQLに ${TRIGGER_FUNCTION} を BEFORE UPDATE で呼ぶトリガーがある`, () => {
      const state = triggerStates.get(name);
      expect(
        hasUpdatedAtTrigger(state),
        `${name}: updated_at列を持つのに ${TRIGGER_FUNCTION} を呼ぶ BEFORE UPDATE トリガーがありません`,
      ).toBe(true);
    });
  });

  it('updated_at列を持たないテーブルにトリガーが付いていない', () => {
    // 意図しない対象拡大(=張り忘れの逆で、余計なテーブルに張ってしまう)に気付けるように、
    // 「持たないテーブル」側も検査する。receipts / sessions / password_reset_codes / tenants が対象。
    const names = tablesWithoutUpdatedAt.map((table) => table.name);
    expect(names).toEqual(
      expect.arrayContaining(['receipts', 'sessions', 'password_reset_codes', 'tenants']),
    );

    const unexpected = tablesWithoutUpdatedAt.filter((table) =>
      hasUpdatedAtTrigger(triggerStates.get(table.name)),
    );
    expect(
      unexpected.map((table) => table.name),
      'updated_at列を持たないテーブルに set_updated_at トリガーが付いています。対象範囲を見直してください',
    ).toEqual([]);
  });
});
