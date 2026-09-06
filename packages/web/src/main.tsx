import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { DemoBanner } from './demo/DemoBanner';
import { IS_DEMO_MODE } from './demo/demoRuntime';
import { createProgressOverlay } from './demo/progressOverlay';
import { applyTextSize, getStoredTextSize } from './settings/textSize';

applyTextSize(getStoredTextSize());

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 現場はモバイル回線のため、再フォーカスのたびの再取得は行わない
      refetchOnWindowFocus: false,
      staleTime: 60_000,
    },
  },
});

/**
 * デモビルドでは、Reactを描画する前にブラウザ内APIを起動して`/api/**`のfetchを差し替える。
 * `IS_DEMO_MODE`はビルド時に定数へ畳まれるため、本番ビルドではこの分岐ごと消え、
 * デモ用のコード(PGliteのwasm含む)は成果物に一切含まれない。
 */
async function main() {
  const root = document.getElementById('root');
  if (!root) throw new Error('#root が見つかりません');

  if (IS_DEMO_MODE) {
    // 進捗画面はデモ本体を読み込む前に出す(デモ本体のチャンクだけで数百KBあり、
    // 読み込み完了を待ってから描くと、その間ずっと白画面になる)。
    const overlay = createProgressOverlay();
    const { bootDemo } = await import('./demo/bootDemo');
    if (!(await bootDemo(overlay))) return;
  }

  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        {IS_DEMO_MODE && <DemoBanner />}
        <App />
      </QueryClientProvider>
    </StrictMode>,
  );
}

void main();
