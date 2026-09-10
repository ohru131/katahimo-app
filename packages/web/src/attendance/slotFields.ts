import type { ScheduleEventSlot } from '../api';

/**
 * 「勤怠を編集」の5枠(訪問その1〜3・事務作業その1〜2)の定義。
 * doc/14 B項の段階1でrowDataが配列(visits/officeWork)になり、列記号(C/D/E…)への
 * 対応表という形では表現できなくなったため、{ kind, index, label } の一覧に置き換えた。
 * 表示上は従来どおり5枠固定のまま見せる(見た目は変えない)。
 */
export interface AttendanceSlotDef {
  slot: ScheduleEventSlot;
  label: string;
}

export const ATTENDANCE_SLOT_DEFS: AttendanceSlotDef[] = [
  { slot: { kind: 'visit', index: 0 }, label: '訪問その1' },
  { slot: { kind: 'visit', index: 1 }, label: '訪問その2' },
  { slot: { kind: 'visit', index: 2 }, label: '訪問その3' },
  { slot: { kind: 'office', index: 0 }, label: '事務作業その1' },
  { slot: { kind: 'office', index: 1 }, label: '事務作業その2' },
];

/** React等の`key`に使う文字列(スロットの種類+添字で一意)。 */
export function slotKeyString(slot: ScheduleEventSlot): string {
  return `${slot.kind}-${slot.index}`;
}
