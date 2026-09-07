import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { requestPasswordReset, resetPasswordWithCode } from '../api';

/**
 * パスワード再設定。GAS版 Auth.js の requestPasswordReset / resetPasswordWithCode に対応する画面。
 *
 * 「コードを送った」の案内は、そのメールアドレスが登録されているかに関係なく同じ文面を出す。
 * ここで出し分けると、誰でも「この事業所に誰が登録されているか」を確かめられてしまう
 * (サーバー側も同じ理由で結果を返していない)。
 */
export function ForgotPasswordForm({
  tenantSlug: initialTenantSlug,
  email: initialEmail,
  onDone,
  onCancel,
}: {
  tenantSlug: string;
  email: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [tenantSlug, setTenantSlug] = useState(initialTenantSlug);
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [mismatch, setMismatch] = useState(false);
  // 「コードを送った」画面へ進んだか。送信済みでもメールが届かない場合に備え、戻れるようにする。
  const [codeSent, setCodeSent] = useState(false);

  const requestMutation = useMutation({
    mutationFn: () => requestPasswordReset(tenantSlug, email),
    onSuccess: () => setCodeSent(true),
  });

  const resetMutation = useMutation({
    mutationFn: () => resetPasswordWithCode({ tenantSlug, email, code, newPassword }),
    onSuccess: onDone,
  });

  const submitReset = () => {
    if (newPassword !== confirmPassword) {
      setMismatch(true);
      return;
    }
    setMismatch(false);
    resetMutation.mutate();
  };

  const inputClass =
    'w-full p-3 rounded-xl border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:outline-none';

  return (
    <div className="fixed inset-0 bg-gray-900 z-50 flex items-center justify-center p-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (codeSent) submitReset();
          else requestMutation.mutate();
        }}
        className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm space-y-5"
      >
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-800">パスワードの再設定</h2>
          <p className="text-sm text-gray-500 mt-1">
            {codeSent
              ? 'メールに記載された認証コードを入力してください'
              : '登録済みのメールアドレスに認証コードを送ります'}
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="resetTenant">
              法人ID
            </label>
            <input
              id="resetTenant"
              value={tenantSlug}
              onChange={(e) => setTenantSlug(e.target.value)}
              required
              disabled={codeSent}
              className={`${inputClass} disabled:bg-gray-100`}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="resetEmail">
              メールアドレス
            </label>
            <input
              id="resetEmail"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={codeSent}
              className={`${inputClass} disabled:bg-gray-100`}
            />
          </div>

          {codeSent && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="resetCode">
                  認証コード(6桁)
                </label>
                <input
                  id="resetCode"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  required
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  className={`${inputClass} tracking-[0.4em] text-center font-mono`}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="resetNewPassword">
                  新しいパスワード
                </label>
                <input
                  id="resetNewPassword"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="resetConfirm">
                  新しいパスワード(確認)
                </label>
                <input
                  id="resetConfirm"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  className={inputClass}
                />
              </div>
            </>
          )}
        </div>

        {codeSent && !resetMutation.isError && !mismatch && (
          <p className="text-xs text-gray-500 bg-gray-50 rounded-lg p-2 leading-relaxed">
            登録済みのメールアドレスであれば、認証コードを送信しました(有効期限30分)。
            届かない場合は、迷惑メールフォルダと入力したメールアドレスをご確認ください。
          </p>
        )}

        <div className="text-red-500 text-sm text-center min-h-[1.25rem]">
          {mismatch
            ? '新しいパスワードが一致しません'
            : resetMutation.isError
              ? resetMutation.error.message
              : requestMutation.isError
                ? requestMutation.error.message
                : ''}
        </div>

        <button
          type="submit"
          disabled={requestMutation.isPending || resetMutation.isPending}
          className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-bold rounded-xl transition-colors"
        >
          {codeSent
            ? resetMutation.isPending
              ? '再設定中…'
              : 'パスワードを再設定'
            : requestMutation.isPending
              ? '送信中…'
              : '認証コードを送る'}
        </button>

        <button
          type="button"
          // メールアドレスを入れ直すときは、前のコードと「コードが違います」の表示も消す。
          // 残しておくと、コードを再送した直後に古いエラーが出たままになる。
          onClick={
            codeSent
              ? () => {
                  setCodeSent(false);
                  setCode('');
                  setNewPassword('');
                  setConfirmPassword('');
                  setMismatch(false);
                  resetMutation.reset();
                }
              : onCancel
          }
          className="w-full text-sm text-gray-500 hover:text-gray-700 underline"
        >
          {codeSent ? 'メールアドレスを入力し直す' : 'ログイン画面に戻る'}
        </button>
      </form>
    </div>
  );
}
