import { describe, expect, it } from 'vitest';
import type { ScheduleAppointmentWithRoute } from '../../ports/schedule';
import {
  buildCalendarSyncPlan,
  buildColumnRowFromAppointments,
  isOfficeWorkAppointment,
} from './calendarSync';
import type { AttendanceColumnRow } from './types';

/** テストの見通しのため、必須項目だけ指定すれば作れるようにする。 */
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

describe('isOfficeWorkAppointment', () => {
  it('eventTypeがOFFICE WORKなら事務作業', () => {
    expect(isOfficeWorkAppointment(appointment({ eventType: 'OFFICE WORK' }))).toBe(true);
  });

  it('顧客予約でもちょうど15分なら事務作業として扱う(GAS版と同じ運用ルール)', () => {
    expect(isOfficeWorkAppointment(appointment({ startTime: '09:00', endTime: '09:15' }))).toBe(true);
  });

  it('顧客予約で15分でなければ訪問', () => {
    expect(isOfficeWorkAppointment(appointment({ startTime: '09:00', endTime: '09:16' }))).toBe(false);
  });

  it('日跨ぎ(23:50→00:05)も15分として判定できる', () => {
    expect(isOfficeWorkAppointment(appointment({ startTime: '23:50', endTime: '00:05' }))).toBe(true);
  });
});

describe('buildColumnRowFromAppointments', () => {
  it('訪問3件・事務作業2件をGAS版と同じ列へ割り当てる', () => {
    const row = buildColumnRowFromAppointments([
      appointment({
        customerName: '本田町　名和 明音',
        startTime: '09:00',
        endTime: '11:00',
        attendanceKm: 8.2,
      }),
      appointment({
        customerName: '岩切　石垣 真奈',
        startTime: '12:00',
        endTime: '14:00',
        moveMin: 24,
        moveKm: 15.88,
      }),
      appointment({
        customerName: '寺岡　森岡 咲夏',
        startTime: '15:00',
        endTime: '17:00',
        moveMin: 18,
        moveKm: 9.4,
        leavingKm: 12.1,
      }),
      appointment({ eventType: 'OFFICE WORK', customerName: '月例会', startTime: '18:00', endTime: '19:00' }),
      appointment({ eventType: 'OFFICE WORK', customerName: '検体', startTime: '19:00', endTime: '19:30' }),
    ]);

    expect(row).toMatchObject({
      C: '本田町　名和 明音',
      D: '09:00',
      E: '11:00',
      L: '岩切　石垣 真奈',
      M: '12:00',
      N: '14:00',
      H: '24',
      AG: '15.88',
      U: '寺岡　森岡 咲夏',
      V: '15:00',
      W: '17:00',
      Q: '18',
      AH: '9.4',
      AI: '8.2',
      AJ: '12.1',
      X: '月例会',
      Y: '18:00',
      Z: '19:00',
      AA: '検体',
      AB: '19:00',
      AC: '19:30',
    });
  });

  it('0km/0分は未入力にせず0として書き出す(GAS版emptyOrValue_)', () => {
    const row = buildColumnRowFromAppointments([
      appointment({ customerName: 'A', startTime: '09:00', endTime: '10:00' }),
      appointment({ customerName: 'B', startTime: '10:00', endTime: '11:00', moveMin: 0, moveKm: 0 }),
    ]);
    expect(row.H).toBe('0');
    expect(row.AG).toBe('0');
  });

  it('出勤/退勤距離は「値を持っている訪問」から拾う(先頭に位置情報が無くても落とさない)', () => {
    const row = buildColumnRowFromAppointments([
      // 1件目はオンライン相談等で位置情報が無く、出勤/退勤距離を持たない。
      appointment({ customerName: 'オンライン', startTime: '09:00', endTime: '10:00' }),
      appointment({
        customerName: '訪問',
        startTime: '11:00',
        endTime: '12:00',
        attendanceKm: 5.5,
        leavingKm: 6.5,
      }),
    ]);
    expect(row.AI).toBe('5.5');
    expect(row.AJ).toBe('6.5');
  });

  it('予定が無い日はすべて空文字になる', () => {
    expect(buildColumnRowFromAppointments([])).toMatchObject({ C: '', D: '', E: '', AI: '', AJ: '' });
  });
});

