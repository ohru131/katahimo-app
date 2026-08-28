import { useQuery } from '@tanstack/react-query';

/** Phase 0 の疎通確認用の最小画面。Phase 4 で 予定 / 訪問先一覧 / 勤怠 の3タブを実装する。 */
export function App() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      const res = await fetch('/api/health/db');
      if (!res.ok) throw new Error(`APIエラー: ${res.status}`);
      return (await res.json()) as { status: string; now: string | null };
    },
  });

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
      <h1>katahimo 訪問管理</h1>
      <p>Phase 0: 基盤構築</p>
      <section>
        <h2>API/DB 疎通</h2>
        {health.isPending && <p>確認中…</p>}
        {health.isError && <p style={{ color: '#b91c1c' }}>NG: {health.error.message}</p>}
        {health.data && <p style={{ color: '#15803d' }}>OK（DB時刻: {health.data.now ?? '-'}）</p>}
      </section>
    </main>
  );
}
