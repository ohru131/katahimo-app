import type { PGlite } from '@electric-sql/pglite';

/**
 * 「デモデータをどこまで作ったか」の記録。
 *
 * これが無いと、2回目以降の起動で日付を追い足すときに「どの日まで作ってあるか」を
 * 推測するしかなくなり、二重投入(同じ日の日報が2件)か取りこぼし(空の日)のどちらかが起きる。
 *
 * 置き場所は demo_applied_migrations と同じく public スキーマの専用テーブル。
 * リセット(DROP SCHEMA public CASCADE)で一緒に消えるので、「消したのに作り終えたことに
 * なっている」状態が残らない。
 */
const STATE_TABLE = 'demo_seed_state';

export interface DemoSeedState {
  /** 訪問履歴(日報・事故報告)を作り終えた最後の業務日('YYYY-MM-DD')。 */
  reportsThrough: string;
  /** 領収書を投入済みの月('YYYY-MM')。 */
  receiptsMonth: string;
  /** 世帯代表者の生年月日を「誕生月」に合わせてある月('YYYY-MM')。 */
  birthdayMonth: string;
}

/** 記録用テーブルを用意する。マイグレーション適用後に毎回呼んで構わない。 */
export async function ensureSeedStateTable(client: PGlite): Promise<void> {
  await client.exec(
    `CREATE TABLE IF NOT EXISTS ${STATE_TABLE} (
       key text PRIMARY KEY,
       value text NOT NULL
     );`,
  );
}

/**
 * 記録を読む。項目が1つでも欠けていれば null を返す。
 *
 * この仕組みを入れる前に作られたDB(訪問者のIndexedDBに既にある)はテーブルごと空なので、
 * 呼び出し側はそこからDBの中身を見て復元する必要がある。
 */
export async function readSeedState(client: PGlite): Promise<DemoSeedState | null> {
  const { rows } = await client.query<{ key: string; value: string }>(
    `SELECT key, value FROM ${STATE_TABLE};`,
  );
  const map = new Map(rows.map((row) => [row.key, row.value]));
  const reportsThrough = map.get('reports_through');
  const receiptsMonth = map.get('receipts_month');
  const birthdayMonth = map.get('birthday_month');
  if (!reportsThrough || !receiptsMonth || !birthdayMonth) return null;
  return { reportsThrough, receiptsMonth, birthdayMonth };
}

/** 記録を書き戻す(全項目を毎回まとめて上書きする)。 */
export async function writeSeedState(client: PGlite, state: DemoSeedState): Promise<void> {
  const entries: [string, string][] = [
    ['reports_through', state.reportsThrough],
    ['receipts_month', state.receiptsMonth],
    ['birthday_month', state.birthdayMonth],
  ];
  await client.transaction(async (tx) => {
    for (const [key, value] of entries) {
      await tx.query(
        `INSERT INTO ${STATE_TABLE} (key, value) VALUES ($1, $2)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;`,
        [key, value],
      );
    }
  });
}
