import { FAMILY_ALLERGY_STATUS_LABELS, type FamilyAllergyStatus } from '@katahimo/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { type FamilyMemberView, updateFamilyMemberAllergy } from './api';

/**
 * 状態ごとの見え方。'unknown' を目立たせるのは、聞き取りが済んでいないことに
 * 気付かせるため(doc/db/guidelines.md §11)。「なし」と同じ薄さにすると、確認できていない
 * まま訪問してしまう。
 */
const STATUS_STYLE: Record<FamilyAllergyStatus, string> = {
  present: 'bg-red-50 text-red-700 border-red-200',
  unknown: 'bg-amber-50 text-amber-700 border-amber-200',
  none: 'bg-gray-100 text-gray-600 border-gray-200',
};

/**
 * 世帯構成員1人のアレルギー表示と編集。
 *
 * 訪問の現場で保護者から聞き取って入れる項目なので、管理者に限らず入力できる
 * (顧客の生年月日が管理者限定なのは請求額に影響するため。こちらは影響しない)。
 */
export function FamilyAllergyEditor({
  customerId,
  member,
}: {
  customerId: string;
  member: FamilyMemberView;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<FamilyAllergyStatus>(member.allergyStatus);
  const [note, setNote] = useState(member.allergyNote ?? '');

  // 保存後や再取得でmemberが差し替わったら、編集していない間は表示中の値へ追従させる。
  useEffect(() => {
    if (editing) return;
    setStatus(member.allergyStatus);
    setNote(member.allergyNote ?? '');
  }, [editing, member.allergyStatus, member.allergyNote]);

  const mutation = useMutation({
    mutationFn: () => updateFamilyMemberAllergy(customerId, member.id, { status, note: note.trim() }),
    onSuccess: () => {
      setEditing(false);
      queryClient.invalidateQueries({ queryKey: ['customer', customerId] });
    },
  });

  // 「あり」なのに内容が空の保存は、サーバーとDBの制約でも弾かれる。ここで先に止めるのは
  // 往復してからエラーを見せないため。
  const invalid = status === 'present' && note.trim().length === 0;

  if (!editing) {
    return (
      <div className="mt-1 flex items-start gap-2">
        <span
          className={`shrink-0 text-xs font-bold px-2 py-0.5 rounded border ${STATUS_STYLE[member.allergyStatus]}`}
        >
          アレルギー: {FAMILY_ALLERGY_STATUS_LABELS[member.allergyStatus]}
        </span>
        {member.allergyNote && (
          <span className="text-xs text-gray-700 break-words min-w-0">{member.allergyNote}</span>
        )}
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="ml-auto shrink-0 text-xs text-blue-600 underline"
        >
          編集
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-2 bg-white rounded-lg border border-gray-200 p-2">
      <div className="flex items-center gap-2">
        <label className="text-xs text-gray-600" htmlFor={`allergy-status-${member.id}`}>
          アレルギー
        </label>
        <select
          id={`allergy-status-${member.id}`}
          value={status}
          onChange={(e) => setStatus(e.target.value as FamilyAllergyStatus)}
          className="text-sm border-gray-300 rounded p-1"
        >
          {(Object.keys(FAMILY_ALLERGY_STATUS_LABELS) as FamilyAllergyStatus[]).map((s) => (
            <option key={s} value={s}>
              {FAMILY_ALLERGY_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        placeholder={
          status === 'present' ? '例: 卵(加熱済みは可)、発疹が出たら冷やして連絡' : '確認した経緯など(任意)'
        }
        className="w-full text-sm border-gray-300 rounded p-2"
      />
      {invalid && <p className="text-xs text-red-600">「あり」のときは内容を入力してください</p>}
      {mutation.error && <p className="text-xs text-red-600">{mutation.error.message}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={invalid || mutation.isPending}
          onClick={() => mutation.mutate()}
          className="px-3 py-1 text-sm bg-blue-600 text-white rounded disabled:bg-gray-300"
        >
          {mutation.isPending ? '保存中…' : '保存'}
        </button>
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            setStatus(member.allergyStatus);
            setNote(member.allergyNote ?? '');
          }}
          className="px-3 py-1 text-sm text-gray-600"
        >
          やめる
        </button>
      </div>
    </div>
  );
}
