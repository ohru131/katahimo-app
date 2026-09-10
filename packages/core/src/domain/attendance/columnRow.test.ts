import { attendanceRowDataSchema, MAX_MOVE_LEGS } from '@katahimo/shared';
import { describe, expect, it } from 'vitest';
import { computeDayDerived } from './attendanceCalc';
import { fromColumnRow, toColumnRow } from './columnRow';
import type { AttendanceColumnRow, AttendanceRowData } from './types';

describe('fromColumnRow(toColumnRow(x)) の往復(永続形式→列記号→永続形式)', () => {
  it('全項目が埋まった1日分は完全に一致する', () => {
    const x: AttendanceRowData = {
      visits: [
        {
          place: '田中様宅',
          start: '9:00',
          end: '12:00',
          weatherAfter: '雨',
          plannedMoveMin: 20,
          distanceKm: 4.2,
        },
        {
          place: '佐藤様宅',
          start: '13:00',
          end: '15:00',
          weatherAfter: '晴れ',
          plannedMoveMin: 0,
          distanceKm: 2.8,
        },
        { place: '鈴木様宅', start: '15:30', end: '16:30' },
      ],
      officeWork: [
        { name: '記録作成', start: '17:00', end: '17:30' },
        { name: 'MTG', start: '17:30', end: '18:00' },
      ],
      commuteDistanceKm: 3.1,
      returnDistanceKm: 3.4,
      shoppingErrandCount: 1,
      note: '備考テスト',
    };
    expect(fromColumnRow(toColumnRow(x))).toEqual(x);
  });

  it('訪問1件のみでも一致する', () => {
    const x: AttendanceRowData = { visits: [{ place: 'A', start: '9:00', end: '10:00' }] };
    expect(fromColumnRow(toColumnRow(x))).toEqual(x);
  });

  it('空(未入力の1日)は一致する', () => {
    const x: AttendanceRowData = {};
    expect(fromColumnRow(toColumnRow(x))).toEqual(x);
  });

  it('0は未入力と区別され、0のまま往復する(0を空文字にしてしまう不具合が無いことの確認)', () => {
    const x: AttendanceRowData = {
      visits: [{ place: 'A', start: '9:00', end: '10:00', plannedMoveMin: 0, distanceKm: 0 }],
      commuteDistanceKm: 0,
      returnDistanceKm: 0,
      shoppingErrandCount: 0,
    };
    expect(fromColumnRow(toColumnRow(x))).toEqual(x);
  });

  it('1件目が空で2件目だけに値がある場合(先頭の空要素)は一致する', () => {
    // toColumnRowはvisits[0]/[1]/[2]を固定位置(C/D/E, L/M/N, U/V/W)として書き出すため、
    // 1件目相当の空オブジェクトを残しておかないと2件目の値が1件目の列に化けてしまう。
    // fromColumnRowはこの固定位置を踏まえて、先頭・途中の空要素はそのまま復元する。
    const x: AttendanceRowData = { visits: [{}, { place: 'B', start: '13:00', end: '14:00' }] };
    expect(fromColumnRow(toColumnRow(x))).toEqual(x);
  });

  it('【往復が成り立たない例1】末尾に空の訪問オブジェクトがあると、復元時に失われる', () => {
    // fromColumnRowは列(C/D/E等)がすべて未入力かどうかでしか「空」を判定できず、
    // 「意図して空オブジェクトを入れた」のか「そもそも入力が無い」のかを区別できない。
    // 末尾の空要素は常に「入力が無い」側として扱われ、切り詰められる。
    const x: AttendanceRowData = { visits: [{ place: 'A', start: '9:00', end: '10:00' }, {}] };
    const result = fromColumnRow(toColumnRow(x));
    expect(result).not.toEqual(x);
    expect(result).toEqual({ visits: [{ place: 'A', start: '9:00', end: '10:00' }] });
  });

  it('【往復が成り立たない例2】末尾に空の事務作業オブジェクトがあると、復元時に失われる', () => {
    const x: AttendanceRowData = { officeWork: [{ name: 'MTG', start: '17:00', end: '18:00' }, {}] };
    const result = fromColumnRow(toColumnRow(x));
    expect(result).not.toEqual(x);
    expect(result).toEqual({ officeWork: [{ name: 'MTG', start: '17:00', end: '18:00' }] });
  });
});

