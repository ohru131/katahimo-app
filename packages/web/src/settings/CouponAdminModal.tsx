import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type {
  CouponAudience,
  CouponBirthdaySubject,
  CouponDiscountKind,
  CouponEligibilityKind,
  CouponUsageLimitKind,
  CouponView,
} from '../api';
import { createCoupon, fetchCouponsForAdmin, updateCoupon } from '../api';

/** 割引条件の表示(例 '500円引き' '10%引き')。doc/14 §9の2種別に対応。 */
function discountLabel(coupon: Pick<CouponView, 'discountKind' | 'discountAmountYen' | 'discountPercent'>) {
  return coupon.discountKind === 'amount'
    ? `${coupon.discountAmountYen}円引き`
    : `${coupon.discountPercent}%引き`;
}

/** 適用条件・配布先・使用上限のうち、既定でないものだけを短い札にする(一覧の1行に収めるため)。 */
function conditionLabels(coupon: CouponView): string[] {
  const labels: string[] = [];
  if (coupon.eligibilityKind === 'birthday_month') {
    const subject =
      coupon.birthdaySubject === 'customer'
        ? '世帯代表'
        : coupon.birthdaySubject === 'family_member'
          ? '世帯構成員'
          : 'どなたか';
    labels.push(`🎂 ${subject}の誕生月`);
  }
  if (coupon.audience === 'assigned') labels.push('配布した顧客のみ');
  if (coupon.usageLimitKind === 'once_per_customer') labels.push('顧客ごと1回まで');
  if (coupon.usageLimitKind === 'once_per_customer_per_year') labels.push('顧客ごと年1回まで');
  return labels;
}

/** 有効期間の表示。片方だけ/両方null(=無期限)もある(coupons_valid_period_check参照)。 */
function periodLabel(coupon: Pick<CouponView, 'validFrom' | 'validTo'>) {
  if (!coupon.validFrom && !coupon.validTo) return '期限なし';
  if (coupon.validFrom && coupon.validTo) return `${coupon.validFrom} 〜 ${coupon.validTo}`;
  if (coupon.validFrom) return `${coupon.validFrom} 〜`;
  return `〜 ${coupon.validTo}`;
}

/**
 * 管理者による割引クーポンの登録・廃止管理(doc/14 §9)。StaffAdminModalと同じ構成
 * (追加フォーム+一覧+行内操作)にしている。
 *
 * 編集はStaffAdminModal(名前・メールは変更不可、権限や在籍状態の切り替えのみ)に合わせ、
 * ここでも「有効/廃止の切り替え」だけを行内操作として持たせている(コード・割引条件そのものの
 * 修正はここでは扱わない。誤登録した場合は廃止して登録し直す運用を想定)。
 */
