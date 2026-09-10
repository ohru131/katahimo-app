import { MAX_OFFICE_WORK, MAX_VISITS } from '@katahimo/shared';
import type { AttendanceColumnRow, AttendanceOfficeWork, AttendanceRowData, AttendanceVisit } from './types';

/**
 * 永続形式(AttendanceRowData、意味のあるキー)と、勤怠計算の内部実装が使う列記号形式
 * (AttendanceColumnRow)を相互変換する。doc/14 B項が求める「照合のためにDBのキー名を
 * 犠牲にする必要が無い」を成立させている核。
 *
 *   toColumnRow()   … 計算(computeDayDerived/computeMonthlyTotals)とGASミラー送信で使う。
 *   fromColumnRow() … GAS版の実データ・既存テストの合成データを新形式へ持ち上げるのに使う。
 */

/** vが「値が入っている」とみなせるか。''は「未入力」と同義として扱う
 * (packages/core/src/domain/attendance/scheduleEvents.tsの`slot.start && slot.end`判定や
 * GAS版と同じ考え方)。0は明確に「入力されている」とみなす(0と未入力は意味が違うため、
 * ここをtruthy判定にすると0が未入力扱いになってしまう)。 */
function isPresent(v: string | number | undefined): boolean {
  return v !== undefined && v !== '';
}

/** 数値をAttendanceColumnRow(文字列)へ変換する。0を''にしてしまうと「未入力」と区別が
 * つかなくなる(attendanceCalc.tsのtoNumberOrNullは''を「未入力」として扱うため)ので、
 * 0は'0'という文字列にする。undefinedはundefinedのまま(=キー自体を空けておく)。 */
function numToColumnString(n: number | undefined): string | undefined {
  return n === undefined ? undefined : String(n);
}

/**
 * AttendanceColumnRowの文字列を数値へ変換する。''・undefinedは「未入力」でありnumberの0とは
 * 別物なのでundefinedを返す。数値として解釈できない文字列(壊れたjsonb・想定外のGAS実データ)が
 * 来た場合もundefinedを返す(例外は投げない): この関数はGAS実データの取り込みや、
 * attendanceCalc.test.tsの合成データをそのまま持ち上げる用途で使うものであり、
 * 「保存してよい値かどうか」を判定する場所ではない。保存経路の検証は
 * @katahimo/shared の attendanceRowDataSchema がAPI境界で担う。
 */
function columnStringToNum(s: string | undefined): number | undefined {
  if (s === undefined || s === '') return undefined;
  const n = Number(s);
  return Number.isNaN(n) ? undefined : n;
}

/**
 * AttendanceRowData(永続形式)を、勤怠計算の内部実装が使う列記号形式に変換する。
 *
 * データ構造自体(AttendanceRowData/jsonb)は訪問件数に上限を持たないが、attendanceCalc.tsは
 * 訪問3件・事務作業2件しか計算できない(GAS版との数値一致を守るため、段階1では計算ロジックを
 * 変更しない判断による)。上限を超える入力は本来アプリの入口(packages/api/src/routes/
 * attendance.ts)で400として拒否しているため、ここに届くのは実装の誤りのときだけ。
 * 黙って4件目以降を切り捨てると給与に直結する値が気付かれずに失われるため、例外を投げて
 * 気付ける形にする(到達したらAPI側のチェック漏れを疑うこと)。
 */
export function toColumnRow(rowData: AttendanceRowData): AttendanceColumnRow {
  const visits = rowData.visits ?? [];
  const officeWork = rowData.officeWork ?? [];
  if (visits.length > MAX_VISITS) {
    throw new Error(
      `訪問は${MAX_VISITS}件までです(勤怠計算がGAS版と一致することを保証している範囲。` +
        `${MAX_VISITS + 1}件以上は段階2の正規化で対応する)`,
    );
  }
  if (officeWork.length > MAX_OFFICE_WORK) {
    throw new Error(
      `事務作業は${MAX_OFFICE_WORK}件までです(勤怠計算がGAS版と一致することを保証している範囲。` +
        `${MAX_OFFICE_WORK + 1}件以上は段階2の正規化で対応する)`,
    );
  }

  const v0 = visits[0];
  const v1 = visits[1];
  const v2 = visits[2];
  const o0 = officeWork[0];
  const o1 = officeWork[1];

  return {
    C: v0?.place,
    D: v0?.start,
    E: v0?.end,
    H: numToColumnString(v0?.plannedMoveMin),
    I: v0?.weatherAfter,
    L: v1?.place,
    M: v1?.start,
    N: v1?.end,
    Q: numToColumnString(v1?.plannedMoveMin),
    R: v1?.weatherAfter,
    // 3件目の訪問(U/V/W)には対応する移動列(H/I/AGに相当するもの)がそもそも無い。
    // GAS版のスプレッドシートに元から#3→#4の移動を書く列が存在しない
    // (attendanceCalc.tsが#1→#2・#2→#3の2区間しか計算しない)ため、v2.weatherAfter/
    // plannedMoveMin/distanceKmを入力されてもここには表現する場所が無く破棄される。
    // これは今回の変更で新たに失われる情報ではなく、既存の計算モデルの制約をそのまま
    // 引き継いだ結果(columnRow.test.tsの往復テストで明示的に確認している)。
    U: v2?.place,
    V: v2?.start,
    W: v2?.end,
    X: o0?.name,
    Y: o0?.start,
    Z: o0?.end,
    AA: o1?.name,
    AB: o1?.start,
    AC: o1?.end,
    AG: numToColumnString(v0?.distanceKm),
    AH: numToColumnString(v1?.distanceKm),
    AI: numToColumnString(rowData.commuteDistanceKm),
    AJ: numToColumnString(rowData.returnDistanceKm),
    AN: numToColumnString(rowData.shoppingErrandCount),
    AO: rowData.note,
  };
}

