import { AGE_MONTHS_MAX, type AgeBandBody, type AgeBandView } from '@katahimo/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useState } from 'react';
import { deleteAgeBand, saveAgeBand } from '../reportAiAdminApi';
import {
  BUTTON_DANGER_CLASS,
  BUTTON_PRIMARY_CLASS,
  BUTTON_SECONDARY_CLASS,
  ErrorText,
  INPUT_CLASS,
  TEXTAREA_CLASS,
} from './shared';

interface FormState {
  code: string;
  label: string;
  ageFromMonths: string;
  ageToMonths: string;
  behaviorWords: string;
  developmentTopics: string;
  sceneExamples: string;
  sortOrder: string;
}

const EMPTY_FORM: FormState = {
  code: '',
  label: '',
  ageFromMonths: '',
  ageToMonths: '',
  behaviorWords: '',
  developmentTopics: '',
  sceneExamples: '',
  sortOrder: '0',
};

function toForm(band: AgeBandView): FormState {
  return {
    code: band.code,
    label: band.label,
    ageFromMonths: String(band.ageFromMonths),
    ageToMonths: String(band.ageToMonths),
    behaviorWords: band.behaviorWords,
    developmentTopics: band.developmentTopics,
    sceneExamples: band.sceneExamples,
    sortOrder: String(band.sortOrder),
  };
}

/**
 * 年齢帯(report_age_bands)の一覧・編集。行を選ぶと同じフォームに読み込み、`code`で upsert する。
 * 削除は年齢帯だけ許す(キーワードと違い、生成記録は年齢帯そのものを参照しないため)。
 */
