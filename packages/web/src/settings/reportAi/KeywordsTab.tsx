import {
  AGE_MONTHS_MAX,
  type AgeBandView,
  type KeywordBody,
  type KeywordView,
  REPORT_LEVEL_MAX,
  REPORT_LEVEL_MIN,
} from '@katahimo/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useState } from 'react';
import { saveKeyword } from '../reportAiAdminApi';
import {
  BUTTON_PRIMARY_CLASS,
  BUTTON_SECONDARY_CLASS,
  ErrorText,
  INPUT_CLASS,
  REPORT_LEVELS,
  TEXTAREA_CLASS,
} from './shared';

interface FormState {
  code: string;
  category: string;
  name: string;
  subConcept: string;
  ageFromMonths: string;
  ageToMonths: string;
  educationLevelMin: string;
  educationLevelMax: string;
  stressLevelMin: string;
  tone: string;
  parentExplanation: string;
  phraseExamples: string;
  usageScene: string;
  ngExample: string;
  sortOrder: string;
  active: boolean;
  ageBandCodes: string[];
}

const EMPTY_FORM: FormState = {
  code: '',
  category: '',
  name: '',
  subConcept: '',
  ageFromMonths: '0',
  ageToMonths: String(AGE_MONTHS_MAX),
  educationLevelMin: String(REPORT_LEVEL_MIN),
  educationLevelMax: String(REPORT_LEVEL_MAX),
  stressLevelMin: String(REPORT_LEVEL_MIN),
  tone: '',
  parentExplanation: '',
  phraseExamples: '',
  usageScene: '',
  ngExample: '',
  sortOrder: '0',
  active: true,
  ageBandCodes: [],
};

/** サーバーから来た1行を、入力欄の文字列の形に直す。 */
function toForm(keyword: KeywordView): FormState {
  return {
    code: keyword.code,
    category: keyword.category,
    name: keyword.name,
    subConcept: keyword.subConcept,
    ageFromMonths: String(keyword.ageFromMonths),
    ageToMonths: String(keyword.ageToMonths),
    educationLevelMin: String(keyword.educationLevelMin),
    educationLevelMax: String(keyword.educationLevelMax),
    stressLevelMin: String(keyword.stressLevelMin),
    tone: keyword.tone,
    parentExplanation: keyword.parentExplanation,
    phraseExamples: keyword.phraseExamples,
    usageScene: keyword.usageScene,
    ngExample: keyword.ngExample,
    sortOrder: String(keyword.sortOrder),
    active: keyword.active,
    ageBandCodes: keyword.ageBandCodes,
  };
}

/**
 * 教育キーワード(report_keywords)の一覧・編集。廃止は削除ではなく `active=false` で保存する
 * (report_ai_generation_keywordsが過去の生成でどのキーワードを使ったかを記録しており、
 * 行を消すとその記録が指す先を失うため)。
 */
