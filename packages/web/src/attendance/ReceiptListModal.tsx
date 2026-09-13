import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { ReceiptListItemView } from '../api';
import { cancelReceipt, fetchReceiptImageObjectUrl, fetchReceipts } from '../api';
import { Button, ButtonRow, EmptyState, ErrorNotice, LoadingBlock, toFriendlyMessage } from '../ui';

/**
 * レシートの写真。開いたときにfetchで取り、オブジェクトURLにして表示する
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
      .catch((e) => {
        console.error('[レシートの写真の読み込み]', e);
        setFailed(true);
      });
    return () => {
      revoked = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [receiptId]);

  if (failed) {
    return <p className="text-sm text-app-text mt-2">写真を読み込めませんでした。もう一度押してください</p>;
  }
  if (!objectUrl) return <LoadingBlock text="写真を読み込んでいます…" />;
  return <img src={objectUrl} alt={alt} className="mt-2 w-full rounded-card border border-gray-200" />;
}

function currentYearMonth(): string {
  return new Date().toLocaleDateString('sv-SE').slice(0, 7); // 'YYYY-MM'
}

function formatYen(value: number): string {
  return `${value.toLocaleString('ja-JP')}円`;
}

/**
 * 金額の表示。写真から数値を読み取れなかった領収書は、読み取った生の文字列を添えて「?」にする
 * (空欄にすると、金額0円なのか読めなかったのかが区別できない)。
 */
function amountLabel(receipt: ReceiptListItemView): string {
  if (receipt.amountYen !== null) return formatYen(receipt.amountYen);
  return receipt.amountRaw ? `? (${receipt.amountRaw})` : '?';
}

