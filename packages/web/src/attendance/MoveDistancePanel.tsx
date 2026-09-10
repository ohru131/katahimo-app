import { useState } from 'react';
import type { AttendanceRowData } from '../api';
import { setArraySlot } from './arraySlot';

/**
 * 数値入力中の生文字列をそのまま数値へ丸めてしまうと、"1."のように入力途中の状態を
 * 打ち終える前に表示が壊れる(例: "1."→Number("1.")=1になり、桁を打っている途中で
 * 表示が"1"に戻ってしまう)。入力欄の表示はコンポーネント内のローカル文字列で持ち、
 * 「数値として確定できる状態(末尾が"."や"-"だけで終わっていない)」になった時点だけ
 * onCommitでrowDataへ反映する。空欄はundefined(=未入力。0とは別の意味)として即時反映する。
 *
 * このフィールドが扱う値(plannedMoveMin/distanceKm/commuteDistanceKm/returnDistanceKm/
 * shoppingErrandCount)はattendanceRowDataSchema側でいずれも0以上しか許されない
 * (nonNegativeNumberSchema/nonNegativeIntSchema)。"-5"のような負数の文字列はNumber()も
 * NaNにならず末尾も"-"や"."で終わらないため、このチェックを素通りしてonCommitへ渡って
 * しまっていた。保存APIの400で初めて気付くのでは遅いため、ここで先に弾く。
 *
 * 空白だけの文字列("  "等)も、Number('  ')===0になってしまうため未入力と区別できず
 * 0を確定してしまう。呼び出し側(NumberFieldのonChange)で空文字と同様にtrim()して
 * 「未入力」= undefined として扱う(空文字をundefinedにする既存の挙動と対称にする方が
 * 自然なため)。ここでも念のため空白だけなら false を返す。
 */
function isCommittableNumberString(raw: string): boolean {
  if (raw.trim() === '') return false;
  if (/[.-]$/.test(raw)) return false;
  const n = Number(raw);
  return !Number.isNaN(n) && n >= 0;
}

function NumberField({
  id,
  label,
  value,
  onCommit,
}: {
  id: string;
  label: string;
  value: number | undefined;
  onCommit: (n: number | undefined) => void;
}) {
  const [raw, setRaw] = useState(value === undefined ? '' : String(value));
  return (
    <div>
      <label className="block text-[11px] text-gray-500 mb-0.5" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        value={raw}
        onChange={(e) => {
          const next = e.target.value;
          setRaw(next);
          // 空文字・空白だけは未入力として扱う(isCommittableNumberStringのコメント参照)。
          if (next.trim() === '') {
            onCommit(undefined);
            return;
          }
          if (isCommittableNumberString(next)) onCommit(Number(next));
        }}
        className="w-full p-2 border border-gray-300 rounded text-sm"
      />
    </div>
  );
}

function TextField({
  id,
  label,
  value,
  onCommit,
}: {
  id: string;
  label: string;
  value: string | undefined;
  onCommit: (v: string | undefined) => void;
}) {
  return (
    <div>
      <label className="block text-[11px] text-gray-500 mb-0.5" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        value={value ?? ''}
        onChange={(e) => onCommit(e.target.value === '' ? undefined : e.target.value)}
        className="w-full p-2 border border-gray-300 rounded text-sm"
      />
    </div>
  );
}

/**
 * 「移動・距離・その他」パネル。特定の予定(訪問・事務作業)に紐づかない、その日全体の
 * 項目をまとめて1か所で編集する。GAS版のpastScheduleDetailPanelと同じ役割・見た目。
 *
 * doc/14 B項の段階1でrowDataの数値項目がstring→numberになったため、列記号(fieldKey)ではなく
 * commuteDistanceKm/visits[0].plannedMoveMinのような新形式のフィールドを直接編集する。
 * onChangeは更新後のrowData全体を渡す(visits配列の途中の要素を更新するのに配列の穴埋め
 * (setArraySlot)が要るため、キー→値のパッチより扱いやすい)。
 *
 * 呼び出し側(AttendanceCalendar.tsx)は日が変わるたびにこのコンポーネントを
 * key={selectedDate}で再マウントする。NumberField/TextFieldのローカル文字列状態は
 * マウント時の値からしか初期化しないため、そうしないと日を切り替えても前の日の
 * 入力途中の文字列が残ってしまう。
 */
