import {
  PROMPT_TEMPLATE_BODY_MAX_LENGTH,
  PROMPT_TEMPLATE_KEY_LABELS,
  PROMPT_TEMPLATE_KEYS,
  type PromptTemplateKey,
} from '@katahimo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { PromptTemplateVersionView } from '../api';
import {
  fetchPromptTemplatesForAdmin,
  fetchPromptTemplateVersions,
  resetPromptTemplate,
  savePromptTemplate,
} from '../api';

/**
 * 差し込み変数の短い説明。区分自体はPROMPT_PLACEHOLDERS(@katahimo/shared)にあるが、
 * 画面での一言説明はここだけで使うので画面側に置く。
 */
const PLACEHOLDER_DESCRIPTIONS: Record<string, string> = {
  anonymizedText: 'メモ本文',
  timeInfo: '保育時間',
  childContext: '3軸の差し込み(未接続、将来用)',
  keywordGuide: '3軸の差し込み(未接続、将来用)',
  toneGuide: '3軸の差し込み(未接続、将来用)',
};

/** ISO日時文字列を'YYYY/MM/DD HH:mm'形式の表示用文字列にする。パースできなければそのまま返す。 */
function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * 管理者によるAIプロンプト文面の編集(GAS版「ＡＩプロンプト」シートに対応)。CouponAdminModal・
 * StaffAdminModalと同じ構成(一覧+操作)だが、こちらは一覧で選んだキーごとに専用の編集欄を出す形にしている。
 *
 * 文面はテナントごとにprompt_templatesへ版として積まれ、版が無いキーは既定文面(DEFAULT_PROMPT_TEMPLATES)
 * で動く。保存・既定戻しのどちらも新しい版として記録されるので、後から履歴で確認・差し戻しができる。
 */
