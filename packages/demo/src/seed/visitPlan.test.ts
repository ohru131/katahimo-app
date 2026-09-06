import { describe, expect, it } from 'vitest';
import { planVisitsForDate, recentBusinessDates, toJstDateIso, VISIT_SLOTS } from './visitPlan';

const FIGURE_COUNT = 20;
const STAFF = '山田 花子';

/**
 * 訪問予定は「日付から決まる純関数」であることが前提の設計になっている。
 * ここが崩れると、シードで作った過去の訪問履歴と、予定タブが出す今日/明日の予定が
 * 食い違う(同じ日なのに履歴と予定で訪問先が違う、という状態になる)。
 */
describe('planVisitsForDate', () => {
  it('同じ日付・同じスタッフなら常に同じ予定を返す', () => {
    const first = planVisitsForDate('2026-09-07', STAFF, FIGURE_COUNT);
    const second = planVisitsForDate('2026-09-07', STAFF, FIGURE_COUNT);
    expect(second).toEqual(first);
  });

  it('日付が変われば別の予定になる', () => {
    const monday = planVisitsForDate('2026-09-07', STAFF, FIGURE_COUNT);
    const tuesday = planVisitsForDate('2026-09-08', STAFF, FIGURE_COUNT);
    expect(tuesday).not.toEqual(monday);
  });

  it('同じ日に同じ世帯を二重に入れない', () => {
    for (const date of ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10']) {
      const indexes = planVisitsForDate(date, STAFF, FIGURE_COUNT).map((v) => v.figureIndex);
      expect(new Set(indexes).size).toBe(indexes.length);
    }
  });

  it('曜日ごとに件数が変わる(平日3件・土曜2件・日曜1件)', () => {
    // 2026-09-07(月)〜2026-09-13(日)
    const counts = [
      '2026-09-07',
      '2026-09-08',
      '2026-09-09',
      '2026-09-10',
      '2026-09-11',
      '2026-09-12',
      '2026-09-13',
    ].map((date) => planVisitsForDate(date, STAFF, FIGURE_COUNT).length);
    expect(counts).toEqual([3, 3, 3, 3, 3, 2, 1]);
  });

  it('どの曜日でも最低1件は予定が入る(デモが空の画面にならないこと)', () => {
    for (let offset = 0; offset < 14; offset++) {
      const date = toJstDateIso(new Date(Date.UTC(2026, 8, 7) + offset * 24 * 60 * 60 * 1000));
      expect(planVisitsForDate(date, STAFF, FIGURE_COUNT).length).toBeGreaterThan(0);
    }
  });

  it('予定の時間帯は訪問枠の並び順どおりになる', () => {
    const visits = planVisitsForDate('2026-09-07', STAFF, FIGURE_COUNT);
    expect(visits.map((v) => [v.start, v.end])).toEqual(
      VISIT_SLOTS.slice(0, visits.length).map((slot) => [slot.start, slot.end]),
    );
  });

  it('スタッフが違えば別の予定になる(担当が分かれていること)', () => {
    const hanako = planVisitsForDate('2026-09-07', '山田 花子', FIGURE_COUNT);
    const ichiro = planVisitsForDate('2026-09-07', '鈴木 一郎', FIGURE_COUNT);
    expect(ichiro).not.toEqual(hanako);
  });
});

describe('recentBusinessDates', () => {
  it('指定日数ぶんの日付を古い順に、当日を含めずに返す', () => {
    const today = new Date('2026-09-10T03:00:00Z');
    const dates = recentBusinessDates(today, 5);
    expect(dates).toEqual(['2026-09-05', '2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09']);
  });
});

describe('toJstDateIso', () => {
  it('UTCで日付をまたぐ時刻でもJSTの業務日になる', () => {
    // 2026-09-10 16:00 UTC = 2026-09-11 01:00 JST
    expect(toJstDateIso(new Date('2026-09-10T16:00:00Z'))).toBe('2026-09-11');
    // 2026-09-10 14:00 UTC = 2026-09-10 23:00 JST
    expect(toJstDateIso(new Date('2026-09-10T14:00:00Z'))).toBe('2026-09-10');
  });
});
