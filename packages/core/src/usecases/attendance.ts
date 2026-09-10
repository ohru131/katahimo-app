import type {
  AttendanceDayDerived,
  AttendanceMonthlyTotals,
  AttendanceRowData,
  ScheduleEvent,
} from '../domain/attendance';
import {
  buildScheduleEventsFromRowData,
  computeDayDerived,
  computeMonthlyTotals,
} from '../domain/attendance';
import { buildMirrorIdempotencyKey } from '../domain/mirror/idempotencyKey';
import type { MirrorPort } from '../ports/mirror';
import type { AttendanceDayRepositoryPort } from '../ports/repositories';
import type { UnitOfWorkPort } from '../ports/unitOfWork';

export interface AttendanceDeps {
  attendanceDays: AttendanceDayRepositoryPort;
  /** 出勤簿スプレッドシートへのミラー書き込み要求をoutboxに積む(Phase 5)。 */
  mirror: MirrorPort;
  /** 勤怠の保存とミラー要求のenqueueを、1つのトランザクションにまとめるために使う。 */
  unitOfWork: UnitOfWorkPort;
}

export interface AttendanceDayView {
  businessDate: string;
  rowData: AttendanceRowData;
  derived: AttendanceDayDerived;
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
  const rowData: AttendanceRowData = record ? record.rowData : {};
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
  await deps.unitOfWork.run(tenantId, async (scope) => {
    const record = await deps.attendanceDays.upsert(tenantId, staffId, businessDate, rowData, scope);
    await deps.mirror.enqueue(
      {
        tenantId,
        kind: 'attendance_day',
        targetId: record.id,
        idempotencyKey: buildMirrorIdempotencyKey('attendance_day', record.id, record.updatedAt),
      },
      scope,
    );
  });
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

  const days = records.map((r) => ({
    businessDate: r.businessDate,
    rowData: r.rowData,
    derived: computeDayDerived(r.rowData),
  }));
  days.sort((a, b) => a.businessDate.localeCompare(b.businessDate));

  const totals = computeMonthlyTotals(days.map((d) => ({ rowData: d.rowData, derived: d.derived })));

  return { yearMonth, days, totals };
}

/**
 * 指定スタッフの指定期間('YYYY-MM-DD'両端含む)の勤怠を、週間予定UI表示用のイベント配列に変換する。
 *
 * GAS版の週間予定タブと同じく、実際のGoogleカレンダーからではなく出勤簿(attendance_days)の
 * 記録内容をそのままイベント化して返す(閲覧専用。カレンダー連携Phase 5が無くても動く)。
 */
export async function getAttendanceScheduleEvents(
  deps: AttendanceDeps,
  tenantId: string,
  staffId: string,
  startDate: string,
  endDate: string,
): Promise<ScheduleEvent[]> {
  const records = await deps.attendanceDays.listByStaffAndDateRange(tenantId, staffId, startDate, endDate);

  return records.flatMap((r) => buildScheduleEventsFromRowData(r.businessDate, r.rowData));
}
