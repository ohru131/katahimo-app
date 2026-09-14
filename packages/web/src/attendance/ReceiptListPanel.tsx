import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { ReceiptListItemView } from '../api';
import { cancelReceipt, fetchReceiptImageObjectUrl, fetchReceipts } from '../api';

/**
 * 領収書画像。開いたときにfetchで取り、オブジェクトURLにして表示する
 * (`<img src="/api/...">` にできない理由は fetchReceiptImageObjectUrl のコメント参照)。
 */
function ReceiptImage({ receiptId, alt }: { receiptId: string; alt: string }) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let revoked = false;
    let url: string | null = null;
    fetchReceiptImageObjectUrl(receiptId)
      .then((created) => {
        // 取得中に閉じられていたら、作ったURLをそのまま捨てる(解放漏れを作らない)。
        if (revoked) {
          URL.revokeObjectURL(created);
          return;
        }
        url = created;
        setObjectUrl(created);
      })
      .catch(() => setFailed(true));
    return () => {
      revoked = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [receiptId]);

  if (failed) return <p className="text-xs text-red-500 mt-2">画像を読み込めませんでした</p>;
  if (!objectUrl) {
    return (
      <div className="flex justify-center py-4">
        <div className="w-5 h-5 rounded-full border-4 border-gray-200 loading-spinner" />
      </div>
    );
  }
  return <img src={objectUrl} alt={alt} className="mt-2 w-full rounded-lg border border-gray-200" />;
}

function formatYen(value: number): string {
  return `${value.toLocaleString('ja-JP')}円`;
}

/**
 * 金額の表示。OCRが数値にできなかった領収書は、読み取った生の文字列を添えて「?」にする
 * (空欄にすると、金額0円なのか読めなかったのかが区別できない)。
 */
function amountLabel(receipt: ReceiptListItemView): string {
  if (receipt.amountYen !== null) return formatYen(receipt.amountYen);
  return receipt.amountRaw ? `? (${receipt.amountRaw})` : '?';
}

/**
 * 領収書1件の行。
 *
 * 金額・店舗名・顧客の紐付けはここでは直せない(会計の記録なので、いつ誰がいくらに変えたのかが
 * 残らない形にしない)。間違えたときは取り消して登録し直す。
 */
