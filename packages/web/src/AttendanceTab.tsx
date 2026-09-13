import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { AdminTargetStaffSelector, useAdminTargetStaff } from './AdminTargetStaffContext';
import { fetchAttendanceMonth } from './api';
import { AttendanceCalendar } from './attendance/AttendanceCalendar';
import { ReceiptListModal } from './attendance/ReceiptListModal';
import { Button, ButtonRow, EmptyState, ErrorNotice, LoadingBlock, toFriendlyMessage } from './ui';

function currentYearMonth(): string {
  return new Date().toLocaleDateString('sv-SE').slice(0, 7); // 'YYYY-MM'
}

/** 分は暗算が要るので、画面には必ず「◯時間◯分」で出す(保存している値は分のまま)。 */
function formatMinutes(min: number | ''): string {
  if (min === '') return '-';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${h}時間${m}分`;
}

/** 「2026-09-03」→「9月3日(水)」。ハイフン区切りはコンピュータの表記なので画面には出さない。 */
function formatBusinessDate(businessDate: string): string {
  const d = new Date(`${businessDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return businessDate;
  const dow = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
  return `${d.getMonth() + 1}月${d.getDate()}日(${dow})`;
}

/** まとめの1項目。名前を小さく、数を大きく出す。 */
function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card border border-gray-200 p-3">
      <p className="text-sm text-app-muted">{label}</p>
      <p className="text-base font-bold text-app-text">{value}</p>
    </div>
  );
}

/**
 * 「📊 今月のまとめ」モーダル。GAS版のattendanceMonthlyModalと同じ役割。
 *
 * GAS版は7列の表(労働(分)/残業(分)/移動(分)/距離(km)/超過回数…)だったが、スマホでは読めない
 * ため、合計をモーダルの上部に大きく出し、その下に日ごとのカードを並べる形にしている
 * (doc/16_UIUX改善提案_2026-09-03.html「月次集計を表からカードへ」)。
 */
