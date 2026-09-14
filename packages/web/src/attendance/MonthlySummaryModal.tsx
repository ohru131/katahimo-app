import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { AttendanceDayView, AttendanceMonthView } from '../api';
import { fetchAttendanceMonth } from '../api';
import { ReceiptListPanel } from './ReceiptListPanel';

/**
 * 「📊 月次集計(勤怠・領収書)」モーダル。GAS版index.htmlのattendanceMonthlyModal /
 * renderAttendanceMonthlyと同じ情報量・同じ並びにしている。
 *
 * GAS版はスプレッドシートの出勤簿を1か月ぶんそのまま表に出しており、下に領収書の日別集計と
 * 「領収書月集計」が続く。移行の判断材料になるのはこの「1画面で月が見渡せる」ことなので、
 * 合計値だけの要約ではなく日付一覧をそのまま再現している。
 *
 * 領収書を独立したモーダルではなくここに含めているのも同じ理由(GAS版と同じ位置)。
 * 明細(画像・取消)は同じモーダルの中で開閉する(ReceiptListPanel)。
 */

function currentYearMonth(): string {
  return new Date().toLocaleDateString('sv-SE').slice(0, 7); // 'YYYY-MM'
}

function formatYen(value: number): string {
  return `${value.toLocaleString('ja-JP')}円`;
}

