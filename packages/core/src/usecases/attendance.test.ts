import { beforeEach, describe, expect, it } from 'vitest';
import type { AttendanceDeps } from './attendance';
import { getAttendanceDay, getAttendanceMonth, saveAttendanceDay } from './attendance';
import { FakeAttendanceDayRepository, FakeCryptoPort } from './testDoubles';

describe('getAttendanceDay / saveAttendanceDay / getAttendanceMonth', () => {
  let deps: AttendanceDeps;
  const tenantId = 'tenant-1';
  const staffId = 'staff-1';

  beforeEach(() => {
    deps = { attendanceDays: new FakeAttendanceDayRepository(), crypto: new FakeCryptoPort() };
  });

  it('データが無い日は空のrowDataとして扱い、派生値もすべて0/空になる', async () => {
    const result = await getAttendanceDay(deps, tenantId, staffId, '2026-08-01');
    expect(result.rowData).toEqual({});
    expect(result.derived.laborMinutes).toBe(0);
    expect(result.derived.visitCount).toBe(0);
  });

  it('保存した入力列が暗号化して保存され、取得時に復号・派生値計算まで一致する', async () => {
    const rowData = { D: '10:00', E: '12:00', AG: '5', AH: '3' };
    const saved = await saveAttendanceDay(deps, tenantId, staffId, '2026-08-01', rowData);
    expect(saved.derived.laborMinutes).toBe(120);
    expect(saved.derived.visitCount).toBe(3);

    const fetched = await getAttendanceDay(deps, tenantId, staffId, '2026-08-01');
    expect(fetched.rowData).toEqual(rowData);
    expect(fetched.derived).toEqual(saved.derived);
  });

  it('同じ日に再保存すると上書きされる(丸ごと置き換え)', async () => {
    await saveAttendanceDay(deps, tenantId, staffId, '2026-08-01', { D: '10:00', E: '11:00' });
    await saveAttendanceDay(deps, tenantId, staffId, '2026-08-01', { D: '10:00', E: '13:00' });

    const fetched = await getAttendanceDay(deps, tenantId, staffId, '2026-08-01');
    expect(fetched.rowData).toEqual({ D: '10:00', E: '13:00' });
  });

  it('月次集計は対象月の日だけを集め、GAS版と同じcomputeMonthlyTotalsで合算する', async () => {
    await saveAttendanceDay(deps, tenantId, staffId, '2026-08-01', { D: '10:00', E: '12:00' });
    await saveAttendanceDay(deps, tenantId, staffId, '2026-08-02', { D: '10:00', E: '11:00', AN: '1' });
    // 対象月の外(7月)は集計に含まれない
    await saveAttendanceDay(deps, tenantId, staffId, '2026-07-31', { D: '10:00', E: '18:00' });

    const month = await getAttendanceMonth(deps, tenantId, staffId, '2026-08');
    expect(month.days.map((d) => d.businessDate)).toEqual(['2026-08-01', '2026-08-02']);
    expect(month.totals.laborMinutes).toBe(180);
    expect(month.totals.shoppingErrandTotal).toBe(1);
  });

  it('他スタッフ・他テナントの勤怠は取得できない', async () => {
    await saveAttendanceDay(deps, tenantId, staffId, '2026-08-01', { D: '10:00', E: '12:00' });

    const otherStaff = await getAttendanceDay(deps, tenantId, 'staff-2', '2026-08-01');
    expect(otherStaff.rowData).toEqual({});

    const otherTenant = await getAttendanceDay(deps, 'tenant-2', staffId, '2026-08-01');
    expect(otherTenant.rowData).toEqual({});
  });
});
