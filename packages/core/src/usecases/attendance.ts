import { attendanceRowDataSchema } from '@katahimo/shared';
import type {
  AttendanceDayDerived,
  AttendanceMonthlyTotals,
  AttendanceRowData,
  ScheduleEvent,
} from '../domain/attendance';
import {
  buildScheduleEventsFromRowData,
  computeDayDerived,
  computeMonthlyTotals,
  toColumnRow,
} from '../domain/attendance';
import { buildMirrorIdempotencyKey } from '../domain/mirror/idempotencyKey';
import { formatJstDateKey, jstMonthRange } from '../domain/reports/jstTime';
import type { MirrorPort } from '../ports/mirror';
import type {
  AttendanceDayRepositoryPort,
  ReceiptRepositoryPort,
  StaffRepositoryPort,
} from '../ports/repositories';
import type { TransactionScope, UnitOfWorkPort } from '../ports/unitOfWork';

export interface AttendanceDeps {
  attendanceDays: AttendanceDayRepositoryPort;
  /** 出勤簿スプレッドシートへのミラー書き込み要求をoutboxに積む(Phase 5)。 */
  mirror: MirrorPort;
  /**
   * 出勤簿のミラーに加えて「勤怠集計」シートの再計算(`attendance_aggregate`)も積むか
   * (`MIRROR_ATTENDANCE_AGGREGATE`、既定false)。
   *
   * このジョブ1件ごとにGAS側でMapsのルート計算が走るため、保存のたびに無条件で積むと
   * 編集の回数だけMapsを消費する(GAS版は「この日をカレンダーから反映」ボタンと夜間トリガーの
   * 2経路だけで再計算しており、勤怠の保存ごとには走らせていない)。既定で切っておき、
   * 勤怠集計シートを新システム側から更新したい運用に切り替えるときだけ有効にする。
   */
  mirrorAttendanceAggregate: boolean;
  /** 勤怠の保存とミラー要求のenqueueを、1つのトランザクションにまとめるために使う。 */
  unitOfWork: UnitOfWorkPort;
  /**
   * 月次集計に「対象: 氏名 / 年月」の見出しを出すために引く(GAS版getAttendanceMonthの
   * 戻り値staffNameと同じ)。
   */
  staff: StaffRepositoryPort;
  /**
   * 月次集計に含める領収書の日別集計(GAS版getReceiptsForMonth_)のために引く。
   * 領収書は勤怠と同じ「その月に自分がやったこと」の記録で、GAS版では月次集計モーダルの
   * 中に一体で出ている。
   */
  receipts: ReceiptRepositoryPort;
}

export interface AttendanceDayView {
  businessDate: string;
  rowData: AttendanceRowData;
  derived: AttendanceDayDerived;
}

/**
 * 指定スタッフ・指定日の勤怠(出勤簿1日分)を取得する。データが無い日は空のrowData
 * (=すべて未入力)として扱う。派生値(労働時間・残業・移動距離等)は都度計算する。
 */
export async function getAttendanceDay(
  deps: AttendanceDeps,
  tenantId: string,
  staffId: string,
  businessDate: string,
): Promise<AttendanceDayView> {
  const record = await deps.attendanceDays.findByStaffAndDate(tenantId, staffId, businessDate);
  const rowData: AttendanceRowData = record ? record.rowData : {};
  return { businessDate, rowData, derived: computeDayDerived(toColumnRow(rowData)) };
}

/**
 * 検証済みのrowDataを、既に開いているトランザクション(scope)の中で書き、ミラー要求を積む。
 *
 * saveAttendanceDay と、カレンダー反映(usecases/calendarSync.ts)の両方から使う。
 * カレンダー反映は「同じトランザクションの中で読み直してからマージして書く」必要があり
 * (AttendanceDayRepositoryPort.findByStaffAndDateForUpdate 参照)、自前でトランザクションを
 * 開く saveAttendanceDay をそのままは使えない。ミラー要求の積み方をコピーして持たせると
 * 片方だけ直す事故が起きるので、書き込みの中身はここ1か所に置く。
 *
 * 呼び出し側の責任: rowDataは attendanceRowDataSchema で検証済みであること。
 */
