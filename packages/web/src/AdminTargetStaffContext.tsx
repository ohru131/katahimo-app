import { useQuery } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext, useMemo, useState } from 'react';
import type { StaffView } from './api';
import { fetchActiveStaffForAdmin } from './api';

/** login直後(StaffView.id)/セッション復元(StaffView.staffId)でキー名が異なるため、両方見る。 */
function ownStaffId(staff: StaffView): string {
  return staff.staffId ?? staff.id ?? '';
}

interface AdminTargetStaffContextValue {
  isAdmin: boolean;
  ownStaffId: string;
  /** 管理者が選択中の対象スタッフID(非管理者は常に自分自身のID)。 */
  targetStaffId: string;
  setTargetStaffId: (id: string) => void;
  /** APIへ渡すstaffId。管理者が自分以外を選んでいる時だけ値を持つ(それ以外はundefined=常に自分自身)。 */
  effectiveStaffId: string | undefined;
  staffList: { id: string; name: string }[];
}

const AdminTargetStaffContext = createContext<AdminTargetStaffContextValue | null>(null);

/**
 * 管理者向け「対象スタッフ」選択をきょうの予定タブ・出勤簿タブで共有する。GAS版index.htmlの
 * sharedAdminTargetStaffName/loadSharedAdminStaffList_/onAdminTargetStaffChange_と同じ設計
 * (どちらのタブを先に開いても一覧取得は1回だけ、選択もタブをまたいで保持される)。
 */
export function AdminTargetStaffProvider({ staff, children }: { staff: StaffView; children: ReactNode }) {
  const selfId = ownStaffId(staff);
  const [targetStaffId, setTargetStaffId] = useState(selfId);

  const staffListQuery = useQuery({
    queryKey: ['active-staff-for-admin'],
    queryFn: fetchActiveStaffForAdmin,
    enabled: staff.isAdmin,
  });

  const value = useMemo<AdminTargetStaffContextValue>(
    () => ({
      isAdmin: staff.isAdmin,
      ownStaffId: selfId,
      targetStaffId,
      setTargetStaffId,
      effectiveStaffId: staff.isAdmin && targetStaffId !== selfId ? targetStaffId : undefined,
      staffList: staffListQuery.data ?? [],
    }),
    [staff.isAdmin, selfId, targetStaffId, staffListQuery.data],
  );

  return <AdminTargetStaffContext.Provider value={value}>{children}</AdminTargetStaffContext.Provider>;
}

export function useAdminTargetStaff(): AdminTargetStaffContextValue {
  const ctx = useContext(AdminTargetStaffContext);
  if (!ctx) throw new Error('useAdminTargetStaff must be used within AdminTargetStaffProvider');
  return ctx;
}

/**
 * 「表示するスタッフ」セレクタ。きょうの予定タブ・出勤簿タブの両方から使う共通部品
 * (GAS版のscheduleStaffSelect/pastScheduleStaffSelectと同じ、選択はタブをまたいで共有される)。
 * 管理者以外には何も表示しない。
 */
export function AdminTargetStaffSelector() {
  const { isAdmin, ownStaffId: selfId, targetStaffId, setTargetStaffId, staffList } = useAdminTargetStaff();
  if (!isAdmin) return null;

  return (
    <div className="mb-3">
      <label className="block text-sm font-bold text-app-text mb-1" htmlFor="adminTargetStaffSelect">
        表示するスタッフ
      </label>
      <select
        id="adminTargetStaffSelect"
        value={targetStaffId}
        onChange={(e) => setTargetStaffId(e.target.value)}
        className="w-full min-h-[48px] px-3 border border-gray-300 rounded-btn text-base text-app-text focus:ring-2 focus:ring-app-primary"
      >
        {!staffList.some((s) => s.id === targetStaffId) && (
          <option value={targetStaffId}>読み込んでいます…</option>
        )}
        {staffList.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
            {s.id === selfId ? '(自分)' : ''}
          </option>
        ))}
      </select>
    </div>
  );
}
