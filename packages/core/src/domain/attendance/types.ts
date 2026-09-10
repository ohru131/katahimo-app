/**
 * 出勤簿テンプレート(出勤簿テンプレート.xlsx)の入力列1日分。
 * 移植元: gas-childcare-visit-app/AttendanceCalc.js のコメント、
 * PastSchedule.js の PAST_SCHEDULE_INPUT_COLUMNS。
 *
 * 【これは内部表現であり、永続形式(DB・API)ではない】doc/14 B項の段階1で、DB(row_data)・
 * APIが持つ形は意味のあるキーの AttendanceRowData(@katahimo/shared、このファイル下部で
 * re-export)に変わった。しかし packages/core/src/domain/attendance/attendanceCalc.ts は
 * GAS版との数値一致を19ケースで検証済みの唯一の資産であり、ここを書き換えるとその保証が
 * 揺らぐため、計算ロジックは列記号のままこの型(旧 AttendanceRowData を改称した
 * AttendanceColumnRow)を内部実装として温存している。境界(toColumnRow/fromColumnRow、
 * columnRow.ts)でのみ変換する。
 *
 * 列名(C/D/E等)はスプレッドシートの列記号をそのままキーにしている。読みにくく見えるが、
 * GAS版・webapp-poc版と全く同じキー名にしておくことで、実データを使った数値照合
 * (このオブジェクトをそのまま両実装に渡して出力を比較する)が row_data の変換なしにできる、
 * という利点を優先した意図的な選択(Phase 7で実データ突き合わせを行う際にそのまま使う)。
 *
 *   C/D/E = #1訪問先/始業/終業, I = #1後の気象状況, H = #1→#2計画移動時間(分)
 *   L/M/N = #2訪問先/始業/終業, R = #2後の気象状況, Q = #2→#3計画移動時間(分)
 *   U/V/W = #3訪問先/始業/終業
 *   X/Y/Z = 事務作業1/開始/終了, AA/AB/AC = 事務作業2/開始/終了
 *   AG = #1移動距離(km), AH = #2移動距離(km), AI = 出勤距離(km), AJ = 退勤距離(km)
 *   AN = 買物代行, AO = 備考
 */
export interface AttendanceColumnRow {
  C?: string;
  D?: string;
  E?: string;
  H?: string;
  I?: string;
  L?: string;
  M?: string;
  N?: string;
  Q?: string;
  R?: string;
  U?: string;
  V?: string;
  W?: string;
  X?: string;
  Y?: string;
  Z?: string;
  AA?: string;
  AB?: string;
  AC?: string;
  AG?: string;
  AH?: string;
  AI?: string;
  AJ?: string;
  AN?: string;
  AO?: string;
}

/**
 * 永続形式(DB row_data・API)の勤怠1日分。実体は @katahimo/shared の
 * attendanceRowDataSchema から推論した型。api/webの両方から同じ形を参照できるように
 * shared側に定義を置き、ここではdomain/attendanceからの既存のimport経路
 * (`from '../domain/attendance'` / `from '@katahimo/core/domain'`)を壊さないためだけに
 * re-exportしている。
 */
export type { AttendanceOfficeWork, AttendanceRowData, AttendanceVisit } from '@katahimo/shared';

export interface MoveChainResult {
  moveStart: string;
  moveEnd: string;
  weatherAdjustedMoveMin: number | '';
  waitMin: number | '';
}

export interface CoreAndOvertime {
  core: number;
  overtime: number;
}

export interface LaborAndOvertime {
  laborMinutes: number;
  overtimeMinutes: number;
}

export interface DistanceAggregates {
  totalMoveMin: number;
  totalDistanceKm: number;
  overThresholdCount: number;
  visitCount: number;
}

export interface AttendanceDayDerived {
  leg1MoveStart: string;
  leg1MoveEnd: string;
  leg1WeatherAdjustedMoveMin: number | '';
  leg1WaitMin: number | '';
  leg2MoveStart: string;
  leg2MoveEnd: string;
  leg2WeatherAdjustedMoveMin: number | '';
  leg2WaitMin: number | '';
  laborMinutes: number;
  overtimeMinutes: number;
  totalMoveMin: number;
  totalDistanceKm: number;
  overThresholdCount: number;
  visitCount: number;
}

/** attendanceCalc.ts(computeMonthlyTotals)の入力。列記号のまま(AttendanceColumnRow)。 */
export interface AttendanceMonthlyDay {
  rowData: AttendanceColumnRow;
  derived: AttendanceDayDerived;
}

export interface AttendanceMonthlyTotals {
  laborMinutes: number;
  overtimeMinutes: number;
  totalMoveMin: number;
  leg1DistanceKmTotal: number;
  leg2DistanceKmTotal: number;
  attendanceDistanceKmTotal: number;
  leavingDistanceKmTotal: number;
  totalDistanceKm: number;
  overThresholdCount: number;
  visitCountTotal: number;
  shoppingErrandTotal: number;
}