describe('toColumnRowは対応する移動列が無い訪問にweatherAfter/plannedMoveMin/distanceKmが入っていたら例外を投げる', () => {
  // GAS版のスプレッドシートには元々#3訪問の「あとの移動」を書く列(H/I/AGに相当するもの)が
  // 無く、attendanceCalc.tsも#1→#2・#2→#3の2区間しか計算しない。したがって3件目(index 2、
  // MAX_MOVE_LEGS以降)のこれらの項目はAttendanceColumnRowに表現する場所がそもそも無い。
  // 本来はattendanceRowDataSchemaのsuperRefineでAPI境界が先に拒否しているはずだが、
  // usecase等から直接呼ばれてすり抜けた場合に黙って捨てて給与に関わるdistanceKmが
  // 気付かれずに消えることが無いよう、toColumnRow自身も防御的に例外を投げる。
  const baseVisits: AttendanceRowData['visits'] = [
    { place: 'A', start: '9:00', end: '10:00' },
    { place: 'B', start: '10:30', end: '11:00' },
  ];

  it.each([
    ['weatherAfter', { weatherAfter: '雪' }],
    ['plannedMoveMin', { plannedMoveMin: 10 }],
    ['distanceKm', { distanceKm: 1 }],
  ] as const)('3件目のweatherAfter/plannedMoveMin/distanceKmの%sだけでも例外になる', (_field, patch) => {
    const x: AttendanceRowData = {
      visits: [...baseVisits, { place: 'C', start: '11:30', end: '12:00', ...patch }],
    };
    expect(() => toColumnRow(x)).toThrow(/移動列が無い/);
  });

  it('MAX_MOVE_LEGS件目(index 1)までなら移動項目があっても例外にならない', () => {
    const x: AttendanceRowData = {
      visits: [
        { place: 'A', start: '9:00', end: '10:00', weatherAfter: '晴れ', plannedMoveMin: 10, distanceKm: 1 },
        { place: 'B', start: '10:30', end: '11:00', weatherAfter: '晴れ', plannedMoveMin: 5, distanceKm: 2 },
      ],
    };
    expect(() => toColumnRow(x)).not.toThrow();
    expect(MAX_MOVE_LEGS).toBe(2);
  });
});

describe('toColumnRow(fromColumnRow(y)) の往復(列記号→永続形式→列記号)', () => {
  it('全項目が埋まった1日分は完全に一致する', () => {
    const y: AttendanceColumnRow = {
      C: '田中様宅',
      D: '9:00',
      E: '12:00',
      H: '20',
      I: '雨',
      L: '佐藤様宅',
      M: '13:00',
      N: '15:00',
      Q: '15',
      R: '晴れ',
      U: '鈴木様宅',
      V: '15:30',
      W: '16:30',
      X: '記録作成',
      Y: '17:00',
      Z: '17:30',
      AA: 'MTG',
      AB: '17:30',
      AC: '18:00',
      AG: '4.2',
      AH: '2.8',
      AI: '3.1',
      AJ: '3.4',
      AN: '1',
      AO: '備考',
    };
    expect(toColumnRow(fromColumnRow(y))).toEqual(y);
  });

  it('空文字だらけの列(すべて未入力)は一致する', () => {
    const y: AttendanceColumnRow = {};
    expect(toColumnRow(fromColumnRow(y))).toEqual(y);
  });

  it("空文字のフィールドはundefinedになる('' と undefined を isPresent で同じに扱う)ため一致しない", () => {
    // AttendanceColumnRowの各フィールドは元々「空文字==未入力」という前提の列記号形式なので、
    // ''を明示的に持つ列と、そのキーが無い列は意味的には同じはずだが、toEqualでは
    // ('' !== undefined)として区別される。この非対称性を正直に記録しておく。
    const y: AttendanceColumnRow = { C: '', D: '9:00', E: '10:00' };
    const result = toColumnRow(fromColumnRow(y));
    expect(result).not.toEqual(y);
    expect(result.C).toBeUndefined();
    expect(result.D).toBe('9:00');
    expect(result.E).toBe('10:00');
  });
});

/**
 * attendanceCalc.test.ts(19ケース)のうち、分岐を広くカバーする代表的なケースを
 * fromColumnRowで新形式へ持ち上げ、toColumnRowを通して計算した結果が、列記号を直接
 * computeDayDerivedへ渡した場合(=attendanceCalc.test.ts本体が検証している値)と
 * 1つも変わらないことを確認する。ラベルはattendanceCalc.test.tsの対応するケースに合わせてある。
 */
