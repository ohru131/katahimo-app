import { beforeEach, describe, expect, it } from 'vitest';
import type { AttendanceDeps } from './attendance';
import {
  getAttendanceDay,
  getAttendanceMonth,
  getAttendanceScheduleEvents,
  saveAttendanceDay,
} from './attendance';
import {
  FakeAttendanceDayRepository,
  FakeOutboxRepository,
  FakeReceiptRepository,
  FakeStaffRepository,
  FakeUnitOfWork,
} from './testDoubles';

describe('getAttendanceDay / saveAttendanceDay / getAttendanceMonth', () => {
  let deps: AttendanceDeps;
  const tenantId = 'tenant-1';
  const staffId = 'staff-1';

  beforeEach(() => {
    const attendanceDays = new FakeAttendanceDayRepository();
    const mirror = new FakeOutboxRepository();
    deps = {
      attendanceDays,
      mirror,
      mirrorAttendanceAggregate: false,
      unitOfWork: new FakeUnitOfWork([attendanceDays, mirror]),
      staff: new FakeStaffRepository(),
      receipts: new FakeReceiptRepository(),
    };
  });

  it('データが無い日は空のrowDataとして扱い、派生値もすべて0/空になる', async () => {
    const result = await getAttendanceDay(deps, tenantId, staffId, '2026-08-01');
    expect(result.rowData).toEqual({});
    expect(result.derived.laborMinutes).toBe(0);
    expect(result.derived.visitCount).toBe(0);
  });

  it('保存した入力列がそのまま保存され、取得時に派生値計算まで一致する', async () => {
    // 列記号でいう { D: '10:00', E: '12:00', AG: '5', AH: '3' } 相当
    // (visits[0]の後の移動距離AG=5、visits[1]の後の移動距離AH=3。AHが数値なので訪問回数は3)。
    const rowData = { visits: [{ start: '10:00', end: '12:00', distanceKm: 5 }, { distanceKm: 3 }] };
    const saved = await saveAttendanceDay(deps, tenantId, staffId, '2026-08-01', rowData);
    expect(saved.derived.laborMinutes).toBe(120);
    expect(saved.derived.visitCount).toBe(3);

    const fetched = await getAttendanceDay(deps, tenantId, staffId, '2026-08-01');
    expect(fetched.rowData).toEqual(rowData);
    expect(fetched.derived).toEqual(saved.derived);
  });

  it('同じ日に再保存すると上書きされる(丸ごと置き換え)', async () => {
    await saveAttendanceDay(deps, tenantId, staffId, '2026-08-01', {
      visits: [{ start: '10:00', end: '11:00' }],
    });
    await saveAttendanceDay(deps, tenantId, staffId, '2026-08-01', {
      visits: [{ start: '10:00', end: '13:00' }],
    });

    const fetched = await getAttendanceDay(deps, tenantId, staffId, '2026-08-01');
    expect(fetched.rowData).toEqual({ visits: [{ start: '10:00', end: '13:00' }] });
  });

  it('不正な形のrowData(HH:mm形式でない時刻等)は保存前に拒否される', async () => {
    await expect(
      saveAttendanceDay(deps, tenantId, staffId, '2026-08-01', {
        visits: [{ start: '10時' }],
      }),
    ).rejects.toThrow();
  });

  it('負の距離は保存前に拒否される(値域を見ていなかった旧実装からの改善)', async () => {
    await expect(
      saveAttendanceDay(deps, tenantId, staffId, '2026-08-01', { commuteDistanceKm: -1 }),
    ).rejects.toThrow();
  });

  it('訪問4件目以降(MAX_VISITS超過)はtoColumnRowが例外を投げ、トランザクションの前に失敗するので何も残らない', async () => {
    // attendanceRowDataSchema自体は件数の上限を持たない(API層で先に弾く設計)ため、
    // ここではschema.parse()は通り、toColumnRow()の上限チェックまで到達する。
    // トランザクションの外・書き込みより前で失敗すれば、勤怠行もoutboxのジョブも残らないはず。
    await expect(
      saveAttendanceDay(deps, tenantId, staffId, '2026-08-01', {
        visits: [{ place: '1' }, { place: '2' }, { place: '3' }, { place: '4' }],
      }),
    ).rejects.toThrow('訪問は3件までです');

    expect(await deps.attendanceDays.findByStaffAndDate(tenantId, staffId, '2026-08-01')).toBeNull();
    expect((deps.mirror as FakeOutboxRepository).listAllForTest()).toEqual([]);
  });

  it('月次集計は対象月の日だけを集め、GAS版と同じcomputeMonthlyTotalsで合算する', async () => {
    await saveAttendanceDay(deps, tenantId, staffId, '2026-08-01', {
      visits: [{ start: '10:00', end: '12:00' }],
    });
    await saveAttendanceDay(deps, tenantId, staffId, '2026-08-02', {
      visits: [{ start: '10:00', end: '11:00' }],
      shoppingErrandCount: 1,
    });
    // 対象月の外(7月)は集計に含まれない
    await saveAttendanceDay(deps, tenantId, staffId, '2026-07-31', {
      visits: [{ start: '10:00', end: '18:00' }],
    });

    const month = await getAttendanceMonth(deps, tenantId, staffId, '2026-08');
    expect(month.totals.laborMinutes).toBe(180);
    expect(month.totals.shoppingErrandTotal).toBe(1);
    expect(month.days.filter((d) => d.derived.laborMinutes > 0).map((d) => d.businessDate)).toEqual([
      '2026-08-01',
      '2026-08-02',
    ]);
  });

  it('月次集計は記録の無い日も含めて月の全日を並べる(GAS版と同じ日付一覧の情報量)', async () => {
    await saveAttendanceDay(deps, tenantId, staffId, '2026-09-02', {
      visits: [{ start: '10:00', end: '14:00' }],
    });

    const month = await getAttendanceMonth(deps, tenantId, staffId, '2026-09');

    expect(month.days).toHaveLength(30); // 9月は30日
    expect(month.days[0]?.businessDate).toBe('2026-09-01');
    expect(month.days[29]?.businessDate).toBe('2026-09-30');
    // 記録が無い日は空のrowDataと0の派生値で並ぶ(画面が月の日数を組み立て直さなくて済む)。
    expect(month.days[0]?.rowData).toEqual({});
    expect(month.days[0]?.derived.laborMinutes).toBe(0);
    expect(month.days[1]?.derived.laborMinutes).toBe(240);
  });

  it('2月の日数は閏年かどうかで変わる', async () => {
    expect((await getAttendanceMonth(deps, tenantId, staffId, '2027-02')).days).toHaveLength(28);
    expect((await getAttendanceMonth(deps, tenantId, staffId, '2028-02')).days).toHaveLength(29);
  });

  it('他スタッフ・他テナントの勤怠は取得できない', async () => {
    await saveAttendanceDay(deps, tenantId, staffId, '2026-08-01', {
      visits: [{ start: '10:00', end: '12:00' }],
    });

    const otherStaff = await getAttendanceDay(deps, tenantId, 'staff-2', '2026-08-01');
    expect(otherStaff.rowData).toEqual({});

    const otherTenant = await getAttendanceDay(deps, 'tenant-2', staffId, '2026-08-01');
    expect(otherTenant.rowData).toEqual({});
  });

  it('getAttendanceScheduleEventsは期間内の各日をイベント化して返す(GAS版の週間予定と同じ考え方)', async () => {
    await saveAttendanceDay(deps, tenantId, staffId, '2026-08-10', {
      visits: [{ place: '佐藤様', start: '09:00', end: '10:00' }],
    });
    await saveAttendanceDay(deps, tenantId, staffId, '2026-08-11', {
      officeWork: [{ name: 'MTG', start: '14:00', end: '15:00' }],
    });
    // 期間外
    await saveAttendanceDay(deps, tenantId, staffId, '2026-08-20', {
      visits: [{ start: '10:00', end: '11:00' }],
    });

    const events = await getAttendanceScheduleEvents(deps, tenantId, staffId, '2026-08-10', '2026-08-11');
    expect(events).toEqual([
      {
        date: '2026-08-10',
        slot: { kind: 'visit', index: 0 },
        title: '佐藤様',
        eventType: 'CUSTOMER APPOINTMENT',
        start: '09:00',
        end: '10:00',
      },
      {
        date: '2026-08-11',
        slot: { kind: 'office', index: 0 },
        title: 'MTG',
        eventType: 'OFFICE WORK',
        start: '14:00',
        end: '15:00',
      },
    ]);
  });
});