/** 取得時刻を「更新: HH:mm」で出す(GAS版formatAttendanceMonthlyUpdatedAt_と同じ)。 */
function formatUpdatedAt(ts: number | undefined): string {
  if (!ts) return '';
  const t = new Date(ts);
  return `更新: ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
}

/**
 * 「訪問先等」列。GAS版は列C/L/U/X/AA(訪問1〜3・事務作業1〜2の名称)を空でないものだけ
 * '・'でつないでいた。配列化後も同じ順・同じ区切りにする。
 */
function visitNames(day: AttendanceDayView): string {
  const { visits = [], officeWork = [] } = day.rowData;
  return [visits[0]?.place, visits[1]?.place, visits[2]?.place, officeWork[0]?.name, officeWork[1]?.name]
    .filter((name): name is string => !!name)
    .join('・');
}

function AttendanceDayTable({
  month,
  onDayClick,
}: {
  month: AttendanceMonthView;
  onDayClick?: (businessDate: string) => void;
}) {
  const t = month.totals;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-gray-500 border-b border-gray-200">
            <th className="text-left py-1 pr-2">日</th>
            <th className="text-left py-1 pr-2">訪問先等</th>
            <th className="text-right py-1 pr-2">労働(分)</th>
            <th className="text-right py-1 pr-2">残業(分)</th>
            <th className="text-right py-1 pr-2">移動(分)</th>
            <th className="text-right py-1 pr-2">距離(km)</th>
            <th className="text-right py-1">超過回数</th>
          </tr>
        </thead>
        <tbody>
          {month.days.map((day) => {
            const names = visitNames(day);
            return (
              <tr
                key={day.businessDate}
                onClick={onDayClick ? () => onDayClick(day.businessDate) : undefined}
                className={`border-b border-gray-100 ${
                  onDayClick ? 'cursor-pointer hover:bg-blue-50' : ''
                } ${names ? '' : 'text-gray-400'}`}
              >
                {/* GAS版と同じく月を落として MM-DD だけ出す(対象月は見出しに出ている)。 */}
                <td className="py-1 pr-2 whitespace-nowrap">{day.businessDate.slice(5)}</td>
                <td className="py-1 pr-2 truncate max-w-[110px]" title={names}>
                  {names}
                </td>
                <td className="py-1 pr-2 text-right">{day.derived.laborMinutes}</td>
                <td className="py-1 pr-2 text-right">{day.derived.overtimeMinutes}</td>
                <td className="py-1 pr-2 text-right">{day.derived.totalMoveMin}</td>
                <td className="py-1 pr-2 text-right">{day.derived.totalDistanceKm}</td>
                <td className="py-1 text-right">{day.derived.overThresholdCount}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="font-bold border-t-2 border-gray-300">
            <td className="py-1 pr-2" colSpan={2}>
              合計
            </td>
            <td className="py-1 pr-2 text-right">{t.laborMinutes}</td>
            <td className="py-1 pr-2 text-right">{t.overtimeMinutes}</td>
            <td className="py-1 pr-2 text-right">{t.totalMoveMin}</td>
            <td className="py-1 pr-2 text-right">{t.totalDistanceKm}</td>
            <td className="py-1 text-right">{t.overThresholdCount}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/**
 * 合計行に出していない月合計。GAS版はこれらを画面に出していないが、区間別の距離や
 * 訪問回数・買物代行は給与計算の内訳なので、表の下にたたんで出しておく
 * (合計行の列を増やすとスマホで横に溢れるため、別枠にしている)。
 */
function MonthlyBreakdown({ month }: { month: AttendanceMonthView }) {
  const t = month.totals;
  const rows: [string, string][] = [
    ['出勤距離', `${t.attendanceDistanceKmTotal}km`],
    ['#1→#2移動距離', `${t.leg1DistanceKmTotal}km`],
    ['#2→#3移動距離', `${t.leg2DistanceKmTotal}km`],
    ['退勤距離', `${t.leavingDistanceKmTotal}km`],
    ['訪問回数', `${t.visitCountTotal}`],
    ['買物代行', `${t.shoppingErrandTotal}`],
  ];

  return (
    <details className="mt-2">
      <summary className="text-[11px] text-blue-600 cursor-pointer">距離・回数の内訳を見る</summary>
      <table className="w-full text-xs mt-1">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label} className="border-b border-gray-100">
              <td className="py-1 pr-2 text-gray-500">{label}</td>
              <td className="py-1 text-right">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

/**
 * 領収書の日別集計と「領収書月集計」。GAS版renderAttendanceMonthlyの領収書セクションと同じ。
 * 「明細を開く」で同じモーダルの中に一覧(画像・取消)を展開する。
 */
function ReceiptSection({
  month,
  staffId,
  yearMonth,
}: {
  month: AttendanceMonthView;
  staffId?: string;
  yearMonth: string;
}) {
  const [showDetail, setShowDetail] = useState(false);
  const { byDay, totalYen, unreadableAmountCount, cancelledCount } = month.receipts;

  return (
    <div className="mt-3 border-t pt-2">
      <div className="flex items-center justify-between mb-1">
        <div className="font-bold text-gray-700 text-sm">領収書</div>
        <button
          type="button"
          onClick={() => setShowDetail((v) => !v)}
          className="text-[11px] text-blue-600 underline"
        >
          {showDetail ? '明細を閉じる' : '明細を開く(画像・取消)'}
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <tbody>
            {byDay.length === 0 ? (
              <tr>
                <td colSpan={2} className="text-center text-gray-400 py-2">
                  登録なし
                </td>
              </tr>
            ) : (
              byDay.map((row) => (
                <tr key={row.date} className="border-b border-gray-100">
                  <td className="py-1 pr-2">{row.date}</td>
                  <td className="py-1 text-right">{formatYen(row.amountYen)}</td>
                </tr>
              ))
            )}
          </tbody>
          <tfoot>
            <tr className="font-bold border-t border-gray-300">
              <td className="py-1">領収書月集計</td>
              <td className="py-1 text-right">{formatYen(totalYen)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* 合計は「金額を読めた分」だけ。何件が合計から漏れているかを出しておかないと、
          締めのときに実額とのズレに気付けない(GAS版は読めない金額を0円として黙って
          足しており、この件数は出していなかった)。 */}
      {unreadableAmountCount > 0 && (
        <p className="text-[11px] text-red-600 mt-1">
          金額を読み取れなかった領収書が {unreadableAmountCount}枚あります(合計に含まれていません)
        </p>
      )}
      {cancelledCount > 0 && (
        <p className="text-[11px] text-gray-500 mt-1">取消済み {cancelledCount}枚(合計には入りません)</p>
      )}

      {showDetail && (
        <div className="mt-2 border-t pt-2">
          <ReceiptListPanel staffId={staffId} yearMonth={yearMonth} />
        </div>
      )}
    </div>
  );
}

export function MonthlySummaryModal({
  staffId,
  onClose,
  onDayClick,
}: {
  staffId?: string;
  onClose: () => void;
  /** 日付行をタップしたとき。カレンダーをその日の1日表示に切り替える。 */
  onDayClick?: (businessDate: string) => void;
}) {
  const [yearMonth, setYearMonth] = useState(currentYearMonth());
  const monthQuery = useQuery({
    queryKey: ['attendance-month', yearMonth, staffId],
    queryFn: () => fetchAttendanceMonth(yearMonth, staffId),
  });

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-[110] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-lg rounded-xl shadow-xl flex flex-col max-h-[90vh]">
        <div className="p-4 border-b flex justify-between items-center bg-gray-50 rounded-t-xl">
          <h3 className="font-bold text-gray-800 text-sm">📊 月次集計(勤怠・領収書)</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-2 hover:bg-gray-200 rounded-full text-gray-500"
          >
            &times;
          </button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto">
          <div className="flex items-end gap-2">
            <div className="flex-grow">
              <label className="block text-xs font-bold text-gray-600 mb-1" htmlFor="monthlyMonth">
                対象月
              </label>
              <input
                id="monthlyMonth"
                type="month"
                value={yearMonth}
                onChange={(e) => setYearMonth(e.target.value)}
                className="w-full p-2 border border-gray-300 rounded text-sm"
              />
            </div>
            <button
              type="button"
              onClick={() => monthQuery.refetch()}
              disabled={monthQuery.isFetching}
              title="最新の内容を再読込"
              className="px-3 py-2 rounded border border-gray-300 text-sm hover:bg-gray-100 disabled:opacity-50"
            >
              🔄
            </button>
          </div>
          <div className="text-[10px] text-gray-400">{formatUpdatedAt(monthQuery.dataUpdatedAt)}</div>

          {monthQuery.isPending && (
            <div className="flex justify-center py-6">
              <div className="w-8 h-8 rounded-full border-4 border-gray-200 loading-spinner" />
            </div>
          )}
          {monthQuery.isError && (
            <p className="text-center text-red-500 text-sm py-6">
              取得に失敗しました: {(monthQuery.error as Error).message}
            </p>
          )}

          {monthQuery.data && (
            <>
              <div className="text-xs text-gray-500 mb-2">
                対象: {monthQuery.data.staffName || '(不明)'} / {monthQuery.data.yearMonth}
              </div>
              <AttendanceDayTable month={monthQuery.data} onDayClick={onDayClick} />
              <MonthlyBreakdown month={monthQuery.data} />
              <ReceiptSection month={monthQuery.data} staffId={staffId} yearMonth={yearMonth} />
            </>
          )}
        </div>

        <div className="p-4 border-t bg-gray-50 rounded-b-xl text-right">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-gray-600 text-white text-sm rounded-lg hover:bg-gray-700"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