export function KeywordsTab({ keywords, ageBands }: { keywords: KeywordView[]; ageBands: AgeBandView[] }) {
  const queryClient = useQueryClient();
  /** 保存後に設定一式を引き直す(他のタブの表示も新しい内容に揃える)。 */
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['report-ai-admin'] });

  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [creatingNew, setCreatingNew] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [dirty, setDirty] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const sorted = [...keywords].sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
  const sortedAgeBands = [...ageBands].sort((a, b) => a.sortOrder - b.sortOrder);
  const selected = sorted.find((k) => k.code === selectedCode) ?? null;

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
    mutationFn: (input: { code: string; body: KeywordBody }) => saveKeyword(input.code, input.body),
    onSuccess: (keyword) => {
      setFormError(null);
      invalidate();
      setSelectedCode(keyword.code);
      setCreatingNew(false);
      setForm(toForm(keyword));
      setDirty(false);
    },
    onError: (e) => setFormError(e instanceof Error ? e.message : String(e)),
  });

  /** 新規追加のフォームを開く(空の入力に戻す)。 */
  const openNew = () => {
    setCreatingNew(true);
    setSelectedCode(null);
    setForm(EMPTY_FORM);
    setDirty(false);
    setFormError(null);
  };

  /** 一覧で選んだキーワードを編集する。中身は useEffect が選択中の行から流し込む。 */
  const openEdit = (code: string) => {
    setCreatingNew(false);
    setSelectedCode(code);
    setDirty(false);
    setFormError(null);
  };

  /** フォームを閉じる(編集中の入力は破棄する)。 */
  const closeForm = () => {
    setCreatingNew(false);
    setSelectedCode(null);
    setDirty(false);
  };

  /** 相性の良い年齢帯の選び外しを切り替える。 */
  const toggleAgeBandCode = (code: string) => {
    editForm((f) => ({
      ...f,
      ageBandCodes: f.ageBandCodes.includes(code)
        ? f.ageBandCodes.filter((c) => c !== code)
        : [...f.ageBandCodes, code],
    }));
  };

  /** 入力を検証して保存する。数値の欄は文字列で持っているので、ここで数に直して確かめる。 */
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const ageFromMonths = Number(form.ageFromMonths);
    const ageToMonths = Number(form.ageToMonths);
    const educationLevelMin = Number(form.educationLevelMin);
    const educationLevelMax = Number(form.educationLevelMax);
    const stressLevelMin = Number(form.stressLevelMin);
    const sortOrder = form.sortOrder.trim() === '' ? 0 : Number(form.sortOrder);
    if (!form.code.trim()) {
      setFormError('コードを入力してください。');
      return;
    }
    if (!form.name.trim()) {
      setFormError('キーワードを入力してください。');
      return;
    }
    if (!Number.isFinite(ageFromMonths) || !Number.isFinite(ageToMonths) || ageToMonths <= ageFromMonths) {
      setFormError('対象月齢の上限は下限より大きい値にしてください(上限の月齢は範囲に含みません)。');
      return;
    }
    if (educationLevelMin > educationLevelMax) {
      setFormError('教育関心度★の上限は下限以上にしてください。');
      return;
    }
    saveMutation.mutate({
      code: form.code.trim(),
      body: {
        category: form.category,
        name: form.name,
        subConcept: form.subConcept,
        ageFromMonths,
        ageToMonths,
        educationLevelMin,
        educationLevelMax,
        stressLevelMin,
        tone: form.tone,
        parentExplanation: form.parentExplanation,
        phraseExamples: form.phraseExamples,
        usageScene: form.usageScene,
        ngExample: form.ngExample,
        sortOrder,
        active: form.active,
        ageBandCodes: form.ageBandCodes,
      },
    });
  };

  const showForm = creatingNew || selected !== null;

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center gap-2">
        <p className="text-[10px] text-gray-400">
          削除は無く、使わなくなった語は「有効」を外して廃止します(過去の生成記録が参照するため)。
        </p>
        <button
          type="button"
          onClick={openNew}
          disabled={saveMutation.isPending}
          className={BUTTON_PRIMARY_CLASS}
        >
          + 新規追加
        </button>
      </div>

      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-xs border-collapse min-w-[520px]">
          <thead>
            <tr className="text-left text-gray-500 border-b">
              <th className="p-1">コード</th>
              <th className="p-1">分類</th>
              <th className="p-1">語</th>
              <th className="p-1">対象月齢</th>
              <th className="p-1">★範囲</th>
              <th className="p-1">PSI下限</th>
              <th className="p-1">有効</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((keyword) => (
              <tr
                key={keyword.code}
                className={`border-b last:border-b-0 ${
                  selectedCode === keyword.code ? 'bg-blue-50' : 'hover:bg-gray-50'
                } ${keyword.active ? '' : 'text-gray-400'}`}
              >
                {/* 行を開く口は本物のボタン1つにする(年齢帯の一覧と同じ作り)。行全体の
                    onClickだとキーボードでたどれず、読み上げでも押せる要素に見えない。 */}
                <td className="p-1 whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => openEdit(keyword.code)}
                    disabled={saveMutation.isPending}
                    className="underline underline-offset-2 hover:text-blue-600 disabled:opacity-50"
                  >
                    {keyword.code}
                  </button>
                </td>
                <td className="p-1 whitespace-nowrap">{keyword.category}</td>
                <td className="p-1 font-bold whitespace-nowrap">{keyword.name}</td>
                <td className="p-1 whitespace-nowrap">
                  {keyword.ageFromMonths}〜{keyword.ageToMonths}
                </td>
                <td className="p-1 whitespace-nowrap">
                  {keyword.educationLevelMin === keyword.educationLevelMax
                    ? `★${keyword.educationLevelMin}`
                    : `★${keyword.educationLevelMin}〜${keyword.educationLevelMax}`}
                </td>
                <td className="p-1 whitespace-nowrap">{keyword.stressLevelMin}以上</td>
                <td className="p-1 whitespace-nowrap">{keyword.active ? '○' : '廃止'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {sorted.length === 0 && <p className="text-xs text-gray-400 p-1">キーワードはまだありません。</p>}
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="space-y-2 bg-gray-50 rounded-lg p-3 border border-gray-200">
          <div className="flex justify-between items-start">
            <h4 className="text-xs font-bold text-gray-600">
              {creatingNew ? 'キーワードを追加' : `編集: ${selected?.name}`}
            </h4>
            <button
              type="button"
              onClick={closeForm}
              disabled={saveMutation.isPending}
              className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-50"
            >
              閉じる
            </button>
          </div>

          <div className="flex gap-2">
            <input
              value={form.code}
              onChange={(e) => editForm((f) => ({ ...f, code: e.target.value }))}
              disabled={!creatingNew || saveMutation.isPending}
              placeholder="コード(例 K01)"
              aria-label="コード"
              className={`${INPUT_CLASS} flex-1 min-w-0 disabled:bg-gray-100`}
            />
            <input
              value={form.name}
              onChange={(e) => editForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="キーワード(用語名)"
              aria-label="キーワード"
              disabled={saveMutation.isPending}
              className={`${INPUT_CLASS} flex-1 min-w-0 disabled:bg-gray-100`}
            />
          </div>
          <div className="flex gap-2">
            <input
              value={form.category}
              onChange={(e) => editForm((f) => ({ ...f, category: e.target.value }))}
              placeholder="分類"
              aria-label="分類"
              disabled={saveMutation.isPending}
              className={`${INPUT_CLASS} flex-1 min-w-0 disabled:bg-gray-100`}
            />
            <input
              value={form.subConcept}
              onChange={(e) => editForm((f) => ({ ...f, subConcept: e.target.value }))}
              placeholder="副題・別名"
              aria-label="副題・別名"
              disabled={saveMutation.isPending}
              className={`${INPUT_CLASS} flex-1 min-w-0 disabled:bg-gray-100`}
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
              disabled={saveMutation.isPending}
              className={`${INPUT_CLASS} flex-1 min-w-0 disabled:bg-gray-100`}
            />
            <span className="text-gray-400 text-[10px] shrink-0">〜(含まない)</span>
            <input
              type="number"
              min={0}
              max={AGE_MONTHS_MAX}
              value={form.ageToMonths}
              onChange={(e) => editForm((f) => ({ ...f, ageToMonths: e.target.value }))}
              aria-label="対象月齢(まで、含まない)"
              disabled={saveMutation.isPending}
              className={`${INPUT_CLASS} flex-1 min-w-0 disabled:bg-gray-100`}
            />
          </div>

          <div className="flex gap-2 items-center">
            <span className="text-xs text-gray-500 shrink-0 w-16">教育関心度★</span>
            <select
              value={form.educationLevelMin}
              onChange={(e) => editForm((f) => ({ ...f, educationLevelMin: e.target.value }))}
              aria-label="教育関心度★(下限)"
              disabled={saveMutation.isPending}
              className={`${INPUT_CLASS} flex-1 min-w-0 bg-white disabled:bg-gray-100`}
            >
              {REPORT_LEVELS.map((lv) => (
                <option key={lv} value={lv}>
                  ★{lv}
                </option>
              ))}
            </select>
            <span className="text-gray-400 text-[10px] shrink-0">〜</span>
            <select
              value={form.educationLevelMax}
              onChange={(e) => editForm((f) => ({ ...f, educationLevelMax: e.target.value }))}
              aria-label="教育関心度★(上限)"
              disabled={saveMutation.isPending}
              className={`${INPUT_CLASS} flex-1 min-w-0 bg-white disabled:bg-gray-100`}
            >
              {REPORT_LEVELS.map((lv) => (
                <option key={lv} value={lv}>
                  ★{lv}
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-2 items-center">
            <label className="text-xs text-gray-500 shrink-0 w-16" htmlFor="keywordStressLevelMin">
              PSI下限
            </label>
            <select
              id="keywordStressLevelMin"
              value={form.stressLevelMin}
              onChange={(e) => editForm((f) => ({ ...f, stressLevelMin: e.target.value }))}
              disabled={saveMutation.isPending}
              className={`${INPUT_CLASS} flex-1 min-w-0 bg-white disabled:bg-gray-100`}
            >
              {REPORT_LEVELS.map((lv) => (
                <option key={lv} value={lv}>
                  {lv}以上で使用可
                </option>
              ))}
            </select>
          </div>

          <input
            value={form.tone}
            onChange={(e) => editForm((f) => ({ ...f, tone: e.target.value }))}
            placeholder="語調・トーン"
            aria-label="語調・トーン"
            disabled={saveMutation.isPending}
            className={`${INPUT_CLASS} disabled:bg-gray-100`}
          />
          <textarea
            value={form.parentExplanation}
            onChange={(e) => editForm((f) => ({ ...f, parentExplanation: e.target.value }))}
            rows={2}
            placeholder="親向けのやさしい言い換え"
            aria-label="親向けのやさしい言い換え"
            disabled={saveMutation.isPending}
            className={`${TEXTAREA_CLASS} disabled:bg-gray-100`}
          />
          <textarea
            value={form.phraseExamples}
            onChange={(e) => editForm((f) => ({ ...f, phraseExamples: e.target.value }))}
            rows={2}
            placeholder="言い回しの例"
            aria-label="言い回しの例"
            disabled={saveMutation.isPending}
            className={`${TEXTAREA_CLASS} disabled:bg-gray-100`}
          />
          <textarea
            value={form.usageScene}
            onChange={(e) => editForm((f) => ({ ...f, usageScene: e.target.value }))}
            rows={2}
            placeholder="使いどころ"
            aria-label="使いどころ"
            disabled={saveMutation.isPending}
            className={`${TEXTAREA_CLASS} disabled:bg-gray-100`}
          />
          <textarea
            value={form.ngExample}
            onChange={(e) => editForm((f) => ({ ...f, ngExample: e.target.value }))}
            rows={2}
            placeholder="避ける言い方(NG例)"
            aria-label="避ける言い方(NG例)"
            disabled={saveMutation.isPending}
            className={`${TEXTAREA_CLASS} disabled:bg-gray-100`}
          />

          <div>
            <p className="text-xs text-gray-500 mb-1">相性の良い年齢帯</p>
            <div className="flex flex-wrap gap-2">
              {sortedAgeBands.map((band) => (
                <label
                  key={band.code}
                  className="flex items-center gap-1 text-xs bg-white border border-gray-200 rounded px-2 py-1"
                >
                  <input
                    type="checkbox"
                    checked={form.ageBandCodes.includes(band.code)}
                    onChange={() => toggleAgeBandCode(band.code)}
                    disabled={saveMutation.isPending}
                  />
                  {band.label}
                </label>
              ))}
              {sortedAgeBands.length === 0 && (
                <p className="text-[10px] text-gray-400">年齢帯タブで先に年齢帯を登録してください。</p>
              )}
            </div>
          </div>

          <div className="flex gap-4 items-center">
            <div className="flex gap-2 items-center">
              <label className="text-xs text-gray-500 shrink-0" htmlFor="keywordSortOrder">
                並び順
              </label>
              <input
                id="keywordSortOrder"
                type="number"
                min={0}
                value={form.sortOrder}
                onChange={(e) => editForm((f) => ({ ...f, sortOrder: e.target.value }))}
                disabled={saveMutation.isPending}
                className={`${INPUT_CLASS} w-24 disabled:bg-gray-100`}
              />
            </div>
            <label className="flex items-center gap-1 text-xs text-gray-700">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => editForm((f) => ({ ...f, active: e.target.checked }))}
                disabled={saveMutation.isPending}
              />
              有効
            </label>
          </div>
          <p className="text-[10px] text-gray-400">
            ※ 誤登録・使わなくなった場合も行は消さず、「有効」を外して廃止してください。
          </p>

          <ErrorText>{formError}</ErrorText>

          <div className="flex flex-wrap gap-2 pt-1">
            <button type="submit" disabled={saveMutation.isPending} className={BUTTON_PRIMARY_CLASS}>
              {saveMutation.isPending ? '保存中…' : '保存'}
            </button>
            <button
              type="button"
              onClick={closeForm}
              disabled={saveMutation.isPending}
              className={BUTTON_SECONDARY_CLASS}
            >
              キャンセル
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
