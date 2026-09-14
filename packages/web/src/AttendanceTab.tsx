import { useState } from 'react';
import { AdminTargetStaffSelector, useAdminTargetStaff } from './AdminTargetStaffContext';
import { AttendanceCalendar } from './attendance/AttendanceCalendar';
import { CalendarSyncRangeModal } from './attendance/CalendarSyncRangeModal';
import { MonthlySummaryModal } from './attendance/MonthlySummaryModal';

/**
 * 「勤怠」タブ。GAS版のtabPastSchedule(Googleカレンダー週間表示風UI+月次集計モーダル+
 * 一括反映)と同じ見た目・操作感にしている(移行時の混乱を減らすため)。日々の労働時間・
 * 残業・移動距離・基準距離超過回数などの派生値は
 * packages/core/src/domain/attendance/attendanceCalc.ts(GAS版と数値一致を検証済み)で
 * 都度計算した結果を表示する。
 *
 * 領収書はGAS版と同じく月次集計モーダルの中(日別集計+領収書月集計)に置いている。
 * 明細(画像・取消)もそこから開く。勤怠と領収書は「その月に自分がやったこと」を
 * 後から見て直す同じ作業なので、別々のボタンに分けると突き合わせができない。
 *
 * 管理者は「対象スタッフ」セレクタで他スタッフの勤怠を閲覧/編集できる
 * (packages/api/src/session.ts resolveAttendanceTargetStaffIdが、管理者以外の指定は
 * 常に無視して本人のstaffIdに強制する。GAS版PastSchedule.jsの対象スタッフセレクタと同じ役割)。
 * 選択はAdminTargetStaffContext経由で予定タブと共有される(GAS版のsharedAdminTargetStaffNameと同じ)。
 */
export function AttendanceTab() {
  const [showMonthly, setShowMonthly] = useState(false);
  const [showRangeSync, setShowRangeSync] = useState(false);
  /** 月次集計の日付行をタップしたときに、背後のカレンダーで開く日。 */
  const [jumpToDate, setJumpToDate] = useState<string | null>(null);
  const { isAdmin, effectiveStaffId } = useAdminTargetStaff();

  return (
    <div>
      <AdminTargetStaffSelector />

      <div className="flex gap-2 mb-4">
        <button
          type="button"
          onClick={() => setShowMonthly(true)}
          className="flex-1 py-2 rounded-xl text-sm font-bold border border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100 transition-colors"
        >
          📊 月次集計
        </button>
        {/* 一括反映は管理者だけ。押せてしまっても
            resolveAttendanceTargetStaffIdが常に本人へ強制するので他人の勤怠は動かないが、
            GAS版と同じくボタン自体を出さない。 */}
        {isAdmin && (
          <button
            type="button"
            onClick={() => setShowRangeSync(true)}
            className="flex-1 py-2 rounded-xl text-sm font-bold border border-emerald-200 text-emerald-700 hover:bg-emerald-50 transition-colors"
          >
            📅 一括反映(管理者用)
          </button>
        )}
      </div>

      <AttendanceCalendar
        staffId={effectiveStaffId}
        jumpToDate={jumpToDate}
        onJumpHandled={() => setJumpToDate(null)}
      />

      {showMonthly && (
        <MonthlySummaryModal
          staffId={effectiveStaffId}
          onClose={() => setShowMonthly(false)}
          onDayClick={(businessDate) => setJumpToDate(businessDate)}
        />
      )}
      {showRangeSync && <CalendarSyncRangeModal onClose={() => setShowRangeSync(false)} />}
    </div>
  );
}
