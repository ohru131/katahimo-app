import { useQuery } from '@tanstack/react-query';
import { useAdminTargetStaff } from './AdminTargetStaffContext';
import { fetchCustomerDetail } from './api';
import { CustomerCouponSection } from './CustomerCouponSection';
import { Button, ErrorNotice, LoadingBlock, toFriendlyMessage } from './ui';

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="min-w-0">
      <dt className="text-sm text-app-muted">{label}</dt>
      <dd className="break-words text-base text-app-text">{value}</dd>
    </div>
  );
}

/**
 * メール/電話番号の値に、そのまま送る・かけるためのボタン(mailto:/tel:)を添える。
 * GAS版showCustomerDetailの「キーに'メール'/'電話'を含む場合はボタンを付ける」ロジックと同じ。
 * アイコンだけのボタンは作らない決めごと(提案書「絶対に守ること」4)に合わせて文字を添え、
 * 高さも44px以上にしてある。長いメールアドレスで折り返せるように、値は1列分の幅を使う。
 */
function ContactField({
  label,
  value,
  type,
}: {
  label: string;
  value: string | null | undefined;
  type: 'email' | 'phone';
}) {
  if (!value) return null;
  const href = type === 'email' ? `mailto:${value}` : `tel:${value}`;
  return (
    <div className="col-span-2 min-w-0">
      <dt className="text-sm text-app-muted">{label}</dt>
      <dd className="text-base text-app-text">
        <p className="break-words">{value}</p>
        <a
          href={href}
          className="mt-2 inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-btn border border-gray-300 bg-white px-4 text-base font-bold text-app-text active:bg-gray-100"
        >
          {type === 'email' ? '✉️ メールを送る' : '📞 電話をかける'}
        </a>
      </dd>
    </div>
  );
}

/**
 * 住所の値に地図を開くボタンを添える。GAS版showCustomerDetailと同じく、緯度経度が
 * わかっていればそちらを優先してクエリに使う(住所文字列だけより正確なため)。GAS版が
 * 「住所2」を対象外にしている(`!key.includes('2')`)のと同じく、この関数は主住所にのみ使う。
 */