export function PromptTemplateAdminModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const templatesQuery = useQuery({
    queryKey: ['prompt-templates-admin'],
    queryFn: fetchPromptTemplatesForAdmin,
  });

  const [selectedKey, setSelectedKey] = useState<PromptTemplateKey>(PROMPT_TEMPLATE_KEYS[0]);
  const [body, setBody] = useState('');
  const [note, setNote] = useState('');
  const [showDefault, setShowDefault] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const selected = templatesQuery.data?.find((t) => t.key === selectedKey) ?? null;

  // 選んだキーの文面(選び直した・保存し直したどちらでも)を編集欄に読み込み直す。
  useEffect(() => {
    if (!selected) return;
    setBody(selected.body);
    setNote('');
    setNotice(null);
    setFormError(null);
    setShowDefault(false);
  }, [selected]);

  // 保存・既定戻しの直後の完了メッセージは、次の操作の邪魔にならないよう少ししたら消す。
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  const versionsQuery = useQuery({
    queryKey: ['prompt-template-versions', selectedKey],
    queryFn: () => fetchPromptTemplateVersions(selectedKey),
    enabled: showHistory,
  });

  /** 保存・既定戻しの後に、関連するキャッシュ(一覧・選択中キーの履歴・日報UI文言)を作り直す。 */
  const invalidateAfterChange = () => {
    queryClient.invalidateQueries({ queryKey: ['prompt-templates-admin'] });
    queryClient.invalidateQueries({ queryKey: ['prompt-template-versions', selectedKey] });
    // 日報・事故報告画面のプレースホルダー/記載要領(UI文言)もすぐ切り替わるようにする。
    queryClient.invalidateQueries({ queryKey: ['report-ui-texts'] });
  };

  const saveMutation = useMutation({
    mutationFn: () => savePromptTemplate(selectedKey, body, note.trim() || undefined),
    onSuccess: () => {
      setFormError(null);
      setNotice('保存しました。以後の生成にはこの文面が使われます。');
      invalidateAfterChange();
    },
    onError: (e) => setFormError(e instanceof Error ? e.message : String(e)),
  });

  const resetMutation = useMutation({
    mutationFn: () => resetPromptTemplate(selectedKey),
    onSuccess: () => {
      setFormError(null);
      setNotice('既定の文面に戻しました。');
      invalidateAfterChange();
    },
    onError: (e) => setFormError(e instanceof Error ? e.message : String(e)),
  });

  const busy = saveMutation.isPending || resetMutation.isPending;
  const bodyUnchanged = selected !== null && body === selected.body;
  const saveDisabled = !selected || busy || bodyUnchanged || body.trim() === '';
  const resetDisabled = !selected || busy || selected.isDefault;
  // 保存前の未反映な変更があるかどうか。他のキーへの切り替え・モーダルを閉じる操作の
  // どちらも、これが真なら確認を挟んで誤って破棄しないようにする。
  const isDirty = selected !== null && body !== selected.body;

  /** 未保存の変更があるときだけ確認ダイアログを出す。破棄してよい(または変更なし)ならtrue。 */
  const confirmDiscardIfDirty = (): boolean => {
    if (!isDirty) return true;
    return window.confirm('編集中の文面を破棄しますか?');
  };

  /** キー一覧から別の文面へ切り替える。未保存の変更があれば確認してから切り替える。 */
  const handleSelectKey = (key: PromptTemplateKey) => {
    if (key === selectedKey) return;
    if (!confirmDiscardIfDirty()) return;
    setSelectedKey(key);
  };

  /** モーダルを閉じる。未保存の変更があれば確認してから閉じる(ヘッダー・フッターの両方から呼ぶ)。 */
  const handleRequestClose = () => {
    if (!confirmDiscardIfDirty()) return;
    onClose();
  };

  /** 選択中キーの文面を既定に戻す。確認ダイアログで承諾されたときだけ実行する。 */
  const handleReset = () => {
    if (!selected || selected.isDefault) return;
    if (
      !window.confirm(
        `「${PROMPT_TEMPLATE_KEY_LABELS[selected.key]}」を既定の文面に戻します。よろしいですか?\n(この操作も新しい版として記録されます)`,
      )
    ) {
      return;
    }
    setNotice(null);
    resetMutation.mutate();
  };

  /** 履歴の1件を編集欄に読み込む。変更メモは版ごとに書き直すものなので、古いメモは残さず空にする。 */
  const loadVersionIntoEditor = (version: PromptTemplateVersionView) => {
    if (!confirmDiscardIfDirty()) return;
    setBody(version.body);
    setNote('');
    setFormError(null);
    setNotice(
      `v${version.version}(${formatDateTime(version.createdAt)})の文面を読み込みました。保存するまで反映されません。`,
    );
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-[110] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-4xl rounded-xl shadow-xl flex flex-col max-h-[92vh]">
        <div className="p-4 border-b flex justify-between items-start gap-2 bg-gray-50 rounded-t-xl">
          <div className="min-w-0">
            <h3 className="font-bold text-gray-800 text-sm">🧠 AIプロンプト管理</h3>
            <p className="text-[10px] text-gray-500 mt-1">
              保存すると新しい版として積まれ、以後の生成にすぐ使われます。既定に戻すも版として記録されます。
            </p>
          </div>
          <button
            type="button"
            onClick={handleRequestClose}
            className="p-2 hover:bg-gray-200 rounded-full text-gray-500 shrink-0"
          >
            &times;
          </button>
        </div>

        <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden">
          <div className="md:w-56 shrink-0 border-b md:border-b-0 md:border-r overflow-y-auto p-2 space-y-1">
            {templatesQuery.isPending && (
              <div className="flex justify-center py-6">
                <div className="w-6 h-6 rounded-full border-4 border-gray-200 loading-spinner" />
              </div>
            )}
            {templatesQuery.isError && (
              <p className="text-red-500 text-xs p-2">{(templatesQuery.error as Error).message}</p>
            )}
            {PROMPT_TEMPLATE_KEYS.map((key) => {
              const template = templatesQuery.data?.find((t) => t.key === key);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => handleSelectKey(key)}
                  className={`w-full text-left p-2 rounded-lg border text-xs flex items-center justify-between gap-2 ${
                    key === selectedKey
                      ? 'bg-blue-50 border-blue-200 text-blue-800'
                      : 'border-transparent hover:bg-gray-50 text-gray-700'
                  }`}
                >
                  <span className="min-w-0 break-words">{PROMPT_TEMPLATE_KEY_LABELS[key]}</span>
                  {template && (
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                        template.isDefault ? 'bg-gray-200 text-gray-600' : 'bg-green-100 text-green-700'
                      }`}
                    >
                      {template.isDefault ? '既定' : `v${template.version}`}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {selected && (
              <>
                <div className="flex items-center flex-wrap gap-2">
                  <h4 className="font-bold text-gray-700 text-sm">{selected.label}</h4>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                      selected.isDefault ? 'bg-gray-200 text-gray-600' : 'bg-green-100 text-green-700'
                    }`}
                  >
                    {selected.isDefault ? '既定を使用中' : `v${selected.version} を使用中`}
                  </span>
                  {selected.updatedAt && (
                    <span className="text-[10px] text-gray-400">
                      最終更新: {formatDateTime(selected.updatedAt)}
                    </span>
                  )}
                </div>

                {selected.key === 'daily_report_stance' && (
                  <p className="rounded bg-amber-50 border border-amber-200 px-2 py-1.5 text-xs text-amber-800">
                    この文面は、保護者向け文面を年齢帯・教育関心度・ストレス度で組み替える差し込み(
                    <code>{'{toneGuide}'}</code>)に入る予定のもの。差し込みが生成に接続されるまで、
                    ここで保存した文面は生成結果に影響しない。
                  </p>
                )}

                {selected.placeholders.length > 0 && (
                  <div>
                    <p className="text-xs font-bold text-gray-600 mb-1">使える差し込み変数</p>
                    <div className="flex flex-wrap gap-1">
                      {selected.placeholders.map((placeholder) => (
                        <span
                          key={placeholder}
                          title={PLACEHOLDER_DESCRIPTIONS[placeholder] ?? ''}
                          className="text-[10px] font-mono bg-blue-50 text-blue-700 rounded px-1.5 py-0.5"
                        >
                          {`{${placeholder}}`}
                        </span>
                      ))}
                    </div>
                    <p className="text-[10px] text-gray-400 mt-1">
                      {selected.placeholders
                        .map((p) => `{${p}} = ${PLACEHOLDER_DESCRIPTIONS[p] ?? p}`)
                        .join(' / ')}
                    </p>
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-bold text-gray-600" htmlFor="promptTemplateBody">
                      文面
                    </label>
                    <span className="text-[10px] text-gray-400">
                      {body.length.toLocaleString('ja-JP')} /{' '}
                      {PROMPT_TEMPLATE_BODY_MAX_LENGTH.toLocaleString('ja-JP')} 文字
                    </span>
                  </div>
                  <textarea
                    id="promptTemplateBody"
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    rows={14}
                    maxLength={PROMPT_TEMPLATE_BODY_MAX_LENGTH}
                    className="w-full border border-gray-300 rounded-lg p-2 text-xs font-mono resize-y min-h-[240px] bg-gray-50"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1" htmlFor="promptTemplateNote">
                    変更メモ(任意)
                  </label>
                  <input
                    id="promptTemplateNote"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="何をなぜ変えたか"
                    className="w-full p-2 border border-gray-300 rounded text-xs"
                  />
                </div>

                {notice && <p className="text-green-600 text-xs">{notice}</p>}
                {formError && <p className="text-red-500 text-xs">{formError}</p>}

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={saveDisabled}
                    onClick={() => saveMutation.mutate()}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-bold rounded"
                  >
                    {saveMutation.isPending ? '保存中…' : '保存'}
                  </button>
                  <button
                    type="button"
                    disabled={resetDisabled}
                    onClick={handleReset}
                    className="px-4 py-2 border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-60 text-xs font-bold rounded"
                  >
                    {resetMutation.isPending ? '処理中…' : '既定に戻す'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowDefault((v) => !v)}
                    className="px-4 py-2 border border-gray-300 text-gray-600 hover:bg-gray-50 text-xs font-bold rounded"
                  >
                    {showDefault ? '既定の文面を隠す' : '既定の文面を表示'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowHistory((v) => !v)}
                    className="px-4 py-2 border border-gray-300 text-gray-600 hover:bg-gray-50 text-xs font-bold rounded"
                  >
                    {showHistory ? '履歴を隠す' : '履歴'}
                  </button>
                </div>

                {showDefault && (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-2">
                    <p className="text-[10px] font-bold text-gray-500 mb-1">既定の文面(参考・読み取り専用)</p>
                    <pre className="text-xs whitespace-pre-wrap break-words text-gray-600 font-mono">
                      {selected.defaultBody}
                    </pre>
                  </div>
                )}

                {showHistory && (
                  <div className="border-t pt-3">
                    <p className="text-xs font-bold text-gray-600 mb-2">保存履歴(新しい順)</p>
                    {versionsQuery.isPending && (
                      <div className="flex justify-center py-4">
                        <div className="w-6 h-6 rounded-full border-4 border-gray-200 loading-spinner" />
                      </div>
                    )}
                    {versionsQuery.isError && (
                      <p className="text-red-500 text-xs">{(versionsQuery.error as Error).message}</p>
                    )}
                    {versionsQuery.data && versionsQuery.data.length === 0 && (
                      <p className="text-[10px] text-gray-400">保存履歴はまだありません。</p>
                    )}
                    <ul className="space-y-2">
                      {(versionsQuery.data ?? []).map((version) => (
                        <li key={version.id} className="border border-gray-200 rounded p-2 text-xs">
                          <div className="flex justify-between items-start gap-2">
                            <div className="min-w-0">
                              <p className="font-bold">
                                v{version.version}{' '}
                                <span className="font-normal text-gray-400">
                                  {formatDateTime(version.createdAt)}
                                </span>
                              </p>
                              {version.note && (
                                <p className="text-gray-500 break-words mt-0.5">{version.note}</p>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => loadVersionIntoEditor(version)}
                              className="shrink-0 px-2 py-1 rounded border border-gray-300 hover:bg-gray-100 text-[10px]"
                            >
                              この版の文面を編集欄に読み込む
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div className="p-4 border-t bg-gray-50 rounded-b-xl text-right">
          <button
            type="button"
            onClick={handleRequestClose}
            className="px-4 py-2 bg-gray-600 text-white text-sm rounded-lg hover:bg-gray-700"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
