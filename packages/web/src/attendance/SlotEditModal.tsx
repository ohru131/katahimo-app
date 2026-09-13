import { useState } from 'react';
import type { AttendanceRowData, ScheduleEventSlot } from '../api';
import { Button, ButtonRow } from '../ui';
import { readSlotFields } from './arraySlot';
import { ATTENDANCE_SLOT_DEFS } from './slotFields';

/**
 * 予定(訪問・事務作業)1件の編集モーダル。名称・始めた時間・終わった時間のみを扱う
 * (移動時間・距離・天候・買い物代行・備考はMoveDistancePanelで別途、日単位でまとめて編集する)。
 * GAS版のpastScheduleSlotModalと同じ役割。文言と大きさは
 * doc/16_UIUX改善提案_2026-09-03.htmlの言いかえ表(出勤簿の行)に合わせている。
 *
 * 「削除」は配列からその要素を取り除くのではなく、その位置の要素を空オブジェクトにする
 * (onSave(null)。実際の反映はarraySlot.tsのapplySlotEdit/setArraySlot参照)。画面は
 * ATTENDANCE_SLOT_DEFSで5枠固定のまま表示しており、配列から取り除いて後続要素を繰り上げる
 * 実装にすると、「3件目の訪問」を削除したつもりが繰り上がった「2件目の訪問」の中身が消える
 * (別の枠のデータが変わって見える)ことになり、押したボタンと変わった内容が対応しなくなる。
 * 位置を保ったまま空にする方が、5枠固定の表示と操作の対応関係が崩れない。
 */
export function SlotEditModal({
  slot,
  rowData,
  onSave,
  onClose,
}: {
  slot: ScheduleEventSlot;
  rowData: AttendanceRowData;
  onSave: (fields: { name: string; start: string; end: string } | null) => void;
  onClose: () => void;
}) {
  const def = ATTENDANCE_SLOT_DEFS.find((d) => d.slot.kind === slot.kind && d.slot.index === slot.index);
  const current = readSlotFields(rowData, slot);
  const [name, setName] = useState(current.name ?? '');
  const [start, setStart] = useState(current.start ?? '');
  const [end, setEnd] = useState(current.end ?? '');

  // 訪問の枠は「お客様・内容」、事務作業の枠は「したこと」を書く欄なので、同じ入力欄でも
  // 枠の種類でラベルを変える(「名称」だけでは何の名前かが分からない)。
  const nameLabel = slot.kind === 'visit' ? 'お客様・内容' : 'したこと';
  const namePlaceholder = slot.kind === 'visit' ? '例)佐藤 様' : '例)報告書を書く';

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-[120] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-sm rounded-card flex flex-col max-h-[90vh]">
        <div className="p-4 border-b border-gray-200 flex justify-between items-center gap-3">
          <h3 className="font-bold text-app-text text-base">{def?.label ?? ''}</h3>
          <Button variant="subtle" size="sub" onClick={onClose}>
            ✕ 閉じる
          </Button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto">
          <div>
            <label className="block text-sm text-app-muted mb-1" htmlFor="slotName">
              {nameLabel}
            </label>
            <input
              id="slotName"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full min-h-[48px] px-3 border border-gray-300 rounded-btn text-base"
              placeholder={namePlaceholder}
            />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-sm text-app-muted mb-1" htmlFor="slotStart">
                始めた時間
              </label>
              <input
                id="slotStart"
                type="time"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="w-full min-h-[48px] px-3 border border-gray-300 rounded-btn text-base"
              />
            </div>
            <div className="flex-1">
              <label className="block text-sm text-app-muted mb-1" htmlFor="slotEnd">
                終わった時間
              </label>
              <input
                id="slotEnd"
                type="time"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className="w-full min-h-[48px] px-3 border border-gray-300 rounded-btn text-base"
              />
            </div>
          </div>
        </div>

        {/* 取り消しは左・グレー、進むは右・青。削除は赤で、主ボタンと同じ行に並べない
            (1モーダルに青い主ボタンは1つ、の並びを崩さないため)。 */}
        <div className="p-4 border-t border-gray-200 space-y-3">
          <ButtonRow>
            <Button variant="subtle" fullWidth onClick={onClose}>
              キャンセル
            </Button>
            <Button variant="primary" fullWidth onClick={() => onSave({ name, start, end })}>
              保存する
            </Button>
          </ButtonRow>
          <Button variant="danger" size="sub" fullWidth onClick={() => onSave(null)}>
            削除
          </Button>
        </div>
      </div>
    </div>
  );
}