/**
 * 領収書1件の行。
 *
 * 金額・お店の名前・お客様の紐付けはここでは直せない(会計の記録なので、いつ誰がいくらに
 * 変えたのかが残らない形にしない)。間違えたときは取り消して登録し直す。
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
      className={`rounded-card border p-3 text-base ${
        cancelled ? 'border-gray-200 bg-gray-50 text-app-muted' : 'border-gray-200 text-app-text'
      }`}
    >
      <div className="flex justify-between items-start gap-3">
        <div className="min-w-0">
          <p className={`break-words ${cancelled ? 'line-through' : 'font-bold'}`}>
            {receipt.storeName || <span className="font-normal text-app-muted">お店の名前なし</span>}
          </p>
          <p className={`text-sm ${cancelled ? '' : 'text-app-muted'}`}>{receipt.receiptTimestamp}</p>
          <p className={`text-sm ${cancelled ? '' : 'text-app-muted'}`}>
            {receipt.customerName ?? <span className="text-app-muted">お客様に関係ない経費</span>}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className={cancelled ? 'line-through' : 'font-bold'}>{amountLabel(receipt)}</p>
          <p
            className={`text-sm ${
              cancelled ? '' : receipt.billingType === 'customer_billable' ? 'font-bold' : 'text-app-muted'
            }`}
          >
            {receipt.billingType === 'customer_billable' ? 'お客様に請求' : '会社が立てかえ'}
          </p>
        </div>
      </div>

      {receipt.handoffText && <p className="text-sm mt-1 break-words opacity-80">{receipt.handoffText}</p>}

      {/* ミラー送信の状態(doc/14 §10)。送信は登録と同時に始まるが、ワーカーが拾うまでの
          間と、失敗して再試行待ちの間は「登録したのにシートに出ていない」状態になる。
          止まっていないかを行に出しておかないと、締めのときに取り残しに気付けない。
          再試行待ち(pendingなのに前回の失敗が残っている)は、ただの順番待ちと区別して出す。
          事務局が原因を追えるよう、サーバーが記録した理由(mirrorError)は薄く添えておく。 */}
      {!cancelled && receipt.mirrorStatus === 'pending' && !receipt.mirrorError && (
        <p className="text-sm mt-1 text-app-muted">事務局のシートへ送るのを待っています</p>
      )}
      {!cancelled && receipt.mirrorStatus === 'pending' && receipt.mirrorError && (
        <p className="text-sm mt-1 break-words text-app-text">
          事務局のシートへ送れませんでした。
          {receipt.mirrorScheduledAt
            ? `${receipt.mirrorScheduledAt} 以降にもう一度送ります`
            : 'もう一度送ります'}
          <span className="text-app-muted">{` — ${receipt.mirrorError}`}</span>
        </p>
      )}
      {!cancelled && receipt.mirrorStatus === 'failed' && (
        <p className="text-sm mt-1 break-words text-app-text">
          事務局のシートへ送れていません。事務局へ連絡してください
          {receipt.mirrorError ? <span className="text-app-muted">{` — ${receipt.mirrorError}`}</span> : ''}
        </p>
      )}

      {/* 取り消した記録も会計の履歴なので、いつ・誰が・なぜ取り消したかを行に残して見せる。 */}
      {cancelled && (
        <p className="text-sm mt-2 bg-gray-100 rounded-btn p-2 text-app-muted break-words">
          取り消し済み({receipt.cancelledAt}
          {receipt.cancelledByStaffName ? ` / ${receipt.cancelledByStaffName}` : ''})
          {receipt.cancellationReason ? ` — ${receipt.cancellationReason}` : ''}
        </p>
      )}

      <ButtonRow className="mt-3">
        <Button variant="outline" size="sub" onClick={() => setShowImage((v) => !v)}>
          {showImage ? '写真を隠す' : 'レシートの写真を見る'}
        </Button>
        {/* 取消ボタンは、有効な行かつ取り消し期限内のときだけ出す。
            期限を過ぎたものはボタン自体を出さない(サーバー側でも同じ条件で弾く)。
            管理者はサーバー側が期限を無視して canCancel を立てるので、期限後も出る。 */}
        {receipt.canCancel && !askingReason && (
          <Button
            variant="danger"
            size="sub"
            className="ml-auto"
            disabled={busy}
            onClick={() => setAskingReason(true)}
          >
            取り消す
          </Button>
        )}
      </ButtonRow>

      {/* 取り消しが成功すると canCancel が false になるので、この確認欄は自動的に閉じる
          (成功後も開いたままだと、取消済みの行に「取り消します」の確認が残って見える)。 */}
      {askingReason && receipt.canCancel && (
        <div className="mt-3 space-y-3 bg-app-danger-bg border border-app-danger rounded-card p-3">
          <p className="text-base leading-relaxed text-app-text">
            この領収書を取り消します。記録は消えず、取り消し済みとして残ります。
            <br />
            金額やお客様を直したいときは、取り消してから登録し直してください。
          </p>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={200}
            placeholder="取り消す理由(あれば)"
            aria-label="取り消す理由"
            className="w-full min-h-[48px] px-3 border border-gray-300 rounded-btn text-base"
          />
          {/* 取り消しは左・グレー、進む(ここでは取り消しの実行)は右・赤。 */}
          <ButtonRow>
            <Button
              variant="subtle"
              size="sub"
              fullWidth
              onClick={() => {
                setAskingReason(false);
                setReason('');
              }}
            >
              やめる
            </Button>
            <Button variant="danger" size="sub" fullWidth disabled={busy} onClick={() => onCancel(reason)}>
              取り消す
            </Button>
          </ButtonRow>
        </div>
      )}

      {/* 写真は開いたときだけ読み込む。一覧を開いた瞬間に全件取りにいくと、月に何十枚も
          登録しているスタッフでは無駄な通信になる。 */}
      {showImage && (
        <ReceiptImage receiptId={receipt.id} alt={`${receipt.storeName ?? '領収書'}のレシートの写真`} />
      )}
    </li>
  );
}

/**
 * 「🧾 領収書」モーダル。出勤簿タブの「📊 今月のまとめ」と同じ位置・同じ形(月を選んで一覧)に
 * している。
 *
 * 領収書はこれまで登録するだけで、あとから見返す画面が無かった。金額の読み違いやお客様の
 * 紐付け間違いに気付いても直す手段が無く、請求額が狂ったまま気付けない。
 *
 * 【編集ではなく取り消しにしている理由】
 * 会計の記録なので、金額や紐付け先を後から書き換えられる形にはしない(いつ誰がいくらに
 * 変えたのかが残らない)。訂正は「取り消して登録し直す」の一択で、取り消した行も
 * グレーで残す。スタッフから見た使い勝手は「消せる」のと変わらない。
 */
