import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  assignCouponToCustomer,
  fetchCouponsForAdmin,
  fetchCustomerCoupons,
  unassignCouponFromCustomer,
  updateCustomerBirthday,
} from './api';
import { Button, ErrorNotice, LoadingBlock, toFriendlyMessage, useFeedback } from './ui';

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
 * お客様の情報の「クーポン」セクション(管理者のみ)。doc/14 §9。
 *
 * ここで扱うのは2つだけ:
 * - 世帯代表の生年月日(誕生月クーポンの判定に使う。RESERVA CSVに列が無いため手入力)
 * - このお客様に配るクーポン(coupons.audience='assigned' のものが使えるようになる)
 *
 * お客様の他の項目を編集させないのは、RESERVA CSVの取込が正で、画面から直しても次の取込で
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
  const { showSuccess } = useFeedback();
  const [dobInput, setDobInput] = useState(dobRaw ?? '');
  const [selectedCouponId, setSelectedCouponId] = useState('');

  // 生年月日はcustomerQueryの解決後に届くので、届いた時点で入力欄へ反映する。
  // お客様そのものを切り替えたときに前のお客様の入力が残らないようにするのは、呼び出し側が
  // key={customerId} でこのコンポーネントを作り直すことで担保している(CustomerDetail.tsx)。
  // ここでcustomerIdを依存に足す手もあるが、効果の中でcustomerIdを読んでいないため
  // 「使っていない依存」になり、意図が伝わらないうえにlintにも引っかかる。
  useEffect(() => {
    setDobInput(dobRaw ?? '');
  }, [dobRaw]);

  const assignedQuery = useQuery({
    queryKey: ['customer-coupons', customerId],
    queryFn: () => fetchCustomerCoupons(customerId),
  });
  // 配布先を選ぶプルダウン用。audience='assigned' のクーポンだけが配る対象になる
  // (全お客様が使えるものを配っても意味が無く、選べると誤解を生む)。
  const couponsQuery = useQuery({ queryKey: ['coupon-admin'], queryFn: fetchCouponsForAdmin });
  const assignableCoupons = (couponsQuery.data ?? []).filter((c) => c.active && c.audience === 'assigned');

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['customer-coupons', customerId] });
    // 日報画面のクーポン選択(['coupons', お客様ID, ...])も配布直後から反映させる。
    queryClient.invalidateQueries({ queryKey: ['coupons'] });
  };

  const dobMutation = useMutation({
    mutationFn: () => updateCustomerBirthday(customerId, dobInput.trim()),
    onSuccess: () => {
      showSuccess(dobInput.trim() ? '生年月日を保存しました' : '生年月日を削除しました');
      queryClient.invalidateQueries({ queryKey: ['customer', customerId] });
      queryClient.invalidateQueries({ queryKey: ['coupons'] });
    },
  });

  const assignMutation = useMutation({
    mutationFn: () => assignCouponToCustomer(customerId, { couponId: selectedCouponId }),
    onSuccess: () => {
      showSuccess('クーポンを配布しました');
      setSelectedCouponId('');
      refresh();
    },
  });

  const unassignMutation = useMutation({
    mutationFn: (couponId: string) => unassignCouponFromCustomer(customerId, couponId),
    onSuccess: () => {
      showSuccess('配布を取り消しました');
      refresh();
    },
  });

  // 英語のe.messageは画面に出さず、やさしい1文だけを出す(提案書「絶対に守ること」9)。
  const mutationError = dobMutation.error ?? assignMutation.error ?? unassignMutation.error ?? null;
  const errorMessage = mutationError
    ? toFriendlyMessage(mutationError, 'CustomerCouponSection.mutation')
    : null;
  const busy = dobMutation.isPending || assignMutation.isPending || unassignMutation.isPending;

  return (
    <section>
      <h3 className="mb-2 text-base font-bold text-app-text">🎟️ クーポン</h3>

      <div className="space-y-3 rounded-card border border-gray-200 bg-gray-50 p-3">
        <label className="block text-sm text-app-muted" htmlFor="customerDob">
          生年月日(誕生月クーポンの判定に使います)
        </label>
        <div className="flex gap-3">
          <input
            id="customerDob"
            value={dobInput}
            onChange={(e) => setDobInput(e.target.value)}
            placeholder="例 1990/6/15"
            className="min-h-[48px] min-w-0 flex-1 rounded-btn border border-gray-300 bg-white px-3 text-base text-app-text"
          />
          <Button
            variant="subtle"
            size="sub"
            disabled={busy}
            onClick={() => dobMutation.mutate()}
            className="flex-shrink-0"
          >
            保存
          </Button>
        </div>
        <p className="text-sm text-app-muted">
          ※ お子さまの誕生日は「お子様・ご家族」の情報から取り込まれます(ここでは代表者の分だけ)。
        </p>
      </div>

      <div className="mt-3 space-y-3">
        <p className="text-sm text-app-muted">配布したクーポン</p>
        {assignedQuery.isPending && <LoadingBlock text="読み込んでいます…" className="py-4" />}
        {assignedQuery.isError && (
          <ErrorNotice
            text={toFriendlyMessage(
              assignedQuery.error,
              'CustomerCouponSection.fetchCustomerCoupons',
              '配布したクーポンを読み込めませんでした。電波を確認して、もう一度開いてください',
            )}
          />
        )}
        {assignedQuery.data?.length === 0 && (
          <p className="text-sm text-app-muted">このお客様に配布したクーポンはありません</p>
        )}
        <ul className="space-y-2">
          {(assignedQuery.data ?? []).map((coupon) => (
            <li
              key={coupon.couponId}
              className="flex flex-wrap items-center gap-2 rounded-card border border-gray-200 bg-gray-50 p-3 text-base"
            >
              <span className="min-w-0 break-words font-bold text-app-text">{coupon.name}</span>
              <span className="shrink-0 text-sm text-app-muted">({discountLabel(coupon)})</span>
              {coupon.couponInactive && (
                <span className="shrink-0 rounded-full bg-gray-200 px-2 py-0.5 text-sm text-app-muted">
                  廃止済み
                </span>
              )}
              <Button
                variant="subtle"
                size="sub"
                disabled={busy}
                onClick={() => unassignMutation.mutate(coupon.couponId)}
                className="ml-auto shrink-0"
              >
                取り消す
              </Button>
            </li>
          ))}
        </ul>

        {assignableCoupons.length > 0 ? (
          <div className="flex gap-3">
            <select
              value={selectedCouponId}
              onChange={(e) => setSelectedCouponId(e.target.value)}
              aria-label="配布するクーポン"
              className="min-h-[48px] min-w-0 flex-1 rounded-btn border border-gray-300 bg-white px-3 text-base text-app-text"
            >
              <option value="">配布するクーポンを選ぶ…</option>
              {assignableCoupons.map((coupon) => (
                <option key={coupon.id} value={coupon.id}>
                  {coupon.name}({discountLabel(coupon)})
                </option>
              ))}
            </select>
            <Button
              variant="primary"
              size="sub"
              disabled={busy || !selectedCouponId}
              onClick={() => assignMutation.mutate()}
              className="flex-shrink-0"
            >
              配布
            </Button>
          </div>
        ) : (
          <p className="text-sm text-app-muted">
            ※ 配布できるのは、設定→クーポン管理で「使える人=配布したお客様のみ」にしたクーポンだけです。
          </p>
        )}
      </div>

      {errorMessage && (
        <div className="mt-3">
          <ErrorNotice text={errorMessage} />
        </div>
      )}
    </section>
  );
}
