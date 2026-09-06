/**
 * 「誰をいつ訪問するか」を日付から決定論的に導出する。
 *
 * 本番の予定はGoogleカレンダー(GAS Bridge経由)から取るが、デモにはカレンダーが無い。
 * かといって予定をDBに貯めると「明日以降の予定が無い」デモになってしまうので、
 * 日付を入力にした純関数として組み立てる。過去の訪問履歴をシードするときも、
 * 予定タブが今日/明日の予定を出すときも、同じこの関数を通すことで両者が食い違わない。
 */

/** 1日あたりの訪問枠。GAS版の出勤簿テンプレート(1日3訪問+事務)に合わせている。 */
export const VISIT_SLOTS = [
  { start: '10:00', end: '11:30' },
  { start: '13:00', end: '14:30' },
  { start: '15:30', end: '17:00' },
] as const;

export interface PlannedVisit {
  /** DEMO_FIGURES上のindex。呼び出し側が実際の顧客レコードへ解決する。 */
  figureIndex: number;
  start: string;
  end: string;
}

/** 文字列から32bitのハッシュを作る(FNV-1a)。日付ごとに安定した並びを得るための種。 */
function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * その日の訪問件数。平日3件・土曜2件・日曜1件。
 *
 * 曜日で件数を変えているのは、勤怠カレンダーに週のリズムが出るようにするため。
 * 日曜を0件(休業)にすると、日曜にデモを見た人の「今日の予定」が空になり、
 * 第一印象が「何も入っていないアプリ」になってしまうので、最低1件は入れる。
 */
function visitCountForDate(dateIso: string): number {
  // 正午UTCで解釈する。深夜0時にするとタイムゾーンのずれで前日の曜日を拾ってしまう。
  const day = new Date(`${dateIso}T12:00:00Z`).getUTCDay();
  if (day === 0) return 1;
  if (day === 6) return 2;
  return VISIT_SLOTS.length;
}

/**
 * 指定日・指定スタッフの訪問予定を返す。
 *
 * @param figureCount 選択対象の世帯数(DEMO_FIGURES.length)
 */
export function planVisitsForDate(dateIso: string, staffName: string, figureCount: number): PlannedVisit[] {
  const visitCount = visitCountForDate(dateIso);
  if (visitCount === 0) return [];

  const seed = hashString(`${dateIso}|${staffName}`);
  const chosen: number[] = [];
  // 同じ日に同じ世帯を二重に入れないよう、重複を除きながら枠数ぶん選ぶ。
  for (let attempt = 0; chosen.length < visitCount && attempt < figureCount * 3; attempt++) {
    const index = (seed + attempt * 7919) % figureCount;
    if (!chosen.includes(index)) chosen.push(index);
  }

  return chosen.map((figureIndex, i) => {
    const slot = VISIT_SLOTS[i];
    if (!slot) throw new Error('訪問枠の数を超えて予定を組もうとしました');
    return { figureIndex, start: slot.start, end: slot.end };
  });
}

/** シード時に「過去◯日ぶんの履歴」を作るための日付一覧(古い順)。 */
export function recentBusinessDates(today: Date, days: number): string[] {
  const dates: string[] = [];
  for (let offset = days; offset >= 1; offset--) {
    // 実行環境のタイムゾーンに左右されないよう、日付の加減算はミリ秒で行う。
    dates.push(toJstDateIso(new Date(today.getTime() - offset * 24 * 60 * 60 * 1000)));
  }
  return dates;
}

/**
 * 「今日」の翌日から今週の土曜までの日付。
 *
 * 勤怠タブの週間表示は日曜始まりで、保存済みの出勤簿しか出せない。過去の日付だけを
 * 入れると今週が埋まらず、とくに日曜にアクセスすると1件も出ない(今週=今日〜土曜が
 * すべて未来になる)。デモとして空の週を見せないために、今週ぶんは先まで入れておく。
 */
export function upcomingWeekDates(today: Date): string[] {
  // JSTでの曜日。getUTCDay()を+9時間ずらした日付に対して使う。
  const jstDayOfWeek = new Date(today.getTime() + 9 * 60 * 60 * 1000).getUTCDay();
  const dates: string[] = [];
  for (let offset = 1; offset <= 6 - jstDayOfWeek; offset++) {
    dates.push(toJstDateIso(new Date(today.getTime() + offset * 24 * 60 * 60 * 1000)));
  }
  return dates;
}

/** DateをJST基準の 'YYYY-MM-DD' にする。業務日は全てJSTで扱う。 */
export function toJstDateIso(date: Date): string {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}
