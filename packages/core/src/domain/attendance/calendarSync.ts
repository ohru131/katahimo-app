import { MAX_OFFICE_WORK, MAX_VISITS } from '@katahimo/shared';
import type { ScheduleAppointmentWithRoute } from '../../ports/schedule';
import { parseTimeToMinutes } from './attendanceCalc';
import type { AttendanceColumnRow } from './types';

/**
 * Googleカレンダーの予定 → 出勤簿(勤怠)への反映。
 *
 * 移植元:
 *   - gas-childcare-visit-app/RouteSearch.js  `buildTimesheetRowDataFromAppointments_`
 *     / `isOfficeWorkAppointment` / `calcDurationMinForAttendance`
 *   - gas-childcare-visit-app/PastSchedule.js `PAST_SCHEDULE_SYNC_SLOTS`
 *     / `buildCalendarSyncPlan_` / `timeRangesOverlap_` / `isSamePastScheduleValue_`
 *
 * GAS版と同じく列記号(AttendanceColumnRow)のまま計算する。永続形式(AttendanceRowData)へ
 * 持ち上げるのは呼び出し側(usecases/calendarSync.ts)が fromColumnRow で行う。列記号のまま
 * 突き合わせるのは、GAS版の「どの列を書き、どの列に触らないか」という非破壊マージの規則を
 * そのままの粒度で保つため(スロット単位に読み替えると、AI/AJのように特定の訪問に付随しない
 * 列の扱いがずれる)。
 */

/** カレンダー反映で書き換えうる列のラベル(差分確認モーダルの表示用)。 */
export const ATTENDANCE_COLUMN_LABELS: Record<string, string> = {
  C: '#1訪問先等',
  D: '#1始業時刻',
  E: '#1終業時刻',
  AI: '#1出勤距離',
  H: '#1→#2移動時間',
  L: '#2訪問先等',
  M: '#2始業時刻',
  N: '#2終業時刻',
  AG: '#1→#2移動距離',
  Q: '#2→#3移動時間',
  U: '#3訪問先等',
  V: '#3始業時刻',
  W: '#3終業時刻',
  AH: '#2→#3移動距離',
  AJ: '退勤距離',
  X: '作業１',
  Y: '作業１開始',
  Z: '作業１終了',
  AA: '作業２',
  AB: '作業２開始',
  AC: '作業２終了',
};

type ColumnKey = keyof AttendanceColumnRow;

interface SyncSlot {
  key: string;
  /** この2列が両方埋まっているときだけ「そのスロットに予定が入っている」とみなす。 */
  timeCols: [ColumnKey, ColumnKey];
  cols: ColumnKey[];
}

/**
 * カレンダー由来の列を「訪問#1/#2/#3・事務作業#1/#2」の5グループに束ねたもの。
 * グループの境界は buildColumnRowFromAppointments の割り当てと完全に一致させている
 * (H/AGは#2への移動、Q/AHは#3への移動、AIは出勤距離として#1側に付随する)。
 *
 * 退勤距離(AJ)は「その日最後の訪問」に付随し、訪問件数によって#1〜#3のどれになるか
 * 変わるため、特定のスロットには入れず buildCalendarSyncPlan で別扱いする
 * (GAS版で「訪問が2件以下の日にAJが反映されない」不具合を直したときと同じ構造)。
 */
const SYNC_SLOTS: SyncSlot[] = [
  { key: 'slot1', timeCols: ['D', 'E'], cols: ['C', 'D', 'E', 'AI'] },
  { key: 'slot2', timeCols: ['M', 'N'], cols: ['H', 'L', 'M', 'N', 'AG'] },
  { key: 'slot3', timeCols: ['V', 'W'], cols: ['Q', 'U', 'V', 'W', 'AH'] },
  { key: 'office1', timeCols: ['Y', 'Z'], cols: ['X', 'Y', 'Z'] },
  { key: 'office2', timeCols: ['AB', 'AC'], cols: ['AA', 'AB', 'AC'] },
];

const VISIT_SLOT_KEYS = ['slot1', 'slot2', 'slot3'];

/** GAS版 calcDurationMinForAttendance(日跨ぎは24時間を足して正にする)。 */
function durationMinutes(start: string, end: string): number {
  const s = parseTimeToMinutes(start);
  const e = parseTimeToMinutes(end);
  if (s === null || e === null) return 0;
  if (e >= s) return e - s;
  return 24 * 60 - s + e;
}

/**
 * GAS版 isOfficeWorkAppointment。CUSTOMER APPOINTMENT でもちょうど15分のものは
 * 「事務作業」として扱う(RESERVAの15分枠を事務作業に使っている運用に合わせたもの)。
 */
export function isOfficeWorkAppointment(appointment: ScheduleAppointmentWithRoute): boolean {
  if (appointment.eventType === 'OFFICE WORK') return true;
  if (appointment.eventType === 'CUSTOMER APPOINTMENT') {
    return durationMinutes(appointment.startTime, appointment.endTime) === 15;
  }
  return false;
}