function ReceiptRow({
  receipt,
  busy,
  onCancel,
}: {
  receipt: ReceiptListItemView;
  busy: boolean;
  onCancel: (reason: string) => void;
}) {
  const [showImage, setShowImage] = useState(false);
  const [askingReason, setAskingReason] = useState(false);
  const [reason, setReason] = useState('');
  const cancelled = receipt.cancelledAt !== null;

  return (
    <li
      className={`rounded-lg border p-3 text-sm ${
        cancelled ? 'border-gray-200 bg-gray-50 text-gray-400' : 'border-gray-200'
      }`}
    >
      <div className="flex justify-between items-start gap-2">
        <div className="min-w-0">
          <p className={`break-words ${cancelled ? 'line-through' : 'font-bold text-gray-800'}`}>
            {receipt.storeName || <span className="text-gray-400 font-normal">店舗名なし</span>}
          </p>
          <p className={`text-xs ${cancelled ? '' : 'text-gray-500'}`}>{receipt.receiptTimestamp}</p>
          <p className={`text-xs ${cancelled ? '' : 'text-gray-500'}`}>
            {receipt.customerName ?? <span className="text-gray-400">顧客に紐付かない経費</span>}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className={cancelled ? 'line-through' : 'font-bold text-gray-800'}>{amountLabel(receipt)}</p>
          <p
            className={`text-[10px] ${
              cancelled
                ? ''
                : receipt.billingType === 'customer_billable'
                  ? 'text-amber-700 font-bold'
                  : 'text-gray-500'
            }`}
          >
            {receipt.billingType === 'customer_billable' ? '顧客に請求' : '会社立替'}
          </p>
        </div>
      </div>

      {receipt.handoffText && <p className="text-xs mt-1 break-words opacity-80">{receipt.handoffText}</p>}

      {/* ミラー送信の状態(doc/db/guidelines.md §10)。送信は登録と同時に始まるが、ワーカーが拾うまでの
          間と、失敗して再試行待ちの間は「登録したのにシートに出ていない」状態になる。
          止まっていないかを行に出しておかないと、締めのときに取り残しに気付けない。
          再試行待ち(pendingなのに前回の失敗が残っている)は、ただの順番待ちと区別して出す。 */}
      {!cancelled && receipt.mirrorStatus === 'pending' && !receipt.mirrorError && (
        <p className="text-xs mt-1 text-gray-500">スプレッドシートへ送信待ちです</p>
      )}
      {!cancelled && receipt.mirrorStatus === 'pending' && receipt.mirrorError && (
        <p className="text-xs mt-1 text-amber-700 break-words">
          スプレッドシートへの送信に失敗しました。
          {receipt.mirrorScheduledAt ? `${receipt.mirrorScheduledAt} 以降に再試行します` : '再試行します'}
          {` — ${receipt.mirrorError}`}
        </p>
      )}
      {!cancelled && receipt.mirrorStatus === 'failed' && (
        <p className="text-xs mt-1 text-red-600 break-words">
          スプレッドシートへの送信に失敗しています
          {receipt.mirrorError ? ` — ${receipt.mirrorError}` : ''}
        </p>
      )}

      {/* 取り消した記録も会計の履歴なので、いつ・誰が・なぜ取り消したかを行に残して見せる。 */}
      {cancelled && (
        <p className="text-xs mt-2 bg-gray-100 rounded p-2 text-gray-500 break-words">
          取消済み({receipt.cancelledAt}
          {receipt.cancelledByStaffName ? ` / ${receipt.cancelledByStaffName}` : ''})
          {receipt.cancellationReason ? ` — ${receipt.cancellationReason}` : ''}
        </p>
      )}

      <div className="flex items-center gap-2 mt-2">
        <button
          type="button"
          onClick={() => setShowImage((v) => !v)}
          className="text-xs px-2 py-1 rounded border border-gray-300 hover:bg-gray-100"
        >
          {showImage ? '画像を隠す' : '画像を見る'}
        </button>
        {/* 取消ボタンは、有効な行かつ取り消し期限内のときだけ出す。
            期限を過ぎたものはボタン自体を出さない(サーバー側でも同じ条件で弾く)。
            管理者はサーバー側が期限を無視して canCancel を立てるので、期限後も出る。 */}
        {receipt.canCancel && !askingReason && (
          <button
            type="button"
            disabled={busy}
            onClick={() => setAskingReason(true)}
            className="ml-auto text-xs px-2 py-1 rounded border border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-60"
          >
            取消
          </button>
        )}
      </div>

      {/* 取り消しが成功すると canCancel が false になるので、この確認欄は自動的に閉じる
          (成功後も開いたままだと、取消済みの行に「取り消します」の確認が残って見える)。 */}
      {askingReason && receipt.canCancel && (
        <div className="mt-2 space-y-2 bg-red-50 border border-red-200 rounded-lg p-2">
          <p className="text-xs text-red-700">
            この領収書を取り消します。記録は消えず、取消済みとして残ります。
            <br />
            金額や顧客を直したい場合は、取り消したうえで登録し直してください。
          </p>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={200}
            placeholder="取消理由(任意)"
            aria-label="取消理由"
            className="w-full p-2 border border-gray-300 rounded text-sm"
          />
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => {
                setAskingReason(false);
                setReason('');
              }}
              className="text-xs px-3 py-1.5 rounded border border-gray-300 hover:bg-gray-100"
            >
              やめる
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onCancel(reason)}
              className="text-xs px-3 py-1.5 rounded bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-bold"
            >
              取り消す
            </button>
          </div>
        </div>
      )}

      {/* 画像は開いたときだけ読み込む。一覧を開いた瞬間に全件取りにいくと、月に何十枚も
          登録しているスタッフでは無駄な通信になる。 */}
      {showImage && <ReceiptImage receiptId={receipt.id} alt={`${receipt.storeName ?? '領収書'}の画像`} />}
    </li>
  );
}

/**
 * 領収書一覧(月次集計モーダルの「領収書」セクションから開く明細)。
 *
 * GAS版では領収書は月次集計モーダルの中に日別集計として出るだけだったが、こちらでは
 * 同じ場所から明細(画像・取消)まで辿れるようにしている。対象月は呼び出し側
 * (MonthlySummaryModal)が持つ月をそのまま受け取る。月の選択欄をここにも置くと、
 * 上の勤怠表と別の月を見ている状態が作れてしまうため。
 *
 * 【編集ではなく取り消しにしている理由】
 * 会計の記録なので、金額や紐付け先を後から書き換えられる形にはしない(いつ誰がいくらに
 * 変えたのかが残らない)。訂正は「取り消して登録し直す」の一択で、取り消した行も
 * グレーで残す。スタッフから見た使い勝手は「消せる」のと変わらない。
 */