function MonthlyModal({ staffId, onClose }: { staffId?: string; onClose: () => void }) {
  const [yearMonth, setYearMonth] = useState(currentYearMonth());
  const monthQuery = useQuery({
    queryKey: ['attendance-month', yearMonth, staffId],
    queryFn: () => fetchAttendanceMonth(yearMonth, staffId),
  });

  const view = monthQuery.data;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-[110] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-lg rounded-card flex flex-col max-h-[90vh]">
        <div className="p-4 border-b border-gray-200 flex justify-between items-center gap-3">
          <h3 className="font-bold text-app-text text-base">📊 今月のまとめ</h3>
          <Button variant="subtle" size="sub" onClick={onClose}>
            ✕ 閉じる
          </Button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto">
          <div>
            <label className="block text-sm font-bold text-app-text mb-1" htmlFor="monthlyMonth">
              月をえらぶ
            </label>
            <input
              id="monthlyMonth"
              type="month"
              value={yearMonth}
              onChange={(e) => setYearMonth(e.target.value)}
              className="w-full min-h-[48px] px-3 border border-gray-300 rounded-btn text-base"
            />
          </div>

          {monthQuery.isPending && <LoadingBlock text="読み込んでいます…" />}
          {monthQuery.isError && (
            <ErrorNotice text={toFriendlyMessage(monthQuery.error, '月のまとめの読み込み')} />
          )}

          {view && (
            <>
              {/* 合計は一番上に大きく。いちばん知りたいのは「今月どれだけ働いたか」なので、
                  働いた時間だけを別格の大きさで出す。 */}
              <div className="rounded-card border border-app-primary bg-app-primary-bg p-4">
                <p className="text-sm text-app-muted">働いた時間</p>
                <p className="text-3xl font-bold text-app-text">{formatMinutes(view.totals.laborMinutes)}</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <SummaryItem label="残業" value={formatMinutes(view.totals.overtimeMinutes)} />
                <SummaryItem label="移動" value={formatMinutes(view.totals.totalMoveMin)} />
                <SummaryItem label="移動きょり" value={`${view.totals.totalDistanceKm}km`} />
                <SummaryItem label="記録のある日数" value={`${view.days.length}日`} />
                <SummaryItem label="買い物代行をした回数" value={`${view.totals.shoppingErrandTotal}回`} />
                {/* 「基準距離超過回数」が何の基準かを事務局に確認できていないため、仮の言いかた。 */}
                <SummaryItem label="基準のきょりを超えた回数" value={`${view.totals.overThresholdCount}回`} />
              </div>

              <div className="space-y-2">
                <h4 className="text-base font-bold text-app-text">日ごとの記録</h4>
                {view.days.length === 0 ? (
                  <EmptyState
                    icon="📭"
                    title="この月の記録はまだありません"
                    nextStep="「月をえらぶ」で先月を見るか、出勤簿で日にちを押して記録を書いてください"
                  />
                ) : (
                  <ul className="space-y-2">
                    {view.days.map((day) => (
                      <li key={day.businessDate} className="rounded-card border border-gray-200 p-3">
                        <p className="text-base font-bold text-app-text">
                          {formatBusinessDate(day.businessDate)}
                        </p>
                        <p className="text-base text-app-text">
                          働いた時間 {formatMinutes(day.derived.laborMinutes)}
                        </p>
                        <p className="text-sm text-app-muted">
                          残業 {formatMinutes(day.derived.overtimeMinutes)} ／ 移動{' '}
                          {formatMinutes(day.derived.totalMoveMin)} ／ {day.derived.totalDistanceKm}km
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}

          {/* 更新は一番下に灰色で1つ。開いたときに自動で読み込むので目立たせない。 */}
          <Button
            variant="subtle"
            size="sub"
            fullWidth
            disabled={monthQuery.isFetching}
            onClick={() => monthQuery.refetch()}
          >
            {monthQuery.isFetching ? '読み込んでいます…' : '🔄 最新にする'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * 「🕒 出勤簿」タブ。GAS版のtabPastSchedule(週間表示+月のまとめモーダル)と同じ役割。
 * 日々の労働時間・残業・移動距離・基準距離超過回数などの派生値は
 * packages/core/src/domain/attendance/attendanceCalc.ts(GAS版と数値一致を検証済み)で
 * 都度計算した結果を表示する。
 *
 * 管理者は「対象スタッフ」セレクタで他スタッフの出勤簿を閲覧/編集できる
 * (packages/api/src/session.ts resolveAttendanceTargetStaffIdが、管理者以外の指定は
 * 常に無視して本人のstaffIdに強制する。GAS版PastSchedule.jsの対象スタッフセレクタと同じ役割)。
 * 選択はAdminTargetStaffContext経由で予定タブと共有される(GAS版のsharedAdminTargetStaffNameと同じ)。
 */
export function AttendanceTab() {
  const [showMonthly, setShowMonthly] = useState(false);
  // 領収書一覧をこのタブに置いたのは、出勤簿と同じ「自分が月にやったことを後から見て直す」
  // 画面だから(対象スタッフの切り替えも月単位の見方も出勤簿と同じ規則で動く)。
  const [showReceipts, setShowReceipts] = useState(false);
  const { effectiveStaffId } = useAdminTargetStaff();

  return (
    <div>
      <AdminTargetStaffSelector />

      <ButtonRow className="mb-4">
        <Button variant="outline" fullWidth onClick={() => setShowMonthly(true)}>
          📊 今月のまとめ
        </Button>
        <Button variant="outline" fullWidth onClick={() => setShowReceipts(true)}>
          🧾 領収書
        </Button>
      </ButtonRow>

      <AttendanceCalendar staffId={effectiveStaffId} />

      {showMonthly && <MonthlyModal staffId={effectiveStaffId} onClose={() => setShowMonthly(false)} />}
      {showReceipts && <ReceiptListModal staffId={effectiveStaffId} onClose={() => setShowReceipts(false)} />}
    </div>
  );
}
