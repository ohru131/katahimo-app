import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RECEIPT_DEADLINE_POLICY,
  type ReceiptDeadlinePolicy,
  receiptCancellableUntil,
  receiptClosingDate,
  receiptMirrorFlushBy,
  receiptMirrorSendAfter,
} from './receiptCancellation';

/** 既定(月末締め・締め日の1日前までに送信・取り消し2日)。 */
const DEFAULT = DEFAULT_RECEIPT_DEADLINE_POLICY;
/** 20日締めのテナント。 */
const DAY20: ReceiptDeadlinePolicy = { closingDay: 20, mirrorLeadDays: 1, cancellableDays: 2 };

describe('receiptClosingDate', () => {
  it('締め日がnullならその月の末日', () => {
    expect(receiptClosingDate('2026-09-01', DEFAULT)).toBe('2026-09-30');
    expect(receiptClosingDate('2026-10-31', DEFAULT)).toBe('2026-10-31');
    // うるう年の2月。
    expect(receiptClosingDate('2028-02-10', DEFAULT)).toBe('2028-02-29');
  });

  it('日付指定なら、領収書の日付以降で最初に来るその日', () => {
    expect(receiptClosingDate('2026-09-05', DAY20)).toBe('2026-09-20');
    expect(receiptClosingDate('2026-09-20', DAY20)).toBe('2026-09-20');
    // 締め日を過ぎて登録されたものは次の締め期間。
    expect(receiptClosingDate('2026-09-21', DAY20)).toBe('2026-10-20');
    // 年をまたぐ。
    expect(receiptClosingDate('2026-12-25', DAY20)).toBe('2027-01-20');
  });
});

describe('receiptCancellableUntil', () => {
  it('通常は領収書の日付+2日(暦日。土日祝も訪問があるため営業日では数えない)', () => {
    expect(receiptCancellableUntil('2026-09-14', DEFAULT)).toBe('2026-09-16');
    // 金曜でも週末をまたいで延びない。
    expect(receiptCancellableUntil('2026-09-18', DEFAULT)).toBe('2026-09-20');
  });

  it('送信締切(締め日のleadDays日前)を越えない', () => {
    // 月末締め・leadDays=1 なので送信締切は9/29。
    expect(receiptCancellableUntil('2026-09-28', DEFAULT)).toBe('2026-09-29');
    // 月末が31日の月でも同じ。
    expect(receiptCancellableUntil('2026-10-29', DEFAULT)).toBe('2026-10-30');
  });

  it('締め間際の領収書は取り消せる期間がゼロになる(領収書の日付より前の日が返る)', () => {
    // 送信締切9/29を過ぎて登録された分。締めるまでに出ていることを優先する。
    expect(receiptCancellableUntil('2026-09-30', DEFAULT)).toBe('2026-09-29');
  });

  it('締め日を変えると期限も追随する', () => {
    expect(receiptCancellableUntil('2026-09-05', DAY20)).toBe('2026-09-07');
    // 送信締切は9/19。
    expect(receiptCancellableUntil('2026-09-18', DAY20)).toBe('2026-09-19');
    // 締め日当日の領収書は次の締め期間(10/20締め・送信締切10/19)に入るので、通常どおり+2日。
    expect(receiptCancellableUntil('2026-09-21', DAY20)).toBe('2026-09-23');
  });

  it('うるう年の2月末も正しく扱う', () => {
    expect(receiptCancellableUntil('2028-02-26', DEFAULT)).toBe('2028-02-28');
    expect(receiptCancellableUntil('2028-02-27', DEFAULT)).toBe('2028-02-28');
  });
});

describe('receiptMirrorFlushBy', () => {
  it('締め日のleadDays日前', () => {
    expect(receiptMirrorFlushBy('2026-09-10', DEFAULT)).toBe('2026-09-29');
    expect(receiptMirrorFlushBy('2026-09-10', { ...DEFAULT, mirrorLeadDays: 3 })).toBe('2026-09-27');
    // leadDays=0 は締め日当日いっぱい。
    expect(receiptMirrorFlushBy('2026-09-10', { ...DEFAULT, mirrorLeadDays: 0 })).toBe('2026-09-30');
  });
});

describe('receiptMirrorSendAfter', () => {
  it('取消できる期間が終わった直後(JSTの翌日0時)を返す', () => {
    // 2026-09-14の領収書は2026-09-16いっぱいまで取り消せるので、9/17 00:00 JST から送る。
    expect(receiptMirrorSendAfter('2026-09-14', DEFAULT).toISOString()).toBe('2026-09-16T15:00:00.000Z');
  });

  it('月末近くの領収書もその月のうちに送り始める(翌月へ持ち越さない)', () => {
    // leadDays=1 により送信締切は9/29。9/30 00:00 JST = 9/29 15:00 UTC から送る。
    // 締め日を月末にしたまま「前月分が翌月に送られる」のを無くしているのがこの行。
    expect(receiptMirrorSendAfter('2026-09-28', DEFAULT).toISOString()).toBe('2026-09-29T15:00:00.000Z');
    expect(receiptMirrorSendAfter('2026-09-30', DEFAULT).toISOString()).toBe('2026-09-29T15:00:00.000Z');
  });

  it('締め間際に登録された分は過去の時刻になり、ワーカーが即座に拾う', () => {
    // 9/30に登録された領収書の送信開始は9/30 00:00 JST = その日の始まり。
    // 登録時刻はそれより後なので、積んだ時点で既に「送ってよい」状態になる。
    const sendAfter = receiptMirrorSendAfter('2026-09-30', DEFAULT);
    const registeredAt = new Date('2026-09-30T10:00:00+09:00');
    expect(sendAfter.getTime()).toBeLessThan(registeredAt.getTime());
  });

  it('取消期限とミラー送信開始のあいだに隙間が無い(競合が起きない)', () => {
    for (const policy of [DEFAULT, DAY20, { ...DEFAULT, mirrorLeadDays: 0, cancellableDays: 5 }]) {
      for (const day of ['2026-09-01', '2026-09-14', '2026-09-19', '2026-09-29', '2026-09-30']) {
        const until = receiptCancellableUntil(day, policy);
        const sendAfter = receiptMirrorSendAfter(day, policy);
        // 送信開始 = 取消できる最終日の翌日0時(JST)= 15:00 UTC 前日。
        const [y = 0, m = 1, d = 1] = until.split('-').map(Number);
        const expected = new Date(Date.UTC(y, m - 1, d + 1) - 9 * 60 * 60 * 1000);
        expect(sendAfter.toISOString()).toBe(expected.toISOString());
      }
    }
  });
});
