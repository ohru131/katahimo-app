import { describe, expect, it } from 'vitest';
import { ACCIDENT_REPORT_TYPES, isAccidentReportType, isValidRating } from './reports';

/**
 * 入口(API)側の値域検証。packages/db/src/schema/accidentReports.ts / dailyReports.ts の
 * CHECK制約と一致させる必要があるため(doc/14 §4)、値そのものと境界値をここで固定する。
 *
 * Honoアプリ全体(認証・Container)を組み立てる既存のテストがこのパッケージには無いため、
 * csrf.test.ts と同じ方針(ルートから切り出した純粋関数を直接テストする)に合わせている。
 */
describe('reportType の値域検証(accident_reports_report_type_check と一致させる)', () => {
  it('許可された2値は通す', () => {
    for (const value of ACCIDENT_REPORT_TYPES) {
      expect(isAccidentReportType(value)).toBe(true);
    }
  });

  it('未知の文字列は拒否する', () => {
    expect(isAccidentReportType('でたらめ')).toBe(false);
    expect(isAccidentReportType('accident')).toBe(false);
    expect(isAccidentReportType('')).toBe(false);
  });

  it('文字列以外は拒否する', () => {
    expect(isAccidentReportType(undefined)).toBe(false);
    expect(isAccidentReportType(null)).toBe(false);
    expect(isAccidentReportType(1)).toBe(false);
    expect(isAccidentReportType(['事故報告'])).toBe(false);
  });
});

describe('riskRating/esRating の値域検証(daily_reports_risk_rating_check/es_rating_check と一致させる)', () => {
  it('1〜5の整数は通す', () => {
    for (const value of [1, 2, 3, 4, 5]) {
      expect(isValidRating(value)).toBe(true);
    }
  });

  it('範囲外の整数は拒否する', () => {
    expect(isValidRating(0)).toBe(false);
    expect(isValidRating(6)).toBe(false);
    expect(isValidRating(-999)).toBe(false);
  });

  it('整数以外は拒否する', () => {
    expect(isValidRating(3.5)).toBe(false);
    expect(isValidRating(Number.NaN)).toBe(false);
    expect(isValidRating('3')).toBe(false);
    expect(isValidRating(null)).toBe(false);
    expect(isValidRating(undefined)).toBe(false);
  });
});
