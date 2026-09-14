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
  /**
   * カレンダー取得の最中に他のリクエストが割り込む状況を再現するためのフック。
   * 本番ではここがGASブリッジへのHTTP呼び出し(数秒)で、隙間が一番広くなる場所。
   */
  onFetch?: () => Promise<void>;

  async getSchedule() {
    return { success: true, appointments: [] };
  }

  async getScheduleWithRoute(
    staffName: string,
    dateString: string,
    forceRefresh: boolean,
  ): Promise<ScheduleWithRouteResult> {
    this.calls.push({ staffName, date: dateString, forceRefresh });
    await this.onFetch?.();
    return this.result;
  }
}

/**
 * 呼ばれたメソッドの順番を記録するだけの薄い被せ物。
 * 「マージのための読みが、書き込みと同じトランザクションの中でロック付きに行われるか」を
 * 実際の同時実行なしで確かめるために使う(フェイクは単一スレッドで動くので、
 * 本物の競合は再現できない)。
 */
class RecordingAttendanceDayRepository extends FakeAttendanceDayRepository {
  readonly callLog: string[] = [];

  override async findByStaffAndDate(tenantId: string, staffId: string, businessDate: string) {
    this.callLog.push('findByStaffAndDate');
    return super.findByStaffAndDate(tenantId, staffId, businessDate);
  }

  override async findByStaffAndDateForUpdate(tenantId: string, staffId: string, businessDate: string) {
    this.callLog.push('findByStaffAndDateForUpdate');
    return super.findByStaffAndDate(tenantId, staffId, businessDate);
  }

  override async upsert(
    ...args: Parameters<FakeAttendanceDayRepository['upsert']>
  ): ReturnType<FakeAttendanceDayRepository['upsert']> {
    this.callLog.push('upsert');
    return super.upsert(...args);
  }
}

describe('previewCalendarSyncForDay / applyCalendarSyncForDay', () => {
  const tenantId = 'tenant-1';
  let deps: CalendarSyncDeps;
  let schedule: StubSchedulePort;
  let attendanceDays: RecordingAttendanceDayRepository;
  let staffId: string;

  beforeEach(async () => {
    attendanceDays = new RecordingAttendanceDayRepository();
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

  it('マージ用の読みは、書き込みと同じトランザクションの中でロック付きに行う', async () => {
    // rowDataは丸ごと置き換えなので、読んでから書くまでの間に本人が同じ日を保存すると
    // その編集を踏み潰す。時間のかかるカレンダー取得はトランザクションの外に置き、
    // 読み直し(ロック付き)→ 突き合わせ → 書き込み を1つのトランザクションに入れている。
    schedule.result = {
      success: true,
      appointments: [appointment({ customerName: '訪問', startTime: '09:00', endTime: '10:00' })],
    };

    await applyCalendarSyncForDay(deps, tenantId, staffId, '2026-09-02');

    expect(attendanceDays.callLog).toEqual(['findByStaffAndDateForUpdate', 'upsert']);
    // ロックを取らない通常の読みでマージしていない(取ると素通りしてしまう)。
    expect(attendanceDays.callLog).not.toContain('findByStaffAndDate');
  });

  it('カレンダー取得中に入った他の編集を踏み潰さない', async () => {
    await saveAttendanceDay(deps, tenantId, staffId, '2026-09-02', {
      visits: [{ place: 'カレンダーの訪問', start: '09:00', end: '10:00' }],
    });
    schedule.result = {
      success: true,
      appointments: [appointment({ customerName: 'カレンダーの訪問', startTime: '09:00', endTime: '10:00' })],
    };
    // カレンダー取得(遅い外部呼び出し)の最中に、本人がスマホから同じ日に
    // 手入力の訪問#2を足した、という状況。本番で隙間が一番広いのがここ。
    schedule.onFetch = async () => {
      await saveAttendanceDay(deps, tenantId, staffId, '2026-09-02', {
        visits: [
          { place: 'カレンダーの訪問', start: '09:00', end: '10:00' },
          { place: 'あとから足した訪問', start: '15:00', end: '16:00' },
        ],
      });
    };

    await applyCalendarSyncForDay(deps, tenantId, staffId, '2026-09-02');

    const saved = await getAttendanceDay(deps, tenantId, staffId, '2026-09-02');
    expect(saved.rowData.visits?.[1]).toMatchObject({
      place: 'あとから足した訪問',
      start: '15:00',
      end: '16:00',
    });
  });

  it('出勤簿の枠に収まらない日は、一部だけ反映せず理由つきで失敗する', async () => {
    schedule.result = {
      success: true,
      appointments: ['A', 'B', 'C', 'D'].map((name, i) =>
        appointment({ customerName: name, startTime: `0${i + 8}:00`, endTime: `0${i + 8}:30` }),
      ),
    };

    await expect(applyCalendarSyncForDay(deps, tenantId, staffId, '2026-09-02')).rejects.toThrow(
      '出勤簿の枠に収まりません',
    );
    // 4件目を落とした3件だけが保存される、という中途半端な結果にならない。
    expect(await deps.attendanceDays.findByStaffAndDate(tenantId, staffId, '2026-09-02')).toBeNull();
    expect((deps.mirror as FakeOutboxRepository).listAllForTest()).toEqual([]);
  });

  it('存在しないスタッフでは失敗する', async () => {
    await expect(
      previewCalendarSyncForDay(deps, tenantId, 'staff-does-not-exist', '2026-09-02'),
    ).rejects.toThrow('スタッフが見つかりません');
  });
});
