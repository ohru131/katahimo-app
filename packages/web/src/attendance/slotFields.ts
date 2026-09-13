import type { ScheduleEventSlot } from '../api';

/**
 * 「✏️ 記録を直す・足す」の5枠(訪問1〜3件目・事務作業1〜2つ目)の定義。
 * doc/14 §2の段階1でrowDataが配列(visits/officeWork)になり、列記号(C/D/E…)への
 * 対応表という形では表現できなくなったため、{ kind, index, label } の一覧に置き換えた。
 * 表示上は従来どおり5枠固定のまま見せる(見た目は変えない)。
 *
 * ラベルはdoc/16_UIUX改善提案_2026-09-03.htmlの言いかえ表(出勤簿の行)に合わせている
 * (「訪問1」→「1件目の訪問」、「事務作業1」→「事務作業(1つ目)」)。
 */
export interface AttendanceSlotDef {
  slot: ScheduleEventSlot;
  label: string;
}

export const ATTENDANCE_SLOT_DEFS: AttendanceSlotDef[] = [
  { slot: { kind: 'visit', index: 0 }, label: '1件目の訪問' },
  { slot: { kind: 'visit', index: 1 }, label: '2件目の訪問' },
  { slot: { kind: 'visit', index: 2 }, label: '3件目の訪問' },
  { slot: { kind: 'office', index: 0 }, label: '事務作業(1つ目)' },
  { slot: { kind: 'office', index: 1 }, label: '事務作業(2つ目)' },
];

/** React等の`key`に使う文字列(スロットの種類+添字で一意)。 */
export function slotKeyString(slot: ScheduleEventSlot): string {
  return `${slot.kind}-${slot.index}`;
}
