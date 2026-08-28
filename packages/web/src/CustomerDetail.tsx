import { useQuery } from '@tanstack/react-query';
import { fetchCustomerDetail } from './api';

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="text-sm text-gray-800">{value}</dd>
    </div>
  );
}

function formatDateTime(value: string | null): string | null {
  if (!value) return null;
  return new Date(value).toLocaleString('ja-JP');
}

/**
 * 顧客1件の全項目(世帯構成員含む)を表示する詳細モーダル。Phase 4(読み取り系)の範囲のため
 * 編集はできない。GAS版のreportModal(下からスライドインするボトムシート)と同じ見た目にしている
 * (移行時の混乱を減らすため)。GAS版にあった日報/事故報告作成タブは、対応するバックエンド機能
 * (Gemini連携)がまだ無いため、このモーダルには含めていない。
 */
export function CustomerDetail({ customerId, onClose }: { customerId: string; onClose: () => void }) {
  const query = useQuery({
    queryKey: ['customer', customerId],
    queryFn: () => fetchCustomerDetail(customerId),
  });

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-end sm:items-center justify-center">
      <div className="bg-white w-full max-w-md h-[90vh] sm:h-auto sm:max-h-[85vh] sm:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col">
        <div className="p-4 border-b flex justify-between items-center bg-gray-50 rounded-t-2xl">
          <div>
            <h2 className="font-bold text-lg text-gray-800">{query.data?.name ?? '読み込み中…'}</h2>
            {query.data?.city && <p className="text-xs text-gray-500">{query.data.city}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 hover:bg-gray-200 rounded-full text-gray-500 text-xl leading-none"
          >
            &times;
          </button>
        </div>

        <div className="flex-grow overflow-y-auto p-4 space-y-5">
          {query.isPending && (
            <div className="flex justify-center py-8">
              <div className="w-8 h-8 rounded-full border-4 border-gray-200 loading-spinner" />
            </div>
          )}
          {query.isError && <p className="text-red-500 text-sm">{query.error.message}</p>}

          {query.data && (
            <>
              {query.data.deactivatedAt && (
                <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg p-2">
                  この顧客は取込元で消失したためソフトデリートされています。
                </p>
              )}

              <section>
                <h3 className="font-bold text-gray-700 text-sm mb-2">基本情報</h3>
                <dl className="grid grid-cols-2 gap-3">
                  <Field label="姓カナ" value={query.data.familyNameKana} />
                  <Field label="名カナ" value={query.data.givenNameKana} />
                  <Field label="性別" value={query.data.gender} />
                  <Field label="年代" value={query.data.ageBracket} />
                  <Field label="メールアドレス" value={query.data.email} />
                  <Field label="電話番号" value={query.data.phone} />
                </dl>
              </section>

              <section>
                <h3 className="font-bold text-gray-700 text-sm mb-2">住所・駐車場</h3>
                <dl className="grid grid-cols-2 gap-3">
                  <Field label="住所" value={query.data.addressDetail} />
                  <Field label="住所2" value={query.data.address2} />
                  <Field label="駐車場" value={query.data.parkingArea} />
                  <Field label="駐車場詳細" value={query.data.parkingDetail} />
                  <Field label="緯度経度" value={query.data.latLng} />
                </dl>
              </section>

              <section>
                <h3 className="font-bold text-gray-700 text-sm mb-2">緊急時</h3>
                <dl className="grid grid-cols-2 gap-3">
                  <Field label="緊急連絡先" value={query.data.emergencyContact} />
                  <Field label="続柄" value={query.data.emergencyContactRelation} />
                  <Field label="避難場所" value={query.data.evacuationSite} />
                </dl>
              </section>

              <section>
                <h3 className="font-bold text-gray-700 text-sm mb-2">会員情報</h3>
                <dl className="grid grid-cols-2 gap-3">
                  <Field label="会員種別" value={query.data.memberType} />
                  <Field label="会員状況" value={query.data.memberStatus} />
                  <Field label="支払方法" value={query.data.paymentMethod} />
                  <Field label="支払状況" value={query.data.paymentStatus} />
                  <Field label="Benefit会員ID" value={query.data.benefitMemberId} />
                  <Field label="登録日時" value={formatDateTime(query.data.registeredAt)} />
                  <Field
                    label="最終更新日時(取込元)"
                    value={formatDateTime(query.data.externalLastUpdatedAt)}
                  />
                </dl>
              </section>

              {query.data.memo && (
                <section>
                  <h3 className="font-bold text-gray-700 text-sm mb-2">顧客メモ</h3>
                  <p className="text-sm text-gray-800 bg-gray-50 rounded-lg p-2">{query.data.memo}</p>
                </section>
              )}

              <section>
                <h3 className="font-bold text-gray-700 text-sm mb-2">世帯構成員</h3>
                {query.data.familyMembers.length === 0 && (
                  <p className="text-sm text-gray-400">登録されている世帯構成員はいません</p>
                )}
                <ul className="space-y-1">
                  {query.data.familyMembers.map((m) => (
                    <li key={m.id} className="text-sm text-gray-800 bg-gray-50 rounded-lg p-2">
                      {m.name}
                      {m.dob && `(${m.dob})`}
                      {m.info && ` - ${m.info}`}
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