describe('代表ケースをfromColumnRow→toColumnRow経由で計算しても値が変わらない', () => {
  const REPRESENTATIVE_CASES: Array<{ label: string; rowData: AttendanceColumnRow }> = [
    { label: '基本: 訪問1件のみ、所定内', rowData: { D: '10:00', E: '12:00' } },
    {
      label: '訪問3件+事務2件、移動あり、天候なし',
      rowData: {
        D: '09:00',
        E: '10:00',
        H: '30',
        I: '',
        M: '10:45',
        N: '12:00',
        Q: '20',
        R: '',
        V: '12:35',
        W: '14:00',
        X: '事務作業A',
        Y: '14:30',
        Z: '15:30',
        AA: '事務作業B',
        AB: '15:45',
        AC: '16:30',
        AG: '5.5',
        AH: '3.2',
        AI: '10',
        AJ: '8',
      },
    },
    { label: '積雪あり: 移動時間が1.3倍になる', rowData: { E: '10:00', H: '20', I: '雪', M: '10:30' } },
    {
      label: 'mtg特例: ラベルが大文字混在(MTG)でも所定内扱い',
      rowData: { X: 'MTG会議', Y: '18:00', Z: '20:00' },
    },
    { label: '距離超過35km(4回分超過、5km刻み)', rowData: { AG: '35', AH: '0', AI: '0', AJ: '0' } },
    {
      label: '複数列で超過が発生する場合は列ごとに計算して合算する(AG=20→1回、AH=25→2回)',
      rowData: { AG: '20', AH: '25', AI: '0', AJ: '0' },
    },
    { label: '訪問回数判定: 全て未入力なら0', rowData: {} },
    { label: '終業<=始業(逆転した時間帯)は所定内0扱い', rowData: { D: '12:00', E: '10:00' } },
    {
      label: '不正な時刻文字列(範囲外)は形式チェックだけ通り、24時間モジュロで丸められる',
      rowData: { D: 'invalid', E: '25:99' },
    },
    {
      label: '日をまたぐ移動(23:50→翌00:10)のフォーマット丸め確認',
      rowData: { E: '23:50', H: '20', M: '00:10' },
    },
    {
      label: '買物代行(AN)は日次derivedには含まれない(月合計でのみ集計)',
      rowData: { D: '10:00', E: '11:00', AN: '2' },
    },
  ];

  it.each(REPRESENTATIVE_CASES.map((c) => [c.label, c.rowData] as const))('%s', (_label, rowData) => {
    const directResult = computeDayDerived(rowData);
    const viaNewFormat = computeDayDerived(toColumnRow(fromColumnRow(rowData)));
    expect(viaNewFormat).toEqual(directResult);
  });
});

/**
 * attendanceRowDataSchema(@katahimo/shared)自体の検証。API境界・saveAttendanceDay usecase
 * の両方がこのスキーマを直接使うので、ここで固定しておけばどちらの呼び出し経路にも効く。
 */
describe('attendanceRowDataSchema', () => {
  it('MAX_MOVE_LEGS件目(index 1)までは移動項目(weatherAfter/plannedMoveMin/distanceKm)を許す', () => {
    const result = attendanceRowDataSchema.safeParse({
      visits: [
        { place: 'A', weatherAfter: '晴れ', plannedMoveMin: 10, distanceKm: 1 },
        { place: 'B', weatherAfter: '晴れ', plannedMoveMin: 5, distanceKm: 2 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it.each([
    ['weatherAfter', { weatherAfter: '雪' }],
    ['plannedMoveMin', { plannedMoveMin: 10 }],
    ['distanceKm', { distanceKm: 1 }],
  ] as const)(
    'MAX_MOVE_LEGS件目より後(index 2以降)に%sがあると、その添字とフィールドを指した検証エラーになる',
    (field, patch) => {
      const result = attendanceRowDataSchema.safeParse({
        visits: [{ place: 'A' }, { place: 'B' }, { place: 'C', ...patch }],
      });
      expect(result.success).toBe(false);
      if (result.success) return;
      const issue = result.error.issues.find((i) => i.path.join('.') === `visits.2.${field}`);
      expect(issue).toBeDefined();
    },
  );

  it('未知のキーは.strict()で拒否される(黙って捨てない)', () => {
    const result = attendanceRowDataSchema.safeParse({
      visits: [{ place: 'A' }],
      // typoや旧フォーマットの残骸(列記号Cなど)を想定。
      unknownTopLevelKey: 'x',
    });
    expect(result.success).toBe(false);
  });

  it('訪問の要素に未知のキーがあると.strict()で拒否される', () => {
    const result = attendanceRowDataSchema.safeParse({
      visits: [{ place: 'A', unknownVisitKey: 'x' }],
    });
    expect(result.success).toBe(false);
  });
});