export function AgeBandsTab({ ageBands }: { ageBands: AgeBandView[] }) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['report-ai-admin'] });

  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [creatingNew, setCreatingNew] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [dirty, setDirty] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const sorted = [...ageBands].sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
  const selected = sorted.find((b) => b.code === selectedCode) ?? null;

  // サーバーの内容が変わった(保存後の再取得・他タブの取込)ときは、未編集ならそれに追従する。
  // biome-ignore lint/correctness/useExhaustiveDependencies: dirtyは判定にだけ使い、依存に加えると編集中に再実行されてしまう
  useEffect(() => {
    if (dirty) return;
    if (selected) setForm(toForm(selected));
  }, [selected]);

  /** 入力を変える口はここ1つ。編集中(dirty)は再取得でフォームを上書きしない。 */
  const editForm = (update: (f: FormState) => FormState) => {
    setDirty(true);
    setForm(update);
  };

  const saveMutation = useMutation({
    mutationFn: (input: { code: string; body: AgeBandBody }) => saveAgeBand(input.code, input.body),
    onSuccess: (band) => {
      setFormError(null);
      invalidate();
      setSelectedCode(band.code);
      setCreatingNew(false);
      setForm(toForm(band));
      setDirty(false);
    },
    onError: (e) => setFormError(e instanceof Error ? e.message : String(e)),
  });

  const deleteMutation = useMutation({
    mutationFn: (code: string) => deleteAgeBand(code),
    onSuccess: () => {
      setSelectedCode(null);
      setCreatingNew(false);
      setDirty(false);
      invalidate();
    },
    onError: (e) => setFormError(e instanceof Error ? e.message : String(e)),
  });

  const openNew = () => {
    setCreatingNew(true);
    setSelectedCode(null);
    setForm(EMPTY_FORM);
    setDirty(false);
    setFormError(null);
  };

  const openEdit = (code: string) => {
    setCreatingNew(false);
    setSelectedCode(code);
    setDirty(false);
    setFormError(null);
  };

  const closeForm = () => {
    setCreatingNew(false);
    setSelectedCode(null);
    setDirty(false);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const ageFromMonths = Number(form.ageFromMonths);
    const ageToMonths = Number(form.ageToMonths);
    const sortOrder = form.sortOrder.trim() === '' ? 0 : Number(form.sortOrder);
    if (!form.code.trim()) {
      setFormError('コードを入力してください。');
      return;
    }
    if (!form.label.trim()) {
      setFormError('表示名を入力してください。');
      return;
    }
    if (!Number.isFinite(ageFromMonths) || !Number.isFinite(ageToMonths)) {
      setFormError('対象月齢を入力してください。');
      return;
    }
    if (ageToMonths <= ageFromMonths) {
      setFormError('対象月齢の上限は下限より大きい値にしてください(上限の月齢は範囲に含みません)。');
      return;
    }
    saveMutation.mutate({
      code: form.code.trim(),
      body: {
        label: form.label,
        ageFromMonths,
        ageToMonths,
        behaviorWords: form.behaviorWords,
        developmentTopics: form.developmentTopics,
        sceneExamples: form.sceneExamples,
        sortOrder,
      },
    });
  };

  const showForm = creatingNew || selected !== null;

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center gap-2">
        <p className="text-[10px] text-gray-400">
          月齢の上限は{AGE_MONTHS_MAX}ヶ月まで。「対象月齢(まで)」は範囲に含みません。
        </p>
        <button type="button" onClick={openNew} className={BUTTON_PRIMARY_CLASS}>
          + 新規追加
        </button>
      </div>

      <ul className="space-y-1">
        {sorted.map((band) => (
          <li key={band.code}>
            <button
              type="button"
              onClick={() => openEdit(band.code)}
              className={`w-full text-left p-2 rounded border text-xs ${
                selectedCode === band.code ? 'bg-blue-50 border-blue-200' : 'border-gray-200 hover:bg-gray-50'
              }`}
            >
              <span className="font-bold">{band.label}</span>
              <span className="ml-2 text-gray-400">{band.code}</span>
              <span className="ml-2 text-gray-500">
                {band.ageFromMonths}〜{band.ageToMonths}ヶ月未満
              </span>
            </button>
          </li>
        ))}
        {sorted.length === 0 && <p className="text-xs text-gray-400">年齢帯はまだありません。</p>}
      </ul>

      {showForm && (
        <form onSubmit={handleSubmit} className="space-y-2 bg-gray-50 rounded-lg p-3 border border-gray-200">
          <div className="flex justify-between items-start">
            <h4 className="text-xs font-bold text-gray-600">
              {creatingNew ? '年齢帯を追加' : `編集: ${selected?.label}`}
            </h4>
            <button type="button" onClick={closeForm} className="text-xs text-gray-400 hover:text-gray-600">
              閉じる
            </button>
          </div>
          <div className="flex gap-2">
            <input
              value={form.code}
              onChange={(e) => editForm((f) => ({ ...f, code: e.target.value }))}
              disabled={!creatingNew}
              placeholder="コード(例 y1)"
              aria-label="コード"
              className={`${INPUT_CLASS} flex-1 min-w-0 disabled:bg-gray-100`}
            />
            <input
              value={form.label}
              onChange={(e) => editForm((f) => ({ ...f, label: e.target.value }))}
              placeholder="表示名(例 1歳)"
              aria-label="表示名"
              className={`${INPUT_CLASS} flex-1 min-w-0`}
            />
          </div>
          <div className="flex gap-2 items-center">
            <span className="text-xs text-gray-500 shrink-0 w-16">対象月齢</span>
            <input
              type="number"
              min={0}
              max={AGE_MONTHS_MAX}
              value={form.ageFromMonths}
              onChange={(e) => editForm((f) => ({ ...f, ageFromMonths: e.target.value }))}
              aria-label="対象月齢(から)"
              className={`${INPUT_CLASS} flex-1 min-w-0`}
            />
            <span className="text-gray-400 text-[10px] shrink-0">〜(含まない)</span>
            <input
              type="number"
              min={0}
              max={AGE_MONTHS_MAX}
              value={form.ageToMonths}
              onChange={(e) => editForm((f) => ({ ...f, ageToMonths: e.target.value }))}
              aria-label="対象月齢(まで、含まない)"
              className={`${INPUT_CLASS} flex-1 min-w-0`}
            />
          </div>
          <textarea
            value={form.behaviorWords}
            onChange={(e) => editForm((f) => ({ ...f, behaviorWords: e.target.value }))}
            rows={2}
            placeholder="よく描く行動・言葉"
            aria-label="よく描く行動・言葉"
            className={TEXTAREA_CLASS}
          />
          <textarea
            value={form.developmentTopics}
            onChange={(e) => editForm((f) => ({ ...f, developmentTopics: e.target.value }))}
            rows={2}
            placeholder="発達の主なトピック"
            aria-label="発達の主なトピック"
            className={TEXTAREA_CLASS}
          />
          <textarea
            value={form.sceneExamples}
            onChange={(e) => editForm((f) => ({ ...f, sceneExamples: e.target.value }))}
            rows={2}
            placeholder="場面例"
            aria-label="場面例"
            className={TEXTAREA_CLASS}
          />
          <div className="flex gap-2 items-center">
            <label className="text-xs text-gray-500 shrink-0" htmlFor="ageBandSortOrder">
              並び順
            </label>
            <input
              id="ageBandSortOrder"
              type="number"
              min={0}
              value={form.sortOrder}
              onChange={(e) => editForm((f) => ({ ...f, sortOrder: e.target.value }))}
              className={`${INPUT_CLASS} w-24`}
            />
          </div>

          <ErrorText>{formError}</ErrorText>

          <div className="flex flex-wrap gap-2 pt-1">
            <button type="submit" disabled={saveMutation.isPending} className={BUTTON_PRIMARY_CLASS}>
              {saveMutation.isPending ? '保存中…' : '保存'}
            </button>
            {!creatingNew && selected && (
              <button
                type="button"
                disabled={deleteMutation.isPending}
                onClick={() => {
                  if (
                    window.confirm(
                      `「${selected.label}」を削除します。よろしいですか?(キーワードとの相性設定からも外れます)`,
                    )
                  ) {
                    deleteMutation.mutate(selected.code);
                  }
                }}
                className={BUTTON_DANGER_CLASS}
              >
                {deleteMutation.isPending ? '削除中…' : '削除'}
              </button>
            )}
            <button type="button" onClick={closeForm} className={BUTTON_SECONDARY_CLASS}>
              キャンセル
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
