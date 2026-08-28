import type { AttendanceDayDerived, AttendanceMonthlyTotals, AttendanceRowData } from '../domain/attendance';
import { computeDayDerived, computeMonthlyTotals } from '../domain/attendance';
import type { CryptoPort } from '../ports/crypto';
import type { AttendanceDayRepositoryPort } from '../ports/repositories';

export interface AttendanceDeps {
  attendanceDays: AttendanceDayRepositoryPort;
  crypto: CryptoPort;
}

export interface AttendanceDayView {
  businessDate: string;
  rowData: AttendanceRowData;
  derived: AttendanceDayDerived;
}

async function decryptRowData(
  crypto: CryptoPort,
  tenantId: string,
  ciphertext: string,
  keyVersion: number,
): Promise<AttendanceRowData> {
  const json = await crypto.decrypt(tenantId, { ciphertext, keyVersion });
  return JSON.parse(json) as AttendanceRowData;
}

/**
 * 指定スタッフ・指定日の勤怠(出勤簿1日分)を取得する。データが無い日は空のrowData
 * (=すべて未入力)として扱う。派生値(労働時間・残業・移動距離等)は都度計算する。
 */
export async function getAttendanceDay(
  deps: AttendanceDeps,
  tenantId: string,
  staffId: string,
  businessDate: string,
): Promise<AttendanceDayView> {
  const record = await deps.attendanceDays.findByStaffAndDate(tenantId, staffId, businessDate);
  const rowData = record
    ? await decryptRowData(deps.crypto, tenantId, record.rowData.ciphertext, record.rowData.keyVersion)
    : {};
  return { businessDate, rowData, derived: computeDayDerived(rowData) };
}

/**
 * 指定スタッフ・指定日の入力列(rowData)を丸ごと保存する。数式に相当する派生値は
 * AttendanceRowDataに存在しないため、呼び出し側が派生値を書き込むことは型上できない。
 */
export async function saveAttendanceDay(
  deps: AttendanceDeps,
  tenantId: string,
  staffId: string,
  businessDate: string,
  rowData: AttendanceRowData,
): Promise<AttendanceDayView> {
  const encrypted = await deps.crypto.encrypt(tenantId, JSON.stringify(rowData));
  await deps.attendanceDays.upsert(tenantId, staffId, businessDate, encrypted);
  return { businessDate, rowData, derived: computeDayDerived(rowData) };
}

export interface AttendanceMonthView {
  yearMonth: string;
  days: AttendanceDayView[];
  totals: AttendanceMonthlyTotals;
}

/** 指定スタッフの指定月('YYYY-MM')の勤怠を集計する。 */
export async function getAttendanceMonth(
  deps: AttendanceDeps,
  tenantId: string,
  staffId: string,
  yearMonth: string,
): Promise<AttendanceMonthView> {
  const records = await deps.attendanceDays.listByStaffAndMonth(tenantId, staffId, yearMonth);

  const days = await Promise.all(
    records.map(async (r) => {
      const rowData = await decryptRowData(deps.crypto, tenantId, r.rowData.ciphertext, r.rowData.keyVersion);
      return { businessDate: r.businessDate, rowData, derived: computeDayDerived(rowData) };
    }),
  );
  days.sort((a, b) => a.businessDate.localeCompare(b.businessDate));

  const totals = computeMonthlyTotals(days.map((d) => ({ rowData: d.rowData, derived: d.derived })));

  return { yearMonth, days, totals };
}
