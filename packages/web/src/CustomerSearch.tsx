import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { fetchAllCustomers } from './api';
import { CustomerDetail } from './CustomerDetail';
import { getRecentCustomerIds } from './recentCustomers';
import { HistoryModal } from './reports/HistoryModal';
import { ReportModal } from './reports/ReportModal';
import { Button, EmptyState, ErrorNotice, LoadingBlock, toFriendlyMessage } from './ui';

/**
 * 「お客様」タブ。GAS版のtabVisitors(index.html)と同じく、有効なお客様を一度に全件取得して
 * ブラウザ側で絞り込む方式にしている(GAS版のallCustomers/filterCustomers()と同じ設計)。
 * - お客様の名前は部分一致・打ちながら絞り込む(GAS版のsearchInput/oninput="filterCustomers()"と同じ)。
 * - 地区(市区町村)セレクトで絞り込める(GAS版のcityFilter/onchange="filterCustomers()"と同じ)。
 * - 名前・地区のどちらも指定していない既定表示は、直近保存/領収書登録したお客様が
 *   先頭にくる「最近使った順」にする(GAS版filterCustomers()の`if (!search && !city)`分岐と同じ。
 *   recentCustomers.tsのlocalStorage 'recent_customers'を参照)。
 *
 * カード内の押し場所は3つのボタンだけにしている(提案書「訪問先一覧の各カード」):
 * 本命の「✏️ 日報を書く」を青の大ボタンにして日報/事故報告モーダル(ReportModal)を開き、
 * 「👤 お客様の情報」「📖 これまでの記録」は灰色の補助ボタンで別モーダル
 * (CustomerDetail/HistoryModal)を開く。カード全体のタップと矢印だけのボタンは、
 * 何が起きるか分からないので置かない。
 *
 * initialSearchText/onInitialSearchConsumedは、きょうの予定タブで名前の一致するお客様が
 * 見つからなかった予定から切り替わった際に、名前を検索欄へ入れておくためのもの
 * (App.tsxが管理する一度きりの値、消費したら親側でnullに戻す)。
 */
export function CustomerSearch({
  initialSearchText,
  onInitialSearchConsumed,
}: {
  initialSearchText?: string;
  onInitialSearchConsumed?: () => void;
}) {
  const [searchText, setSearchText] = useState('');
  const [cityFilter, setCityFilter] = useState('');

  // biome-ignore lint/correctness/useExhaustiveDependencies: initialSearchTextが変わった時だけ反映する意図的な依存
  useEffect(() => {
    if (initialSearchText === undefined) return;
    setSearchText(initialSearchText);
    setCityFilter('');
    onInitialSearchConsumed?.();
  }, [initialSearchText]);
  const [reportCustomerId, setReportCustomerId] = useState<string | null>(null);
  const [detailCustomerId, setDetailCustomerId] = useState<string | null>(null);
  const [historyCustomer, setHistoryCustomer] = useState<{ id: string; name: string } | null>(null);
  // 報告作成モーダルを閉じるたびに1増やし、useMemoに「最近使ったお客様」の並びを再評価させる
  // (保存直後にlocalStorageの'recent_customers'が更新されている可能性があるため)。
  const [recentTick, setRecentTick] = useState(0);

  const query = useQuery({ queryKey: ['customers', 'all'], queryFn: fetchAllCustomers });

  // biome-ignore lint/correctness/useExhaustiveDependencies: recentTickは再評価トリガー専用の意図的な依存
  const filteredCustomers = useMemo(() => {
    const customers = query.data?.customers ?? [];
    const search = searchText.trim().toLowerCase();

    const filtered = customers.filter((c) => {
      const matchesCity = cityFilter ? c.city === cityFilter : true;
      const matchesSearch = search ? c.name.toLowerCase().includes(search) : true;
      return matchesCity && matchesSearch;
    });

    if (!search && !cityFilter) {
      const recentRank = new Map(getRecentCustomerIds().map((id, index) => [id, index]));
      filtered.sort((a, b) => {
        const rankA = recentRank.get(a.id) ?? Number.POSITIVE_INFINITY;
        const rankB = recentRank.get(b.id) ?? Number.POSITIVE_INFINITY;
        return rankA - rankB;
      });
    }

    return filtered;
  }, [query.data, searchText, cityFilter, recentTick]);

  return (
    <div>
      <div className="mb-4 space-y-3">
        <div className="relative">
          <span
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base"
            aria-hidden="true"
          >
            🔍
          </span>
          <input
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="お客様の名前で探す"
            className="min-h-[48px] w-full rounded-btn border border-gray-300 bg-white py-3 pl-10 pr-4 text-base text-app-text"
          />
        </div>

        <div className="relative">
          <select
            value={cityFilter}
            onChange={(e) => setCityFilter(e.target.value)}
            aria-label="地域でしぼる"
            className="min-h-[48px] w-full appearance-none rounded-btn border border-gray-300 bg-white py-3 pl-4 pr-10 text-base text-app-text"
          >
            <option value="">すべての地域</option>
            {(query.data?.cities ?? []).map((city) => (
              <option key={city} value={city}>
                {city}
              </option>
            ))}
          </select>
          <span
            className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-base text-app-muted"
            aria-hidden="true"
          >
            ▼
          </span>
        </div>
      </div>

      {query.isError && (
        <div className="mb-3">
          <ErrorNotice
            text={toFriendlyMessage(
              query.error,
              'CustomerSearch.fetchAllCustomers',
              'お客様の一覧を読み込めませんでした。電波を確認して、もう一度開いてください',
            )}
          />
        </div>
      )}

      {query.isPending && <LoadingBlock text="読み込んでいます…" />}

      {query.isSuccess && (
        <div className="space-y-3">
          {filteredCustomers.length === 0 && (
            <EmptyState icon="🔍" title="見つかりませんでした" nextStep="名前の一部だけで探せます" />
          )}
          {filteredCustomers.map((c) => (
            <div key={c.id} className="rounded-card border border-gray-200 bg-white p-3.5">
              <h3 className="break-words text-lg font-bold text-app-text">{c.name}</h3>
              {c.city && <p className="mt-1 text-sm text-app-muted">{c.city}</p>}

              <div className="mt-3 space-y-3">
                <Button variant="primary" fullWidth onClick={() => setReportCustomerId(c.id)}>
                  ✏️ 日報を書く
                </Button>
                {/* 補助の2つは横に並べず縦に積む。横並びにすると狭い端末で
                    「お客様の情 報」のように折り返して読めなくなる。 */}
                <Button variant="subtle" size="sub" fullWidth onClick={() => setDetailCustomerId(c.id)}>
                  👤 お客様の情報
                </Button>
                <Button
                  variant="subtle"
                  size="sub"
                  fullWidth
                  onClick={() => setHistoryCustomer({ id: c.id, name: c.name })}
                >
                  📖 これまでの記録
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {reportCustomerId && (
        <ReportModal
          customerId={reportCustomerId}
          onClose={() => {
            setReportCustomerId(null);
            setRecentTick((t) => t + 1);
          }}
        />
      )}
      {detailCustomerId && (
        <CustomerDetail customerId={detailCustomerId} onClose={() => setDetailCustomerId(null)} />
      )}
      {historyCustomer && (
        <HistoryModal
          customerId={historyCustomer.id}
          customerName={historyCustomer.name}
          onClose={() => setHistoryCustomer(null)}
        />
      )}
    </div>
  );
}