export function CouponAdminModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [discountKind, setDiscountKind] = useState<CouponDiscountKind>('amount');
  const [discountAmountYen, setDiscountAmountYen] = useState('');
  const [discountPercent, setDiscountPercent] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [validTo, setValidTo] = useState('');
  const [audience, setAudience] = useState<CouponAudience>('all');
  const [eligibilityKind, setEligibilityKind] = useState<CouponEligibilityKind>('manual');
  const [birthdaySubject, setBirthdaySubject] = useState<CouponBirthdaySubject>('any');
  const [usageLimitKind, setUsageLimitKind] = useState<CouponUsageLimitKind>('unlimited');
  const [note, setNote] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const couponsQuery = useQuery({ queryKey: ['coupon-admin'], queryFn: fetchCouponsForAdmin });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['coupon-admin'] });
    // 日報画面のクーポン選択(['coupons', 日付])も、登録直後から選べるようにする。
    queryClient.invalidateQueries({ queryKey: ['coupons'] });
  };

  /**
   * 割引種別を切り替えたら、使わない側の値を必ず空にする。DBのCHECK制約
   * (coupons_discount_value_check)は「種別に対応する側だけが埋まっている」ことを求めており、
   * 切り替え前の値を残したまま送信できてしまうと「率引きなのに金額が入っている」形の
   * リクエストを作れてしまうため。
   */
  const handleDiscountKindChange = (kind: CouponDiscountKind) => {
    setDiscountKind(kind);
    setDiscountAmountYen('');
    setDiscountPercent('');
  };

  /**
   * 誕生月に切り替えたら、使用上限の既定を「年1回」にする。誕生月割引を上限なしで作ると、
   * 誕生月に3回訪問すれば3回割引が付く(運用の意図とまず食い違う)ため、安全側を初期値にする。
   * 上限なしにしたい場合は明示的に選び直せる。
   */
  const handleEligibilityKindChange = (kind: CouponEligibilityKind) => {
    setEligibilityKind(kind);
    if (kind === 'birthday_month' && usageLimitKind === 'unlimited') {
      setUsageLimitKind('once_per_customer_per_year');
    }
  };

  const createMutation = useMutation({
    mutationFn: () =>
      createCoupon({
        code,
        name,
        discountKind,
        discountAmountYen: discountKind === 'amount' ? Number(discountAmountYen) : undefined,
        discountPercent: discountKind === 'percent' ? Number(discountPercent) : undefined,
        validFrom: validFrom || undefined,
        validTo: validTo || undefined,
        audience,
        eligibilityKind,
        // 誕生月クーポン以外に対象者を送るとサーバー側で拒否される
        // (coupons_birthday_subject_check と同じ条件)。
        birthdaySubject: eligibilityKind === 'birthday_month' ? birthdaySubject : undefined,
        usageLimitKind,
        note: note.trim() || undefined,
      }),
    onSuccess: () => {
      setNotice(`クーポン「${name}」を登録しました`);
      setCode('');
      setName('');
      setDiscountKind('amount');
      setDiscountAmountYen('');
      setDiscountPercent('');
      setValidFrom('');
      setValidTo('');
      setAudience('all');
      setEligibilityKind('manual');
      setBirthdaySubject('any');
      setUsageLimitKind('unlimited');
      setNote('');
      refresh();
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: (coupon: CouponView) => updateCoupon(coupon.id, { active: !coupon.active }),
    onSuccess: () => {
      setNotice(null);
      refresh();
    },
  });

  const errorMessage = createMutation.error?.message ?? toggleActiveMutation.error?.message ?? null;
  const busy = createMutation.isPending || toggleActiveMutation.isPending;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-[110] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-lg rounded-xl shadow-xl flex flex-col max-h-[90vh]">
        <div className="p-4 border-b flex justify-between items-center bg-gray-50 rounded-t-xl">
          <h3 className="font-bold text-gray-800 text-sm">🎟️ クーポン管理</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-2 hover:bg-gray-200 rounded-full text-gray-500"
          >
            &times;
          </button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createMutation.mutate();
            }}
            className="space-y-2 bg-gray-50 rounded-lg p-3"
          >
            <h4 className="text-xs font-bold text-gray-600">クーポンを追加</h4>
            <div className="flex gap-2">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                placeholder="コード(例 INTRO500)"
                aria-label="コード"
                className="flex-1 min-w-0 p-2 border border-gray-300 rounded text-sm"
              />
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="名前(例 紹介キャンペーン)"
                aria-label="名前"
                className="flex-1 min-w-0 p-2 border border-gray-300 rounded text-sm"
              />
            </div>

            <div className="flex gap-2">
              <select
                value={discountKind}
                onChange={(e) => handleDiscountKindChange(e.target.value as CouponDiscountKind)}
                aria-label="割引種別"
                className="w-28 shrink-0 p-2 border border-gray-300 rounded text-sm bg-white"
              >
                <option value="amount">金額引き</option>
                <option value="percent">率引き</option>
              </select>
              {/* 割引種別によって入力欄そのものを切り替える(片方しか送らないため、
                  もう片方の欄自体を出さないほうが「率引きなのに金額欄が残っている」ような
                  誤解を生まない)。 */}
              {discountKind === 'amount' ? (
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={discountAmountYen}
                  onChange={(e) => setDiscountAmountYen(e.target.value)}
                  required
                  placeholder="割引額(円)"
                  aria-label="割引額(円)"
                  className="flex-1 min-w-0 p-2 border border-gray-300 rounded text-sm"
                />
              ) : (
                <input
                  type="number"
                  min={1}
                  max={100}
                  step={1}
                  value={discountPercent}
                  onChange={(e) => setDiscountPercent(e.target.value)}
                  required
                  placeholder="割引率(1〜100)"
                  aria-label="割引率(1〜100)"
                  className="flex-1 min-w-0 p-2 border border-gray-300 rounded text-sm"
                />
              )}
            </div>

            <div className="flex gap-2 items-center">
              <label className="text-xs text-gray-500 shrink-0" htmlFor="couponValidFrom">
                有効期間
              </label>
              <input
                id="couponValidFrom"
                type="date"
                value={validFrom}
                onChange={(e) => setValidFrom(e.target.value)}
                className="flex-1 min-w-0 p-2 border border-gray-300 rounded text-sm"
              />
              <span className="text-gray-400 text-xs">〜</span>
              <input
                type="date"
                value={validTo}
                onChange={(e) => setValidTo(e.target.value)}
                aria-label="有効期間の終了日"
                className="flex-1 min-w-0 p-2 border border-gray-300 rounded text-sm"
              />
            </div>
            <p className="text-[10px] text-gray-400">※ 空欄はそれぞれ「下限なし」「無期限」になります。</p>

            {/* 適用条件・配布先・使用上限(doc/14 §9)。ここで決めた条件はサーバー側が判定するので、
                現場のスタッフは日報画面で「使えるものだけ」を見ることになる。 */}
            <div className="flex gap-2 items-center">
              <label className="text-xs text-gray-500 shrink-0 w-14" htmlFor="couponEligibilityKind">
                使える日
              </label>
              <select
                id="couponEligibilityKind"
                value={eligibilityKind}
                onChange={(e) => handleEligibilityKindChange(e.target.value as CouponEligibilityKind)}
                className="flex-1 min-w-0 p-2 border border-gray-300 rounded text-sm bg-white"
              >
                <option value="manual">いつでも(有効期間内)</option>
                <option value="birthday_month">誕生月のみ</option>
              </select>
              {eligibilityKind === 'birthday_month' && (
                <select
                  value={birthdaySubject}
                  onChange={(e) => setBirthdaySubject(e.target.value as CouponBirthdaySubject)}
                  aria-label="誕生日を見る対象者"
                  className="flex-1 min-w-0 p-2 border border-gray-300 rounded text-sm bg-white"
                >
                  <option value="any">世帯の誰か</option>
                  <option value="customer">世帯代表</option>
                  <option value="family_member">世帯構成員(お子さま等)</option>
                </select>
              )}
            </div>

            <div className="flex gap-2 items-center">
              <label className="text-xs text-gray-500 shrink-0 w-14" htmlFor="couponAudience">
                使える人
              </label>
              <select
                id="couponAudience"
                value={audience}
                onChange={(e) => setAudience(e.target.value as CouponAudience)}
                className="flex-1 min-w-0 p-2 border border-gray-300 rounded text-sm bg-white"
              >
                <option value="all">全ての顧客</option>
                <option value="assigned">配布した顧客のみ</option>
              </select>
              <select
                value={usageLimitKind}
                onChange={(e) => setUsageLimitKind(e.target.value as CouponUsageLimitKind)}
                aria-label="使用回数の上限"
                className="flex-1 min-w-0 p-2 border border-gray-300 rounded text-sm bg-white"
              >
                <option value="unlimited">回数制限なし</option>
                <option value="once_per_customer">顧客ごと1回まで</option>
                <option value="once_per_customer_per_year">顧客ごと年1回まで</option>
              </select>
            </div>
            {audience === 'assigned' && (
              <p className="text-[10px] text-gray-400">
                ※「配布した顧客のみ」は、顧客カルテの「クーポン」から配ってはじめて使えるようになります。
              </p>
            )}
            {eligibilityKind === 'birthday_month' && (
              <p className="text-[10px] text-gray-400">
                ※ 生年月日が登録されている方だけが対象です(顧客カルテで登録できます)。
              </p>
            )}

            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="備考(任意)"
              aria-label="備考"
              className="w-full p-2 border border-gray-300 rounded text-sm"
            />

            <button
              type="submit"
              disabled={busy}
              className="w-full py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-bold rounded"
            >
              {createMutation.isPending ? '登録中…' : '登録する'}
            </button>
          </form>

          {notice && <p className="text-green-600 text-xs">{notice}</p>}
          {errorMessage && <p className="text-red-500 text-xs">{errorMessage}</p>}

          {couponsQuery.isPending && (
            <div className="flex justify-center py-6">
              <div className="w-6 h-6 rounded-full border-4 border-gray-200 loading-spinner" />
            </div>
          )}
          {couponsQuery.isError && (
            <p className="text-red-500 text-sm">{(couponsQuery.error as Error).message}</p>
          )}

          <ul className="space-y-2">
            {(couponsQuery.data ?? []).map((coupon) => (
              <li
                key={coupon.id}
                className={`rounded-lg border p-3 text-sm ${
                  coupon.active ? 'border-gray-200' : 'bg-gray-50 border-gray-200 text-gray-500'
                }`}
              >
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0">
                    <p className="font-bold break-words">
                      {coupon.name}
                      <span className="ml-2 text-xs font-normal text-gray-400">{coupon.code}</span>
                    </p>
                    <p className="text-xs text-gray-500">
                      {discountLabel(coupon)} ・ {periodLabel(coupon)}
                    </p>
                    {conditionLabels(coupon).length > 0 && (
                      <p className="text-xs text-gray-500 mt-0.5 flex flex-wrap gap-1">
                        {conditionLabels(coupon).map((label) => (
                          <span key={label} className="bg-gray-100 rounded px-1.5 py-0.5">
                            {label}
                          </span>
                        ))}
                      </p>
                    )}
                    {coupon.note && <p className="text-xs text-gray-400 break-words mt-0.5">{coupon.note}</p>}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    {!coupon.active && (
                      <span className="text-xs bg-gray-200 text-gray-600 rounded px-1.5 py-0.5">
                        廃止済み
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 mt-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => toggleActiveMutation.mutate(coupon)}
                    className="text-xs px-2 py-1 rounded border border-gray-300 hover:bg-gray-100 disabled:opacity-60"
                  >
                    {coupon.active ? '廃止にする' : '有効に戻す'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="p-4 border-t bg-gray-50 rounded-b-xl text-right">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-gray-600 text-white text-sm rounded-lg hover:bg-gray-700"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
