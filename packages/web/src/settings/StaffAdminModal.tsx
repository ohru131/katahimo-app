import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { StaffAdminView } from '../api';
import { createStaff, fetchStaffForAdmin, resetStaffPassword, updateStaff } from '../api';
import { Button, EmptyState, LoadingBlock, toFriendlyMessage, useFeedback } from '../ui';

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
  const { confirm } = useFeedback();
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
    onSuccess: (result) => {
      // メールを送れなくてもアカウントは作成済み。ここで「失敗」と見せると、
      // やり直してメールアドレス重複で弾かれるだけになる。
      setNotice(
        result.mailDelivered
          ? `${email} に初期パスワードを送信しました`
          : `${email} を登録しましたが、メールを送信できませんでした。下の「初期パスワードを再発行」でもう一度お試しください。`,
      );
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
    onSuccess: (result, staff) => {
      setNotice(
        result.mailDelivered
          ? `${staff.email} に新しい初期パスワードを送信しました`
          : `${staff.email} の初期パスワードを再発行しましたが、メールを送信できませんでした。もう一度お試しください。`,
      );
      refresh();
    },
  });

  const errorMessage = createMutation.isError
    ? toFriendlyMessage(createMutation.error, 'スタッフの登録', createMutation.error.message)
    : updateMutation.isError
      ? toFriendlyMessage(updateMutation.error, 'スタッフの更新', updateMutation.error.message)
      : resetMutation.isError
        ? toFriendlyMessage(resetMutation.error, '初期パスワードの再発行', resetMutation.error.message)
        : null;
  const busy = createMutation.isPending || updateMutation.isPending || resetMutation.isPending;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-[110] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-lg rounded-xl shadow-xl flex flex-col max-h-[90vh]">
        <div className="p-4 border-b flex justify-between items-center bg-gray-50 rounded-t-xl">
          <h3 className="font-bold text-gray-800 text-sm">👥 スタッフ管理</h3>
          <Button variant="subtle" size="sub" onClick={onClose}>
            ✕ 閉じる
          </Button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createMutation.mutate();
            }}
            className="space-y-2 bg-gray-50 rounded-lg p-3"
          >
            <h4 className="text-sm font-bold text-gray-600">スタッフを追加</h4>
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
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={isAdmin}
                onChange={(e) => setIsAdmin(e.target.checked)}
                className="w-4 h-4"
              />
              管理者にする
            </label>
            <p className="text-sm text-gray-500">
              初期パスワードを自動で作り、本人のメールアドレスへ送ります。本人がパスワードを
              変更するまで、他の画面は使えません。
            </p>
            <Button variant="primary" fullWidth type="submit" disabled={busy}>
              {createMutation.isPending ? '登録中…' : '登録して初期パスワードを送る'}
            </Button>
          </form>

          {notice && <p className="text-sm text-app-done">{notice}</p>}
          {errorMessage && <p className="text-sm text-app-danger">{errorMessage}</p>}

          {staffQuery.isPending && <LoadingBlock />}
          {staffQuery.isError && (
            <p className="text-sm text-app-danger">
              {toFriendlyMessage(staffQuery.error, 'スタッフ一覧の読み込み')}
            </p>
          )}

          {staffQuery.data && staffQuery.data.length === 0 ? (
            <EmptyState
              icon="👥"
              title="スタッフがまだ登録されていません"
              nextStep="上のフォームから追加してください"
            />
          ) : (
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
                      <p className="text-sm text-gray-500 break-words">{member.email}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      {member.isAdmin && (
                        <span className="text-sm bg-red-100 text-red-700 rounded px-1.5 py-0.5">管理者</span>
                      )}
                      {member.retired && (
                        <span className="text-sm bg-gray-200 text-gray-600 rounded px-1.5 py-0.5">
                          退職済み
                        </span>
                      )}
                      {member.mustChangePassword && (
                        <span className="text-sm bg-amber-100 text-amber-700 rounded px-1.5 py-0.5">
                          初期パスワード
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-3 mt-2">
                    {/* 自分自身の権限を外す・自分を退職扱いにするのはサーバー側でも拒否される
                        (管理者が1人の事業所で誰も管理者設定に入れなくなるため)。 */}
                    {member.id !== selfStaffId && (
                      <>
                        <Button
                          variant="outline"
                          size="sub"
                          disabled={busy}
                          onClick={() =>
                            updateMutation.mutate({
                              staffId: member.id,
                              patch: { isAdmin: !member.isAdmin },
                            })
                          }
                        >
                          {member.isAdmin ? '管理者を外す' : '管理者にする'}
                        </Button>
                        <Button
                          variant="outline"
                          size="sub"
                          disabled={busy}
                          onClick={() =>
                            updateMutation.mutate({
                              staffId: member.id,
                              patch: { retirementDate: member.retired ? null : todayIso() },
                            })
                          }
                        >
                          {member.retired ? '在籍中に戻す' : '退職にする'}
                        </Button>
                      </>
                    )}
                    <Button
                      variant="outline"
                      size="sub"
                      disabled={busy}
                      onClick={async () => {
                        const ok = await confirm({
                          message: `${member.name} さんの初期パスワードを再発行します。\n現在ログイン中の場合はログアウトされます。よろしいですか?`,
                          confirmLabel: '再発行する',
                        });
                        if (ok) resetMutation.mutate(member);
                      }}
                    >
                      初期パスワードを再発行
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="p-4 border-t bg-gray-50 rounded-b-xl text-right">
          <Button variant="subtle" onClick={onClose}>
            閉じる
          </Button>
        </div>
      </div>
    </div>
  );
}