/** 配列の末尾から、isEmpty(v)がtrueの要素を取り除く(先頭寄り・途中の要素は残す)。 */
function trimTrailingEmpty<T>(arr: T[], isEmpty: (v: T) => boolean): T[] {
  let end = arr.length;
  while (end > 0) {
    const last = arr[end - 1];
    if (last === undefined || !isEmpty(last)) break;
    end--;
  }
  return arr.slice(0, end);
}

function isVisitEmpty(v: AttendanceVisit): boolean {
  return (
    !isPresent(v.place) &&
    !isPresent(v.start) &&
    !isPresent(v.end) &&
    !isPresent(v.weatherAfter) &&
    !isPresent(v.plannedMoveMin) &&
    !isPresent(v.distanceKm)
  );
}

function isOfficeWorkEmpty(o: AttendanceOfficeWork): boolean {
  return !isPresent(o.name) && !isPresent(o.start) && !isPresent(o.end);
}

function buildVisit(
  place: string | undefined,
  start: string | undefined,
  end: string | undefined,
  weatherAfter: string | undefined,
  plannedMoveMin: number | undefined,
  distanceKm: number | undefined,
): AttendanceVisit {
  const v: AttendanceVisit = {};
  if (isPresent(place)) v.place = place;
  if (isPresent(start)) v.start = start;
  if (isPresent(end)) v.end = end;
  if (isPresent(weatherAfter)) v.weatherAfter = weatherAfter;
  if (isPresent(plannedMoveMin)) v.plannedMoveMin = plannedMoveMin;
  if (isPresent(distanceKm)) v.distanceKm = distanceKm;
  return v;
}

function buildOfficeWork(
  name: string | undefined,
  start: string | undefined,
  end: string | undefined,
): AttendanceOfficeWork {
  const o: AttendanceOfficeWork = {};
  if (isPresent(name)) o.name = name;
  if (isPresent(start)) o.start = start;
  if (isPresent(end)) o.end = end;
  return o;
}

/**
 * 列記号形式(AttendanceColumnRow。GAS版の実データ・attendanceCalc.test.tsの合成データが
 * この形)を、永続形式(AttendanceRowData)へ変換する。GAS版の実データ取り込みや、
 * 計算ロジック(列記号のまま)のテストケースを新形式でも照合するために使う。
 *
 * 配列の各要素が「空かどうか」は isVisitEmpty/isOfficeWorkEmpty で判定し、末尾の空要素だけを
 * 取り除く(先頭・途中の空要素はそのまま残す)。これは toColumnRow が visits[0]/[1]/[2] を
 * 常に固定位置(C/D/E, L/M/N, U/V/W)として書き出すため、「1件目は空だが2件目に値がある」
 * ようなデータは1件目相当の空オブジェクトを残さないと位置がずれてしまうことに対応するため。
 *
 * 往復(fromColumnRow(toColumnRow(x)) === x、toColumnRow(fromColumnRow(y)) === y)がどこまで
 * 成り立つかは columnRow.test.ts で実際に確認している。少なくとも次の2パターンは一致しない
 * ことが分かっている(「成り立つはず」で済ませず、テストで固定した上でここに書く):
 *   - xの訪問/事務作業配列の末尾に空オブジェクト({}等)が含まれる場合
 *     (fromColumnRowでは「空」を「そもそも入力されていない」と区別できないため、
 *     末尾の空要素は復元時に失われる)
 *   - 3件目の訪問にweatherAfter/plannedMoveMin/distanceKmを持たせた場合
 *     (toColumnRowのコメント参照。対応する列がそもそも無い)
 */
export function fromColumnRow(columnRow: AttendanceColumnRow): AttendanceRowData {
  const v0 = buildVisit(
    columnRow.C,
    columnRow.D,
    columnRow.E,
    columnRow.I,
    columnStringToNum(columnRow.H),
    columnStringToNum(columnRow.AG),
  );
  const v1 = buildVisit(
    columnRow.L,
    columnRow.M,
    columnRow.N,
    columnRow.R,
    columnStringToNum(columnRow.Q),
    columnStringToNum(columnRow.AH),
  );
  // 3件目には対応する移動列(H/I/AGに相当するもの)が存在しない(toColumnRow参照)。
  const v2 = buildVisit(columnRow.U, columnRow.V, columnRow.W, undefined, undefined, undefined);
  const visits = trimTrailingEmpty([v0, v1, v2], isVisitEmpty);

  const o0 = buildOfficeWork(columnRow.X, columnRow.Y, columnRow.Z);
  const o1 = buildOfficeWork(columnRow.AA, columnRow.AB, columnRow.AC);
  const officeWork = trimTrailingEmpty([o0, o1], isOfficeWorkEmpty);

  const rowData: AttendanceRowData = {};
  if (visits.length > 0) rowData.visits = visits;
  if (officeWork.length > 0) rowData.officeWork = officeWork;
  const commuteDistanceKm = columnStringToNum(columnRow.AI);
  if (commuteDistanceKm !== undefined) rowData.commuteDistanceKm = commuteDistanceKm;
  const returnDistanceKm = columnStringToNum(columnRow.AJ);
  if (returnDistanceKm !== undefined) rowData.returnDistanceKm = returnDistanceKm;
  const shoppingErrandCount = columnStringToNum(columnRow.AN);
  if (shoppingErrandCount !== undefined) rowData.shoppingErrandCount = shoppingErrandCount;
  if (isPresent(columnRow.AO)) rowData.note = columnRow.AO;

  return rowData;
}
