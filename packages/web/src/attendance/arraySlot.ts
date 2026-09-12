import type { AttendanceRowData, ScheduleEventSlot } from '../api';

/**
 * 配列(visits/officeWork)のindex番目の要素を更新する。indexが配列の長さを超える場合は、
 * 間を空オブジェクトで埋める。
 *
 * doc/14 §2の段階1で訪問・事務作業が固定5枠(スプレッドシートの列記号)から配列になったが、
 * 画面(AttendanceCalendar/slotFields.ts)は引き続き5枠固定で表示する。そのため「訪問その3」
 * (index=2)だけを先に入力する、といった操作が起き得て、その場合visits配列にはindex0・1に
 * 相当する要素がまだ無い。pushだけでは意図した位置に入らないため、間を空オブジェクトで
 * 埋めてから目的のindexへ書き込む。
 *
 * patch===null は「この枠を空にする(削除)」を表す。null以外は既存の値とマージする
 * (SlotEditModal.tsxで名称/始業/終業を編集しても、MoveDistancePanel.tsxで別途入力した
 * 移動時間・距離・天候等を消してしまわないようにするため)。
 */
export function setArraySlot<T extends object>(
  arr: T[] | undefined,
  index: number,
  patch: Partial<T> | null,
): T[] {
  const next = arr ? [...arr] : [];
  while (next.length <= index) next.push({} as T);
  // マージ結果はTのプロパティをすべて省略可能にした形(Partial<T>)にしかならないが、
  // 実際に渡ってくるT(AttendanceVisit/AttendanceOfficeWork)はすべてのプロパティが元々
  // optionalなので安全にTとして扱える。
  next[index] = (patch === null ? {} : { ...next[index], ...patch }) as T;
  return next;
}

function orUndefined(s: string): string | undefined {
  return s === '' ? undefined : s;
}

/** SlotEditModal/AttendanceCalendarが「その枠の現在値」を表示するために使う。 */
export function readSlotFields(
  rowData: AttendanceRowData,
  slot: ScheduleEventSlot,
): { name: string | undefined; start: string | undefined; end: string | undefined } {
  if (slot.kind === 'visit') {
    const v = rowData.visits?.[slot.index];
    return { name: v?.place, start: v?.start, end: v?.end };
  }
  const o = rowData.officeWork?.[slot.index];
  return { name: o?.name, start: o?.start, end: o?.end };
}

/**
 * SlotEditModalの保存/削除結果を、その枠(slot)に対応するvisits/officeWorkの要素へ反映した
 * 新しいrowDataを返す。fields===null は削除(setArraySlotのpatch===null相当)。
 * 空文字は「未入力」として扱いundefinedにする(attendanceRowDataSchemaの時刻フォーマット検証は
 * 空文字を許さないため、空文字のまま保存しようとすると保存APIが400を返してしまう)。
 */
export function applySlotEdit(
  rowData: AttendanceRowData,
  slot: ScheduleEventSlot,
  fields: { name: string; start: string; end: string } | null,
): AttendanceRowData {
  if (slot.kind === 'visit') {
    const patch =
      fields === null
        ? null
        : { place: orUndefined(fields.name), start: orUndefined(fields.start), end: orUndefined(fields.end) };
    return { ...rowData, visits: setArraySlot(rowData.visits, slot.index, patch) };
  }
  const patch =
    fields === null
      ? null
      : { name: orUndefined(fields.name), start: orUndefined(fields.start), end: orUndefined(fields.end) };
  return { ...rowData, officeWork: setArraySlot(rowData.officeWork, slot.index, patch) };
}
