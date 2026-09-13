/**
 * 営業日の計算。実費報告(領収書)の取り消し期限に使う(doc/14 §10)。
 *
 * 【祝日を扱わない理由】
 * このアプリは祝日カレンダーを持っていない。持たないまま「祝日も除く」と書くと、実際には
 * 除けていないのに除けているつもりのコードになる。ここでは土日だけを休みとして扱い、
 * 祝日の扱いが必要になった時点でカレンダーを持ち込む(その時までは、祝日をまたぐと期限が
 * 1日ぶん厳しくなる方向にずれる=取り消せる期間が短くなる側なので、会計上は安全側)。
 */

/** 'YYYY-MM-DD'(JST)の日付がその曜日か。0=日曜, 6=土曜。 */
function dayOfWeek(dateStr: string): number {
  const [year, month, day] = dateStr.split('-').map(Number);
  // 曜日の判定だけなのでUTCの正午で作る(タイムゾーンで前後の日にずれない)。
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1, 12)).getUTCDay();
}

/** 土日を休みとして扱う。 */
function isBusinessDay(dateStr: string): boolean {
  const dow = dayOfWeek(dateStr);
  return dow !== 0 && dow !== 6;
}

/** 'YYYY-MM-DD' に日数を足す。 */
function addDays(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1, 12));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * 'YYYY-MM-DD' から営業日をcount日ぶん進めた日付を返す。
 *
 * 起点の日が営業日かどうかは数えない(「訪問日+2営業日」は、訪問日の翌営業日・翌々営業日を
 * 指す)。土曜の訪問なら、月曜・火曜を数えて火曜が期限になる。
 */
export function addBusinessDays(dateStr: string, count: number): string {
  let current = dateStr;
  let remaining = count;
  while (remaining > 0) {
    current = addDays(current, 1);
    if (isBusinessDay(current)) remaining -= 1;
  }
  return current;
}
