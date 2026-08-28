import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { searchCustomersByFamilyName } from './api';

/**
 * 苗字(姓)の完全一致検索。ブラインドインデックス方式のため部分一致/前方一致はできない
 * (packages/core/src/usecases/customers.ts の searchCustomersByFamilyName 参照)。
 */
export function CustomerSearch() {
  const [familyName, setFamilyName] = useState('');
  const mutation = useMutation({ mutationFn: (name: string) => searchCustomersByFamilyName(name) });

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (familyName.trim()) mutation.mutate(familyName.trim());
        }}
        style={{ display: 'flex', gap: '0.5rem', maxWidth: 320 }}
      >
        <input
          value={familyName}
          onChange={(e) => setFamilyName(e.target.value)}
          placeholder="苗字で検索(例: 佐藤)"
        />
        <button type="submit" disabled={mutation.isPending}>
          検索
        </button>
      </form>

      {mutation.isError && <p style={{ color: '#b91c1c' }}>{mutation.error.message}</p>}
      {mutation.isSuccess && (
        <ul style={{ marginTop: '1rem', paddingLeft: '1.25rem' }}>
          {mutation.data.length === 0 && <li>該当する顧客が見つかりません</li>}
          {mutation.data.map((c) => (
            <li key={c.id}>
              <Link to={`/customers/${c.id}`}>{c.name}</Link>
              {c.city && `(${c.city})`}
              {c.phone && ` / ${c.phone}`}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
