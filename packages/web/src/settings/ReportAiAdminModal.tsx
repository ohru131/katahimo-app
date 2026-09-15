import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { AgeBandsTab } from './reportAi/AgeBandsTab';
import { EducationLevelsTab } from './reportAi/EducationLevelsTab';
import { ImportTab } from './reportAi/ImportTab';
import { KeywordsTab } from './reportAi/KeywordsTab';
import { PhrasesTab } from './reportAi/PhrasesTab';
import { StressLevelsTab } from './reportAi/StressLevelsTab';
import { fetchReportAiAdminConfig } from './reportAiAdminApi';

type TabKey = 'keywords' | 'ageBands' | 'educationLevels' | 'stressLevels' | 'phrases' | 'import';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'keywords', label: 'キーワード表' },
  { key: 'ageBands', label: '年齢帯' },
  { key: 'educationLevels', label: '教育関心度★' },
  { key: 'stressLevels', label: 'ストレス度(PSI)' },
  { key: 'phrases', label: '温かみ・避ける表現' },
  { key: 'import', label: '取込' },
];

/**
 * 日報AI 3軸(年齢帯・教育関心度★・ストレス度PSI)とキーワード表・表現集を調整する管理画面。
 * 管理者のみ(SettingsModalの管理者設定から開く)。1度に全設定を読み込み(`GET .../report-ai`)、
 * 各タブの保存後はこのクエリを作り直して他タブにもすぐ反映させる。
 *
 * doc/db/new-domains.md 第6章の3軸の意味と、テナントが1行も設定していない場合は
 * GAS版と同じ1プロンプトで動く(差し込みが空文字になる)という前提はここでは扱わない。
 * この画面はあくまで「表の中身」を編集するもので、生成そのものの挙動は
 * usecases/reportAi.ts側にある。
 */
export function ReportAiAdminModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<TabKey>('keywords');
  const configQuery = useQuery({ queryKey: ['report-ai-admin'], queryFn: fetchReportAiAdminConfig });

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-[110] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-3xl rounded-xl shadow-xl flex flex-col max-h-[92vh]">
        <div className="p-4 border-b flex justify-between items-start gap-2 bg-gray-50 rounded-t-xl">
          <div className="min-w-0">
            <h3 className="font-bold text-gray-800 text-sm">🧩 日報AIの調整(3軸)</h3>
            <p className="text-[10px] text-gray-500 mt-1">
              年齢帯・教育関心度★・ストレス度(PSI)の判定基準と、教育キーワード・表現集を編集します。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 hover:bg-gray-200 rounded-full text-gray-500 shrink-0"
          >
            &times;
          </button>
        </div>

        <div className="flex gap-1 overflow-x-auto border-b p-2 shrink-0">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`shrink-0 px-3 py-1.5 rounded text-xs font-bold whitespace-nowrap ${
                tab === t.key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          {configQuery.isPending && (
            <div className="flex justify-center py-8">
              <div className="w-8 h-8 rounded-full border-4 border-gray-200 loading-spinner" />
            </div>
          )}
          {configQuery.isError && (
            <p className="text-red-500 text-sm">{(configQuery.error as Error).message}</p>
          )}

          {configQuery.data && (
            <>
              {tab === 'keywords' && (
                <KeywordsTab keywords={configQuery.data.keywords} ageBands={configQuery.data.ageBands} />
              )}
              {tab === 'ageBands' && <AgeBandsTab ageBands={configQuery.data.ageBands} />}
              {tab === 'educationLevels' && (
                <EducationLevelsTab educationLevels={configQuery.data.educationLevels} />
              )}
              {tab === 'stressLevels' && <StressLevelsTab stressLevels={configQuery.data.stressLevels} />}
              {tab === 'phrases' && <PhrasesTab phrases={configQuery.data.phrases} />}
              {tab === 'import' && <ImportTab />}
            </>
          )}
        </div>

        <div className="p-4 border-t bg-gray-50 rounded-b-xl text-right shrink-0">
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