export function MoveDistancePanel({
  rowData,
  onChange,
  onSave,
  saving,
}: {
  rowData: AttendanceRowData;
  onChange: (rowData: AttendanceRowData) => void;
  onSave: () => void;
  saving: boolean;
}) {
  const visit0 = rowData.visits?.[0];
  const visit1 = rowData.visits?.[1];

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-3 mb-4">
      <div className="text-xs font-bold text-gray-600 mb-2">移動・距離・その他</div>

      <div className="space-y-3 mb-3">
        <div>
          <div className="text-[11px] font-bold text-gray-500 mb-1">出勤(自宅→#1)</div>
          <div className="grid grid-cols-1 gap-2">
            <NumberField
              id="move-commuteDistanceKm"
              label="出勤距離(km)"
              value={rowData.commuteDistanceKm}
              onCommit={(n) => onChange({ ...rowData, commuteDistanceKm: n })}
            />
          </div>
        </div>

        <div>
          <div className="text-[11px] font-bold text-gray-500 mb-1">#1→#2移動</div>
          <div className="grid grid-cols-3 gap-2">
            <NumberField
              id="move-visit0-plannedMoveMin"
              label="移動時間(分)"
              value={visit0?.plannedMoveMin}
              onCommit={(n) =>
                onChange({ ...rowData, visits: setArraySlot(rowData.visits, 0, { plannedMoveMin: n }) })
              }
            />
            <TextField
              id="move-visit0-weatherAfter"
              label="天候(雪で1.3倍)"
              value={visit0?.weatherAfter}
              onCommit={(v) =>
                onChange({ ...rowData, visits: setArraySlot(rowData.visits, 0, { weatherAfter: v }) })
              }
            />
            <NumberField
              id="move-visit0-distanceKm"
              label="移動距離(km)"
              value={visit0?.distanceKm}
              onCommit={(n) =>
                onChange({ ...rowData, visits: setArraySlot(rowData.visits, 0, { distanceKm: n }) })
              }
            />
          </div>
        </div>

        <div>
          <div className="text-[11px] font-bold text-gray-500 mb-1">#2→#3移動</div>
          <div className="grid grid-cols-3 gap-2">
            <NumberField
              id="move-visit1-plannedMoveMin"
              label="移動時間(分)"
              value={visit1?.plannedMoveMin}
              onCommit={(n) =>
                onChange({ ...rowData, visits: setArraySlot(rowData.visits, 1, { plannedMoveMin: n }) })
              }
            />
            <TextField
              id="move-visit1-weatherAfter"
              label="天候"
              value={visit1?.weatherAfter}
              onCommit={(v) =>
                onChange({ ...rowData, visits: setArraySlot(rowData.visits, 1, { weatherAfter: v }) })
              }
            />
            <NumberField
              id="move-visit1-distanceKm"
              label="移動距離(km)"
              value={visit1?.distanceKm}
              onCommit={(n) =>
                onChange({ ...rowData, visits: setArraySlot(rowData.visits, 1, { distanceKm: n }) })
              }
            />
          </div>
        </div>

        <div>
          <div className="text-[11px] font-bold text-gray-500 mb-1">退勤(#3→自宅)</div>
          <div className="grid grid-cols-1 gap-2">
            <NumberField
              id="move-returnDistanceKm"
              label="退勤距離(km)"
              value={rowData.returnDistanceKm}
              onCommit={(n) => onChange({ ...rowData, returnDistanceKm: n })}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-2">
        <NumberField
          id="move-shoppingErrandCount"
          label="買物代行(回数)"
          value={rowData.shoppingErrandCount}
          onCommit={(n) => onChange({ ...rowData, shoppingErrandCount: n })}
        />
        <TextField
          id="move-note"
          label="備考"
          value={rowData.note}
          onCommit={(v) => onChange({ ...rowData, note: v })}
        />
      </div>

      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        className="w-full py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-bold rounded-lg transition-colors"
      >
        {saving ? '保存中…' : '保存する'}
      </button>
    </div>
  );
}
