import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { StaffView } from './api';
import { fetchMe, logout } from './api';
import { CustomerSearch } from './CustomerSearch';
import { LoginForm } from './LoginForm';

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
      <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
        <p>確認中…</p>
      </main>
    );
  }

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem', maxWidth: 480 }}>
      <h1>katahimo 訪問管理</h1>

      {!staff && (
        <>
          <p>Phase 2: 認証(メール+パスワード)。デモテナントの管理者アカウントでログインできます。</p>
          <LoginForm onLoggedIn={setStaff} />
        </>
      )}

      {staff && (
        <>
          <p>
            ログイン中: {staff.name}({staff.email}){staff.isAdmin && ' [管理者]'}
          </p>
          <button
            type="button"
            onClick={async () => {
              await logout();
              setStaff(null);
              queryClient.removeQueries({ queryKey: ['me'] });
            }}
          >
            ログアウト
          </button>

          <h2 style={{ marginTop: '1.5rem' }}>顧客検索(苗字)</h2>
          <CustomerSearch />
        </>
      )}
    </main>
  );
}