export async function writeAttendanceDayInScope(
  deps: AttendanceDeps,
  tenantId: string,
  staffId: string,
  businessDate: string,
  validatedRowData: AttendanceRowData,
  scope: TransactionScope,
): Promise<void> {
  const record = await deps.attendanceDays.upsert(tenantId, staffId, businessDate, validatedRowData, scope);
  await deps.mirror.enqueue(
    {
      tenantId,
      kind: 'attendance_day',
      targetId: record.id,
      idempotencyKey: buildMirrorIdempotencyKey('attendance_day', record.id, record.updatedAt),
    },
    scope,
  );
  // 勤怠集計シートの再計算は別のジョブとして積む(冪等キーもkind込みで別になるため、
  // 出勤簿のミラーと取り違えて片方が捨てられることはない)。出勤簿への書き込みが先に
  // 済んでいる必要はない: GAS側の勤怠集計の書き込みは個別出勤簿に触らないため、
  // どちらが先に処理されても結果は変わらない。
  if (deps.mirrorAttendanceAggregate) {
    await deps.mirror.enqueue(
      {
        tenantId,
        kind: 'attendance_aggregate',
        targetId: record.id,
        idempotencyKey: buildMirrorIdempotencyKey('attendance_aggregate', record.id, record.updatedAt),
      },
      scope,
    );
  }
}

/**
 * 指定スタッフ・指定日の入力列(rowData)を丸ごと保存する。数式に相当する派生値は
 * AttendanceRowDataに存在しないため、呼び出し側が派生値を書き込むことは型上できない。
 *
 * 保存前に attendanceRowDataSchema で検証する。API層(packages/api/src/routes/attendance.ts)も
 * 同じスキーマで検証しているが、usecaseはAPIを経由しない呼び出し(シード投入・将来のバッチ等)
 * からも呼ばれ得るため、ここでも独立に検証しておく(doc/14 §2: 「アプリ境界でZodにより検証する」)。
 */
export async function saveAttendanceDay(
  deps: AttendanceDeps,
  tenantId: string,
  staffId: string,
  businessDate: string,
  rowData: AttendanceRowData,
): Promise<AttendanceDayView> {
  const validatedRowData = attendanceRowDataSchema.parse(rowData);
  // toColumnRow()はMAX_VISITS/MAX_OFFICE_WORK超過で例外を投げる(API層で先に弾いているはずだが、
  // usecaseを直接呼ぶ経路もあるための防御)。unitOfWork.runの後(return文)で呼んでいると、
  // 勤怠行とoutboxジョブが既にコミットされたあとで例外が飛んでしまい、呼び出し側が
  // リトライすると updatedAt が変わって別の冪等キーでジョブがもう1件積まれる
  // (トランザクションの中身は正しいのに、外側だけ失敗した状態になる)。トランザクションの
  // 外・書き込みより前に呼ぶことで、失敗するなら何も書き込まれない状態で失敗させる。
  const columnRow = toColumnRow(validatedRowData);
  await deps.unitOfWork.run(tenantId, (scope) =>
    writeAttendanceDayInScope(deps, tenantId, staffId, businessDate, validatedRowData, scope),
  );
  return {
    businessDate,
    rowData: validatedRowData,
    derived: computeDayDerived(columnRow),
  };
}

/** 月次集計に埋め込む領収書の1日分(GAS版 receipts.byDay の1エントリ)。 */
export interface AttendanceMonthReceiptDay {
  /** 'YYYY-MM-DD'(JST)。領収書の日時(OCRが読んだ日付、読めなければ登録時刻)の日付部分。 */
  date: string;
  amountYen: number;
}

export interface AttendanceMonthReceipts {
  /** 日付昇順。金額の入っていない日は現れない。 */
  byDay: AttendanceMonthReceiptDay[];
  /** 領収書月集計(円)。取り消し済みと、金額を数値化できなかった分は入らない。 */
  totalYen: number;
  /**
   * 金額を数値にできていない領収書の件数(取り消し済みを除く)。合計は「読めた分だけ」なので、
   * 何件が合計から漏れているかを画面に出せるようにする(GAS版には無い。GAS版は
   * `Number(row[4]) || 0` で黙って0円として合計していた)。
   */
  unreadableAmountCount: number;
  /** 取り消し済みの件数(合計には入らない)。 */
  cancelledCount: number;
}

export interface AttendanceMonthView {
  yearMonth: string;
  /** 対象スタッフの氏名。月次集計の見出し「対象: 氏名 / 年月」に使う。 */
  staffName: string;
  /**
   * その月の全日(1日〜末日)。記録が無い日も空のrowData・0の派生値で並ぶ
   * (GAS版getAttendanceMonthと同じ。スプレッドシートの日付一覧をそのまま見るのと同じ情報量にする)。
   */
  days: AttendanceDayView[];
  totals: AttendanceMonthlyTotals;
  receipts: AttendanceMonthReceipts;
}

/** 'YYYY-MM' の日数。 */
function daysInMonth(yearMonth: string): number {
  const [year, month] = yearMonth.split('-').map(Number);
  // Date.UTCのday=0はその月の最終日。month(1始まり)をそのまま渡すと翌月の0日=当月末日になる。
  return new Date(Date.UTC(year ?? 1970, month ?? 1, 0)).getUTCDate();
}

