import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CalendarSyncChange } from '../api';
import { applyCalendarSync, previewCalendarSync } from '../api';

/**
 * 「📅 カレンダーから反映」の差分確認モーダル。GAS版index.htmlのcalendarSyncDiffModal /
 * syncOneDayFromCalendar と同じ流れ(まず差分を出し、確認してから書き込む)。
 *
 * 出勤簿の内容と違う項目だけを並べ、「取り込む」を押すと**サーバー側で計算し直した**内容が
 * 書き込まれる(この画面に出ている差分をそのまま送り返すわけではない)。確認している間に
 * カレンダーや出勤簿が変わっていれば、その最新の状態が反映される。
 */
function ChangeRow({ change }: { change: CalendarSyncChange }) {
  return (
    <div className="border-b border-gray-100 py-1.5 text-xs">
      <div className="font-bold text-gray-700">{change.label}</div>
      <div className="flex items-center gap-1 flex-wrap">
        <span className="line-through text-gray-400">{change.oldValue || '(空欄)'}</span>
        <span className="text-gray-400">→</span>
        <span className="text-blue-700 font-bold">{change.newValue || '(空欄)'}</span>
      </div>
    </div>
  );
}

export function CalendarSyncDiffModal({
  date,
  staffId,
  onClose,
}: {
  date: string;
  staffId?: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();

  const previewQuery = useQuery({
    queryKey: ['calendar-sync-preview', date, staffId],
    queryFn: () => previewCalendarSync(date, staffId),
    // 差分は「いま押した時点」の確認なので、開き直したら必ず取り直す。
    gcTime: 0,
    staleTime: 0,
    retry: false,
  });

  const applyMutation = useMutation({
    mutationFn: () => applyCalendarSync(date, staffId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendance-day'] });
      queryClient.invalidateQueries({ queryKey: ['attendance-week'] });
      queryClient.invalidateQueries({ queryKey: ['attendance-month'] });
      onClose();
    },
  });

  const preview = previewQuery.data;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-[115] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-sm rounded-xl shadow-xl flex flex-col max-h-[85vh]">
        <div className="p-4 border-b flex justify-between items-center bg-gray-50 rounded-t-xl">
          <h3 className="font-bold text-gray-800 text-sm">カレンダーの内容を確認</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-2 hover:bg-gray-200 rounded-full text-gray-500"
          >
            &times;
          </button>
        </div>

        <div className="p-4 overflow-y-auto">
          <p className="text-xs text-gray-500 mb-2">
            出勤簿の内容と異なる項目です。取り込むと、以下の項目だけが上書きされます(それ以外の項目は
            変更されません)。
          </p>

          {previewQuery.isPending && (
            <div className="flex justify-center py-6">
              <div className="w-6 h-6 rounded-full border-4 border-gray-200 loading-spinner" />
            </div>
          )}
          {previewQuery.isError && (
            <p className="text-red-500 text-sm py-4">{(previewQuery.error as Error).message}</p>
          )}

          {preview && (
            <>
              <div className="text-[11px] text-gray-400 mb-2">
                {date} / {preview.staffName} — カレンダーの予定: {preview.appointmentCount}件 / 変更点:{' '}
                {preview.changes.length}件
              </div>
              {preview.hasChanges ? (
                preview.changes.map((change) => <ChangeRow key={change.column} change={change} />)
              ) : (
                <p className="text-sm text-gray-500 py-4">
                  カレンダーの予定({preview.appointmentCount}件)と出勤簿の内容は一致しています(変更なし)。
                </p>
              )}
            </>
          )}
          {applyMutation.isError && (
            <p className="text-red-500 text-xs mt-2">{(applyMutation.error as Error).message}</p>
          )}
        </div>

        <div className="p-4 border-t bg-gray-50 rounded-b-xl flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2 bg-gray-200 text-gray-700 text-sm font-bold rounded-lg hover:bg-gray-300"
          >
            閉じる
          </button>
          <button
            type="button"
            onClick={() => applyMutation.mutate()}
            disabled={!preview?.hasChanges || applyMutation.isPending}
            className="flex-1 py-2 bg-emerald-600 text-white text-sm font-bold rounded-lg hover:bg-emerald-700 disabled:opacity-50"
          >
            {applyMutation.isPending ? '取り込み中...' : '取り込む'}
          </button>
        </div>
      </div>
    </div>
  );
}
