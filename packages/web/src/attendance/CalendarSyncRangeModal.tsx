import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useAdminTargetStaff } from '../AdminTargetStaffContext';
import { applyCalendarSync } from '../api';

/**
 * 「📅 一括反映(管理者用)」モーダル。GAS版index.htmlのcalendarSyncModal /
 * runCalendarSyncQueue と同じ作りにしている。
 *
 * 期間×スタッフのぶんだけ `POST /api/attendance/calendar-sync/apply` を**1件ずつ順に**呼ぶ。
 * まとめて処理するエンドポイントにしないのは、1件ごとにGoogle Mapsのルート計算が走り、
 * 期間が長いと1リクエストがタイムアウトするため。1件ずつなら途中まで反映された分は残り、
 * 失敗した組み合わせだけを「失敗分のみ再実行」で流し直せる。
 *
 * 個別の日の反映(CalendarSyncDiffModal)と違い、差分確認は挟まず即時反映する
 * (GAS版と同じ。日数×人数ぶんの確認は現実的に押せないため)。修正可能期限の制限も無い。
 */

interface SyncTarget {
  date: string;
  staffId: string;
  staffName: string;
}

interface FailedTarget extends SyncTarget {
  error: string;
}

function todayKey(): string {
  return new Date().toLocaleDateString('sv-SE'); // 'YYYY-MM-DD'
}

/** 開始日〜終了日(両端含む)× スタッフ を、GAS版と同じ「日ごと×全スタッフ」の順に展開する。 */
function buildTargets(
  startDate: string,
  endDate: string,
  staffList: { id: string; name: string }[],
): SyncTarget[] {
  const targets: SyncTarget[] = [];
  const cursor = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  while (cursor.getTime() <= end.getTime()) {
    const date = cursor.toLocaleDateString('sv-SE');
    for (const staff of staffList) targets.push({ date, staffId: staff.id, staffName: staff.name });
    cursor.setDate(cursor.getDate() + 1);
  }
  return targets;
}

interface Progress {
  completed: number;
  total: number;
  succeeded: number;
  failed: number;
  appointmentCount: number;
  changedCount: number;
  current: string;
}

