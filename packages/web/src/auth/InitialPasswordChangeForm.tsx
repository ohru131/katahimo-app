import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import type { StaffView } from '../api';
import { changePassword, fetchMe } from '../api';

/**
 * 初期パスワードのままログインした人に、変更を終えるまで他の画面を見せない。
 *
 * 見た目上ここで止めるだけでなく、サーバー側もパスワード変更以外のAPIを
 * 403で拒否している(packages/api/src/session.ts requirePasswordChangeGuard)。
 * 画面だけの制限にすると、APIを直接叩けば通ってしまうため。
 */
export function InitialPasswordChangeForm({
  staff,
  onChanged,
  onLogout,
}: {
  staff: StaffView;
  onChanged: (staff: StaffView) => void;
  onLogout: () => void;
}) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [mismatch, setMismatch] = useState(false);

  const mutation = useMutation({
    mutationFn: async () => {
      await changePassword(currentPassword, newPassword);
      // 強制変更フラグが下りた状態を取り直す。ここで古いstaffを使い回すと、
      // 変更したのにこの画面から抜けられない。
      return fetchMe();
    },
    onSuccess: (updated) => {
      // 変更中にセッションが切れた場合は取り直せない。そのままだと古い状態のまま
      // この画面が出続けるので、ログイン画面へ戻す。
      if (updated) onChanged(updated);
      else onLogout();
    },
  });

  const inputClass =
    'w-full p-3 rounded-xl border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:outline-none';

  return (
    <div className="fixed inset-0 bg-gray-900 z-50 flex items-center justify-center p-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (newPassword !== confirmPassword) {
            setMismatch(true);
            return;
          }
          setMismatch(false);
          mutation.mutate();
        }}
        className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm space-y-5"
      >
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-800">パスワードの変更</h2>
          <p className="text-sm text-gray-500 mt-1">
            初期パスワードのままです。ご自身のパスワードに変更してください。
          </p>
        </div>

        <p className="text-xs text-gray-500 bg-gray-50 rounded-lg p-2">
          {staff.name} 様({staff.email})
        </p>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="initialCurrent">
              初期パスワード
            </label>
            <input
              id="initialCurrent"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              autoComplete="current-password"
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="initialNew">
              新しいパスワード
            </label>
            <input
              id="initialNew"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              autoComplete="new-password"
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="initialConfirm">
              新しいパスワード(確認)
            </label>
            <input
              id="initialConfirm"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              autoComplete="new-password"
              className={inputClass}
            />
          </div>
        </div>

        <div className="text-red-500 text-sm text-center min-h-[1.25rem]">
          {mismatch ? '新しいパスワードが一致しません' : mutation.isError ? mutation.error.message : ''}
        </div>

        <button
          type="submit"
          disabled={mutation.isPending}
          className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-bold rounded-xl transition-colors"
        >
          {mutation.isPending ? '変更中…' : 'パスワードを変更して続ける'}
        </button>

        <button
          type="button"
          onClick={onLogout}
          className="w-full text-sm text-gray-500 hover:text-gray-700 underline"
        >
          ログアウト
        </button>
      </form>
    </div>
  );
}
