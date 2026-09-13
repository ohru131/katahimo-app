import { describe, expect, it } from 'vitest';
import { receiptCancellableUntil, receiptMirrorSendAfter } from './receiptCancellation';

describe('receiptCancellableUntil', () => {
  it('通常は領収書の日付+2日(暦日。土日祝も訪問があるため営業日では数えない)', () => {
    expect(receiptCancellableUntil('2026-09-14')).toBe('2026-09-16');
    // 金曜でも週末をまたいで延びない。
    expect(receiptCancellableUntil('2026-09-18')).toBe('2026-09-20');
  });

  it('月末を越えない(その月は月末で締めるため)', () => {
    expect(receiptCancellableUntil('2026-09-29')).toBe('2026-09-30');
    expect(receiptCancellableUntil('2026-09-30')).toBe('2026-09-30');
    // 月末が31日の月でも同じ。
    expect(receiptCancellableUntil('2026-10-30')).toBe('2026-10-31');
    expect(receiptCancellableUntil('2026-10-31')).toBe('2026-10-31');
  });

  it('うるう年の2月末も正しく扱う', () => {
    expect(receiptCancellableUntil('2028-02-28')).toBe('2028-02-29');
    expect(receiptCancellableUntil('2028-02-27')).toBe('2028-02-29');
  });
});

describe('receiptMirrorSendAfter', () => {
  it('取消できる期間が終わった直後(JSTの翌日0時)を返す', () => {
    // 2026-09-14の領収書は2026-09-16いっぱいまで取り消せるので、9/17 00:00 JST から送る。
    expect(receiptMirrorSendAfter('2026-09-14').toISOString()).toBe('2026-09-16T15:00:00.000Z');
  });

  it('月末の領収書はその月のうちに送る(翌月へ持ち越さない)', () => {
    // 2026-09-30の領収書は9/30いっぱいまでしか取り消せず、10/1 00:00 JST に送られる。
    // 「月をまたいでミラー送信しない」の境界そのもの。
    expect(receiptMirrorSendAfter('2026-09-30').toISOString()).toBe('2026-09-30T15:00:00.000Z');
  });

  it('取消期限とミラー送信開始のあいだに隙間が無い(競合が起きない)', () => {
    for (const day of ['2026-09-01', '2026-09-14', '2026-09-29', '2026-09-30']) {
      const until = receiptCancellableUntil(day);
      const sendAfter = receiptMirrorSendAfter(day);
      // 送信開始 = 取消できる最終日の翌日0時(JST)= 15:00 UTC 前日。
      const [y = 0, m = 1, d = 1] = until.split('-').map(Number);
      const expected = new Date(Date.UTC(y, m - 1, d + 1) - 9 * 60 * 60 * 1000);
      expect(sendAfter.toISOString()).toBe(expected.toISOString());
    }
  });
});
