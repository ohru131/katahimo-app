import { describe, expect, it } from 'vitest';
import { buildScheduleEventsFromRowData } from './scheduleEvents';

/**
 * 期待値はGAS版 gas-childcare-visit-app/PastSchedule.js の
 * buildScheduleEventsFromRowData_ をNode上でそのまま実行した結果と一致することを確認済み
 * (rowData自体は doc/14 B項の段階1で新形式=意味のあるキーに変わっているが、
 * 「始業・終業が両方揃った枠だけをイベント化する」という判定ロジックは変えていない)。
 */
describe('buildScheduleEventsFromRowData', () => {
  it('始業・終業が両方入力されているスロットだけイベント化する(GAS版と同じ結果)', () => {
    const events = buildScheduleEventsFromRowData('2026-08-15', {
      visits: [
        { place: '佐藤様', start: '09:00', end: '10:00' },
        { place: '鈴木様', start: '10:45', end: '12:00' },
      ],
      officeWork: [
        { name: 'MTG', start: '14:00', end: '15:00' },
        { name: '', start: '', end: '' },
      ],
    });

    expect(events).toEqual([
      {
        date: '2026-08-15',
        slot: { kind: 'visit', index: 0 },
        title: '佐藤様',
        eventType: 'CUSTOMER APPOINTMENT',
        start: '09:00',
        end: '10:00',
      },
      {
        date: '2026-08-15',
        slot: { kind: 'visit', index: 1 },
        title: '鈴木様',
        eventType: 'CUSTOMER APPOINTMENT',
        start: '10:45',
        end: '12:00',
      },
      {
        date: '2026-08-15',
        slot: { kind: 'office', index: 0 },
        title: 'MTG',
        eventType: 'OFFICE WORK',
        start: '14:00',
        end: '15:00',
      },
    ]);
  });

  it('入力が無ければ空配列を返す', () => {
    expect(buildScheduleEventsFromRowData('2026-08-15', {})).toEqual([]);
  });

  it('始業・終業のどちらかしか無いスロットはイベント化しない', () => {
    const events = buildScheduleEventsFromRowData('2026-08-15', {
      visits: [{ place: '佐藤様', start: '09:00' }],
    });
    expect(events).toEqual([]);
  });

  it('4件目以降の訪問(配列の上限が外れたことの確認)もindexがずれずイベント化する', () => {
    // 段階1の変更点そのもの: 列記号(C/D/E…)の頃は訪問3件が上限だったが、配列になったことで
    // rowDataの形としては4件目・5件目も表現できる(勤怠計算attendanceCalc.tsは引き続き3件までしか
    // 計算しないが、週間予定表示は計算を経由しないのでそのまま出せる)。
    const events = buildScheduleEventsFromRowData('2026-08-15', {
      visits: [
        { place: 'A', start: '09:00', end: '10:00' },
        { place: 'B', start: '10:30', end: '11:00' },
        { place: 'C', start: '11:30', end: '12:00' },
        { place: 'D', start: '13:00', end: '14:00' },
      ],
    });
    expect(events.map((e) => e.slot)).toEqual([
      { kind: 'visit', index: 0 },
      { kind: 'visit', index: 1 },
      { kind: 'visit', index: 2 },
      { kind: 'visit', index: 3 },
    ]);
  });
});
