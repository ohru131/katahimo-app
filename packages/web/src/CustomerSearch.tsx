import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { searchCustomersByFamilyName } from './api';
import { CustomerDetail } from './CustomerDetail';

/**
 * 「訪問先一覧」タブ。GAS版のtabVisitors(index.html)と同じ検索欄・カード一覧の見た目にしている
 * (移行時の混乱を減らすため)。ただしGAS版は顧客名の部分一致でその場で絞り込むのに対し、
 * こちらはブラインドインデックス方式のため「苗字の完全一致」のみ対応(検索ボタンを押して
 * サーバーに問い合わせる方式)。プレースホルダー文言はその違いが伝わるようにしている。
 */
export function CustomerSearch() {
  const [familyName, setFamilyName] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const mutation = useMutation({ mutationFn: (name: string) => searchCustomersByFamilyName(name) });

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (familyName.trim()) mutation.mutate(familyName.trim());
        }}
        className="mb-6 space-y-3"
      >
        <div className="relative flex-grow">
          <input
            type="text"
            value={familyName}
            onChange={(e) => setFamilyName(e.target.value)}
            placeholder="苗字で検索(完全一致・例: 佐藤)"
            className="w-full pl-10 pr-4 py-3 rounded-xl border-none ring-1 ring-gray-200 focus:ring-2 focus:ring-blue-500 bg-gray-50 text-base shadow-sm transition-all"
          />
          <svg
            className="w-5 h-5 absolute left-3 top-3.5 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>
        <button
          type="submit"
          disabled={mutation.isPending}
          className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-bold rounded-xl transition-colors"
        >
          {mutation.isPending ? '検索中…' : '検索'}
        </button>
      </form>

      {mutation.isError && <p className="text-red-500 text-sm mb-3">{mutation.error.message}</p>}

      {mutation.isPending && (
        <div className="flex justify-center py-8">
          <div className="w-8 h-8 rounded-full border-4 border-gray-200 loading-spinner" />
        </div>
      )}

      {mutation.isSuccess && (
        <div className="space-y-3">
          {mutation.data.length === 0 && (
            <div className="text-center text-gray-400 py-8">該当する顧客がいません</div>
          )}
          {mutation.data.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setSelectedCustomerId(c.id)}
              className="w-full bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex justify-between items-center cursor-pointer hover:shadow-md transition-shadow active:bg-gray-50 text-left"
            >
              <div className="flex-grow">
                <h3 className="font-bold text-gray-800 text-lg">{c.name}</h3>
                {c.city && (
                  <p className="text-sm text-gray-500 flex items-center gap-1">
                    <span className="inline-block px-2 py-0.5 bg-gray-100 rounded text-xs">{c.city}</span>
                  </p>
                )}
              </div>
              <div className="text-blue-500">
                <svg
                  className="w-6 h-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </button>
          ))}
        </div>
      )}

      {selectedCustomerId && (
        <CustomerDetail customerId={selectedCustomerId} onClose={() => setSelectedCustomerId(null)} />
      )}
    </div>
  );
}
