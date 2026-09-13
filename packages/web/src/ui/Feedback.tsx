import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { Button, ButtonRow } from './Button';

/**
 * 画面の下から出るお知らせ(トースト)と、確認ダイアログ。
 *
 * 提案書(doc/16_UIUX改善提案_2026-09-03.html)の決めごと:
 * - 成功は4秒で消える。失敗は**消さない**で「閉じる」を付ける(読む前に消えてしまうため)。
 * - 位置は下タブの上(bottom-20)。下タブと重ねない。
 * - 確認は `window.confirm` を使わない。ボタン自体に動詞を書く(「OK」ではなく「書きかえる」)。
 */

type ToastKind = 'success' | 'error';

interface ToastState {
  id: number;
  kind: ToastKind;
  text: string;
}

interface ConfirmRequest {
  message: string;
  /** 実行するほうのボタンの文言。動詞を書く(例:「送る」「書きかえる」)。 */
  confirmLabel: string;
  /** 取り消すほうのボタンの文言。既定は「キャンセル」。 */
  cancelLabel?: string;
  /** 取り返しのつかない操作(削除など)は赤にする。 */
  danger?: boolean;
}

interface FeedbackApi {
  /** 成功のお知らせ。4秒で消える。 */
  showSuccess: (text: string) => void;
  /**
   * 失敗のお知らせ。自動では消えない。
   * 技術的な文面(英語のe.messageなど)は渡さないこと。errors.ts の toFriendlyMessage を通す。
   */
  showError: (text: string) => void;
  /** 確認ダイアログ。押されるまで解決しない Promise を返す(window.confirmの置きかえ)。 */
  confirm: (request: ConfirmRequest) => Promise<boolean>;
}

const FeedbackContext = createContext<FeedbackApi | null>(null);

let nextToastId = 1;

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastState[]>([]);
  const [confirmState, setConfirmState] = useState<
    (ConfirmRequest & { resolve: (ok: boolean) => void }) | null
  >(null);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, text: string) => {
      const id = nextToastId++;
      setToasts((current) => [...current, { id, kind, text }]);
      // 成功だけ自動で消す。失敗は読み終わるまで残す。
      if (kind === 'success') setTimeout(() => dismiss(id), 4000);
    },
    [dismiss],
  );

  const api = useMemo<FeedbackApi>(
    () => ({
      showSuccess: (text) => push('success', text),
      showError: (text) => push('error', text),
      confirm: (request) => new Promise<boolean>((resolve) => setConfirmState({ ...request, resolve })),
    }),
    [push],
  );

  const closeConfirm = (ok: boolean) => {
    confirmState?.resolve(ok);
    setConfirmState(null);
  };

  return (
    <FeedbackContext.Provider value={api}>
      {children}

      {toasts.length > 0 && (
        <div className="fixed bottom-20 left-1/2 z-[200] w-full max-w-[480px] -translate-x-1/2 space-y-2 px-4">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`flex items-start gap-3 rounded-card border p-4 text-base shadow-lg ${
                toast.kind === 'success'
                  ? 'border-app-done bg-app-done-bg text-app-text'
                  : 'border-app-danger bg-app-danger-bg text-app-text'
              }`}
            >
              <span className="flex-grow whitespace-pre-wrap leading-relaxed">{toast.text}</span>
              {toast.kind === 'error' && (
                <button
                  type="button"
                  onClick={() => dismiss(toast.id)}
                  className="min-h-[44px] flex-shrink-0 rounded-btn border border-gray-300 bg-white px-3 font-bold text-app-text active:bg-gray-100"
                >
                  閉じる
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {confirmState && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black bg-opacity-50 p-4">
          <div className="w-full max-w-sm rounded-card bg-white p-5">
            <p className="mb-5 whitespace-pre-wrap text-base leading-relaxed text-app-text">
              {confirmState.message}
            </p>
            {/* 取り消しは左・グレー、進むは右。全画面で同じ並びにする。 */}
            <ButtonRow>
              <Button variant="subtle" fullWidth onClick={() => closeConfirm(false)}>
                {confirmState.cancelLabel ?? 'キャンセル'}
              </Button>
              <Button
                variant={confirmState.danger ? 'danger' : 'primary'}
                fullWidth
                onClick={() => closeConfirm(true)}
              >
                {confirmState.confirmLabel}
              </Button>
            </ButtonRow>
          </div>
        </div>
      )}
    </FeedbackContext.Provider>
  );
}

/** お知らせ・確認ダイアログを出す。FeedbackProvider の内側でだけ使える。 */
export function useFeedback(): FeedbackApi {
  const api = useContext(FeedbackContext);
  if (!api) throw new Error('FeedbackProvider の中で使ってください');
  return api;
}
