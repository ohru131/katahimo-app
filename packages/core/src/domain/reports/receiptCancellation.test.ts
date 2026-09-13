import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RECEIPT_DEADLINE_POLICY,
  type ReceiptDeadlinePolicy,
  receiptCancellableUntil,
  receiptClosingDate,
} from './receiptCancellation';

/** 既定(月末締め・取り消し2日)。 */
const DEFAULT = DEFAULT_RECEIPT_DEADLINE_POLICY;
/** 20日締めのテナント。 */
const DAY20: ReceiptDeadlinePolicy = { closingDay: 20, cancellableDays: 2 };

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

  it('締め日を越えない(締めたあとに当期の記録が動かないようにする)', () => {
    expect(receiptCancellableUntil('2026-09-29', DEFAULT)).toBe('2026-09-30');
    expect(receiptCancellableUntil('2026-09-30', DEFAULT)).toBe('2026-09-30');
    // 月末が31日の月でも同じ。
    expect(receiptCancellableUntil('2026-10-30', DEFAULT)).toBe('2026-10-31');
  });

  it('締め日を変えると期限も追随する', () => {
    expect(receiptCancellableUntil('2026-09-05', DAY20)).toBe('2026-09-07');
    // 締め日(9/20)を越えない。
    expect(receiptCancellableUntil('2026-09-19', DAY20)).toBe('2026-09-20');
    // 締め日当日を過ぎた分は次の締め期間(10/20)に入るので、通常どおり+2日。
    expect(receiptCancellableUntil('2026-09-21', DAY20)).toBe('2026-09-23');
  });

  it('うるう年の2月末も正しく扱う', () => {
    expect(receiptCancellableUntil('2028-02-27', DEFAULT)).toBe('2028-02-29');
    expect(receiptCancellableUntil('2028-02-28', DEFAULT)).toBe('2028-02-29');
  });

  it('領収書の日付より前の日を返さない(取り消せる期間が負にならない)', () => {
    for (const policy of [DEFAULT, DAY20, { closingDay: 1, cancellableDays: 0 }]) {
      for (const day of ['2026-09-01', '2026-09-14', '2026-09-20', '2026-09-21', '2026-09-30']) {
        expect(receiptCancellableUntil(day, policy) >= day).toBe(true);
      }
    }
  });

  it('cancellableDays=0 ならその日のうちだけ取り消せる', () => {
    expect(receiptCancellableUntil('2026-09-14', { closingDay: null, cancellableDays: 0 })).toBe(
      '2026-09-14',
    );
  });
});