export function CalendarSyncRangeModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const { staffList } = useAdminTargetStaff();

  const [startDate, setStartDate] = useState(todayKey);
  const [endDate, setEndDate] = useState(todayKey);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [failedTargets, setFailedTargets] = useState<FailedTarget[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  // 実行中にモーダルを閉じられても処理は続く(GAS版と同じ)。アンマウント後にsetStateを
  // 呼ばないよう、生きているかどうかだけ見る。
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // 初期状態は全員チェックON(GAS版と同じ)。一覧の取得が後から終わる場合にも追従する。
  useEffect(() => {
    setChecked((prev) => {
      const next = { ...prev };
      let added = false;
      for (const staff of staffList) {
        if (next[staff.id] === undefined) {
          next[staff.id] = true;
          added = true;
        }
      }
      return added ? next : prev;
    });
  }, [staffList]);

  const selectedStaff = staffList.filter((s) => checked[s.id]);

  async function runQueue(targets: SyncTarget[], label: string) {
    setRunning(true);
    setMessage(null);
    const summary: Progress = {
      completed: 0,
      total: targets.length,
      succeeded: 0,
      failed: 0,
      appointmentCount: 0,
      changedCount: 0,
      current: '',
    };
    const failures: FailedTarget[] = [];

    for (const target of targets) {
      if (mounted.current) {
        setProgress({ ...summary, current: `実行中: ${target.date} / ${target.staffName}` });
      }
      try {
        const result = await applyCalendarSync(target.date, target.staffId);
        summary.succeeded++;
        summary.appointmentCount += result.appointmentCount;
        summary.changedCount += result.changedCount;
      } catch (e) {
        summary.failed++;
        failures.push({ ...target, error: (e as Error).message });
      }
      summary.completed++;
      if (mounted.current) {
        setProgress({ ...summary, current: `完了: ${target.date} / ${target.staffName}` });
      }
    }

    // 反映した日の勤怠は全て変わりうるので、勤怠系のキャッシュをまとめて捨てる。
    queryClient.invalidateQueries({ queryKey: ['attendance-day'] });
    queryClient.invalidateQueries({ queryKey: ['attendance-week'] });
    queryClient.invalidateQueries({ queryKey: ['attendance-month'] });

    if (!mounted.current) return;
    setRunning(false);
    setFailedTargets(failures);
    // GAS版は結果をトーストで出してからモーダルを自動で閉じていたが、この画面にはトーストが
    // 無い。自動で閉じると「何件反映されたのか」がどこにも残らないので、結果を出したまま
    // 開いておき、閉じるのは利用者に任せる。
    setMessage(
      `${label}: 成功${summary.succeeded}件 / 失敗${summary.failed}件 / ` +
        `予定${summary.appointmentCount}件 / 変更${summary.changedCount}項目`,
    );
  }

  function handleRun() {
    if (!startDate || !endDate) {
      setMessage('開始日と終了日を指定してください');
      return;
    }
    if (startDate > endDate) {
      setMessage('終了日は開始日以降にしてください');
      return;
    }
    if (selectedStaff.length === 0) {
      setMessage('更新対象スタッフを1名以上チェックしてください');
      return;
    }
    void runQueue(buildTargets(startDate, endDate, selectedStaff), '反映完了');
  }

  function handleRetry() {
    if (running || failedTargets.length === 0) return;
    void runQueue(
      failedTargets.map((f) => ({ date: f.date, staffId: f.staffId, staffName: f.staffName })),
      '再実行完了',
    );
  }

  const percent =
    progress && progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-[110] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-sm rounded-xl shadow-xl flex flex-col max-h-[85vh]">
        <div className="p-4 border-b flex justify-between items-center bg-gray-50 rounded-t-xl">
          <h3 className="font-bold text-gray-800 text-sm">カレンダー反映の対象を選択</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-2 hover:bg-gray-200 rounded-full text-gray-500"
          >
            &times;
          </button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto">
          <p className="text-xs text-gray-500">
            開始日と終了日を指定して、チェックしたスタッフ分を一括更新できます。修正可能期限の制限は
            ありません。カレンダーに無い手入力の予定は、時間帯が重ならない限り消えません。
          </p>

          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-xs font-bold text-gray-600 mb-1" htmlFor="calendarSyncStartDate">
                開始日
              </label>
              <input
                id="calendarSyncStartDate"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full p-2 border border-gray-300 rounded text-sm"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-bold text-gray-600 mb-1" htmlFor="calendarSyncEndDate">
                終了日
              </label>
              <input
                id="calendarSyncEndDate"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full p-2 border border-gray-300 rounded text-sm"
              />
            </div>
          </div>

          <div>
            <div className="flex justify-between items-center mb-1">
              <span className="block text-xs font-bold text-gray-600">対象スタッフ(チェックONのみ更新)</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setChecked(Object.fromEntries(staffList.map((s) => [s.id, true])))}
                  className="text-[11px] text-blue-600 underline"
                >
                  全選択
                </button>
                <button
                  type="button"
                  onClick={() => setChecked(Object.fromEntries(staffList.map((s) => [s.id, false])))}
                  className="text-[11px] text-blue-600 underline"
                >
                  全解除
                </button>
              </div>
            </div>
            <div className="border border-gray-200 rounded-lg p-2 max-h-40 overflow-y-auto space-y-1">
              {staffList.length === 0 && <p className="text-xs text-gray-400">スタッフを読み込み中...</p>}
              {staffList.map((staff) => (
                <label key={staff.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={!!checked[staff.id]}
                    onChange={(e) => setChecked((prev) => ({ ...prev, [staff.id]: e.target.checked }))}
                  />
                  <span>{staff.name}</span>
                </label>
              ))}
            </div>
          </div>

          {progress && (
            <div>
              <p className="text-xs font-bold text-gray-600 mb-1">処理進捗</p>
              <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-2 bg-emerald-500" style={{ width: `${percent}%` }} />
              </div>
              <div className="text-[11px] text-gray-500 mt-1">
                完了 {progress.completed}/{progress.total} (成功{progress.succeeded} / 失敗
                {progress.failed})
              </div>
              <div className="text-[11px] text-gray-400">{progress.current}</div>
            </div>
          )}

          {message && (
            <p className={`text-xs ${failedTargets.length > 0 ? 'text-red-600' : 'text-gray-600'}`}>
              {message}
            </p>
          )}

          {/* 失敗した組み合わせは理由まで出す。「どの日の誰が落ちたのか」が分からないと、
              再実行しても同じところで止まっていることに気付けない。 */}
          {failedTargets.length > 0 && (
            <ul className="text-[11px] text-red-600 space-y-0.5 max-h-32 overflow-y-auto">
              {failedTargets.map((f) => (
                <li key={`${f.date}_${f.staffId}`}>
                  {f.date} / {f.staffName} — {f.error}
                </li>
              ))}
            </ul>
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
            onClick={handleRetry}
            disabled={running || failedTargets.length === 0}
            className="flex-1 py-2 bg-amber-100 text-amber-700 text-sm font-bold rounded-lg hover:bg-amber-200 disabled:opacity-50"
          >
            失敗分のみ再実行
          </button>
          <button
            type="button"
            onClick={handleRun}
            disabled={running}
            className="flex-1 py-2 bg-emerald-600 text-white text-sm font-bold rounded-lg hover:bg-emerald-700 disabled:opacity-50"
          >
            {running ? '反映中...' : '反映を実行'}
          </button>
        </div>
      </div>
    </div>
  );
}
