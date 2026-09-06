import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * デモ(GitHub Pages公開用)ビルドかどうか。`VITE_DEMO=1 vite build` で切り替える。
 *
 * デモではアプリ全体がブラウザ内で完結する(APIサーバーもPostgreSQLも無い)ため、
 * 通常ビルドとは以下が変わる:
 *  - node:crypto をブラウザ実装に差し替える(packages/core等が同期APIを使っているため)
 *  - PWAを無効化する(Service Workerの古いキャッシュでデモが動かなくなる事故を避ける)
 *  - GitHub Pagesのサブパス配信に合わせて base を変える
 */
const isDemo = process.env.VITE_DEMO === '1';

/** https://<user>.github.io/<repo>/ で配信されるため、リポジトリ名をbaseにする。 */
const DEMO_BASE = '/katahimo-app/';

const DEMO_ENTRY_SPECIFIER = './demo/bootDemo';
const DEMO_STUB_ID = '\0katahimo:demo-stub';

/**
 * 通常ビルドでデモの入口をスタブに差し替える。
 *
 * `if (IS_DEMO_MODE) await import('./demo/bootDemo')` と書いても、rollupは動的importを
 * 必ず別チャンクとしてグラフに載せるため、定数畳み込みで分岐が消えてもPGlite(wasm 8MB)や
 * デモ用の架空データが本番の成果物に残ってしまう。実際、この差し替えを入れる前は
 * 本番ビルドがnode:cryptoを解決できずに失敗していた。
 *
 * 「入らないはず」を仕組みで保証するため、通常ビルドではモジュールごと存在しないことにする。
 */
function stripDemoEntry(): Plugin {
  return {
    name: 'katahimo:strip-demo-entry',
    enforce: 'pre',
    resolveId(source) {
      return source === DEMO_ENTRY_SPECIFIER ? DEMO_STUB_ID : null;
    },
    load(id) {
      if (id !== DEMO_STUB_ID) return null;
      return 'export async function bootDemo() { throw new Error("デモビルドではありません"); }\n';
    },
  };
}

export default defineConfig({
  base: isDemo ? DEMO_BASE : '/',
  define: {
    // デモではNode専用のグローバルに触れうるコードが混ざる。参照だけで落ちないよう空にしておく。
    ...(isDemo ? { 'process.env': '{}' } : {}),
  },
  resolve: {
    alias: isDemo
      ? {
          'node:crypto': fileURLToPath(new URL('../demo/src/nodeCryptoShim.ts', import.meta.url)),
        }
      : {},
  },
  plugins: [
    react(),
    ...(isDemo
      ? []
      : [
          stripDemoEntry(),
          VitePWA({
            registerType: 'autoUpdate',
            manifest: {
              name: 'katahimo 訪問管理',
              short_name: 'katahimo',
              description: '保育訪問業務の予定・訪問先・勤怠を管理するアプリ',
              lang: 'ja',
              theme_color: '#2563eb',
              background_color: '#ffffff',
              display: 'standalone',
              start_url: '/',
            },
          }),
        ]),
  ],
  server: {
    port: 5173,
    // 開発中はAPI(:8080)へプロキシし、本番と同じ同一オリジン構成(Cookie認証)にする
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
    },
  },
});
