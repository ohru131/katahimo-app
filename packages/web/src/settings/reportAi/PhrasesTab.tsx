import {
  type PhraseInput,
  type PhraseView,
  REPORT_LEVEL_MAX,
  REPORT_LEVEL_MIN,
  type ReportPhraseKind,
  type ReportPhrasePlacement,
} from '@katahimo/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { replacePhrases } from '../reportAiAdminApi';
import {
  BUTTON_PRIMARY_CLASS,
  BUTTON_SECONDARY_CLASS,
  ErrorText,
  INPUT_CLASS,
  NoticeText,
  REPORT_LEVELS,
} from './shared';

/** 保存前の画面上だけのキー。DBの行を指すものではないので、削除・並べ替えの識別にだけ使う。 */
let nextRowKey = 0;
/** 画面上の行を見分けるための連番を1つ払い出す。 */
function newRowKey(): number {
  nextRowKey += 1;
  return nextRowKey;
}

interface PhraseRow extends PhraseInput {
  rowKey: number;
}

/**
 * 保存に出す1行にする(画面だけのrowKeyを落とす)。避ける表現はストレス度の範囲を持たない
 * ため、値が入っていても全範囲に戻す。この画面には avoid の範囲の入力欄が無いので、
 * 取込などで範囲の付いた行が来ていたときに、見えないまま送り返してしまわないようにする。
 */
function toPhraseInput({ rowKey: _rowKey, ...rest }: PhraseRow): PhraseInput {
  if (rest.kind !== 'avoid') return rest;
  return { ...rest, stressLevelMin: REPORT_LEVEL_MIN, stressLevelMax: REPORT_LEVEL_MAX };
}

/** サーバーから来た一覧を、画面で編集する行(rowKey付き)にする。 */
function toRows(phrases: PhraseView[]): PhraseRow[] {
  return phrases.map((p) => ({ ...p, rowKey: newRowKey() }));
}

/** 空の1行を足す。ストレス度の範囲は全範囲から始める。 */
function newRow(kind: ReportPhraseKind): PhraseRow {
  return {
    rowKey: newRowKey(),
    kind,
    body: '',
    intent: '',
    stressLevelMin: REPORT_LEVEL_MIN,
    stressLevelMax: REPORT_LEVEL_MAX,
    placement: 'any',
    sortOrder: 0,
    active: true,
  };
}

const KIND_LABELS: Record<ReportPhraseKind, string> = {
  encourage: '温かみ表現(ねぎらう・寄り添う)',
  avoid: '避ける表現(全日報で使わない)',
};

