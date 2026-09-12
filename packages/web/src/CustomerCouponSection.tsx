import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  assignCouponToCustomer,
  fetchCouponsForAdmin,
  fetchCustomerCoupons,
  unassignCouponFromCustomer,
  updateCustomerBirthday,
} from './api';

/** 割引条件の表示(例 '500円引き' '10%引き')。CouponAdminModalのdiscountLabelと同じ形。 */
function discountLabel(coupon: {
  discountKind: 'amount' | 'percent';
  discountAmountYen: number | null;
  discountPercent: number | null;
}) {
  return coupon.discountKind === 'amount'
    ? `${coupon.discountAmountYen}円引き`
    : `${coupon.discountPercent}%引き`;
}

/**
 * 顧客カルテの「クーポン」セクション(管理者のみ)。doc/14 §9。
 *
 * ここで扱うのは2つだけ:
 * - 世帯代表の生年月日(誕生月クーポンの判定に使う。RESERVA CSVに列が無いため手入力)
 * - この顧客に配るクーポン(coupons.audience='assigned' のものが使えるようになる)
 *
 * 顧客の他の項目を編集させないのは、RESERVA CSVの取込が正で、画面から直しても次の取込で
 * 静かに消えるため(packages/shared/src/contracts/customers.ts のコメント参照)。
 */
export function CustomerCouponSection({
  customerId,
  dobRaw,
}: {
  customerId: string;
  /** 現在保存されている生年月日の元表記。未登録はnull。 */
  dobRaw: string | null;
}) {
  const queryClient = useQueryClient();
  const [dobInput, setDobInput] = useState(dobRaw ?? '');
  const [selectedCouponId, setSelectedCouponId] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  // 顧客を切り替えたときに前の顧客の入力値が残らないようにする
  // (このコンポーネントはモーダル内で顧客ごとにマウントされ直すとは限らない)。
  useEffect(() => {
    setDobInput(dobRaw ?? '');
    setNotice(null);
  }, [dobRaw]);

  const assignedQuery = useQuery({
    queryKey: ['customer-coupons', customerId],
    queryFn: () => fetchCustomerCoupons(customerId),
  });
  // 配布先を選ぶプルダウン用。audience='assigned' のクーポンだけが配る対象になる
  // (全顧客が使えるものを配っても意味が無く、選べると誤解を生む)。
  const couponsQuery = useQuery({ queryKey: ['coupon-admin'], queryFn: fetchCouponsForAdmin });
  const assignableCoupons = (couponsQuery.data ?? []).filter((c) => c.active && c.audience === 'assigned');

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['customer-coupons', customerId] });
    // 日報画面のクーポン選択(['coupons', 顧客ID, ...])も配布直後から反映させる。
    queryClient.invalidateQueries({ queryKey: ['coupons'] });
  };

  const dobMutation = useMutation({
    mutationFn: () => updateCustomerBirthday(customerId, dobInput.trim()),
    onSuccess: () => {
      setNotice(dobInput.trim() ? '生年月日を保存しました' : '生年月日を削除しました');
      queryClient.invalidateQueries({ queryKey: ['customer', customerId] });
      queryClient.invalidateQueries({ queryKey: ['coupons'] });
    },
  });

  const assignMutation = useMutation({
    mutationFn: () => assignCouponToCustomer(customerId, { couponId: selectedCouponId }),
    onSuccess: () => {
      setNotice('クーポンを配布しました');
      setSelectedCouponId('');
      refresh();
    },
  });

  const unassignMutation = useMutation({
    mutationFn: (couponId: string) => unassignCouponFromCustomer(customerId, couponId),
    onSuccess: () => {
      setNotice('配布を取り消しました');
      refresh();
    },
  });

  const errorMessage =
    dobMutation.error?.message ?? assignMutation.error?.message ?? unassignMutation.error?.message ?? null;
  const busy = dobMutation.isPending || assignMutation.isPending || unassignMutation.isPending;

  return (
    <section>
      <h3 className="font-bold text-gray-700 text-sm mb-2">🎟️ クーポン</h3>

      <div className="bg-gray-50 rounded-lg p-3 space-y-2">
        <label className="text-xs text-gray-500 block" htmlFor="customerDob">
          生年月日(誕生月クーポンの判定に使います)
        </label>
        <div className="flex gap-2">
          <input
            id="customerDob"
            value={dobInput}
            onChange={(e) => setDobInput(e.target.value)}
            placeholder="例 1990/6/15"
            className="flex-1 min-w-0 p-2 border border-gray-300 rounded text-sm"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => dobMutation.mutate()}
            className="px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-bold rounded shrink-0"
          >
            保存
          </button>
        </div>
        <p className="text-[10px] text-gray-400">
          ※ お子さまの誕生日は「世帯構成員」の情報から取り込まれます(ここでは代表者の分だけ)。
        </p>
      </div>

      <div className="mt-3 space-y-2">
        <p className="text-xs text-gray-500">配布したクーポン</p>
        {assignedQuery.isPending && (
          <div className="flex justify-center py-2">
            <div className="w-5 h-5 rounded-full border-4 border-gray-200 loading-spinner" />
          </div>
        )}
        {assignedQuery.isError && (
          <p className="text-red-500 text-xs">{(assignedQuery.error as Error).message}</p>
        )}
        {assignedQuery.data?.length === 0 && (
          <p className="text-sm text-gray-400">この顧客に配布したクーポンはありません</p>
        )}
        <ul className="space-y-1">
          {(assignedQuery.data ?? []).map((coupon) => (
            <li key={coupon.couponId} className="flex items-center gap-2 text-sm bg-gray-50 rounded-lg p-2">
              <span className="font-bold text-gray-700 break-words min-w-0">{coupon.name}</span>
              <span className="text-xs text-gray-400 shrink-0">({discountLabel(coupon)})</span>
              {coupon.couponInactive && (
                <span className="text-xs bg-gray-200 text-gray-600 rounded px-1.5 py-0.5 shrink-0">
                  廃止済み
                </span>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => unassignMutation.mutate(coupon.couponId)}
                className="ml-auto shrink-0 text-xs px-2 py-1 rounded border border-gray-300 hover:bg-gray-100 disabled:opacity-60"
              >
                取り消す
              </button>
            </li>
          ))}
        </ul>

        {assignableCoupons.length > 0 ? (
          <div className="flex gap-2">
            <select
              value={selectedCouponId}
              onChange={(e) => setSelectedCouponId(e.target.value)}
              aria-label="配布するクーポン"
              className="flex-1 min-w-0 p-2 border border-gray-300 rounded text-sm bg-white"
            >
              <option value="">配布するクーポンを選ぶ…</option>
              {assignableCoupons.map((coupon) => (
                <option key={coupon.id} value={coupon.id}>
                  {coupon.name}({discountLabel(coupon)})
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={busy || !selectedCouponId}
              onClick={() => assignMutation.mutate()}
              className="px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-bold rounded shrink-0"
            >
              配布
            </button>
          </div>
        ) : (
          <p className="text-[10px] text-gray-400">
            ※ 配布できるのは、設定→クーポン管理で「使える人=配布した顧客のみ」にしたクーポンだけです。
          </p>
        )}
      </div>

      {notice && <p className="text-green-600 text-xs mt-2">{notice}</p>}
      {errorMessage && <p className="text-red-500 text-xs mt-2">{errorMessage}</p>}
    </section>
  );
}