export function ReceiptListPanel({ staffId, yearMonth }: { staffId?: string; yearMonth: string }) {
  const queryClient = useQueryClient();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  /**
   * 「取り消したが、外部シートには既に送られていた」ことの警告。管理者が期限後に取り消した
   * ときだけ出る。閉じるまで残す(一覧は取り直されるので、行の見た目だけでは気付けない)。
   */
  const [mirrorSentWarning, setMirrorSentWarning] = useState(false);

  const receiptsQuery = useQuery({
    queryKey: ['receipts', yearMonth, staffId],
    queryFn: () => fetchReceipts(yearMonth, staffId),
  });

  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => cancelReceipt(id, reason),
    onSuccess: (result) => {
      setErrorMessage(null);
      setMirrorSentWarning(result.mirrorAlreadySent);
      // 合計も変わるので、一覧ごと取り直す(画面側で足し直すと、サーバーの集計とズレる)。
      queryClient.invalidateQueries({ queryKey: ['receipts'] });
      // 月次集計モーダルの「領収書」セクション(日別集計・月合計)も同じ値を出しているので、
      // そちらも取り直す。取り消した分が合計に残ったままにならないようにするため。
      queryClient.invalidateQueries({ queryKey: ['attendance-month'] });
    },
    onError: (e: Error) => setErrorMessage(e.message),
  });

  const view = receiptsQuery.data;

  return (
    <div className="space-y-3">
      {receiptsQuery.isPending && (
        <div className="flex justify-center py-6">
          <div className="w-6 h-6 rounded-full border-4 border-gray-200 loading-spinner" />
        </div>
      )}
      {receiptsQuery.isError && (
        <p className="text-red-500 text-sm">{(receiptsQuery.error as Error).message}</p>
      )}
      {errorMessage && <p className="text-red-500 text-xs">{errorMessage}</p>}
      {/* 送信に取りかかった後の行はこちらからは消せない(Bridge.jsに取り消し用のactionが無い)。
          黙って成功にすると、シート側に有効な行が残ったままになる。
          mirror_claimed_at が表すのは「送信を開始した」ことで、HTTP送信の成否までは
          分からない。断定すると管理者がシート側の状態を誤認するので、両方の可能性を出す。 */}
      {mirrorSentWarning && (
        <div className="text-xs text-amber-800 bg-amber-50 border border-amber-300 rounded-lg p-2 flex items-start gap-2">
          <span className="flex-grow">
            取り消しましたが、この領収書は
            <strong>スプレッドシートへ送信済み、または送信中</strong>でした。
            シート側の行は自動では消えません。
            <strong>シートを確認し、行があれば手で取り消してください。</strong>
          </span>
          <button
            type="button"
            onClick={() => setMirrorSentWarning(false)}
            className="shrink-0 px-2 py-1 rounded hover:bg-amber-100"
            aria-label="この警告を閉じる"
          >
            &times;
          </button>
        </div>
      )}

      {view && (
        <>
          <ul className="text-sm text-gray-800 space-y-1 bg-gray-50 rounded-lg p-3">
            <li>登録枚数: {view.receipts.length - view.cancelledCount}枚</li>
            <li className="text-amber-800 font-bold">
              顧客に請求: {formatYen(view.customerBillableTotalYen)}
            </li>
            <li>会社立替: {formatYen(view.companyExpenseTotalYen)}</li>
            {/* 送信待ち・送信失敗の件数。締めのときにここだけ見れば取り残しが分かる。
                読み取れなかった枚数・取消済みの枚数は上の日別集計の側に出しているので、
                同じ数字をここで二重に出さない。 */}
            {view.pendingMirrorCount > 0 && (
              <li className="text-gray-500">
                スプレッドシート未送信 {view.pendingMirrorCount}枚(取消できる期間が終わってから送信)
              </li>
            )}
            {view.failedMirrorCount > 0 && (
              <li className="text-red-600 font-bold">
                スプレッドシートへの送信に失敗 {view.failedMirrorCount}枚(対応が必要です)
              </li>
            )}
          </ul>

          {view.receipts.length === 0 && (
            <p className="text-sm text-gray-400">この月に登録された領収書はありません</p>
          )}

          <ul className="space-y-2">
            {view.receipts.map((receipt) => (
              <ReceiptRow
                key={receipt.id}
                receipt={receipt}
                busy={cancelMutation.isPending}
                onCancel={(reason) => cancelMutation.mutate({ id: receipt.id, reason })}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
