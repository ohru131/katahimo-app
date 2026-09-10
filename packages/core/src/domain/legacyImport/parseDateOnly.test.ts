import { describe, expect, it } from 'vitest';
import { parseDateOnly } from './parseDateOnly';

describe('parseDateOnly', () => {
  it('normalizeDateStrの出力形式("YYYY/M/D")をYYYY-MM-DDに変換する', () => {
    expect(parseDateOnly('1990/1/28')).toBe('1990-01-28');
    expect(parseDateOnly('2025/12/1')).toBe('2025-12-01');
  });

  it('ISO形式("YYYY-MM-DD")はそのまま(桁揃えのみ)通す', () => {
    expect(parseDateOnly('2020-06-15')).toBe('2020-06-15');
  });

  it('前後の空白は無視する', () => {
    expect(parseDateOnly('  1990/1/28  ')).toBe('1990-01-28');
  });

  it('年だけ・年月だけの不完全な表記はnullを返す(1月1日等を補わない)', () => {
    expect(parseDateOnly('1990')).toBeNull();
    expect(parseDateOnly('1990/1')).toBeNull();
  });

  it('実在しない暦日(範囲外の月日)はnullを返す', () => {
    expect(parseDateOnly('1990/13/45')).toBeNull();
    expect(parseDateOnly('2021/2/30')).toBeNull();
  });

  it('うるう年の2/29は実在する暦日として通す', () => {
    expect(parseDateOnly('2020/2/29')).toBe('2020-02-29');
  });

  it('うるう年でない年の2/29はnullを返す', () => {
    expect(parseDateOnly('2021/2/29')).toBeNull();
  });

  it('数字以外の自由記述はnullを返す', () => {
    expect(parseDateOnly('不明')).toBeNull();
    expect(parseDateOnly('')).toBeNull();
  });
});
