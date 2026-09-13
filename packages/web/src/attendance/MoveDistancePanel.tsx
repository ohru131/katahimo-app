import { useState } from 'react';
import type { AttendanceRowData } from '../api';
import { Button } from '../ui';
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

/** 入力欄の見た目。高さ48px・文字16px(iOSの自動ズーム防止にも必要)。 */
const FIELD_CLASS = 'w-full min-h-[48px] px-3 border border-gray-300 rounded-btn text-base';

/** 数値項目1つ。入力中の生文字列はローカルに持ち、確定できる状態になった時だけ親へ渡す。 */
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
      <label className="block text-sm text-app-muted mb-1" htmlFor={id}>
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
        className={FIELD_CLASS}
      />
    </div>
  );
}

/** 文字列項目1つ。空欄は「未入力」としてundefinedを渡す(0と未入力を区別する数値項目と対称)。 */
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
      <label className="block text-sm text-app-muted mb-1" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        value={value ?? ''}
        onChange={(e) => onCommit(e.target.value === '' ? undefined : e.target.value)}
        className={FIELD_CLASS}
      />
    </div>
  );
}

/** 区間の見出し(「🏠 家 → 1件目の訪問」など)。矢印と家の絵で、どこからどこへかを示す。 */
function LegHeading({ children }: { children: string }) {
  return <div className="text-base font-bold text-app-text mb-2">{children}</div>;
}

/**
 * 「移動と距離・買い物代行・備考」パネル。特定の予定(訪問・事務作業)に紐づかない、その日全体の
 * 項目をまとめて1か所で編集する。GAS版のpastScheduleDetailPanelと同じ役割。文言は
 * doc/16_UIUX改善提案_2026-09-03.htmlの言いかえ表(出勤簿の行)に合わせている。
 *
 * doc/14 §2の段階1でrowDataの数値項目がstring→numberになったため、列記号(fieldKey)ではなく
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
    <div className="bg-white rounded-card border border-gray-200 p-4 mb-4">
      <div className="text-base font-bold text-app-text mb-3">移動と距離・買い物代行・備考</div>

      <div className="space-y-4 mb-4">
        <div>
          <LegHeading>🏠 家 → 1件目の訪問</LegHeading>
          <div className="grid grid-cols-1 gap-3">
            <NumberField
              id="move-commuteDistanceKm"
              label="きょり(km)"
              value={rowData.commuteDistanceKm}
              onCommit={(n) => onChange({ ...rowData, commuteDistanceKm: n })}
            />
          </div>
        </div>

        <div>
          <LegHeading>1件目の訪問 → 2件目の訪問</LegHeading>
          <div className="grid grid-cols-1 gap-3">
            <NumberField
              id="move-visit0-plannedMoveMin"
              label="移動にかかった時間(分)"
              value={visit0?.plannedMoveMin}
              onCommit={(n) =>
                onChange({ ...rowData, visits: setArraySlot(rowData.visits, 0, { plannedMoveMin: n }) })
              }
            />
            <TextField
              id="move-visit0-weatherAfter"
              label="天気(雪のときは1.3倍で数えます)"
              value={visit0?.weatherAfter}
              onCommit={(v) =>
                onChange({ ...rowData, visits: setArraySlot(rowData.visits, 0, { weatherAfter: v }) })
              }
            />
            <NumberField
              id="move-visit0-distanceKm"
              label="移動きょり(km)"
              value={visit0?.distanceKm}
              onCommit={(n) =>
                onChange({ ...rowData, visits: setArraySlot(rowData.visits, 0, { distanceKm: n }) })
              }
            />
          </div>
        </div>

        <div>
          <LegHeading>2件目の訪問 → 3件目の訪問</LegHeading>
          <div className="grid grid-cols-1 gap-3">
            <NumberField
              id="move-visit1-plannedMoveMin"
              label="移動にかかった時間(分)"
              value={visit1?.plannedMoveMin}
              onCommit={(n) =>
                onChange({ ...rowData, visits: setArraySlot(rowData.visits, 1, { plannedMoveMin: n }) })
              }
            />
            <TextField
              id="move-visit1-weatherAfter"
              label="天気"
              value={visit1?.weatherAfter}
              onCommit={(v) =>
                onChange({ ...rowData, visits: setArraySlot(rowData.visits, 1, { weatherAfter: v }) })
              }
            />
            <NumberField
              id="move-visit1-distanceKm"
              label="移動きょり(km)"
              value={visit1?.distanceKm}
              onCommit={(n) =>
                onChange({ ...rowData, visits: setArraySlot(rowData.visits, 1, { distanceKm: n }) })
              }
            />
          </div>
        </div>

        <div>
          <LegHeading>3件目の訪問 → 🏠 家</LegHeading>
          <div className="grid grid-cols-1 gap-3">
            <NumberField
              id="move-returnDistanceKm"
              label="きょり(km)"
              value={rowData.returnDistanceKm}
              onCommit={(n) => onChange({ ...rowData, returnDistanceKm: n })}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 mb-4">
        <NumberField
          id="move-shoppingErrandCount"
          label="買い物代行をした回数"
          value={rowData.shoppingErrandCount}
          onCommit={(n) => onChange({ ...rowData, shoppingErrandCount: n })}
        />
        <TextField
          id="move-note"
          label="備考(事務局へのひとこと。あれば)"
          value={rowData.note}
          onCommit={(v) => onChange({ ...rowData, note: v })}
        />
      </div>

      <Button variant="primary" fullWidth onClick={onSave} disabled={saving}>
        {saving ? '保存しています…' : '保存する'}
      </Button>
    </div>
  );
}
