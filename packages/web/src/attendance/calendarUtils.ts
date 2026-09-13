import type { ScheduleEvent } from '../api';

/**
 * GAS版(gas-childcare-visit-app/index.html)の週間予定タブと同じ計算ロジック
 * (calYmd_/calGetWeekStart_/calTimeToMinutes_/calComputeHourRange_)を移植したもの。
 * 表示用の整形(calFormatMonthDay/calFormatHours)は、出勤簿を「予定のある日だけのリスト」で
 * 見せるためにweb側で足したもの(doc/16_UIUX改善提案_2026-09-03.html「週の表示」)。
 */
export const CAL_DOW = ['日', '月', '火', '水', '木', '金', '土'];

/**
 * 予定の種類ごとの色。色は役割で決める方針(提案書「文字・色・大きさのきまり」)に合わせ、
 * お客様の訪問=青、事務作業=灰の2つだけにしている。
 */
export const CAL_TYPE_STYLE: Record<string, string> = {
  'CUSTOMER APPOINTMENT': 'bg-app-primary-bg text-app-text border-app-primary',
  'OFFICE WORK': 'bg-gray-100 text-app-text border-gray-300',
};

// 通常の勤務時間帯(9〜20時)を仮の表示範囲とし、それを超える予定がある場合のみ広げる。
const CAL_DEFAULT_START_HOUR = 9;
const CAL_DEFAULT_END_HOUR = 20;

export function calYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function calGetWeekStart(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  copy.setDate(copy.getDate() - copy.getDay());
  return copy;
}

export function calTimeToMinutes(hhmm: string | undefined): number | null {
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function calComputeHourRange(events: ScheduleEvent[]): { startHour: number; endHour: number } {
  let startHour = CAL_DEFAULT_START_HOUR;
  let endHour = CAL_DEFAULT_END_HOUR;
  for (const e of events) {
    const s = calTimeToMinutes(e.start);
    const en = calTimeToMinutes(e.end);
    if (s !== null) startHour = Math.min(startHour, Math.floor(s / 60));
    if (en !== null) endHour = Math.max(endHour, Math.ceil(en / 60));
  }
  if (endHour <= startHour) endHour = startHour + 1;
  return { startHour, endHour };
}

/** 「8月31日」。ハイフン区切り(2026-08-31)はコンピュータの表記なので画面には出さない。 */
export function calFormatMonthDay(d: Date): string {
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 分を「5.0h」の形にする。日ごとの合計時間をひと目で比べられるようにするため。 */
export function calFormatHours(minutes: number): string {
  return `${(minutes / 60).toFixed(1)}h`;
}

/** その日の予定の長さの合計(分)。開始〜終了が読めない予定は0分として数える。 */
export function calSumEventMinutes(events: ScheduleEvent[]): number {
  let total = 0;
  for (const e of events) {
    const s = calTimeToMinutes(e.start);
    const en = calTimeToMinutes(e.end);
    if (s === null || en === null || en <= s) continue;
    total += en - s;
  }
  return total;
}