describe('getAttendanceMonth の領収書集計(GAS版 getReceiptsForMonth_ 相当)', () => {
  const tenantId = 'tenant-1';
  let deps: AttendanceDeps;
  let receipts: FakeReceiptRepository;
  let staffId: string;

  /** 指定日時(JST)・金額の領収書を1件作る。cancel=trueなら取り消し済みにする。 */
  async function addReceipt(
    jstTimestamp: string,
    amountYen: number | null,
    options: { cancelled?: boolean; staffId?: string } = {},
  ) {
    const record = await receipts.create({
      tenantId,
      staffId: options.staffId ?? staffId,
      customerId: null,
      receiptTimestamp: new Date(jstTimestamp),
      dedupeKey: null,
      amountYen,
      amountRaw: amountYen === null ? '読めない' : String(amountYen),
      storeName: '店',
      handoffText: null,
      fileKey: `${tenantId}/receipts/${jstTimestamp}.jpg`,
      contentType: 'image/jpeg',
      billingType: 'company_expense',
      cancellableUntil: '2099-12-31',
    });
    if (options.cancelled) {
      await receipts.cancel(tenantId, record.id, { cancelledByStaffId: staffId, reason: null });
    }
    return record;
  }

  beforeEach(async () => {
    const attendanceDays = new FakeAttendanceDayRepository();
    const mirror = new FakeOutboxRepository();
    const staff = new FakeStaffRepository();
    receipts = new FakeReceiptRepository();
    staffId = (
      await staff.create({ tenantId, name: '蒔田 歩未', email: 'maita@example.com', isAdmin: false })
    ).id;
    deps = {
      attendanceDays,
      mirror,
      mirrorAttendanceAggregate: false,
      unitOfWork: new FakeUnitOfWork([attendanceDays, mirror]),
      staff,
      receipts,
    };
  });

  it('対象月の領収書を日別に合算し、月合計も返す', async () => {
    await addReceipt('2026-09-09T10:00:00+09:00', 1000);
    await addReceipt('2026-09-09T18:00:00+09:00', 500);
    await addReceipt('2026-09-02T10:00:00+09:00', 300);

    const month = await getAttendanceMonth(deps, tenantId, staffId, '2026-09');

    expect(month.receipts.byDay).toEqual([
      { date: '2026-09-02', amountYen: 300 },
      { date: '2026-09-09', amountYen: 1500 },
    ]);
    expect(month.receipts.totalYen).toBe(1800);
  });

  it('月の境界はJSTで切る(月末23:00 JSTは当月、月初00:00 JSTは翌月)', async () => {
    await addReceipt('2026-09-30T23:00:00+09:00', 100);
    await addReceipt('2026-10-01T00:30:00+09:00', 999);

    const month = await getAttendanceMonth(deps, tenantId, staffId, '2026-09');

    expect(month.receipts.byDay).toEqual([{ date: '2026-09-30', amountYen: 100 }]);
    expect(month.receipts.totalYen).toBe(100);
  });

  it('取り消し済みと金額を読めなかった分は合計に入れず、件数だけ返す', async () => {
    await addReceipt('2026-09-05T10:00:00+09:00', 1000);
    await addReceipt('2026-09-06T10:00:00+09:00', 700, { cancelled: true });
    await addReceipt('2026-09-07T10:00:00+09:00', null);

    const month = await getAttendanceMonth(deps, tenantId, staffId, '2026-09');

    expect(month.receipts.totalYen).toBe(1000);
    expect(month.receipts.byDay).toEqual([{ date: '2026-09-05', amountYen: 1000 }]);
    expect(month.receipts.cancelledCount).toBe(1);
    expect(month.receipts.unreadableAmountCount).toBe(1);
  });

  it('他スタッフの領収書は混ざらない', async () => {
    await addReceipt('2026-09-05T10:00:00+09:00', 1000, { staffId: 'staff-other' });

    const month = await getAttendanceMonth(deps, tenantId, staffId, '2026-09');

    expect(month.receipts.byDay).toEqual([]);
    expect(month.receipts.totalYen).toBe(0);
  });

  it('対象スタッフの氏名を見出し用に返す', async () => {
    const month = await getAttendanceMonth(deps, tenantId, staffId, '2026-09');
    expect(month.staffName).toBe('蒔田 歩未');
  });
});
