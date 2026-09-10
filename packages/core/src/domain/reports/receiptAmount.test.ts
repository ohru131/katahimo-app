import { describe, expect, it } from 'vitest';
import { computeReceiptAmount } from './receiptAmount';

describe('computeReceiptAmount', () => {
  it('カンマ区切りの金額をamountYenに変換する(amountRawには生値を残す)', () => {
    expect(computeReceiptAmount('1,000')).toEqual({ amountYen: 1000, amountRaw: '1,000' });
  });

  it('数値化できない値はamountYen=nullでamountRawだけ残す', () => {
    expect(computeReceiptAmount('1000円')).toEqual({ amountYen: null, amountRaw: '1000円' });
  });

  it('小数は四捨五入してamountYenに入れる(元の表記はamountRawに残す)', () => {
    expect(computeReceiptAmount('1000.6')).toEqual({ amountYen: 1001, amountRaw: '1000.6' });
    expect(computeReceiptAmount('1000.4')).toEqual({ amountYen: 1000, amountRaw: '1000.4' });
  });

  it('数値そのものが渡された場合も同様に扱う', () => {
    expect(computeReceiptAmount(1500)).toEqual({ amountYen: 1500, amountRaw: '1500' });
  });

  it('空文字・null・undefinedは両方nullになる', () => {
    expect(computeReceiptAmount('')).toEqual({ amountYen: null, amountRaw: null });
    expect(computeReceiptAmount(null)).toEqual({ amountYen: null, amountRaw: null });
    expect(computeReceiptAmount(undefined)).toEqual({ amountYen: null, amountRaw: null });
  });

  it('空白だけの入力は未入力として扱う(0円と誤認しない)', () => {
    expect(computeReceiptAmount('   ')).toEqual({ amountYen: null, amountRaw: null });
    expect(computeReceiptAmount('\t\n')).toEqual({ amountYen: null, amountRaw: null });
  });
});
