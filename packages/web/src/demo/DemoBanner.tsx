import { useEffect, useState } from 'react';
import { getDemoRuntime } from './demoRuntime';

interface Toast {
  id: number;
  channel: string;
  text: string;
}

/** デモが「送信した」メール。宛先が架空なので実際には届かない。 */
interface DemoMailView {
  id: number;
  to: string;
  subject: string;
  body: string;
}

const CHANNEL_LABEL: Record<string, string> = {
  report: '日報通知',
  receipt: '領収書通知',
};

/**
 * リセット失敗後もデモをそのまま使い続けられるか。
 *
 * `@katahimo/demo` の DemoResetError が持つフラグを見る。値としてimportすると
 * 本番ビルドにデモパッケージが入ってしまうため、構造だけで判定する。
 */
function isRuntimeUsable(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { runtimeUsable?: unknown }).runtimeUsable === true
  );
}

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
  const [warning, setWarning] = useState<string | null>(null);
  const [mails, setMails] = useState<DemoMailView[]>([]);
  const [openMailId, setOpenMailId] = useState<number | null>(null);

  useEffect(() => {
    const runtime = getDemoRuntime();
    if (!runtime) return;
    let nextId = 0;
    const unsubscribeNotification = runtime.handle.onNotification((notification) => {
      const toast: Toast = { id: nextId++, channel: notification.channel, text: notification.text };
      setToasts((current) => [...current, toast]);
      setTimeout(() => setToasts((current) => current.filter((t) => t.id !== toast.id)), 8000);
    });
    // 書き出し失敗はトーストにしない。8秒で消えると気付かないまま
    // リロードして「保存したはずのものが消えた」ことになる。
    const unsubscribeWarning = runtime.handle.onWarning(setWarning);
    // 認証コードや初期パスワードはメール本文にしか出ない。デモの宛先は架空で
    // 実際には届かないので、ここに出して読めるようにする。
    let nextMailId = 0;
    const unsubscribeMail = runtime.handle.onMail((mail) => {
      const view: DemoMailView = {
        id: nextMailId++,
        to: mail.to,
        subject: mail.subject,
        body: mail.body,
      };
      setMails((current) => [view, ...current].slice(0, 5));
      // 最新のメールを開いた状態にする。コードを探して開く手間を省く。
      setOpenMailId(view.id);
    });
    return () => {
      unsubscribeNotification();
      unsubscribeWarning();
      unsubscribeMail();
    };
  }, []);

  const handleReset = async () => {
    if (!window.confirm('デモデータを削除して初期状態に戻します。よろしいですか?')) return;
    const runtime = getDemoRuntime();
    if (!runtime) return;
    setResetting(true);
    try {
      await runtime.handle.reset();
    } catch (error) {
      window.alert(`リセットできませんでした。\n\n${error instanceof Error ? error.message : String(error)}`);
      // 領収書画像の削除に失敗しただけなら、ブラウザ内DBの接続はまだ生きている。
      // ここでリロードすると、消えていない画像を抱えたままデモが再起動するので、
      // 画面はそのままにして再試行できるようにする。
      if (isRuntimeUsable(error)) {
        setResetting(false);
        return;
      }
      // DBを閉じた後の失敗。この状態ではAPIが応答できないので、リロードして使える状態に戻す
      // (データは残ったまま)。
    }
    window.location.reload();
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
              <strong>既定では</strong>お使いの端末から外部へ送信されません。
              「リセット」で完全に消去できます。
            </p>
            <p>
              移動時間・距離は緯度経度からの概算値です。AIによる日報生成は既定では定型応答なので、
              この状態では入力内容が外部へ送られることはありません。
            </p>
            <p>
              <strong>設定画面でご自身のGemini APIキーを登録した場合に限り</strong>、日報生成・
              領収書OCRの入力内容(メモの本文や領収書画像)がGoogleのGemini APIへ送信されます。
              キーはメモリ上にのみ保持し、端末にも保存しません(タブを閉じると消えます)。
            </p>
          </div>
        )}
      </div>

      {warning && (
        // 保存した内容が失われうるという警告なので、読み上げ環境にも即座に伝わるようにする。
        <div
          role="alert"
          className="bg-red-50 border-b border-red-300 text-red-800 text-xs px-3 py-2 flex items-start gap-2"
        >
          <span className="flex-1 leading-relaxed">{warning}</span>
          <button type="button" onClick={() => setWarning(null)} className="shrink-0 underline">
            閉じる
          </button>
        </div>
      )}

      {mails.length > 0 && (
        <div className="bg-sky-50 border-b border-sky-300 text-sky-900 text-xs">
          <div className="px-3 py-2 flex items-center gap-2">
            <span className="font-bold shrink-0">📧 デモの受信箱</span>
            <span className="flex-1 text-sky-700">
              宛先が架空なので実際には送信されません。ここで内容を確認できます。
            </span>
            <button
              type="button"
              onClick={() => setMails([])}
              className="shrink-0 underline hover:text-sky-950"
            >
              消す
            </button>
          </div>
          <ul className="px-3 pb-2 space-y-1">
            {mails.map((mail) => (
              <li key={mail.id} className="bg-white border border-sky-200 rounded-lg">
                <button
                  type="button"
                  onClick={() => setOpenMailId(openMailId === mail.id ? null : mail.id)}
                  className="w-full text-left px-2 py-1.5"
                >
                  <span className="font-bold">{mail.subject}</span>
                  <span className="text-sky-700"> → {mail.to}</span>
                </button>
                {openMailId === mail.id && (
                  <pre className="px-2 pb-2 whitespace-pre-wrap font-sans text-sky-900 leading-relaxed">
                    {mail.body}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

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
