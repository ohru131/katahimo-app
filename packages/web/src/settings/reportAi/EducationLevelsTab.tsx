import {
  type EducationLevelBody,
  type EducationLevelView,
  MAX_KEYWORDS_PER_REPORT_LIMIT,
} from '@katahimo/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useState } from 'react';
import { saveEducationLevel } from '../reportAiAdminApi';
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
  description: string;
  promptInstruction: string;
  maxKeywords: string;
  allowTermNames: boolean;
}

/** その★の行(まだ無ければ既定値)を、入力欄の形に直す。 */
function toForm(level: number, data: EducationLevelView | undefined): FormState {
  if (data) {
    return {
      label: data.label,
      description: data.description,
      promptInstruction: data.promptInstruction,
      maxKeywords: String(data.maxKeywords),
      allowTermNames: data.allowTermNames,
    };
  }
  return {
    label: `★${level}`,
    description: '',
    promptInstruction: '',
    maxKeywords: '1',
    allowTermNames: false,
  };
}

/** レベル1件ぶんのフォーム。5つ並べるので、保存の成否・エラーはレベルごとに独立させている。 */
function EducationLevelForm({ level, data }: { level: number; data: EducationLevelView | undefined }) {
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
    mutationFn: (body: EducationLevelBody) => saveEducationLevel(level, body),
    onSuccess: (saved) => {
      setError(null);
      setNotice('保存しました。');
      setForm(toForm(level, saved));
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ['report-ai-admin'] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  /** 入力を検証して、この★の定義を保存する。 */
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    if (!form.label.trim()) {
      setError('呼称を入力してください。');
      return;
    }
    const maxKeywords = Number(form.maxKeywords);
    if (!Number.isInteger(maxKeywords) || maxKeywords < 0 || maxKeywords > MAX_KEYWORDS_PER_REPORT_LIMIT) {
      setError(`キーワード数上限は0〜${MAX_KEYWORDS_PER_REPORT_LIMIT}にしてください。`);
      return;
    }
    saveMutation.mutate({
      label: form.label,
      description: form.description,
      promptInstruction: form.promptInstruction,
      maxKeywords,
      allowTermNames: form.allowTermNames,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-2 bg-gray-50 rounded-lg p-3 border border-gray-200">
      <h4 className="text-xs font-bold text-gray-600">★{level}</h4>
      <input
        value={form.label}
        onChange={(e) => editForm((f) => ({ ...f, label: e.target.value }))}
        placeholder="呼称"
        aria-label={`★${level} 呼称`}
        className={INPUT_CLASS}
      />
      <textarea
        value={form.description}
        onChange={(e) => editForm((f) => ({ ...f, description: e.target.value }))}
        rows={2}
        placeholder="想定する家庭像"
        aria-label={`★${level} 想定する家庭像`}
        className={TEXTAREA_CLASS}
      />
      <textarea
        value={form.promptInstruction}
        onChange={(e) => editForm((f) => ({ ...f, promptInstruction: e.target.value }))}
        rows={2}
        placeholder="AIへの指示文({keywordGuide}に差し込まれる)"
        aria-label={`★${level} AIへの指示文`}
        className={TEXTAREA_CLASS}
      />
      <div className="flex gap-4 items-center flex-wrap">
        <div className="flex gap-2 items-center">
          <label className="text-xs text-gray-500 shrink-0" htmlFor={`educationLevelMaxKeywords-${level}`}>
            キーワード数上限
          </label>
          <input
            id={`educationLevelMaxKeywords-${level}`}
            type="number"
            min={0}
            max={MAX_KEYWORDS_PER_REPORT_LIMIT}
            value={form.maxKeywords}
            onChange={(e) => editForm((f) => ({ ...f, maxKeywords: e.target.value }))}
            className={`${INPUT_CLASS} w-20`}
          />
        </div>
        <label className="flex items-center gap-1 text-xs text-gray-700">
          <input
            type="checkbox"
            checked={form.allowTermNames}
            onChange={(e) => editForm((f) => ({ ...f, allowTermNames: e.target.checked }))}
          />
          用語名をそのまま出す
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
 * 教育関心度★(report_education_levels)の判定基準。level 1〜5の固定5行を常に表示し、
 * データが無いレベルは空のフォームから作る(段階を飛ばして設定できないようにするため)。
 */
export function EducationLevelsTab({ educationLevels }: { educationLevels: EducationLevelView[] }) {
  const byLevel = new Map(educationLevels.map((e) => [e.level, e]));
  return (
    <div className="space-y-3">
      <p className="text-[10px] text-gray-400">
        ★は教育関心度(高いほど教育語への関心が高い家庭)。行が無いレベルは保存すると作られます。
      </p>
      {REPORT_LEVELS.map((level) => (
        <EducationLevelForm key={level} level={level} data={byLevel.get(level)} />
      ))}
    </div>
  );
}