/** 1行の編集欄。kindは固定(セクションで決まる)なので編集させない。 */
function PhraseRowEditor({
  row,
  onChange,
  onRemove,
}: {
  row: PhraseRow;
  onChange: (next: PhraseRow) => void;
  onRemove: () => void;
}) {
  return (
    <div className="space-y-1 bg-white rounded border border-gray-200 p-2">
      <div className="flex gap-2">
        <input
          value={row.body}
          onChange={(e) => onChange({ ...row, body: e.target.value })}
          placeholder="表現"
          aria-label="表現"
          className={`${INPUT_CLASS} flex-1 min-w-0`}
        />
        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 px-2 py-1 text-xs text-red-500 hover:bg-red-50 rounded"
        >
          削除
        </button>
      </div>
      <input
        value={row.intent}
        onChange={(e) => onChange({ ...row, intent: e.target.value })}
        placeholder={row.kind === 'encourage' ? '込めるメッセージ' : '避ける理由'}
        aria-label={row.kind === 'encourage' ? '込めるメッセージ' : '避ける理由'}
        className={INPUT_CLASS}
      />
      <div className="flex gap-2 items-center flex-wrap">
        {row.kind === 'encourage' && (
          <>
            <div className="flex gap-1 items-center">
              <span className="text-[10px] text-gray-500 shrink-0">対象PSI</span>
              <select
                value={row.stressLevelMin}
                onChange={(e) => onChange({ ...row, stressLevelMin: Number(e.target.value) })}
                aria-label="対象PSI(下限)"
                className={`${INPUT_CLASS} w-16 bg-white`}
              >
                {REPORT_LEVELS.map((lv) => (
                  <option key={lv} value={lv}>
                    {lv}
                  </option>
                ))}
              </select>
              <span className="text-gray-400 text-[10px]">〜</span>
              <select
                value={row.stressLevelMax}
                onChange={(e) => onChange({ ...row, stressLevelMax: Number(e.target.value) })}
                aria-label="対象PSI(上限)"
                className={`${INPUT_CLASS} w-16 bg-white`}
              >
                {REPORT_LEVELS.map((lv) => (
                  <option key={lv} value={lv}>
                    {lv}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-1 items-center">
              <label
                className="text-[10px] text-gray-500 shrink-0"
                htmlFor={`phrase-placement-${row.rowKey}`}
              >
                配置
              </label>
              <select
                id={`phrase-placement-${row.rowKey}`}
                value={row.placement}
                onChange={(e) => onChange({ ...row, placement: e.target.value as ReportPhrasePlacement })}
                className={`${INPUT_CLASS} w-24 bg-white`}
              >
                <option value="any">どこでも</option>
                <option value="closing">締めの一文</option>
              </select>
            </div>
          </>
        )}
        <label className="flex items-center gap-1 text-[10px] text-gray-700">
          <input
            type="checkbox"
            checked={row.active}
            onChange={(e) => onChange({ ...row, active: e.target.checked })}
          />
          有効
        </label>
      </div>
    </div>
  );
}

/**
 * 温かみ表現・避ける表現(report_phrases)。kindごとに一覧を編集し、まとめて
 * `PUT /phrases`(全件入れ替え)で保存する。キーワードと違い生成記録がこの行を直接参照しないため、
 * 画面から行を消してよい(次の保存で本当に消える)。
 */
export function PhrasesTab({ phrases }: { phrases: PhraseView[] }) {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<PhraseRow[]>(() => toRows(phrases));
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // サーバーの内容が変わった(他タブの取込等)ときは、未編集ならそれに追従する。
  // biome-ignore lint/correctness/useExhaustiveDependencies: dirtyは判定にだけ使い、依存に加えると編集中に再実行されてしまう
  useEffect(() => {
    if (dirty) return;
    setRows(toRows(phrases));
  }, [phrases]);

  /** 1行を差し替える(編集中の印を立てて、再取得で上書きされないようにする)。 */
  const updateRow = (rowKey: number, next: PhraseRow) => {
    setDirty(true);
    setNotice(null);
    setRows((rs) => rs.map((r) => (r.rowKey === rowKey ? next : r)));
  };

  /** 1行を一覧から外す(実際に消えるのは保存したとき)。 */
  const removeRow = (rowKey: number) => {
    setDirty(true);
    setNotice(null);
    setRows((rs) => rs.filter((r) => r.rowKey !== rowKey));
  };

  /** その種類の空行を末尾に足す。 */
  const addRow = (kind: ReportPhraseKind) => {
    setDirty(true);
    setNotice(null);
    setRows((rs) => [...rs, newRow(kind)]);
  };

  const saveMutation = useMutation({
    mutationFn: () => replacePhrases(rows.map(toPhraseInput)),
    onSuccess: (saved) => {
      setError(null);
      setNotice('保存しました。');
      setDirty(false);
      setRows(toRows(saved));
      queryClient.invalidateQueries({ queryKey: ['report-ai-admin'] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  /** 画面の一覧をそのままテナントの一式として保存する(全件入れ替え)。 */
  const handleSave = () => {
    const emptyBody = rows.find((r) => r.body.trim() === '');
    if (emptyBody) {
      setError('表現が空の行があります。入力するか削除してください。');
      return;
    }
    const invalidRange = rows.find((r) => r.kind === 'encourage' && r.stressLevelMin > r.stressLevelMax);
    if (invalidRange) {
      setError('対象PSIの上限は下限以上にしてください。');
      return;
    }
    setError(null);
    saveMutation.mutate();
  };

  return (
    <div className="space-y-4">
      {(['encourage', 'avoid'] as const).map((kind) => (
        <section key={kind} className="space-y-2">
          <div className="flex justify-between items-center">
            <h4 className="text-xs font-bold text-gray-600">{KIND_LABELS[kind]}</h4>
            <button
              type="button"
              onClick={() => addRow(kind)}
              className="text-xs px-2 py-1 rounded border border-gray-300 hover:bg-gray-100"
            >
              + 追加
            </button>
          </div>
          <div className="space-y-2">
            {rows
              .filter((r) => r.kind === kind)
              .map((row) => (
                <PhraseRowEditor
                  key={row.rowKey}
                  row={row}
                  onChange={(next) => updateRow(row.rowKey, next)}
                  onRemove={() => removeRow(row.rowKey)}
                />
              ))}
            {rows.filter((r) => r.kind === kind).length === 0 && (
              <p className="text-xs text-gray-400">まだありません。</p>
            )}
          </div>
        </section>
      ))}

      <ErrorText>{error}</ErrorText>
      <NoticeText>{notice}</NoticeText>

      <div className="flex gap-2">
        <button
          type="button"
          disabled={saveMutation.isPending}
          onClick={handleSave}
          className={BUTTON_PRIMARY_CLASS}
        >
          {saveMutation.isPending ? '保存中…' : '保存(全件入れ替え)'}
        </button>
        {dirty && (
          <button
            type="button"
            onClick={() => {
              setRows(toRows(phrases));
              setDirty(false);
              setError(null);
              setNotice(null);
            }}
            className={BUTTON_SECONDARY_CLASS}
          >
            編集を取り消す
          </button>
        )}
      </div>
      <p className="text-[10px] text-gray-400">
        ※ 保存すると、この画面に出ている行だけに入れ替わります(表示していない行は残りません)。
      </p>
    </div>
  );
}
