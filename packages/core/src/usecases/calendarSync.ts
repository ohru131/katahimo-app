import type { CalendarSyncChange } from '../domain/attendance';
import {
  buildCalendarSyncPlan,
  buildColumnRowFromAppointments,
  fromColumnRow,
  toColumnRow,
} from '../domain/attendance';
import type { AttendanceDayRepositoryPort, StaffRepositoryPort } from '../ports/repositories';
import type { SchedulePort } from '../ports/schedule';
import type { AttendanceDeps } from './attendance';
import { saveAttendanceDay } from './attendance';

/**
 * Googleカレンダー(GAS版Web App経由)の予定を出勤簿(勤怠)へ反映する。
 *
 * 移植元: gas-childcare-visit-app/PastSchedule.js の
 * `previewCalendarSyncForStaffOnDate` / `applyCalendarSyncForStaffOnDate` /
 * `syncPastScheduleFromCalendar`(一括反映が1日ずつ呼ぶもの)。
 *
 * GAS版と同じく、手入力で足した予定を勝手に消さない非破壊マージ(buildCalendarSyncPlan)で
 * 反映する。反映内容の計算は書き込みと分離してあり、プレビュー(差分確認)は一切書き込まない。
 *
 * 「修正可能期限」の制限はGAS版と同じくこの機能には無い(カレンダー内容の反映はいつでも行える)。
 */
export interface CalendarSyncDeps extends AttendanceDeps {
  schedule: SchedulePort;
  staff: StaffRepositoryPort;
  attendanceDays: AttendanceDayRepositoryPort;
}

export interface CalendarSyncPreview {
  staffId: string;
  staffName: string;
  date: string;
  /** カレンダーから読めた予定の件数(事務作業扱いのものを含む)。 */
  appointmentCount: number;
  hasChanges: boolean;
  changes: CalendarSyncChange[];
}

export interface CalendarSyncApplyResult extends CalendarSyncPreview {
  changedCount: number;
}

async function resolveStaffName(deps: CalendarSyncDeps, tenantId: string, staffId: string): Promise<string> {
  const record = await deps.staff.findById(tenantId, staffId);
  if (!record) throw new Error('スタッフが見つかりません');
  return record.name;
}

/**
 * 指定スタッフ・指定日について、カレンダーの内容と出勤簿の現状の差分を計算する。
 * 書き込みは一切行わない(GAS版 computeCalendarSyncPlanForStaffOnDate_ と同じ分離)。
 */
async function computePlan(deps: CalendarSyncDeps, tenantId: string, staffId: string, date: string) {
  const staffName = await resolveStaffName(deps, tenantId, staffId);

  // forceRefresh=true。反映は「いま実際にカレンダーに入っている内容」を書き込む操作なので、
  // GAS側のルート計算キャッシュに残った古い予定で出勤簿を上書きしてしまわないようにする。
  const result = await deps.schedule.getScheduleWithRoute(staffName, date, true);
  if (!result.success) {
    throw new Error(result.message || 'カレンダー予定の取得に失敗しました。');
  }
  const appointments = result.appointments ?? [];

  const record = await deps.attendanceDays.findByStaffAndDate(tenantId, staffId, date);
  const current = toColumnRow(record?.rowData ?? {});
  const incoming = buildColumnRowFromAppointments(appointments);
  const plan = buildCalendarSyncPlan(current, incoming);

  return { staffName, appointmentCount: appointments.length, plan };
}

export async function previewCalendarSyncForDay(
  deps: CalendarSyncDeps,
  tenantId: string,
  staffId: string,
  date: string,
): Promise<CalendarSyncPreview> {
  const { staffName, appointmentCount, plan } = await computePlan(deps, tenantId, staffId, date);
  return {
    staffId,
    staffName,
    date,
    appointmentCount,
    hasChanges: plan.changes.length > 0,
    changes: plan.changes,
  };
}

/**
 * 差分確認のあと、実際に出勤簿へ書き込む。クライアントから送られた差分は信用せず、
 * 書き込み時にサーバー側で計算をやり直す(確認からこの呼び出しまでの間にカレンダー・
 * 出勤簿が変わっていれば、その最新の状態が反映される)。GAS版と同じ方針。
 */
export async function applyCalendarSyncForDay(
  deps: CalendarSyncDeps,
  tenantId: string,
  staffId: string,
  date: string,
): Promise<CalendarSyncApplyResult> {
  const { staffName, appointmentCount, plan } = await computePlan(deps, tenantId, staffId, date);

  // 変更が無い日は書き込まない。書き込むと updated_at が動いてミラージョブが1件積まれ、
  // 一括反映(日数×スタッフ数)のたびに中身の変わらない送信がGAS側へ流れてしまう。
  if (plan.changes.length > 0) {
    await saveAttendanceDay(deps, tenantId, staffId, date, fromColumnRow(plan.merged));
  }

  return {
    staffId,
    staffName,
    date,
    appointmentCount,
    hasChanges: plan.changes.length > 0,
    changes: plan.changes,
    changedCount: plan.changes.length,
  };
}