export function ReceiptListModal({ staffId, onClose }: { staffId?: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [yearMonth, setYearMonth] = useState(currentYearMonth());
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
    },
    onError: (e) => setErrorMessage(toFriendlyMessage(e, '領収書の取り消し')),
  });

  const view = receiptsQuery.data;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-[110] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-lg rounded-card flex flex-col max-h-[90vh]">
        <div className="p-4 border-b border-gray-200 flex justify-between items-center gap-3">
          <h3 className="font-bold text-app-text text-base">🧾 領収書</h3>
          <Button variant="subtle" size="sub" onClick={onClose}>
            ✕ 閉じる
          </Button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto">
          <div>
            <label className="block text-sm font-bold text-app-text mb-1" htmlFor="receiptMonth">
              月をえらぶ
            </label>
            <input
              id="receiptMonth"
              type="month"
              value={yearMonth}
              onChange={(e) => setYearMonth(e.target.value)}
              className="w-full min-h-[48px] px-3 border border-gray-300 rounded-btn text-base"
            />
          </div>

          {receiptsQuery.isPending && <LoadingBlock text="読み込んでいます…" />}
          {receiptsQuery.isError && (
            <ErrorNotice text={toFriendlyMessage(receiptsQuery.error, '領収書一覧の読み込み')} />
          )}
          {errorMessage && <ErrorNotice text={errorMessage} />}
          {/* 送信に取りかかった後の行はこちらからは消せない(Bridge.jsに取り消し用のactionが無い)。
              黙って成功にすると、シート側に有効な行が残ったままになる。
              mirror_claimed_at が表すのは「送信を開始した」ことで、HTTP送信の成否までは
              分からない。断定すると管理者がシート側の状態を誤認するので、両方の可能性を出す。 */}
          {mirrorSentWarning && (
            <ErrorNotice text="取り消しましたが、この領収書は事務局のシートへ送り終えているか、送っている最中でした。シート側の行は自動では消えません。シートを見て、行があれば手で取り消してください。">
              <div className="mt-3">
                <Button variant="subtle" size="sub" onClick={() => setMirrorSentWarning(false)}>
                  ✕ 閉じる
                </Button>
              </div>
            </ErrorNotice>
          )}

          {view && (
            <>
              <div className="rounded-card border border-gray-200 p-3">
                <h4 className="text-base font-bold text-app-text mb-2">この月の領収書 合計</h4>
                <ul className="text-base text-app-text space-y-1">
                  <li>送った枚数: {view.receipts.length - view.cancelledCount}枚</li>
                  <li className="font-bold">お客様に請求: {formatYen(view.customerBillableTotalYen)}</li>
                  <li>会社が立てかえ: {formatYen(view.companyExpenseTotalYen)}</li>
                  {/* 合計は「金額を数値にできた分」だけ。読めなかった枚数を出さないと、
                      合計が実額より小さいことに気付けない。 */}
                  {view.unreadableAmountCount > 0 && (
                    <li className="text-sm">
                      金額を読み取れなかった領収書が {view.unreadableAmountCount}
                      枚あります(合計に入っていません)
                    </li>
                  )}
                  {view.cancelledCount > 0 && (
                    <li className="text-sm text-app-muted">
                      取り消し済み {view.cancelledCount}枚(一覧には残りますが、合計には入りません)
                    </li>
                  )}
                  {/* 送信待ち・送信失敗の件数。締めのときにここだけ見れば取り残しが分かる。 */}
                  {view.pendingMirrorCount > 0 && (
                    <li className="text-sm text-app-muted">
                      事務局のシートへ未送信 {view.pendingMirrorCount}
                      枚(取り消せる期間が終わってから送ります)
                    </li>
                  )}
                  {view.failedMirrorCount > 0 && (
                    <li className="text-sm font-bold">
                      事務局のシートへ送れていない領収書 {view.failedMirrorCount}枚(事務局へ連絡してください)
                    </li>
                  )}
                </ul>
              </div>

              {view.receipts.length === 0 ? (
                <EmptyState
                  icon="🧾"
                  title="この月に送った領収書はありません"
                  nextStep="「月をえらぶ」で先月を見るか、日報の画面からレシートを送ってください"
                />
              ) : (
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
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
