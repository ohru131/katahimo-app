import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { fetchCustomerDetail } from './api';

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div>
      <dt style={{ fontSize: '0.8rem', color: '#666' }}>{label}</dt>
      <dd style={{ margin: 0 }}>{value}</dd>
    </div>
  );
}

function formatDateTime(value: string | null): string | null {
  if (!value) return null;
  return new Date(value).toLocaleString('ja-JP');
}

/** 顧客1件の全項目(世帯構成員含む)を表示する詳細画面。Phase 4(読み取り系)の範囲のため編集はできない。 */
export function CustomerDetail() {
  const { id } = useParams<{ id: string }>();
  const query = useQuery({
    queryKey: ['customer', id],
    queryFn: () => fetchCustomerDetail(id ?? ''),
    enabled: !!id,
  });

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem', maxWidth: 560 }}>
      <p>
        <Link to="/">← 検索に戻る</Link>
      </p>

      {query.isPending && <p>読み込み中…</p>}
      {query.isError && <p style={{ color: '#b91c1c' }}>{query.error.message}</p>}

      {query.data && (
        <>
          <h1>{query.data.name}</h1>
          {query.data.deactivatedAt && (
            <p style={{ color: '#b91c1c' }}>この顧客は取込元で消失したためソフトデリートされています。</p>
          )}

          <section>
            <h2>基本情報</h2>
            <dl style={{ display: 'grid', gap: '0.5rem' }}>
              <Field label="姓カナ" value={query.data.familyNameKana} />
              <Field label="名カナ" value={query.data.givenNameKana} />
              <Field label="性別" value={query.data.gender} />
              <Field label="年代" value={query.data.ageBracket} />
              <Field label="メールアドレス" value={query.data.email} />
              <Field label="電話番号" value={query.data.phone} />
            </dl>
          </section>

          <section>
            <h2>住所・駐車場</h2>
            <dl style={{ display: 'grid', gap: '0.5rem' }}>
              <Field label="市区町村" value={query.data.city} />
              <Field label="住所" value={query.data.addressDetail} />
              <Field label="住所2" value={query.data.address2} />
              <Field label="駐車場" value={query.data.parkingArea} />
              <Field label="駐車場詳細" value={query.data.parkingDetail} />
              <Field label="緯度経度" value={query.data.latLng} />
            </dl>
          </section>

          <section>
            <h2>緊急時</h2>
            <dl style={{ display: 'grid', gap: '0.5rem' }}>
              <Field label="緊急連絡先" value={query.data.emergencyContact} />
              <Field label="続柄" value={query.data.emergencyContactRelation} />
              <Field label="避難場所" value={query.data.evacuationSite} />
            </dl>
          </section>

          <section>
            <h2>会員情報</h2>
            <dl style={{ display: 'grid', gap: '0.5rem' }}>
              <Field label="会員種別" value={query.data.memberType} />
              <Field label="会員状況" value={query.data.memberStatus} />
              <Field label="支払方法" value={query.data.paymentMethod} />
              <Field label="支払状況" value={query.data.paymentStatus} />
              <Field label="Benefit会員ID" value={query.data.benefitMemberId} />
              <Field label="登録日時" value={formatDateTime(query.data.registeredAt)} />
              <Field label="最終更新日時(取込元)" value={formatDateTime(query.data.externalLastUpdatedAt)} />
            </dl>
          </section>

          {query.data.memo && (
            <section>
              <h2>顧客メモ</h2>
              <p>{query.data.memo}</p>
            </section>
          )}

          <section>
            <h2>世帯構成員</h2>
            {query.data.familyMembers.length === 0 && <p>登録されている世帯構成員はいません</p>}
            <ul style={{ paddingLeft: '1.25rem' }}>
              {query.data.familyMembers.map((m) => (
                <li key={m.id}>
                  {m.name}
                  {m.dob && `(${m.dob})`}
                  {m.info && ` - ${m.info}`}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </main>
  );
}
