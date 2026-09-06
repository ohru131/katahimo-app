import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import type { StaffView } from './api';
import { login } from './api';
import { getDemoRuntime, IS_DEMO_MODE } from './demo/demoRuntime';

/**
 * GAS版(gas-childcare-visit-app/index.html)のログインモーダルと同じ見た目・文言にしている
 * (移行時の混乱を減らすため)。マルチテナントSaaS化に伴い法人ID(tenantSlug)欄のみ追加。
 */
export function LoginForm({ onLoggedIn }: { onLoggedIn: (staff: StaffView) => void }) {
  // デモビルドでは、初見の人がそのままログインできるよう管理者アカウントを入れておく。
  const demoRuntime = IS_DEMO_MODE ? getDemoRuntime() : null;
  const defaultAccount = demoRuntime?.credentials[0];

  const [tenantSlug, setTenantSlug] = useState(demoRuntime?.tenantSlug ?? 'demo');
  const [email, setEmail] = useState(defaultAccount?.email ?? 'admin@example.com');
  const [password, setPassword] = useState(defaultAccount?.password ?? '');

  const mutation = useMutation({
    mutationFn: () => login(tenantSlug, email, password),
    onSuccess: onLoggedIn,
  });

  return (
    <div className="fixed inset-0 bg-gray-900 z-50 flex items-center justify-center p-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
        className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm space-y-6"
      >
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-800">ログイン</h2>
          <p className="text-sm text-gray-500 mt-1">スタッフ情報を入力してください</p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="loginTenant">
              法人ID
            </label>
            <input
              id="loginTenant"
              value={tenantSlug}
              onChange={(e) => setTenantSlug(e.target.value)}
              required
              className="w-full p-3 rounded-xl border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="loginEmail">
              メールアドレス
            </label>
            <input
              id="loginEmail"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="ex: staff@example.com"
              className="w-full p-3 rounded-xl border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="loginPassword">
              パスワード
            </label>
            <input
              id="loginPassword"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="••••••••"
              className="w-full p-3 rounded-xl border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>
        </div>

        {demoRuntime && demoRuntime.credentials.length > 0 && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 space-y-2">
            <p className="text-xs text-amber-900 font-medium">デモ用アカウント(タップで入力)</p>
            {demoRuntime.credentials.map((account) => (
              <button
                key={account.email}
                type="button"
                onClick={() => {
                  setTenantSlug(demoRuntime.tenantSlug);
                  setEmail(account.email);
                  setPassword(account.password);
                }}
                className="w-full text-left text-xs bg-white hover:bg-amber-100 border border-amber-200 rounded-lg px-2 py-1.5"
              >
                <span className="font-bold">{account.label}</span> {account.name} / {account.email} /{' '}
                {account.password}
              </button>
            ))}
          </div>
        )}

        <div className="text-red-500 text-sm text-center min-h-[1.25rem]">
          {mutation.isError ? mutation.error.message : ''}
        </div>

        <button
          type="submit"
          disabled={mutation.isPending}
          className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-bold rounded-xl transition-colors"
        >
          {mutation.isPending ? 'ログイン中…' : 'ログイン'}
        </button>
      </form>
    </div>
  );
}
