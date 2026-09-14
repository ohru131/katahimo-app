import { attendanceRowDataSchema } from '@katahimo/shared';
import type { AttendanceColumnRow, CalendarSyncChange } from '../domain/attendance';
import {
  buildCalendarSyncPlan,
  buildColumnRowFromAppointments,
  fromColumnRow,
  toColumnRow,
} from '../domain/attendance';
import type { AttendanceDayRepositoryPort, StaffRepositoryPort } from '../ports/repositories';
import type { SchedulePort } from '../ports/schedule';
import type { AttendanceDeps } from './attendance';
import { writeAttendanceDayInScope } from './attendance';

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
 * カレンダーから、その日の予定を列記号形式に組み立てる。DBには一切触らない。
 *
 * forceRefresh=true。反映は「いま実際にカレンダーに入っている内容」を書き込む操作なので、
 * GAS側のルート計算キャッシュに残った古い予定で出勤簿を上書きしてしまわないようにする。
 *
 * 予定が出勤簿の枠(訪問3件・事務作業2件)に収まらない日は
 * buildColumnRowFromAppointments が例外を投げる。一部だけ反映して残りを黙って捨てないため。
 */
async function fetchIncomingFromCalendar(
  deps: CalendarSyncDeps,
  staffName: string,
  date: string,
): Promise<{ incoming: AttendanceColumnRow; appointmentCount: number }> {
  const result = await deps.schedule.getScheduleWithRoute(staffName, date, true);
  if (!result.success) {
    throw new Error(result.message || 'カレンダー予定の取得に失敗しました。');
  }
  const appointments = result.appointments ?? [];
  return {
    incoming: buildColumnRowFromAppointments(appointments),
    appointmentCount: appointments.length,
  };
}

/**
 * 指定スタッフ・指定日について、カレンダーの内容と出勤簿の現状の差分を計算する。
 * 書き込みは一切行わない(GAS版 computeCalendarSyncPlanForStaffOnDate_ と同じ分離)。
 */
export async function previewCalendarSyncForDay(
  deps: CalendarSyncDeps,
  tenantId: string,
  staffId: string,
  date: string,
): Promise<CalendarSyncPreview> {
  const staffName = await resolveStaffName(deps, tenantId, staffId);
  const { incoming, appointmentCount } = await fetchIncomingFromCalendar(deps, staffName, date);

  const record = await deps.attendanceDays.findByStaffAndDate(tenantId, staffId, date);
  const plan = buildCalendarSyncPlan(toColumnRow(record?.rowData ?? {}), incoming);

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
 * 書き込み時にサーバー側で突き合わせをやり直す(確認からこの呼び出しまでの間にカレンダー・
 * 出勤簿が変わっていれば、その最新の状態が反映される)。GAS版と同じ方針。
 *
 * 出勤簿の読み直しと突き合わせは、書き込みと同じトランザクションの中で行ベースの
 * ロックを取ってから行う。rowDataは「丸ごと置き換え」なので、読みと書きの間に本人が
 * スマホから同じ日を保存すると、その編集を古い内容で踏み潰してしまうため
 * (カレンダー取得は数秒かかる外部呼び出しで、その分だけ隙間が広い)。時間のかかる
 * カレンダー取得はトランザクションの外で先に済ませ、トランザクションの中には
 * DB操作と純粋計算だけを置く。
 */
export async function applyCalendarSyncForDay(
  deps: CalendarSyncDeps,
  tenantId: string,
  staffId: string,
  date: string,
): Promise<CalendarSyncApplyResult> {
  const staffName = await resolveStaffName(deps, tenantId, staffId);
  const { incoming, appointmentCount } = await fetchIncomingFromCalendar(deps, staffName, date);

  const changes = await deps.unitOfWork.run(tenantId, async (scope) => {
    const record = await deps.attendanceDays.findByStaffAndDateForUpdate(tenantId, staffId, date, scope);
    const plan = buildCalendarSyncPlan(toColumnRow(record?.rowData ?? {}), incoming);

    // 変更が無い日は書き込まない。書き込むと updated_at が動いてミラージョブが1件積まれ、
    // 一括反映(日数×スタッフ数)のたびに中身の変わらない送信がGAS側へ流れてしまう。
    if (plan.changes.length > 0) {
      // 検証はトランザクションの中だが、失敗すればロールバックされるので中途半端な
      // 書き込みは残らない(saveAttendanceDayが検証を外に出しているのは、あちらが
      // 「検証してから開く」順にできるため。こちらは読み直してからでないと
      // 書く内容が決まらない)。
      const validated = attendanceRowDataSchema.parse(fromColumnRow(plan.merged));
      await writeAttendanceDayInScope(deps, tenantId, staffId, date, validated, scope);
    }
    return plan.changes;
  });

  return {
    staffId,
    staffName,
    date,
    appointmentCount,
    hasChanges: changes.length > 0,
    changes,
    changedCount: changes.length,
  };
}
