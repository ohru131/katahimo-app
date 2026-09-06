import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { StaffAdminView } from '../api';
import { createStaff, fetchStaffForAdmin, resetStaffPassword, updateStaff } from '../api';

/** 今日の 'YYYY-MM-DD'(退職日の既定値)。 */
function todayIso(): string {
  return new Date().toLocaleDateString('sv-SE');
}

/**
 * 管理者によるスタッフの登録・編集。GAS版には無かった画面で、GAS版では
 * スタッフ台帳のスプレッドシートを直接編集していた作業に相当する。
 *
 * パスワードはここでは扱わない。管理者が決めるのではなく、登録時にサーバー側で
 * 作った初期パスワードを本人のメールへ送り、本人が変更するまで他の操作を止める
 * (管理者が本人のパスワードを知っている状態を作らないため)。
 */
export function StaffAdminModal({ selfStaffId, onClose }: { selfStaffId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const staffQuery = useQuery({ queryKey: ['staff-admin'], queryFn: fetchStaffForAdmin });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['staff-admin'] });
    // 「対象スタッフ」セレクタ(予定/勤怠タブ)も退職・追加を反映させる。
    queryClient.invalidateQueries({ queryKey: ['active-staff-for-admin'] });
  };

  const createMutation = useMutation({
    mutationFn: () => createStaff({ name, email, isAdmin }),
    onSuccess: () => {
      setNotice(`${email} に初期パスワードを送信しました`);
      setName('');
      setEmail('');
      setIsAdmin(false);
      refresh();
    },
  });

  const updateMutation = useMutation({
    mutationFn: (input: { staffId: string; patch: Parameters<typeof updateStaff>[1] }) =>
      updateStaff(input.staffId, input.patch),
    onSuccess: () => {
      setNotice(null);
      refresh();
    },
  });

  const resetMutation = useMutation({
    mutationFn: (staff: StaffAdminView) => resetStaffPassword(staff.id),
    onSuccess: (_result, staff) => {
      setNotice(`${staff.email} に新しい初期パスワードを送信しました`);
      refresh();
    },
  });

  const errorMessage =
    createMutation.error?.message ?? updateMutation.error?.message ?? resetMutation.error?.message ?? null;
  const busy = createMutation.isPending || updateMutation.isPending || resetMutation.isPending;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-[110] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-lg rounded-xl shadow-xl flex flex-col max-h-[90vh]">
        <div className="p-4 border-b flex justify-between items-center bg-gray-50 rounded-t-xl">
          <h3 className="font-bold text-gray-800 text-sm">👥 スタッフ管理</h3>
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
            <h4 className="text-xs font-bold text-gray-600">スタッフを追加</h4>
            <div className="flex gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="氏名"
                aria-label="氏名"
                className="flex-1 min-w-0 p-2 border border-gray-300 rounded text-sm"
              />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="メールアドレス"
                aria-label="メールアドレス"
                className="flex-1 min-w-0 p-2 border border-gray-300 rounded text-sm"
              />
            </div>
            <label className="flex items-center gap-2 text-xs text-gray-700">
              <input
                type="checkbox"
                checked={isAdmin}
                onChange={(e) => setIsAdmin(e.target.checked)}
                className="w-4 h-4"
              />
              管理者にする
            </label>
            <p className="text-xs text-gray-500">
              初期パスワードを自動で作り、本人のメールアドレスへ送ります。本人がパスワードを
              変更するまで、他の画面は使えません。
            </p>
            <button
              type="submit"
              disabled={busy}
              className="w-full py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-bold rounded"
            >
              {createMutation.isPending ? '登録中…' : '登録して初期パスワードを送る'}
            </button>
          </form>

          {notice && <p className="text-green-600 text-xs">{notice}</p>}
          {errorMessage && <p className="text-red-500 text-xs">{errorMessage}</p>}

          {staffQuery.isPending && (
            <div className="flex justify-center py-6">
              <div className="w-6 h-6 rounded-full border-4 border-gray-200 loading-spinner" />
            </div>
          )}
          {staffQuery.isError && (
            <p className="text-red-500 text-sm">{(staffQuery.error as Error).message}</p>
          )}

          <ul className="space-y-2">
            {(staffQuery.data ?? []).map((member) => (
              <li
                key={member.id}
                className={`rounded-lg border p-3 text-sm ${
                  member.retired ? 'bg-gray-50 border-gray-200 text-gray-500' : 'border-gray-200'
                }`}
              >
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0">
                    <p className="font-bold break-words">{member.name}</p>
                    <p className="text-xs text-gray-500 break-words">{member.email}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    {member.isAdmin && (
                      <span className="text-xs bg-red-100 text-red-700 rounded px-1.5 py-0.5">管理者</span>
                    )}
                    {member.retired && (
                      <span className="text-xs bg-gray-200 text-gray-600 rounded px-1.5 py-0.5">
                        退職済み
                      </span>
                    )}
                    {member.mustChangePassword && (
                      <span className="text-xs bg-amber-100 text-amber-700 rounded px-1.5 py-0.5">
                        初期パスワード
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 mt-2">
                  {/* 自分自身の権限を外す・自分を退職扱いにするのはサーバー側でも拒否される
                      (管理者が1人の事業所で誰も管理者設定に入れなくなるため)。 */}
                  {member.id !== selfStaffId && (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          updateMutation.mutate({
                            staffId: member.id,
                            patch: { isAdmin: !member.isAdmin },
                          })
                        }
                        className="text-xs px-2 py-1 rounded border border-gray-300 hover:bg-gray-100 disabled:opacity-60"
                      >
                        {member.isAdmin ? '管理者を外す' : '管理者にする'}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          updateMutation.mutate({
                            staffId: member.id,
                            patch: { retirementDate: member.retired ? null : todayIso() },
                          })
                        }
                        className="text-xs px-2 py-1 rounded border border-gray-300 hover:bg-gray-100 disabled:opacity-60"
                      >
                        {member.retired ? '在籍中に戻す' : '退職にする'}
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          `${member.name} さんの初期パスワードを再発行します。\n現在ログイン中の場合はログアウトされます。よろしいですか?`,
                        )
                      ) {
                        resetMutation.mutate(member);
                      }
                    }}
                    className="text-xs px-2 py-1 rounded border border-gray-300 hover:bg-gray-100 disabled:opacity-60"
                  >
                    初期パスワードを再発行
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
