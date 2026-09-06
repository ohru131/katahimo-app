export interface ProgressOverlay {
  update(message: string, ratio: number): void;
  fail(error: unknown): void;
  remove(): void;
}

/**
 * デモ起動中の進捗表示。
 *
 * デモ本体(PGliteのwasmを含む数百KBのチャンク)の読み込み自体に時間がかかるため、
 * この画面は本体を動的importする**前**に出せる必要がある。だから
 * bootDemo.ts(デモ本体側)ではなく、最初に読み込まれるチャンクに置いて素のDOMで描く。
 * ここに @katahimo/demo への依存を持ち込まないこと。
 */
export function createProgressOverlay(): ProgressOverlay {
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-50 flex items-center justify-center bg-gray-900 text-white p-6';
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;background:#111827;color:#fff;padding:1.5rem';
  overlay.innerHTML = `
    <div style="width:100%;max-width:22rem;text-align:center">
      <div style="font-size:1.125rem;font-weight:700;margin-bottom:1rem">katahimo 訪問管理 デモ</div>
      <div style="height:0.5rem;width:100%;border-radius:9999px;background:#374151;overflow:hidden">
        <div data-bar style="height:100%;width:4%;background:#3b82f6;transition:width .3s"></div>
      </div>
      <div data-message style="font-size:.875rem;opacity:.85;margin-top:1rem">読み込んでいます…</div>
      <div style="font-size:.75rem;opacity:.5;margin-top:1rem;line-height:1.7">
        ブラウザの中でPostgreSQLを起動し、架空のデモデータを作成します。<br />
        初回は十数秒かかります(2回目以降は保存済みのデータを使います)。<br />
        入力した内容は端末の中だけに保存され、サーバーへは送信されません。
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const bar = overlay.querySelector<HTMLElement>('[data-bar]');
  const message = overlay.querySelector<HTMLElement>('[data-message]');

  return {
    update(text, ratio) {
      // 進捗0%のままだと止まって見えるので、下限を置いて必ず動いているように見せる。
      const percent = Math.round(Math.min(1, Math.max(0.04, ratio)) * 100);
      if (bar) bar.style.width = `${percent}%`;
      if (message) message.textContent = text;
    },
    fail(error) {
      if (bar) bar.style.background = '#ef4444';
      if (message) {
        message.textContent = `デモを起動できませんでした: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
      const hint = overlay.querySelector<HTMLElement>('div > div:last-child');
      if (hint) {
        hint.textContent =
          'プライベートブラウジングや、IndexedDBを無効にしている設定では動作しません。設定を確認して再読み込みしてください。';
      }
    },
    remove() {
      overlay.remove();
    },
  };
}