function AddressField({
  label,
  value,
  lat,
  lng,
}: {
  label: string;
  value: string | null | undefined;
  lat: number | null | undefined;
  lng: number | null | undefined;
}) {
  if (!value) return null;
  // doc/14 §7でlat/lngが数値になった。数値として分かっていれば住所文字列より優先して
  // クエリに使う(GAS版と同じ、住所文字列よりも正確なため)。
  const mapQuery = lat != null && lng != null ? `${lat},${lng}` : value;
  const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`;
  return (
    <div className="col-span-2 min-w-0">
      <dt className="text-sm text-app-muted">{label}</dt>
      <dd className="text-base text-app-text">
        <p className="break-words">{value}</p>
        <a
          href={mapUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-btn border border-gray-300 bg-white px-4 text-base font-bold text-app-text active:bg-gray-100"
        >
          🗺️ 道順を見る
        </a>
      </dd>
    </div>
  );
}

function formatDateTime(value: string | null): string | null {
  if (!value) return null;
  return new Date(value).toLocaleString('ja-JP');
}

/** 見出し。中身が分かる言葉にする(言いかえ表「顧客詳細情報/ご家族情報/基本情報」の行)。 */
function SectionTitle({ children }: { children: string }) {
  return <h3 className="mb-2 text-base font-bold text-app-text">{children}</h3>;
}

/**
 * お客様1件の全項目(ご家族含む)を表示するモーダル。Phase 4(読み取り系)の範囲のため
 * 編集はできない。GAS版のreportModal(下からスライドインするボトムシート)と同じ見た目にしている
 * (移行時の混乱を減らすため)。GAS版にあった日報/事故報告作成タブは、対応するバックエンド機能
 * (Gemini連携)がまだ無いため、このモーダルには含めていない。
 */
export function CustomerDetail({ customerId, onClose }: { customerId: string; onClose: () => void }) {
  const query = useQuery({
    queryKey: ['customer', customerId],
    queryFn: () => fetchCustomerDetail(customerId),
  });
  // クーポンの配布と生年月日の登録は請求額に影響するため、管理者にだけ出す
  // (APIも管理者限定。routes/coupons.ts / routes/customers.ts のPATCH参照)。
  const { isAdmin } = useAdminTargetStaff();

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black bg-opacity-50 sm:items-center">
      <div className="flex h-[90vh] w-full max-w-md flex-col rounded-t-card border border-gray-200 bg-white sm:h-auto sm:max-h-[85vh] sm:rounded-card">
        <div className="flex items-center justify-between gap-3 rounded-t-card border-b border-gray-200 bg-gray-50 p-4">
          <div className="min-w-0">
            <p className="text-sm text-app-muted">お客様の情報</p>
            <h2 className="break-words text-lg font-bold text-app-text">
              {query.data?.name ?? '読み込んでいます…'}
            </h2>
            {query.data?.city && <p className="text-sm text-app-muted">{query.data.city}</p>}
          </div>
          <Button variant="subtle" size="sub" onClick={onClose} className="flex-shrink-0">
            ✕ 閉じる
          </Button>
        </div>

        <div className="flex-grow space-y-5 overflow-y-auto p-4">
          {query.isPending && <LoadingBlock text="読み込んでいます…" />}
          {query.isError && (
            <ErrorNotice
              text={toFriendlyMessage(
                query.error,
                'CustomerDetail.fetchCustomerDetail',
                'お客様の情報を読み込めませんでした。電波を確認して、もう一度開いてください',
              )}
            />
          )}

          {query.data && (
            <>
              {query.data.deactivatedAt && (
                <ErrorNotice text="このお客様は登録元の一覧から消えています(事務局へ連絡してください)" />
              )}

              <section>
                <SectionTitle>住所・連絡先</SectionTitle>
                <dl className="grid grid-cols-2 gap-3">
                  <AddressField
                    label="住所"
                    value={query.data.addressDetail}
                    lat={query.data.lat}
                    lng={query.data.lng}
                  />
                  <Field label="住所2" value={query.data.address2} />
                  <ContactField label="電話番号" value={query.data.phone} type="phone" />
                  <ContactField label="メールアドレス" value={query.data.email} type="email" />
                  <Field label="駐車場" value={query.data.parkingArea} />
                  <Field label="駐車場の詳しい場所" value={query.data.parkingDetail} />
                  <Field
                    label="地図の位置(緯度経度)"
                    value={
                      query.data.lat != null && query.data.lng != null
                        ? `${query.data.lat}, ${query.data.lng}`
                        : query.data.latLngRaw
                    }
                  />
                </dl>
              </section>

              <section>
                <SectionTitle>お名前・生年月日</SectionTitle>
                <dl className="grid grid-cols-2 gap-3">
                  <Field label="姓カナ" value={query.data.familyNameKana} />
                  <Field label="名カナ" value={query.data.givenNameKana} />
                  <Field label="性別" value={query.data.gender} />
                  <Field label="年代" value={query.data.ageBracket} />
                  <Field label="生年月日" value={query.data.dobRaw ?? query.data.dobDate} />
                </dl>
              </section>

              <section>
                <SectionTitle>緊急時</SectionTitle>
                <dl className="grid grid-cols-2 gap-3">
                  <Field label="緊急連絡先" value={query.data.emergencyContact} />
                  <Field label="続柄" value={query.data.emergencyContactRelation} />
                  <Field label="避難場所" value={query.data.evacuationSite} />
                </dl>
              </section>

              <section>
                <SectionTitle>会員情報</SectionTitle>
                <dl className="grid grid-cols-2 gap-3">
                  <Field label="会員種別" value={query.data.memberType} />
                  <Field label="会員状況" value={query.data.memberStatus} />
                  <Field label="支払方法" value={query.data.paymentMethod} />
                  <Field label="支払状況" value={query.data.paymentStatus} />
                  <Field label="Benefit会員ID" value={query.data.benefitMemberId} />
                  <Field label="登録日時" value={formatDateTime(query.data.registeredAt)} />
                  <Field
                    label="登録元での最終更新"
                    value={formatDateTime(query.data.externalLastUpdatedAt)}
                  />
                </dl>
              </section>

              {query.data.memo && (
                <section>
                  <SectionTitle>お客様メモ</SectionTitle>
                  <p className="rounded-card border border-gray-200 bg-gray-50 p-3 text-base leading-relaxed text-app-text">
                    {query.data.memo}
                  </p>
                </section>
              )}

              <section>
                <SectionTitle>お子様・ご家族</SectionTitle>
                {query.data.familyMembers.length === 0 && (
                  <p className="text-sm text-app-muted">登録されているお子様・ご家族はいません</p>
                )}
                <ul className="space-y-2">
                  {query.data.familyMembers.map((m) => (
                    <li
                      key={m.id}
                      className="rounded-card border border-gray-200 bg-gray-50 p-3 text-base text-app-text"
                    >
                      {m.name}
                      {(m.dobRaw ?? m.dobDate) && `(${m.dobRaw ?? m.dobDate})`}
                      {m.info && ` - ${m.info}`}
                    </li>
                  ))}
                </ul>
              </section>

              {/* key にお客様IDを入れて、お客様が変わったら作り直す。生年月日の入力途中や配布する
                  クーポンの選択といったお客様固有の状態を、前のお客様のまま持ち越さない
                  (生年月日が両方とも未登録のお客様へ切り替えると props の値が変わらないので、
                  state のリセットだけでは取りこぼす)。 */}
              {isAdmin && (
                <CustomerCouponSection key={customerId} customerId={customerId} dobRaw={query.data.dobRaw} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
