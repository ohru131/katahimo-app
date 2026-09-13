import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { HistoryItem } from '../api';
import { fetchCustomerHistory } from '../api';
import { Button, EmptyState, ErrorNotice, LoadingBlock, toFriendlyMessage } from '../ui';

/** 記録1件が持つ3つの本文。GAS版のタブ(原本/社内向け/保護者向け)と同じ区分。 */
type ReportView = 'original' | 'internal' | 'customer';

/** 誰に届く文かが分かる言い方にする(言いかえ表「原本」「社内向け/保護者向け」の行)。 */
const VIEW_LABEL: Record<ReportView, string> = {
  original: '書いたメモ',
  internal: '事務局に送る文',
  customer: '保護者に送る文',
};

/**
 * 記録1件のカード。同じ訪問について3つの本文(自分で書いたメモ・事務局に送る文・
 * 保護者に送る文)を持っているので、GAS版と同じくタブで切り替えられるようにする。
 *
 * タブの状態はカードごとに独立させたいので、一覧側ではなくこのコンポーネントが持つ。
 */
function HistoryCard({ item }: { item: HistoryItem }) {
  // 既定は事務局に送る文(GAS版の「社内向け」と同じ)。訪問の振り返りで最初に見たいのはこれ。
  const [view, setView] = useState<ReportView>('internal');
  // 事故報告の customer は「保護者への対応」で、保護者に見せる文章ではない。
  // GAS版がこのタブを出していないのと同じく、日報のときだけ出す。
  const views: ReportView[] =
    item.type === 'accident' ? ['original', 'internal'] : ['original', 'internal', 'customer'];
  const body = item[view];

  return (
    <div className="rounded-card border border-gray-200 bg-white p-3.5">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-base font-bold text-app-text">
          {item.type === 'accident' ? `⚠️ ${item.subtype ?? '事故・ヒヤリ'}` : '📝 日報'}
        </span>
        <span className="text-sm text-app-muted">{item.timestamp}</span>
      </div>
      <p className="mb-2 text-sm text-app-muted">担当: {item.staff}</p>
      {(item.risk || item.es) && (
        <div className="mb-2 flex flex-wrap gap-2">
          {item.risk ? (
            <span className="whitespace-nowrap rounded-btn border border-gray-200 bg-gray-50 px-2 py-1 text-sm font-bold text-app-text">
              ⚠️ ヒヤッとした度合い {'★'.repeat(item.risk)}
              {'☆'.repeat(5 - item.risk)}
            </span>
          ) : null}
          {item.es ? (
            <span className="whitespace-nowrap rounded-btn border border-gray-200 bg-gray-50 px-2 py-1 text-sm font-bold text-app-text">
              😊 働きやすさ {'★'.repeat(item.es)}
              {'☆'.repeat(5 - item.es)}
            </span>
          ) : null}
        </div>
      )}

      <div className="mb-2 mt-2 flex flex-wrap gap-2 border-b border-gray-200 pb-2">
        {views.map((candidate) => (
          <button
            key={candidate}
            type="button"
            aria-pressed={view === candidate}
            onClick={() => setView(candidate)}
            className={`min-h-[44px] rounded-btn border px-3 text-base font-bold transition-colors ${
              view === candidate
                ? 'border-app-primary bg-app-primary-bg text-app-primary'
                : 'border-gray-300 bg-white text-app-muted active:bg-gray-100'
            }`}
          >
            {VIEW_LABEL[candidate]}
          </button>
        ))}
      </div>

      {body ? (
        <p className="whitespace-pre-wrap text-base leading-relaxed text-app-text">{body}</p>
      ) : (
        <p className="text-base text-app-muted">この文は書かれていません</p>
      )}
    </div>
  );
}

/**
 * お客様の「これまでの記録」(過去の日報+事故報告)。GAS版index.htmlのcustomerHistoryModal
 * (「活動記録」ボタンで開く別モーダル)に対応。GAS版と同じくカーソルページネーション
 * (「さらに前の記録を見る」ボタンでoccurredAtより古いものを追加取得)にしている。
 */
export function HistoryModal({
  customerId,
  customerName,
  onClose,
}: {
  customerId: string;
  customerName: string;
  onClose: () => void;
}) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initialQuery = useQuery({
    queryKey: ['customerHistory', customerId, 'initial'],
    queryFn: () => fetchCustomerHistory(customerId),
  });

  if (initialQuery.isSuccess && !loadedOnce) {
    setLoadedOnce(true);
    setItems(initialQuery.data);
    setHasMore(initialQuery.data.length >= 5);
  }

  const loadMore = async () => {
    const last = items[items.length - 1];
    if (!last) return;
    setLoadingMore(true);
    setError(null);
    try {
      const more = await fetchCustomerHistory(customerId, last.occurredAtIso);
      setItems((prev) => [...prev, ...more]);
      setHasMore(more.length >= 5);
    } catch (e) {
      setError(
        toFriendlyMessage(
          e,
          'HistoryModal.loadMore',
          '前の記録を読み込めませんでした。電波を確認して、もう一度押してください',
        ),
      );
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black bg-opacity-50 sm:items-center">
      <div className="flex h-[90vh] w-full max-w-md flex-col rounded-t-card border border-gray-200 bg-white sm:h-auto sm:max-h-[85vh] sm:rounded-card">
        <div className="flex items-center justify-between gap-3 rounded-t-card border-b border-gray-200 bg-gray-50 p-4">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-app-text">これまでの記録</h2>
            <p className="break-words text-sm text-app-muted">{customerName}</p>
          </div>
          <Button variant="subtle" size="sub" onClick={onClose} className="flex-shrink-0">
            ✕ 閉じる
          </Button>
        </div>

        <div className="flex-grow overflow-y-auto p-4">
          {initialQuery.isPending && <LoadingBlock text="読み込んでいます…" />}
          {initialQuery.isError && (
            <ErrorNotice
              text={toFriendlyMessage(
                initialQuery.error,
                'HistoryModal.fetchCustomerHistory',
                '記録を読み込めませんでした。電波を確認して、もう一度開いてください',
              )}
            />
          )}

          {loadedOnce && items.length === 0 && (
            <EmptyState icon="📓" title="まだ記録がありません" nextStep="日報を保存するとここに並びます" />
          )}

          <div className="space-y-3">
            {items.map((item) => (
              <HistoryCard key={item.id} item={item} />
            ))}
          </div>

          {error && (
            <div className="mt-3">
              <ErrorNotice text={error} />
            </div>
          )}

          {loadedOnce && hasMore && items.length > 0 && (
            <div className="mt-4">
              <Button variant="subtle" fullWidth onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? '読み込んでいます…' : 'さらに前の記録を見る'}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
