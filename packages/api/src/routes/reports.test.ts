import { describe, expect, it } from 'vitest';
import {
  ACCIDENT_REPORT_TYPES,
  isAccidentReportType,
  isValidRating,
  parseGenerateDailyReportBody,
} from './reports';

/**
 * 入口(API)側の値域検証。packages/db/src/schema/accidentReports.ts / dailyReports.ts の
 * CHECK制約と一致させる必要があるため(doc/db/guidelines.md §4)、値そのものと境界値をここで固定する。
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

describe('stressLevel/esRating の値域検証(daily_reports_stress_level_check/es_rating_check と一致させる)', () => {
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

/**
 * `POST /api/reports/daily/generate` の入口の判定。customerId が無いまま通すと、
 * 家庭ごとの★も対象児も引けないまま生成が走る(しかも画面上は普通に下書きが出る)。
 */
describe('POST /daily/generate のリクエストボディ', () => {
  const valid = { text: 'メモ', customerId: 'customer-1' };

  it('text と customerId があれば通る', () => {
    const parsed = parseGenerateDailyReportBody({ ...valid, start: '10:00', end: '13:00' });
    expect(parsed).toEqual({
      ok: true,
      input: {
        text: 'メモ',
        start: '10:00',
        end: '13:00',
        reportDate: undefined,
        customerId: 'customer-1',
        familyMemberId: null,
        stressLevel: null,
      },
    });
  });

  it('customerId が無ければ400にする', () => {
    expect(parseGenerateDailyReportBody({ text: 'メモ' })).toEqual({
      ok: false,
      message: 'customerId が必要です',
    });
    expect(parseGenerateDailyReportBody({ text: 'メモ', customerId: '   ' }).ok).toBe(false);
  });

  it('text が空なら400にする', () => {
    expect(parseGenerateDailyReportBody({ customerId: 'customer-1' }).ok).toBe(false);
    expect(parseGenerateDailyReportBody({ text: '  ', customerId: 'customer-1' }).ok).toBe(false);
    expect(parseGenerateDailyReportBody(null).ok).toBe(false);
  });

  it('familyMemberId は文字列かnull。空文字は未選択と同じ扱いにする', () => {
    const picked = parseGenerateDailyReportBody({ ...valid, familyMemberId: 'member-1' });
    expect(picked.ok && picked.input.familyMemberId).toBe('member-1');

    for (const value of [null, undefined, '']) {
      const parsed = parseGenerateDailyReportBody({ ...valid, familyMemberId: value });
      expect(parsed.ok && parsed.input.familyMemberId).toBeNull();
    }
    expect(parseGenerateDailyReportBody({ ...valid, familyMemberId: 123 }).ok).toBe(false);
  });

  it('stressLevel は未評価(null/省略)か1〜5の整数だけを通す', () => {
    const rated = parseGenerateDailyReportBody({ ...valid, stressLevel: 3 });
    expect(rated.ok && rated.input.stressLevel).toBe(3);

    const unrated = parseGenerateDailyReportBody({ ...valid, stressLevel: null });
    expect(unrated.ok && unrated.input.stressLevel).toBeNull();

    expect(parseGenerateDailyReportBody({ ...valid, stressLevel: 0 }).ok).toBe(false);
    expect(parseGenerateDailyReportBody({ ...valid, stressLevel: 6 }).ok).toBe(false);
    expect(parseGenerateDailyReportBody({ ...valid, stressLevel: '3' }).ok).toBe(false);
  });
});
