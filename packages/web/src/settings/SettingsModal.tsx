import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { AdminSettingsView, GeminiModelInfo, StaffView } from '../api';
import {
  fetchAdminSettings,
  listAvailableGeminiModels,
  saveGeminiApiKey,
  saveGeminiModelSettings,
  saveGoogleChatWebhookSettings,
  saveReceiptDeadlineSettings,
} from '../api';
import { Button, ButtonRow, LoadingBlock, toFriendlyMessage, useFeedback } from '../ui';
import { ChangePasswordModal } from './ChangePasswordModal';
import { CouponAdminModal } from './CouponAdminModal';
import { StaffAdminModal } from './StaffAdminModal';
import {
  applyTextSize,
  getStoredTextSize,
  TEXT_SIZE_LABEL,
  TEXT_SIZE_ORDER,
  type TextSize,
} from './textSize';

/**
 * Gemini APIキー入力欄のプレースホルダ。平文は読み戻せないので、
 * 「設定済みかどうか」と末尾数文字だけで現在の状態を示す。
 */
function apiKeyPlaceholder(settings: AdminSettingsView): string {
  if (!settings.hasGeminiApiKey) return '未設定(新しいキーを入力)';
  return settings.geminiApiKeyPreview
    ? `設定済み(末尾 ${settings.geminiApiKeyPreview})- 変更する場合のみ入力`
    : '設定済み - 変更する場合のみ入力';
}

/** 現在の値が一覧に無くても必ず選べるようにする(値が消えないようにするため)。GAS版setSelectOptions_と同じ。 */
function ModelOptions({ current, fetched }: { current: string; fetched: GeminiModelInfo[] }) {
  const options: GeminiModelInfo[] = [];
  const seen = new Set<string>();
  if (current && !seen.has(current)) {
    options.push({ name: current, displayName: '(現在の設定)' });
    seen.add(current);
  }
  for (const m of fetched) {
    if (seen.has(m.name)) continue;
    seen.add(m.name);
    options.push(m);
  }
  return (
    <>
      {options.map((m) => (
        <option key={m.name} value={m.name}>
          {m.name}
          {m.displayName ? ` - ${m.displayName}` : ''}
        </option>
      ))}
    </>
  );
}

/**
 * 「設定」モーダル。GAS版index.htmlのsettingsModalと同じ役割にしている
 * (文字サイズ・パスワード変更・管理者設定)。管理者設定(Gemini APIキー・モデル・
 * Google Chat Webhook URL)はapp_settingsテーブルにテナント単位で保存され、
 * 日報AI生成/OCR/通知の実処理(reportAi.ts usecases・container.tsのnotifier)が
 * この値を優先して使う(未設定なら.envのデフォルトにフォールバックする)。
 */
