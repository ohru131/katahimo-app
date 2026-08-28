import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { AttendanceTab } from './AttendanceTab';
import type { StaffView } from './api';
import { fetchMe, logout } from './api';
import { CustomerSearch } from './CustomerSearch';
import { LoginForm } from './LoginForm';
import { ScheduleTab } from './ScheduleTab';

type HomeTab = 'schedule' | 'visitors' | 'attendance';

const TABS: { key: HomeTab; label: string }[] = [
  { key: 'schedule', label: '📅 予定' },
  { key: 'visitors', label: '🏠 訪問先一覧' },
  { key: 'attendance', label: '🕒 勤怠' },
];

/**
 * アプリ全体の骨格。GAS版(gas-childcare-visit-app/index.html)と同じ、ヘッダー+3タブ構成の
 * 単一ページアプリにしている(移行時の混乱を減らすため)。GAS版はURLルーティングを一切使わず
 * タブの表示/非表示切り替えだけで画面遷移するため、こちらもURLは変えずタブをstateで切り替える
 * 作りにしている(react-router-domは使わない)。
 */
function AppShell({ staff, onLogout }: { staff: StaffView; onLogout: () => void }) {
  const [activeTab, setActiveTab] = useState<HomeTab>('schedule');

  return (
    <div className="min-h-screen flex flex-col relative bg-white shadow-xl overflow-hidden">
      <header className="bg-blue-600 text-white p-4 shadow-md z-10 sticky top-0 flex items-center justify-between">
        <div className="flex flex-col">
          <h1 className="text-xl font-bold tracking-wider">katahimo 訪問管理</h1>
          <span className="text-[10px] opacity-70 font-mono">Ver. 0.1 (katahimo-app)</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium opacity-90">{staff.name}</span>
          <button
            type="button"
            onClick={onLogout}
            className="p-2 bg-white/20 hover:bg-white/30 rounded-full transition-colors"
            title="ログアウト"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
              />
            </svg>
          </button>
        </div>
      </header>

      <nav className="flex bg-white border-b border-gray-200 sticky top-[60px] z-10">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 py-3 text-sm font-bold text-center border-b-2 transition-colors ${
              activeTab === tab.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <main className="flex-grow p-4 overflow-y-auto pb-24">
        {activeTab === 'schedule' && <ScheduleTab />}
        {activeTab === 'visitors' && <CustomerSearch />}
        {activeTab === 'attendance' && <AttendanceTab />}
      </main>
    </div>
  );
}

export function App() {
  const queryClient = useQueryClient();
  const [staff, setStaff] = useState<StaffView | null | undefined>(undefined);

  // 初回だけCookieセッションの有無を確認する(ページ再読み込み後もログイン状態を保つため)。
  useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const result = await fetchMe();
      setStaff(result);
      return result;
    },
    enabled: staff === undefined,
    retry: false,
  });

  if (staff === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-4 border-gray-200 loading-spinner" />
      </div>
    );
  }

  if (!staff) {
    return <LoginForm onLoggedIn={setStaff} />;
  }

  const handleLogout = async () => {
    await logout();
    setStaff(null);
    queryClient.removeQueries({ queryKey: ['me'] });
  };

  return <AppShell staff={staff} onLogout={handleLogout} />;
}
