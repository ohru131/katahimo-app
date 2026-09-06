import { useEffect, useState } from 'react';
import { getDemoRuntime } from './demoRuntime';

interface Toast {
  id: number;
  channel: string;
  text: string;
}

const CHANNEL_LABEL: Record<string, string> = {
  report: '日報通知',
  receipt: '領収書通知',
};

/**
 * デモ環境であることの明示と、データのリセット導線。
 *
 * 「本番のデータを触っているのでは」と一瞬でも思わせないことが目的なので、常時表示にしている。
 * 併せて、本来Google Chatへ飛ぶ通知をトーストとして見せる(送信先が無いデモでも、
 * 通知が実際に組み立てられていることが分かるように)。
 */
export function DemoBanner() {
  const [expanded, setExpanded] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const runtime = getDemoRuntime();
    if (!runtime) return;
    let nextId = 0;
    return runtime.handle.onNotification((notification) => {
      const toast: Toast = { id: nextId++, channel: notification.channel, text: notification.text };
      setToasts((current) => [...current, toast]);
      setTimeout(() => setToasts((current) => current.filter((t) => t.id !== toast.id)), 8000);
    });
  }, []);

  const handleReset = async () => {
    if (!window.confirm('デモデータを削除して初期状態に戻します。よろしいですか?')) return;
    const runtime = getDemoRuntime();
    if (!runtime) return;
    setResetting(true);
    try {
      await runtime.handle.reset();
      window.location.reload();
    } catch (error) {
      setResetting(false);
      window.alert(`リセットに失敗しました: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <>
      <div className="bg-amber-100 border-b border-amber-300 text-amber-900 text-xs">
        <div className="px-3 py-2 flex items-center gap-2">
          <span className="font-bold shrink-0 bg-amber-500 text-white rounded px-1.5 py-0.5">DEMO</span>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex-1 text-left underline decoration-dotted"
          >
            架空データの体験版です{expanded ? '(閉じる)' : '(詳しく)'}
          </button>
          <button
            type="button"
            onClick={handleReset}
            disabled={resetting}
            className="shrink-0 bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white rounded px-2 py-1"
          >
            {resetting ? 'リセット中…' : 'リセット'}
          </button>
        </div>
        {expanded && (
          <div className="px-3 pb-3 space-y-1.5 leading-relaxed">
            <p>
              利用者・スタッフ・訪問履歴はすべて架空のものです。世帯主の名前は歴史上の人物から
              借りていますが、住所の番地・連絡先・お子さまの情報は実在しません。
            </p>
            <p>
              データベース(PostgreSQL)はブラウザの中で動いており、入力した内容は
              お使いの端末から外部へ送信されません。「リセット」で完全に消去できます。
            </p>
            <p>
              移動時間・距離は緯度経度からの概算値です。AIによる日報生成は既定では定型応答で、
              設定画面でご自身のGemini APIキーを登録すると実際に生成されます
              (キーも端末内にのみ保存されます)。
            </p>
          </div>
        )}
      </div>

      {toasts.length > 0 && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-40 w-full max-w-[440px] px-3 space-y-2">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className="bg-gray-900/95 text-white rounded-xl shadow-lg p-3 text-xs whitespace-pre-wrap"
            >
              <div className="font-bold text-emerald-300 mb-1">
                {CHANNEL_LABEL[toast.channel] ?? toast.channel}(本来はGoogle Chatへ送信)
              </div>
              {toast.text}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
