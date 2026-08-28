import { useState } from 'react';

/**
 * 「予定」タブ。GAS版index.htmlのtabSchedule(今日/明日トグル・ルート取得ボタン)と同じ見た目に
 * している(移行時の混乱を減らすため)。ただし今日/明日の予定はGoogleカレンダー連携(Phase 5、
 * 実際のGCPプロジェクト・OAuth設定が必要)がまだ無いため、ここでは見た目だけを再現し、
 * 実データが無いことを正直に表示する(存在しない予定をでっち上げない)。
 */
export function ScheduleTab() {
  const [offset, setOffset] = useState<0 | 1>(0);

  return (
    <div>
      <div className="flex gap-2 mb-4">
        <button
          type="button"
          onClick={() => setOffset(0)}
          className={`flex-1 py-2 rounded-xl text-sm font-bold border transition-colors ${
            offset === 0 ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'
          }`}
        >
          ☀️ 今日
        </button>
        <button
          type="button"
          onClick={() => setOffset(1)}
          className={`flex-1 py-2 rounded-xl text-sm font-bold border transition-colors ${
            offset === 1 ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'
          }`}
        >
          🌙 明日
        </button>
      </div>

      <button
        type="button"
        disabled
        className="w-full mb-3 py-3 rounded-xl text-sm font-bold border border-blue-200 bg-blue-50 text-blue-700 opacity-50 flex items-center justify-center gap-1"
        title="Googleカレンダー連携(Phase 5)が未実装のため、現時点では利用できません"
      >
        🚗 ルート・移動時間を取得
      </button>

      <div className="text-center text-gray-400 py-8 text-sm">
        Googleカレンダー連携(Phase 5)が未実装のため、
        <br />
        この画面はまだ実際の予定を表示できません。
      </div>
    </div>
  );
}
