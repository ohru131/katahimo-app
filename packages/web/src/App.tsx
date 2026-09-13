import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { AdminTargetStaffProvider } from './AdminTargetStaffContext';
import { AttendanceTab } from './AttendanceTab';
import type { StaffView } from './api';
import { fetchMe, logout } from './api';
import { ForgotPasswordForm } from './auth/ForgotPasswordForm';
import { InitialPasswordChangeForm } from './auth/InitialPasswordChangeForm';
import { CustomerSearch } from './CustomerSearch';
import { LoginForm } from './LoginForm';
import { ScheduleTab } from './ScheduleTab';
import { SettingsModal } from './settings/SettingsModal';
import { applyTextSize, getStoredTextSize, nextTextSize, TEXT_SIZE_LABEL } from './settings/textSize';
import { LoadingBlock, useFeedback } from './ui';

type HomeTab = 'schedule' | 'visitors' | 'attendance';

const TABS: { key: HomeTab; icon: string; label: string }[] = [
  { key: 'schedule', icon: '📅', label: 'きょうの予定' },
  { key: 'visitors', icon: '👪', label: 'お客様' },
  { key: 'attendance', icon: '🕒', label: '出勤簿' },
];

/**
 * ヘッダー専用の文字つきボタン。青いヘッダーの上に置く前提の見た目(白半透明の背景)なので、
 * `ui/Button` の役割別バリアント(進む・戻る等)には合わず、ここだけローカルに用意している
 * (SPEC.md「足りない部品は担当ファイル内にローカルで作る」)。高さ44px以上・`active:`のみ。
 */
function HeaderButton({
  onClick,
  children,
  title,
}: {
  onClick: () => void;
  children: ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="flex min-h-[44px] items-center gap-1 rounded-btn bg-white/20 px-3 text-sm font-bold text-white active:bg-white/30"
    >
      {children}
    </button>
  );
}

/**
 * アプリ全体の骨格。GAS版(gas-childcare-visit-app/index.html)と同じ、ヘッダー+3タブ構成の
 * 単一ページアプリにしている(移行時の混乱を減らすため)。GAS版はURLルーティングを一切使わず
 * タブの表示/非表示切り替えだけで画面遷移するため、こちらもURLは変えずタブをstateで切り替える
 * 作りにしている(react-router-domは使わない)。
 *
 * タブ切り替えはGAS版と同様、スマホでの操作性のため下部固定ボタンにしている(GAS版
 * gas-childcare-visit-app/index.htmlのホームタブと同じ配置)。ルート要素が`overflow-hidden`
 * (下記)なので`sticky`は本文が長い時に画面外へクリップされる。GAS版と同じ理由で`fixed`にし、
 * ビューポート基準+`left-1/2 -translate-x-1/2`でアプリ幅(`max-width: 480px`、index.htmlの
 * #rootと同じ)に中央寄せして常に表示されるようにする。
 */
function AppShell({ staff, onLogout }: { staff: StaffView; onLogout: () => void }) {
  const [activeTab, setActiveTab] = useState<HomeTab>('schedule');
  const [showSettings, setShowSettings] = useState(false);
  // 予定タブの予定カードタップで訪問先一覧タブへ切り替え、検索欄にその顧客名を入れる
  // (GAS版jumpToCustomerFromScheduleと同じ動作)。
  const [jumpSearchText, setJumpSearchText] = useState<string | null>(null);
  const { showSuccess } = useFeedback();

  // ヘッダーの「Aa」ボタン。押すたびに文字の大きさを順送りし、今どの段階かをお知らせで伝える
  // (提案書「文字サイズの切りかえをヘッダーに常設」)。
  const handleCycleTextSize = () => {
    const next = nextTextSize(getStoredTextSize());
    applyTextSize(next);
    showSuccess(`文字の大きさ:${TEXT_SIZE_LABEL[next]}`);
  };

  return (
    <div className="min-h-screen flex flex-col relative bg-white shadow-xl overflow-hidden">
      {/* 「とても大きい」の文字サイズでも横に溢れないよう、名前は縮めてよい場所(truncate)にし、
          押す場所(Aa・設定)は縮めない(flex-shrink-0)。 */}
      <header className="bg-app-primary text-white px-4 py-3 shadow-md z-10 sticky top-0 flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <h1 className="truncate text-lg font-bold">katahimo 訪問管理</h1>
          <span className="truncate text-sm opacity-90">{staff.name} さん</span>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <HeaderButton onClick={handleCycleTextSize} title="文字の大きさを変える">
            Aa
          </HeaderButton>
          <HeaderButton onClick={() => setShowSettings(true)} title="設定">
            ⚙️ 設定
          </HeaderButton>
        </div>
      </header>

      <main className="flex-grow p-4 overflow-y-auto pb-24">
        <AdminTargetStaffProvider staff={staff}>
          {activeTab === 'schedule' && (
            <ScheduleTab
              onJumpToCustomer={(name) => {
                setJumpSearchText(name);
                setActiveTab('visitors');
              }}
            />
          )}
          {activeTab === 'visitors' && (
            <CustomerSearch
              initialSearchText={jumpSearchText ?? undefined}
              onInitialSearchConsumed={() => setJumpSearchText(null)}
            />
          )}
          {activeTab === 'attendance' && <AttendanceTab />}
        </AdminTargetStaffProvider>
      </main>

      <nav
        className="fixed bottom-0 left-1/2 -translate-x-1/2 z-20 flex h-16 bg-white border-t border-gray-200"
        style={{ width: '100%', maxWidth: '480px' }}
      >
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 h-full flex flex-col items-center justify-center gap-0.5 text-sm font-bold border-t-2 transition-colors ${
              activeTab === tab.key
                ? 'border-app-primary text-app-primary'
                : 'border-transparent text-app-muted'
            }`}
          >
            <span className="text-2xl leading-none">{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>

      {showSettings && (
        <SettingsModal staff={staff} onClose={() => setShowSettings(false)} onLogout={onLogout} />
      )}
    </div>
  );
}

export function App() {
  const queryClient = useQueryClient();
  const [staff, setStaff] = useState<StaffView | null | undefined>(undefined);
  // パスワード再設定はログイン前に使うので、ログイン画面と同じ階層で切り替える。
  const [forgotInput, setForgotInput] = useState<{ tenantSlug: string; email: string } | null>(null);

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
        <LoadingBlock />
      </div>
    );
  }

  const handleLogout = async () => {
    await logout();
    setStaff(null);
    queryClient.removeQueries({ queryKey: ['me'] });
  };

  if (!staff) {
    if (forgotInput) {
      return (
        <ForgotPasswordForm
          tenantSlug={forgotInput.tenantSlug}
          email={forgotInput.email}
          onDone={() => setForgotInput(null)}
          onCancel={() => setForgotInput(null)}
        />
      );
    }
    return <LoginForm onLoggedIn={setStaff} onForgotPassword={setForgotInput} />;
  }

  // 初期パスワードのままなら、変更を終えるまでアプリ本体を見せない
  // (サーバー側も他のAPIを403で拒否している)。
  if (staff.mustChangePassword) {
    return <InitialPasswordChangeForm staff={staff} onChanged={setStaff} onLogout={handleLogout} />;
  }

  return <AppShell staff={staff} onLogout={handleLogout} />;
}
