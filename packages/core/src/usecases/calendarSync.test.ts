import { beforeEach, describe, expect, it } from 'vitest';
import type { ScheduleAppointmentWithRoute, SchedulePort, ScheduleWithRouteResult } from '../ports/schedule';
import { getAttendanceDay, saveAttendanceDay } from './attendance';
import type { CalendarSyncDeps } from './calendarSync';
import { applyCalendarSyncForDay, previewCalendarSyncForDay } from './calendarSync';
import {
  FakeAttendanceDayRepository,
  FakeOutboxRepository,
  FakeReceiptRepository,
  FakeStaffRepository,
  FakeUnitOfWork,
} from './testDoubles';

function appointment(patch: Partial<ScheduleAppointmentWithRoute>): ScheduleAppointmentWithRoute {
  return {
    eventType: 'CUSTOMER APPOINTMENT',
    customerName: '',
    startTime: '',
    endTime: '',
    reservaUrl: '',
    moveUrl: '',
    moveMin: '',
    moveKm: '',
    attendanceUrl: '',
    attendanceMin: '',
    attendanceKm: '',
    leavingUrl: '',
    leavingMin: '',
    leavingKm: '',
    customerId: '',
    address: '',
    ...patch,
  };
}

/** 指定した予定をそのまま返すSchedulePort。呼ばれた引数も記録する。 */
class StubSchedulePort implements SchedulePort {
  readonly calls: { staffName: string; date: string; forceRefresh: boolean }[] = [];
  result: ScheduleWithRouteResult = { success: true, appointments: [] };

  async getSchedule() {
    return { success: true, appointments: [] };
  }

  async getScheduleWithRoute(
    staffName: string,
    dateString: string,
    forceRefresh: boolean,
  ): Promise<ScheduleWithRouteResult> {
    this.calls.push({ staffName, date: dateString, forceRefresh });
    return this.result;
  }
}

describe('previewCalendarSyncForDay / applyCalendarSyncForDay', () => {
  const tenantId = 'tenant-1';
  let deps: CalendarSyncDeps;
  let schedule: StubSchedulePort;
  let staffId: string;

  beforeEach(async () => {
    const attendanceDays = new FakeAttendanceDayRepository();
    const mirror = new FakeOutboxRepository();
    const staff = new FakeStaffRepository();
    schedule = new StubSchedulePort();

    const created = await staff.create({
      tenantId,
      name: '蒔田 歩未',
      email: 'maita@example.com',
      isAdmin: false,
    });
    staffId = created.id;

    deps = {
      attendanceDays,
      mirror,
      mirrorAttendanceAggregate: false,
      unitOfWork: new FakeUnitOfWork([attendanceDays, mirror]),
      staff,
      receipts: new FakeReceiptRepository(),
      schedule,
    };
  });

  it('プレビューは差分を返すだけで、出勤簿には一切書き込まない', async () => {
    schedule.result = {
      success: true,
      appointments: [
        appointment({ customerName: '本田町　名和 明音', startTime: '09:00', endTime: '11:00' }),
      ],
    };

    const preview = await previewCalendarSyncForDay(deps, tenantId, staffId, '2026-09-02');

    expect(preview.staffName).toBe('蒔田 歩未');
    expect(preview.appointmentCount).toBe(1);
    expect(preview.hasChanges).toBe(true);
    expect(preview.changes.map((c) => c.column)).toEqual(['C', 'D', 'E']);
    expect(await deps.attendanceDays.findByStaffAndDate(tenantId, staffId, '2026-09-02')).toBeNull();
  });

  it('反映するとカレンダーの内容が出勤簿へ保存される', async () => {
    schedule.result = {
      success: true,
      appointments: [
        appointment({
          customerName: '本田町　名和 明音',
          startTime: '09:00',
          endTime: '11:00',
          attendanceKm: 8.2,
          leavingKm: 7.66,
        }),
      ],
    };

    const result = await applyCalendarSyncForDay(deps, tenantId, staffId, '2026-09-02');

    expect(result.changedCount).toBe(5); // C/D/E/AI/AJ
    const saved = await getAttendanceDay(deps, tenantId, staffId, '2026-09-02');
    expect(saved.rowData).toEqual({
      visits: [{ place: '本田町　名和 明音', start: '09:00', end: '11:00' }],
      commuteDistanceKm: 8.2,
      returnDistanceKm: 7.66,
    });
    // 09:00-11:00 のうち所定内(10:00-17:00)は60分、残り60分は所定外。
    expect(saved.derived.laborMinutes).toBe(60);
    expect(saved.derived.overtimeMinutes).toBe(60);
  });

  it('カレンダーに無い手入力の予定は反映後も残る(非破壊マージ)', async () => {
    await saveAttendanceDay(deps, tenantId, staffId, '2026-09-02', {
      visits: [{}, { place: '手入力の訪問', start: '15:00', end: '16:00' }],
      note: '手書きのメモ',
    });
    schedule.result = {
      success: true,
      appointments: [appointment({ customerName: 'カレンダーの訪問', startTime: '09:00', endTime: '10:00' })],
    };

    await applyCalendarSyncForDay(deps, tenantId, staffId, '2026-09-02');

    const saved = await getAttendanceDay(deps, tenantId, staffId, '2026-09-02');
    expect(saved.rowData.visits?.[0]).toMatchObject({
      place: 'カレンダーの訪問',
      start: '09:00',
      end: '10:00',
    });
    expect(saved.rowData.visits?.[1]).toMatchObject({ place: '手入力の訪問', start: '15:00', end: '16:00' });
    expect(saved.rowData.note).toBe('手書きのメモ');
  });

  it('差分が無い日は書き込まない(空振りのミラージョブを積まない)', async () => {
    schedule.result = {
      success: true,
      appointments: [appointment({ customerName: '訪問', startTime: '09:00', endTime: '10:00' })],
    };
    await applyCalendarSyncForDay(deps, tenantId, staffId, '2026-09-02');
    const jobsAfterFirst = (deps.mirror as FakeOutboxRepository).listAllForTest().length;

    const second = await applyCalendarSyncForDay(deps, tenantId, staffId, '2026-09-02');

    expect(second.changedCount).toBe(0);
    expect((deps.mirror as FakeOutboxRepository).listAllForTest()).toHaveLength(jobsAfterFirst);
  });

  it('カレンダーの取得に失敗したら例外にする(黙って空の予定で上書きしない)', async () => {
    await saveAttendanceDay(deps, tenantId, staffId, '2026-09-02', {
      visits: [{ place: '既存の訪問', start: '09:00', end: '10:00' }],
    });
    schedule.result = { success: false, message: 'カレンダーに接続できません' };

    await expect(applyCalendarSyncForDay(deps, tenantId, staffId, '2026-09-02')).rejects.toThrow(
      'カレンダーに接続できません',
    );
    const saved = await getAttendanceDay(deps, tenantId, staffId, '2026-09-02');
    expect(saved.rowData.visits?.[0]?.place).toBe('既存の訪問');
  });

  it('カレンダーは常に最新を取りに行く(キャッシュ済みの古い予定で上書きしない)', async () => {
    schedule.result = { success: true, appointments: [] };
    await previewCalendarSyncForDay(deps, tenantId, staffId, '2026-09-02');

    expect(schedule.calls).toEqual([{ staffName: '蒔田 歩未', date: '2026-09-02', forceRefresh: true }]);
  });

  it('存在しないスタッフでは失敗する', async () => {
    await expect(
      previewCalendarSyncForDay(deps, tenantId, 'staff-does-not-exist', '2026-09-02'),
    ).rejects.toThrow('スタッフが見つかりません');
  });
});