/**
 * 指定スタッフ・指定月の領収書を日別に集計する(GAS版 getReceiptsForMonth_ 相当)。
 *
 * GAS版との違いは2点だけで、どちらも新システム側にしか無い概念に合わせたもの:
 *   - 取り消し済み(cancelled_at)の領収書は合計にも日別にも入れない。
 *   - 金額を数値化できなかった領収書を0円として黙って足さず、件数として別に返す。
 */
async function aggregateReceiptsForMonth(
  deps: AttendanceDeps,
  tenantId: string,
  staffId: string,
  yearMonth: string,
): Promise<AttendanceMonthReceipts> {
  const range = jstMonthRange(yearMonth);
  if (!range) return { byDay: [], totalYen: 0, unreadableAmountCount: 0, cancelledCount: 0 };

  const records = await deps.receipts.listByStaffInPeriod(tenantId, staffId, range.from, range.to);

  const amountByDate = new Map<string, number>();
  let totalYen = 0;
  let unreadableAmountCount = 0;
  let cancelledCount = 0;

  for (const record of records) {
    if (record.cancelledAt !== null) {
      cancelledCount++;
      continue;
    }
    if (record.amountYen === null) {
      unreadableAmountCount++;
      continue;
    }
    const dateKey = formatJstDateKey(record.receiptTimestamp);
    amountByDate.set(dateKey, (amountByDate.get(dateKey) ?? 0) + record.amountYen);
    totalYen += record.amountYen;
  }

  const byDay = Array.from(amountByDate, ([date, amountYen]) => ({ date, amountYen })).sort((a, b) =>
    a.date.localeCompare(b.date),
  );

  return { byDay, totalYen, unreadableAmountCount, cancelledCount };
}

/**
 * 指定スタッフの指定月('YYYY-MM')の勤怠を集計する。
 *
 * daysはその月の全日を1日〜末日まで並べる(記録が無い日は空のrowData)。GAS版
 * getAttendanceMonthが出勤簿シートの日付行をそのまま全日ぶん返しているのに合わせたもので、
 * 「スプレッドシートの日付一覧を見ているのと同じ情報量」を画面に出せるようにするため。
 * 記録のある日だけを返すと、画面側で月の日付を組み立て直すことになり、末日の判定が
 * サーバーとクライアントに二重に散る。
 */
export async function getAttendanceMonth(
  deps: AttendanceDeps,
  tenantId: string,
  staffId: string,
  yearMonth: string,
): Promise<AttendanceMonthView> {
  const [staffRecord, records, receipts] = await Promise.all([
    deps.staff.findById(tenantId, staffId),
    deps.attendanceDays.listByStaffAndMonth(tenantId, staffId, yearMonth),
    aggregateReceiptsForMonth(deps, tenantId, staffId, yearMonth),
  ]);

  const rowDataByDate = new Map(records.map((r) => [r.businessDate, r.rowData]));
  const days: AttendanceDayView[] = [];
  for (let day = 1; day <= daysInMonth(yearMonth); day++) {
    const businessDate = `${yearMonth}-${String(day).padStart(2, '0')}`;
    const rowData = rowDataByDate.get(businessDate) ?? {};
    days.push({ businessDate, rowData, derived: computeDayDerived(toColumnRow(rowData)) });
  }

  // computeMonthlyTotalsはattendanceCalc.ts側の内部実装(列記号のAttendanceColumnRow)を
  // そのまま受け取るので、ここでもtoColumnRow()を通す(表示用のAttendanceMonthView.days自体は
  // 永続形式のrowDataを保つ。列記号への変換はcomputeMonthlyTotalsに渡す直前だけ)。
  const totals = computeMonthlyTotals(
    days.map((d) => ({ rowData: toColumnRow(d.rowData), derived: d.derived })),
  );

  return { yearMonth, staffName: staffRecord?.name ?? '', days, totals, receipts };
}

/**
 * 指定スタッフの指定期間('YYYY-MM-DD'両端含む)の勤怠を、週間予定UI表示用のイベント配列に変換する。
 *
 * GAS版の週間予定タブと同じく、実際のGoogleカレンダーからではなく出勤簿(attendance_days)の
 * 記録内容をそのままイベント化して返す(閲覧専用。カレンダー連携Phase 5が無くても動く)。
 */
export async function getAttendanceScheduleEvents(
  deps: AttendanceDeps,
  tenantId: string,
  staffId: string,
  startDate: string,
  endDate: string,
): Promise<ScheduleEvent[]> {
  const records = await deps.attendanceDays.listByStaffAndDateRange(tenantId, staffId, startDate, endDate);

  return records.flatMap((r) => buildScheduleEventsFromRowData(r.businessDate, r.rowData));
}