/**
 * 数値0を「未入力」と誤判定しないための空値判定(GAS版 emptyOrValue_)。
 * 0分/0kmはれっきとした入力値なので''にしない。
 */
function emptyOrValue(value: number | string | undefined | null): string {
  if (value === undefined || value === null || value === '') return '';
  return String(value);
}

/**
 * ルート計算つきの予定(SchedulePort.getScheduleWithRoute の戻り)から、出勤簿1日分の
 * 列記号形式を組み立てる。移植元: GAS版 buildTimesheetRowDataFromAppointments_。
 *
 * 出勤簿が持てるのは訪問3件・事務作業2件まで(MAX_VISITS/MAX_OFFICE_WORK)。カレンダー側は
 * それより多くの予定を返しうるが、GAS版のように4件目以降を黙って捨てることはしない
 * ――捨てられるのは訪問先・時刻・移動距離、つまり給与に直結する値で、消えたことに
 * 誰も気付けないため(columnRow.ts の toColumnRow が同じ理由で例外を投げるのと同じ判断)。
 * 反映できない日は例外にして、一括反映の「失敗した組み合わせ」として日付・スタッフ名つきで
 * 表に出し、手入力で直してもらう。
 */
export function buildColumnRowFromAppointments(
  appointments: ScheduleAppointmentWithRoute[],
): AttendanceColumnRow {
  const rowData: AttendanceColumnRow = {
    C: '',
    D: '',
    E: '',
    H: '',
    L: '',
    M: '',
    N: '',
    Q: '',
    U: '',
    V: '',
    W: '',
    X: '',
    Y: '',
    Z: '',
    AA: '',
    AB: '',
    AC: '',
    AG: '',
    AH: '',
    AI: '',
    AJ: '',
  };

  const officeWorks = appointments.filter(isOfficeWorkAppointment);
  const visits = appointments.filter((a) => !isOfficeWorkAppointment(a));

  if (visits.length > MAX_VISITS || officeWorks.length > MAX_OFFICE_WORK) {
    throw new Error(
      `カレンダーの予定が出勤簿の枠に収まりません(訪問${visits.length}件/上限${MAX_VISITS}件、` +
        `事務作業${officeWorks.length}件/上限${MAX_OFFICE_WORK}件)。` +
        '一部だけを反映すると残りが黙って消えるため、この日は反映していません。手入力で調整してください。',
    );
  }

  if (visits[0]) {
    rowData.C = visits[0].customerName || '';
    rowData.D = visits[0].startTime || '';
    rowData.E = visits[0].endTime || '';
  }
  if (visits[1]) {
    rowData.L = visits[1].customerName || '';
    rowData.M = visits[1].startTime || '';
    rowData.N = visits[1].endTime || '';
    rowData.H = emptyOrValue(visits[1].moveMin);
    rowData.AG = emptyOrValue(visits[1].moveKm);
  }
  if (visits[2]) {
    rowData.U = visits[2].customerName || '';
    rowData.V = visits[2].startTime || '';
    rowData.W = visits[2].endTime || '';
    rowData.Q = emptyOrValue(visits[2].moveMin);
    rowData.AH = emptyOrValue(visits[2].moveKm);
  }

  // 出勤距離(AI)・退勤距離(AJ)は「位置情報のある最初/最後の予定」に付いてくるので、
  // visits[0]/visits[末尾]とは限らない(先頭や末尾がオンライン相談だと位置情報が無い)。
  // 値を持っている予定を探して読み取る(GAS版と同じ)。
  const withAttendance = visits.find((v) => emptyOrValue(v.attendanceKm) !== '');
  if (withAttendance) rowData.AI = emptyOrValue(withAttendance.attendanceKm);
  const withLeaving = visits.find((v) => emptyOrValue(v.leavingKm) !== '');
  if (withLeaving) rowData.AJ = emptyOrValue(withLeaving.leavingKm);

  if (officeWorks[0]) {
    rowData.X = officeWorks[0].customerName || '';
    rowData.Y = officeWorks[0].startTime || '';
    rowData.Z = officeWorks[0].endTime || '';
  }
  if (officeWorks[1]) {
    rowData.AA = officeWorks[1].customerName || '';
    rowData.AB = officeWorks[1].startTime || '';
    rowData.AC = officeWorks[1].endTime || '';
  }

  return rowData;
}

/** 出勤簿の値の同一判定(GAS版 isSamePastScheduleValue_ の、Dateセルが無い版)。 */
function isSameValue(oldValue: string | undefined, newValue: string | undefined): boolean {
  return String(oldValue ?? '') === String(newValue ?? '');
}

const MINUTES_PER_DAY = 24 * 60;