export function SettingsModal({
  staff,
  onClose,
  onLogout,
}: {
  staff: StaffView;
  onClose: () => void;
  onLogout: () => void;
}) {
  const [textSize, setTextSize] = useState<TextSize>(() => getStoredTextSize());
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showStaffAdmin, setShowStaffAdmin] = useState(false);
  const [showCouponAdmin, setShowCouponAdmin] = useState(false);
  const { confirm } = useFeedback();

  const settingsQuery = useQuery({
    queryKey: ['admin-settings'],
    queryFn: fetchAdminSettings,
    enabled: staff.isAdmin,
  });

  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [reportModel, setReportModel] = useState('');
  const [ocrModel, setOcrModel] = useState('');
  const [modelOptions, setModelOptions] = useState<GeminiModelInfo[]>([]);
  const [refreshingModels, setRefreshingModels] = useState(false);
  const [reportWebhook, setReportWebhook] = useState('');
  const [receiptWebhook, setReceiptWebhook] = useState('');
  const [showReportWebhook, setShowReportWebhook] = useState(false);
  const [showReceiptWebhook, setShowReceiptWebhook] = useState(false);
  // 締め日まわり(doc/14 §10)。締め日は空文字が「月末」を表す。
  const [closingDay, setClosingDay] = useState('');
  const [cancellableDays, setCancellableDays] = useState('2');

  // 読み込みが完了してから初めてフォームへ反映する(未読み込みのまま保存されて空値等で
  // 上書きされる事故を防ぐため。GAS版のgeminiKeyLoadState等と同じ考え方)。
  // Gemini APIキーは平文を読み戻せない(書き込み専用)ので、入力欄は常に空から始める。
  // 空のまま保存した場合は保存APIを呼ばず、既存のキーをそのまま残す。
  useEffect(() => {
    const data: AdminSettingsView | undefined = settingsQuery.data;
    if (!data) return;
    setReportModel(data.geminiReportModel);
    setOcrModel(data.geminiOcrModel);
    setReportWebhook(data.gchatReportWebhookUrl);
    setReceiptWebhook(data.gchatReceiptWebhookUrl);
    setClosingDay(data.receiptClosingDay === null ? '' : String(data.receiptClosingDay));
    setCancellableDays(String(data.receiptCancellableDays));
  }, [settingsQuery.data]);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  /** 文字サイズは保存ボタンを待たず即時反映する(効果を見ながら選ぶため)。 */
  const handleTextSizeChange = (size: TextSize) => {
    setTextSize(size);
    applyTextSize(size);
  };

  // 入力欄が空なら保存済みのキーで取得する(サーバー側で解決)。入力中の新しいキーで
  // 試したい場合は、その値をそのまま渡す。
  const handleRefreshModels = async () => {
    const typedKey = apiKeyInput.trim();
    if (!typedKey && !settingsQuery.data?.hasGeminiApiKey) {
      setSaveError('Gemini APIキーを入力してから取得してください');
      return;
    }
    setRefreshingModels(true);
    setSaveError(null);
    try {
      const models = await listAvailableGeminiModels(typedKey || undefined);
      setModelOptions(models);
    } catch (e) {
      setSaveError(toFriendlyMessage(e, 'モデル一覧の取得', e instanceof Error ? e.message : undefined));
    } finally {
      setRefreshingModels(false);
    }
  };

  /**
   * 変わった項目だけを保存する。未変更の欄まで毎回送ると、Gemini APIキーのように
   * 「空で保存すると既存値が消える」項目を踏む経路ができてしまう。
   */
  const handleSave = async () => {
    if (!staff.isAdmin || !settingsQuery.data) {
      onClose();
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      // 空のままなら「変更なし」とみなして保存APIを呼ばない(既存キーを消さないため)。
      if (apiKeyInput.trim()) {
        const result = await saveGeminiApiKey(apiKeyInput.trim());
        if (!result.ok) throw new Error(result.message);
      }
      if (
        reportModel !== settingsQuery.data.geminiReportModel ||
        ocrModel !== settingsQuery.data.geminiOcrModel
      ) {
        const result = await saveGeminiModelSettings(reportModel, ocrModel);
        if (!result.ok) throw new Error(result.message);
      }
      if (
        reportWebhook !== settingsQuery.data.gchatReportWebhookUrl ||
        receiptWebhook !== settingsQuery.data.gchatReceiptWebhookUrl
      ) {
        const result = await saveGoogleChatWebhookSettings(reportWebhook, receiptWebhook);
        if (!result.ok) throw new Error(result.message);
      }
      // 空欄のまま保存させない。保存ボタンは type="button" でブラウザの検証を通らないため、
      // ここで弾かないと Number('') === 0 で「0日」が黙って保存される
      // (締め日の空欄は「月末」という正当な値なので、数値2つだけを見る)。
      if (cancellableDays === '') {
        throw new Error('取り消せる日数を入力してください。');
      }
      const nextClosingDay = closingDay === '' ? null : Number(closingDay);
      const nextCancellableDays = Number(cancellableDays);
      if (
        nextClosingDay !== settingsQuery.data.receiptClosingDay ||
        nextCancellableDays !== settingsQuery.data.receiptCancellableDays
      ) {
        const result = await saveReceiptDeadlineSettings({
          closingDay: nextClosingDay,
          cancellableDays: nextCancellableDays,
        });
        if (!result.ok) throw new Error(result.message);
      }
      onClose();
    } catch (e) {
      setSaveError(toFriendlyMessage(e, '設定の保存', e instanceof Error ? e.message : undefined));
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = async () => {
    const ok = await confirm({ message: 'ログアウトしますか?', confirmLabel: 'ログアウトする' });
    if (ok) onLogout();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-[100] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-sm rounded-xl shadow-xl flex flex-col max-h-[85vh]">
        <div className="p-4 border-b flex justify-between items-center bg-gray-50 rounded-t-xl">
          <h3 className="font-bold text-gray-800">設定</h3>
          <Button variant="subtle" size="sub" onClick={onClose}>
            ✕ 閉じる
          </Button>
        </div>

        <div className="p-6 space-y-6 overflow-y-auto">
          <div>
            <h4 className="font-bold text-gray-700 mb-3">文字の大きさ</h4>
            <div className="space-y-3">
              {TEXT_SIZE_ORDER.map((size) => (
                <label
                  key={size}
                  className={`flex items-center space-x-3 p-3 rounded-lg border cursor-pointer active:bg-gray-50 ${
                    textSize === size ? 'bg-app-primary-bg border-app-primary' : 'border-gray-200'
                  }`}
                >
                  <input
                    type="radio"
                    name="textSize"
                    value={size}
                    checked={textSize === size}
                    onChange={() => handleTextSizeChange(size)}
                    className="w-5 h-5 text-app-primary focus:ring-app-primary border-gray-300"
                  />
                  <span className="text-base text-app-text">{TEXT_SIZE_LABEL[size]}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="border-t pt-4">
            <Button variant="subtle" fullWidth onClick={() => setShowChangePassword(true)}>
              パスワード変更
            </Button>
          </div>

          {staff.isAdmin && (
            <div className="border-t pt-4 space-y-3">
              <Button variant="subtle" fullWidth onClick={() => setShowStaffAdmin(true)}>
                スタッフ管理
              </Button>
              <Button variant="subtle" fullWidth onClick={() => setShowCouponAdmin(true)}>
                クーポン管理
              </Button>

              {/* Gemini APIキー・Webhook URL等はスタッフに関係ないので折りたたみ、
                  「詳細設定(管理者のみ)」を開いた人だけに見せる(提案書「管理者設定」の折りたたみ)。
                  中の項目名(Gemini APIキー等)は提案書の指示どおり変えていない。 */}
              <details className="rounded-lg border border-gray-200">
                <summary className="cursor-pointer select-none p-3 text-sm font-bold text-app-text">
                  詳細設定(管理者のみ)
                </summary>

                <div className="p-3 pt-0">
                  {settingsQuery.isPending && <LoadingBlock />}

                  {settingsQuery.data && (
                    <>
                      <label className="block text-sm font-bold text-gray-600 mb-1" htmlFor="geminiApiKey">
                        Gemini APIキー
                      </label>
                      <div className="flex gap-1">
                        <input
                          id="geminiApiKey"
                          type={showApiKey ? 'text' : 'password'}
                          value={apiKeyInput}
                          onChange={(e) => setApiKeyInput(e.target.value)}
                          placeholder={apiKeyPlaceholder(settingsQuery.data)}
                          className="flex-1 p-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-app-primary"
                        />
                        <Button variant="outline" size="sub" onClick={() => setShowApiKey((v) => !v)}>
                          {showApiKey ? '隠す' : '表示'}
                        </Button>
                      </div>
                      <p className="text-sm text-app-muted mt-1">
                        ※ 日報・事故報告のAI生成、領収書OCRに使用します。
                        {settingsQuery.data.hasGeminiApiKey
                          ? ' 保存済みのキーは表示できません。変更するときだけ新しいキーを入力してください(空のままなら現在のキーを維持します)。'
                          : ' 空のまま保存はできません。'}
                      </p>

                      <div className="mt-4 pt-4 border-t border-gray-100">
                        <label
                          className="block text-sm font-bold text-gray-600 mb-1"
                          htmlFor="geminiReportModel"
                        >
                          日報・事故報告で使うモデル
                        </label>
                        <select
                          id="geminiReportModel"
                          value={reportModel}
                          onChange={(e) => setReportModel(e.target.value)}
                          className="w-full p-2 border border-gray-300 rounded text-sm mb-3 focus:ring-2 focus:ring-app-primary"
                        >
                          <ModelOptions current={reportModel} fetched={modelOptions} />
                        </select>

                        <label
                          className="block text-sm font-bold text-gray-600 mb-1"
                          htmlFor="geminiOcrModel"
                        >
                          領収書OCRで使うモデル
                        </label>
                        <select
                          id="geminiOcrModel"
                          value={ocrModel}
                          onChange={(e) => setOcrModel(e.target.value)}
                          className="w-full p-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-app-primary"
                        >
                          <ModelOptions current={ocrModel} fetched={modelOptions} />
                        </select>

                        <Button
                          variant="outline"
                          size="sub"
                          fullWidth
                          className="mt-3"
                          onClick={handleRefreshModels}
                          disabled={refreshingModels}
                        >
                          {refreshingModels ? '取得中…' : '🔄 最新モデル一覧を取得'}
                        </Button>
                        <p className="text-sm text-app-muted mt-1">
                          ※
                          上のAPIキー入力欄に値があればその値で、空なら保存済みのキーで一覧を取得します(保存前の新しいキーでも確認できます)。モデルが使えなくなった場合はここで切り替えてください。
                        </p>
                      </div>

                      <div className="mt-4 pt-4 border-t border-gray-100">
                        <label
                          className="block text-sm font-bold text-gray-600 mb-1"
                          htmlFor="gchatReportWebhook"
                        >
                          日報・事故報告 通知用 Webhook URL
                        </label>
                        <div className="flex gap-1">
                          <input
                            id="gchatReportWebhook"
                            type={showReportWebhook ? 'text' : 'password'}
                            value={reportWebhook}
                            onChange={(e) => setReportWebhook(e.target.value)}
                            className="flex-1 p-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-app-primary"
                          />
                          <Button
                            variant="outline"
                            size="sub"
                            onClick={() => setShowReportWebhook((v) => !v)}
                          >
                            {showReportWebhook ? '隠す' : '表示'}
                          </Button>
                        </div>
                        <p className="text-sm text-app-muted mt-1">
                          ※ 日報・事故報告・訪問完了通知の送信先です。空のまま保存はできません。
                        </p>

                        <label
                          className="block text-sm font-bold text-gray-600 mt-3 mb-1"
                          htmlFor="gchatReceiptWebhook"
                        >
                          領収書登録 通知用 Webhook URL
                        </label>
                        <div className="flex gap-1">
                          <input
                            id="gchatReceiptWebhook"
                            type={showReceiptWebhook ? 'text' : 'password'}
                            value={receiptWebhook}
                            onChange={(e) => setReceiptWebhook(e.target.value)}
                            className="flex-1 p-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-app-primary"
                          />
                          <Button
                            variant="outline"
                            size="sub"
                            onClick={() => setShowReceiptWebhook((v) => !v)}
                          >
                            {showReceiptWebhook ? '隠す' : '表示'}
                          </Button>
                        </div>
                        <p className="text-sm text-app-muted mt-1">
                          ※ 領収書登録通知の送信先です。空のまま保存はできません。
                        </p>
                      </div>

                      {/* 締め日まわり(doc/14 §10)。取り消せる期限がこの2つから決まるので、
                          意味が分かるよう1箇所にまとめて出す。 */}
                      <div className="mt-4 pt-4 border-t border-gray-100">
                        <p className="text-sm font-bold text-gray-600 mb-2">領収書の締め日</p>

                        <label className="block text-sm text-gray-600 mb-1" htmlFor="receiptClosingDay">
                          会計の締め日
                        </label>
                        <select
                          id="receiptClosingDay"
                          value={closingDay}
                          onChange={(e) => setClosingDay(e.target.value)}
                          className="w-full p-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-app-primary"
                        >
                          <option value="">月末</option>
                          {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
                            <option key={day} value={String(day)}>
                              {day}日
                            </option>
                          ))}
                        </select>
                        <p className="text-sm text-app-muted mt-1">
                          ※ 29〜31日は選べません(2月に存在しないため)。月末で締める場合は「月末」を選びます。
                        </p>

                        <label
                          className="block text-sm text-gray-600 mt-3 mb-1"
                          htmlFor="receiptCancellableDays"
                        >
                          領収書を取り消せる日数
                        </label>
                        <input
                          id="receiptCancellableDays"
                          type="number"
                          min={0}
                          max={14}
                          value={cancellableDays}
                          onChange={(e) => setCancellableDays(e.target.value)}
                          className="w-full p-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-app-primary"
                        />
                        <p className="text-sm text-app-muted mt-1">
                          ※
                          暦日で数えます(訪問保育は土日祝日も訪問があるため)。締め日が先に来る場合は締め日が優先され、締め間際の領収書は取り消せる期間が短くなります。
                        </p>
                      </div>
                    </>
                  )}

                  {settingsQuery.isError && (
                    <p className="text-sm text-app-danger">
                      {toFriendlyMessage(settingsQuery.error, '管理者設定の読み込み')}
                    </p>
                  )}
                </div>
              </details>
            </div>
          )}

          {saveError && <p className="text-sm text-app-danger">{saveError}</p>}

          <div className="border-t pt-4 space-y-3">
            <Button variant="outline" fullWidth onClick={handleLogout}>
              ログアウト
            </Button>
            <p className="text-center text-sm text-app-muted">Ver. 0.1 (katahimo-app)</p>
          </div>
        </div>

        <div className="p-4 border-t bg-gray-50 rounded-b-xl">
          <ButtonRow>
            <Button variant="subtle" fullWidth onClick={onClose}>
              キャンセル
            </Button>
            <Button
              variant="primary"
              fullWidth
              onClick={handleSave}
              disabled={saving || (staff.isAdmin && settingsQuery.isPending)}
            >
              {saving ? '保存中…' : '保存して閉じる'}
            </Button>
          </ButtonRow>
        </div>
      </div>

      {showChangePassword && <ChangePasswordModal onClose={() => setShowChangePassword(false)} />}
      {showStaffAdmin && (
        <StaffAdminModal
          selfStaffId={staff.staffId ?? staff.id ?? ''}
          onClose={() => setShowStaffAdmin(false)}
        />
      )}
      {showCouponAdmin && <CouponAdminModal onClose={() => setShowCouponAdmin(false)} />}
    </div>
  );
}
