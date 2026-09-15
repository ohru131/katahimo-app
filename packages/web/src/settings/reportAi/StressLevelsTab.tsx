import { EDUCATION_LEVEL_SHIFT_MIN, type StressLevelBody, type StressLevelView } from '@katahimo/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useState } from 'react';
import { saveStressLevel } from '../reportAiAdminApi';
import {
  BUTTON_PRIMARY_CLASS,
  ErrorText,
  INPUT_CLASS,
  NoticeText,
  REPORT_LEVELS,
  TEXTAREA_CLASS,
} from './shared';

interface FormState {
  label: string;
  criteria: string;
  promptInstruction: string;
  educationLevelShift: string;
  keywordsEnabled: boolean;
  escalationRequired: boolean;
}

/** そのストレス度の行(まだ無ければ既定値)を、入力欄の形に直す。 */
function toForm(level: number, data: StressLevelView | undefined): FormState {
  if (data) {
    return {
      label: data.label,
      criteria: data.criteria,
      promptInstruction: data.promptInstruction,
      educationLevelShift: String(data.educationLevelShift),
      keywordsEnabled: data.keywordsEnabled,
      escalationRequired: data.escalationRequired,
    };
  }
  return {
    label: `PSI${level}`,
    criteria: '',
    promptInstruction: '',
    educationLevelShift: '0',
    keywordsEnabled: true,
    escalationRequired: false,
  };
}

/** レベル1件ぶんのフォーム。5つ並べるので、保存の成否・エラーはレベルごとに独立させている。 */
function StressLevelForm({ level, data }: { level: number; data: StressLevelView | undefined }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(() => toForm(level, data));
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // サーバーの内容が変わった(保存後の再取得・取込タブ)ときは、未編集ならそれに追従する。
  // dirty はこのレベルのフォームだけのものなので、隣のレベルを編集していても追従は止まらない。
  // biome-ignore lint/correctness/useExhaustiveDependencies: dirtyは判定にだけ使い、依存に加えると編集中に再実行されてしまう
  useEffect(() => {
    if (dirty) return;
    setForm(toForm(level, data));
  }, [level, data]);

  /** 入力を変える口はここ1つ。編集中(dirty)は再取得でフォームを上書きしない。 */
  const editForm = (update: (f: FormState) => FormState) => {
    setDirty(true);
    setNotice(null);
    setForm(update);
  };

  const saveMutation = useMutation({
    mutationFn: (body: StressLevelBody) => saveStressLevel(level, body),
    onSuccess: (saved) => {
      setError(null);
      setNotice('保存しました。');
      setForm(toForm(level, saved));
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ['report-ai-admin'] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  /** 入力を検証して、このストレス度の定義を保存する。 */
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    if (!form.label.trim()) {
      setError('呼称を入力してください。');
      return;
    }
    const shift = Number(form.educationLevelShift);
    if (!Number.isInteger(shift) || shift < EDUCATION_LEVEL_SHIFT_MIN || shift > 0) {
      setError(`★の引き下げ幅は${EDUCATION_LEVEL_SHIFT_MIN}〜0にしてください。`);
      return;
    }
    saveMutation.mutate({
      label: form.label,
      criteria: form.criteria,
      promptInstruction: form.promptInstruction,
      educationLevelShift: shift,
      keywordsEnabled: form.keywordsEnabled,
      escalationRequired: form.escalationRequired,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-2 bg-gray-50 rounded-lg p-3 border border-gray-200">
      <h4 className="text-xs font-bold text-gray-600">PSI{level}</h4>
      <input
        value={form.label}
        onChange={(e) => editForm((f) => ({ ...f, label: e.target.value }))}
        placeholder="呼称"
        aria-label={`PSI${level} 呼称`}
        disabled={saveMutation.isPending}
        className={`${INPUT_CLASS} disabled:bg-gray-100`}
      />
      <textarea
        value={form.criteria}
        onChange={(e) => editForm((f) => ({ ...f, criteria: e.target.value }))}
        rows={2}
        placeholder="判定基準(日報入力画面にも表示される)"
        aria-label={`PSI${level} 判定基準`}
        disabled={saveMutation.isPending}
        className={`${TEXTAREA_CLASS} disabled:bg-gray-100`}
      />
      <textarea
        value={form.promptInstruction}
        onChange={(e) => editForm((f) => ({ ...f, promptInstruction: e.target.value }))}
        rows={2}
        placeholder="AIへの指示文"
        aria-label={`PSI${level} AIへの指示文`}
        disabled={saveMutation.isPending}
        className={`${TEXTAREA_CLASS} disabled:bg-gray-100`}
      />
      <div className="flex gap-4 items-center flex-wrap">
        <div className="flex gap-2 items-center">
          <label className="text-xs text-gray-500 shrink-0" htmlFor={`stressLevelShift-${level}`}>
            ★の引き下げ幅
          </label>
          <input
            id={`stressLevelShift-${level}`}
            type="number"
            min={EDUCATION_LEVEL_SHIFT_MIN}
            max={0}
            value={form.educationLevelShift}
            onChange={(e) => editForm((f) => ({ ...f, educationLevelShift: e.target.value }))}
            disabled={saveMutation.isPending}
            className={`${INPUT_CLASS} w-20 disabled:bg-gray-100`}
          />
        </div>
        <label className="flex items-center gap-1 text-xs text-gray-700">
          <input
            type="checkbox"
            checked={form.keywordsEnabled}
            onChange={(e) => editForm((f) => ({ ...f, keywordsEnabled: e.target.checked }))}
            disabled={saveMutation.isPending}
          />
          教育語を使う
        </label>
        <label className="flex items-center gap-1 text-xs text-gray-700">
          <input
            type="checkbox"
            checked={form.escalationRequired}
            onChange={(e) => editForm((f) => ({ ...f, escalationRequired: e.target.checked }))}
            disabled={saveMutation.isPending}
          />
          管理者連絡を要する
        </label>
      </div>

      <ErrorText>{error}</ErrorText>
      <NoticeText>{notice}</NoticeText>

      <button type="submit" disabled={saveMutation.isPending} className={BUTTON_PRIMARY_CLASS}>
        {saveMutation.isPending ? '保存中…' : '保存'}
      </button>
    </form>
  );
}

/**
 * ストレス度・PSI(report_stress_levels)の判定基準。level 1〜5(低いほど負担大)の固定5行を
 * 常に表示する。未評価(null)はコード側で安全側(教育語なし・エスカレーション不要)に扱うため、
 * ここにはレベル0の行は無い。
 */
export function StressLevelsTab({ stressLevels }: { stressLevels: StressLevelView[] }) {
  const byLevel = new Map(stressLevels.map((s) => [s.level, s]));
  return (
    <div className="space-y-3">
      <p className="text-[10px] text-gray-400">
        PSIは数値が低いほど保護者の負担が大きい判定です。未評価(スタッフが選ばなかった場合)は
        教育キーワードを使わず、管理者連絡も要しない安全側の扱いになります。
      </p>
      {REPORT_LEVELS.map((level) => (
        <StressLevelForm key={level} level={level} data={byLevel.get(level)} />
      ))}
    </div>
  );
}