/**
 * 2つの時間帯が重なるか。
 *
 * 出勤簿の時刻は「その営業日の壁時計時刻」なので、終業が始業より前なら日跨ぎ勤務を表す
 * (shared/contracts/attendance.ts の attendanceTimeSchema 参照)。そのまま数値比較すると
 * 23:50-00:20 と 23:55-00:10 のように明らかに重なる組が「重ならない」と判定され、
 * 上書きされるべき古いスロットが出勤簿に残って予定が二重に見えてしまう。終業側に24時間を
 * 足して区間を正規化してから比較する(GAS版 timeRangesOverlap_ にはこの正規化が無く、
 * 夜勤の日に重複が残る不具合があった。ここは意図的にGAS版より正しくしている)。
 *
 * 前後の日へずらした比較はしない。どちらの区間も同じ営業日の始業時刻を起点にしているので、
 * 23:50-00:20(翌日の00:20まで)と 00:05-00:15(その日の朝)は別の時間帯であり、
 * ずらして突き合わせると重ならないものを重なると誤判定する。
 */
function timeRangesOverlap(
  startA: string | undefined,
  endA: string | undefined,
  startB: string | undefined,
  endB: string | undefined,
): boolean {
  const sA = parseTimeToMinutes(startA);
  const sB = parseTimeToMinutes(startB);
  const rawEndA = parseTimeToMinutes(endA);
  const rawEndB = parseTimeToMinutes(endB);
  if (sA === null || rawEndA === null || sB === null || rawEndB === null) return false;
  const eA = rawEndA < sA ? rawEndA + MINUTES_PER_DAY : rawEndA;
  const eB = rawEndB < sB ? rawEndB + MINUTES_PER_DAY : rawEndB;
  return sA < eB && sB < eA;
}

function isFilled(row: AttendanceColumnRow, cols: [ColumnKey, ColumnKey]): boolean {
  return !!row[cols[0]] && !!row[cols[1]];
}

/** 差分1件(差分確認モーダルの1行)。 */
export interface CalendarSyncChange {
  column: string;
  label: string;
  oldValue: string;
  newValue: string;
}

export interface CalendarSyncPlan {
  changes: CalendarSyncChange[];
  /** 実際に保存する列記号形式(current にカレンダー由来の変更を重ねたもの)。 */
  merged: AttendanceColumnRow;
}

/**
 * 出勤簿の現在の内容(current)とカレンダー由来の内容(incoming)を突き合わせ、
 * 実際に書き込む内容を決める。移植元: GAS版 buildCalendarSyncPlan_。
 *
 * 方針(手入力で足した、カレンダーには無い予定を自動で消してしまわないため):
 * - カレンダー側にそのグループの予定がある(始業・終業とも入力がある)場合は、
 *   カレンダーの内容で上書きする。
 * - カレンダー側にそのグループの予定が無く、出勤簿側にだけ予定がある場合は、
 *   その時間帯がカレンダー由来の他グループと重なっていない限り、その列には触らない
 *   (=既存の入力をそのまま残す)。重なっている場合だけ、カレンダー側で表現し直された
 *   =消えたものとみなしてクリアする。
 *
 * カレンダー反映が触らない列(天候 I/R・買物代行 AN・備考 AO)は current の値がそのまま残る。
 */
export function buildCalendarSyncPlan(
  current: AttendanceColumnRow,
  incoming: AttendanceColumnRow,
): CalendarSyncPlan {
  const changes: CalendarSyncChange[] = [];
  const merged: AttendanceColumnRow = { ...current };

  const applyColumn = (col: ColumnKey, newValue: string) => {
    const oldValue = current[col] ?? '';
    if (!isSameValue(oldValue, newValue)) {
      changes.push({
        column: col,
        label: ATTENDANCE_COLUMN_LABELS[col] ?? col,
        oldValue: String(oldValue),
        newValue,
      });
    }
    merged[col] = newValue;
  };

  const incomingFilledSlots = SYNC_SLOTS.filter((slot) => isFilled(incoming, slot.timeCols));

  for (const slot of SYNC_SLOTS) {
    if (isFilled(incoming, slot.timeCols)) {
      for (const col of slot.cols) applyColumn(col, incoming[col] ?? '');
      continue;
    }
    if (!isFilled(current, slot.timeCols)) continue;

    const overlapsAny = incomingFilledSlots.some((other) =>
      timeRangesOverlap(
        current[slot.timeCols[0]],
        current[slot.timeCols[1]],
        incoming[other.timeCols[0]],
        incoming[other.timeCols[1]],
      ),
    );
    if (overlapsAny) {
      for (const col of slot.cols) applyColumn(col, '');
    }
    // 重ならなければ何もしない(出勤簿側の入力をそのまま残す)。
  }

  // 退勤距離(AJ): カレンダー由来の訪問のうち最後に埋まっている枠に付随する値なので、
  // スロットのcolsとは別にここで一度だけ判定する。
  const lastIncomingVisitSlot = incomingFilledSlots.filter((s) => VISIT_SLOT_KEYS.includes(s.key)).pop();
  if (lastIncomingVisitSlot) applyColumn('AJ', incoming.AJ ?? '');

  return { changes, merged };
}