describe('buildCalendarSyncPlan', () => {
  it('カレンダー側に予定があるスロットは上書きし、差分を列単位で返す', () => {
    const current: AttendanceColumnRow = { C: '旧訪問先', D: '09:00', E: '10:00' };
    const incoming = buildColumnRowFromAppointments([
      appointment({ customerName: '新訪問先', startTime: '09:30', endTime: '11:00' }),
    ]);

    const plan = buildCalendarSyncPlan(current, incoming);

    expect(plan.merged.C).toBe('新訪問先');
    expect(plan.merged.D).toBe('09:30');
    expect(plan.merged.E).toBe('11:00');
    expect(plan.changes).toEqual([
      { column: 'C', label: '#1訪問先等', oldValue: '旧訪問先', newValue: '新訪問先' },
      { column: 'D', label: '#1始業時刻', oldValue: '09:00', newValue: '09:30' },
      { column: 'E', label: '#1終業時刻', oldValue: '10:00', newValue: '11:00' },
    ]);
  });

  it('カレンダーに無い手入力の予定は、時間帯が重ならない限り消さない', () => {
    // 出勤簿にだけある訪問#2(15:00-16:00)は、カレンダー由来の訪問#1(09:00-10:00)と
    // 重ならないので触らない。
    const current: AttendanceColumnRow = {
      C: 'カレンダーの訪問',
      D: '09:00',
      E: '10:00',
      L: '手入力の訪問',
      M: '15:00',
      N: '16:00',
    };
    const incoming = buildColumnRowFromAppointments([
      appointment({ customerName: 'カレンダーの訪問', startTime: '09:00', endTime: '10:00' }),
    ]);

    const plan = buildCalendarSyncPlan(current, incoming);

    expect(plan.merged.L).toBe('手入力の訪問');
    expect(plan.merged.M).toBe('15:00');
    expect(plan.merged.N).toBe('16:00');
    expect(plan.changes.map((c) => c.column)).not.toContain('L');
  });

  it('カレンダー由来の予定と時間帯が重なる出勤簿側の予定はクリアする', () => {
    // 出勤簿の訪問#2(09:30-10:30)はカレンダー由来の訪問#1(09:00-10:00)と重なる。
    // カレンダー側で表現し直された=消えたものとみなす。
    const current: AttendanceColumnRow = {
      C: 'カレンダーの訪問',
      D: '09:00',
      E: '10:00',
      L: '重なる予定',
      M: '09:30',
      N: '10:30',
    };
    const incoming = buildColumnRowFromAppointments([
      appointment({ customerName: 'カレンダーの訪問', startTime: '09:00', endTime: '10:00' }),
    ]);

    const plan = buildCalendarSyncPlan(current, incoming);

    expect(plan.merged.L).toBe('');
    expect(plan.merged.M).toBe('');
    expect(plan.merged.N).toBe('');
    expect(plan.changes.map((c) => c.column)).toEqual(expect.arrayContaining(['L', 'M', 'N']));
  });

  it('退勤距離は訪問が1件だけの日にも反映される', () => {
    const incoming = buildColumnRowFromAppointments([
      appointment({
        customerName: '訪問',
        startTime: '09:00',
        endTime: '10:00',
        attendanceKm: 3,
        leavingKm: 4,
      }),
    ]);

    const plan = buildCalendarSyncPlan({}, incoming);

    expect(plan.merged.AI).toBe('3');
    expect(plan.merged.AJ).toBe('4');
  });

  it('カレンダーに訪問が1件も無い日は退勤距離に触らない', () => {
    const current: AttendanceColumnRow = { AJ: '9.9' };
    const plan = buildCalendarSyncPlan(current, buildColumnRowFromAppointments([]));

    expect(plan.merged.AJ).toBe('9.9');
    expect(plan.changes).toEqual([]);
  });

  it('カレンダー反映が扱わない列(天候・買物代行・備考)はそのまま残る', () => {
    const current: AttendanceColumnRow = { I: '雪', AN: '2', AO: 'メモ' };
    const incoming = buildColumnRowFromAppointments([
      appointment({ customerName: '訪問', startTime: '09:00', endTime: '10:00' }),
    ]);

    const plan = buildCalendarSyncPlan(current, incoming);

    expect(plan.merged.I).toBe('雪');
    expect(plan.merged.AN).toBe('2');
    expect(plan.merged.AO).toBe('メモ');
    expect(plan.changes.map((c) => c.column)).not.toContain('I');
  });

  it('内容が一致していれば差分は0件になる(空振りの書き込みを起こさない)', () => {
    const incoming = buildColumnRowFromAppointments([
      appointment({ customerName: '訪問', startTime: '09:00', endTime: '10:00' }),
    ]);
    const plan = buildCalendarSyncPlan(incoming, incoming);

    expect(plan.changes).toEqual([]);
  });
});
