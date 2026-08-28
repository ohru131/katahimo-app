import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import type { ReceiptImageUpload } from '../api';
import {
  extractReceiptOcr,
  fetchCustomerDetail,
  generateAccidentReportDraft,
  generateDailyReportDraft,
  saveAccidentReport,
  saveDailyReport,
  uploadReceipts,
} from '../api';
import { markCustomerRecentlyUsed } from '../recentCustomers';

type Mode = 'daily' | 'accident';

function StarRating({
  value,
  onChange,
  label,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-500 w-14 shrink-0">{label}</span>
      <div className="flex gap-0.5 text-xl leading-none">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(value === n ? null : n)}
            className={value !== null && n <= value ? 'text-yellow-500' : 'text-gray-300'}
          >
            ★
          </button>
        ))}
      </div>
      <span className="text-xs text-gray-400">{value === null ? '未評価' : `(${value})`}</span>
    </div>
  );
}

/** GAS版index.htmlのcalculateAge()と同じ「(N歳Mか月)」表示。dobは'YYYY-MM-DD'想定。 */
function calculateAgeLabel(dob: string | null): string {
  if (!dob) return '';
  const parts = dob.split(/[-/]/).map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return '';
  const [y, m, d] = parts as [number, number, number];
  const birth = new Date(y, m - 1, d);
  const today = new Date();
  let years = today.getFullYear() - birth.getFullYear();
  let months = today.getMonth() - birth.getMonth();
  if (today.getDate() < birth.getDate()) months--;
  if (months < 0) {
    years--;
    months += 12;
  }
  return `(${years}歳${months}か月)`;
}

interface ReceiptImageState {
  id: string;
  dataUrl: string;
  amount: string;
  storeName: string;
  receiptDate: string;
  ocrLoading: boolean;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * 顧客カードタップで開く報告作成モーダル。GAS版index.htmlのreportModal(保育日報/事故報告の
 * 2タブ+領収書登録)に対応。「顧客情報」「活動記録」は別モーダル(CustomerDetail/HistoryModal)
 * に分かれている点もGAS版と同じ(openModal(customer)は常にこの報告モーダルを開く)。
 */
export function ReportModal({ customerId, onClose }: { customerId: string; onClose: () => void }) {
  const customerQuery = useQuery({
    queryKey: ['customer', customerId],
    queryFn: () => fetchCustomerDetail(customerId),
  });

  const [mode, setMode] = useState<Mode>('daily');
  const [selectedFamilyId, setSelectedFamilyId] = useState('');

  // ── 保育日報 ──
  const todayStr = new Date().toISOString().slice(0, 10);
  const [reportDate, setReportDate] = useState(todayStr);
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [riskRating, setRiskRating] = useState<number | null>(null);
  const [esRating, setEsRating] = useState<number | null>(null);
  const [memoText, setMemoText] = useState('');
  const [internalText, setInternalText] = useState('');
  const [customerText, setCustomerText] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [generatingDaily, setGeneratingDaily] = useState(false);
  const [savingDaily, setSavingDaily] = useState(false);
  const [dailyMessage, setDailyMessage] = useState<string | null>(null);
  const [dailyError, setDailyError] = useState<string | null>(null);

  // ── 事故報告/ヒヤリハット ──
  const [reportType, setReportType] = useState<'事故報告' | 'ヒヤリハット'>('事故報告');
  const [accidentMemo, setAccidentMemo] = useState('');
  const [occurrenceTime, setOccurrenceTime] = useState('');
  const [location, setLocation] = useState('');
  const [accidentContent, setAccidentContent] = useState('');
  const [situation, setSituation] = useState('');
  const [immediateResponse, setImmediateResponse] = useState('');
  const [parentCorrespondence, setParentCorrespondence] = useState('');
  const [diagnosisTreatment, setDiagnosisTreatment] = useState('');
  const [prevention, setPrevention] = useState('');
  const [generatingAccident, setGeneratingAccident] = useState(false);
  const [savingAccident, setSavingAccident] = useState(false);
  const [accidentMessage, setAccidentMessage] = useState<string | null>(null);
  const [accidentError, setAccidentError] = useState<string | null>(null);

  // ── 領収書登録(日報タブのみ。GAS版と同じ制約) ──
  const [images, setImages] = useState<ReceiptImageState[]>([]);
  const [handoffText, setHandoffText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const selectedFamily = customerQuery.data?.familyMembers.find((f) => f.id === selectedFamilyId) ?? null;

  const handleGenerateDaily = async () => {
    if (!memoText.trim()) return;
    setGeneratingDaily(true);
    setDailyError(null);
    try {
      const draft = await generateDailyReportDraft(memoText, startTime || undefined, endTime || undefined);
      setWarnings(draft.warnings);
      setInternalText(draft.internal);
      setCustomerText(draft.customer);
    } catch (e) {
      setDailyError(e instanceof Error ? e.message : String(e));
    } finally {
      setGeneratingDaily(false);
    }
  };

  const handleSaveDaily = async () => {
    if (!customerQuery.data) return;
    setSavingDaily(true);
    setDailyMessage(null);
    setDailyError(null);
    try {
      await saveDailyReport({
        customerId,
        reportDate,
        startTime,
        endTime,
        inputText: memoText,
        internalText,
        customerText,
        riskRating,
        esRating,
      });
      setDailyMessage('日報を保存しました');
      markCustomerRecentlyUsed(customerId);
    } catch (e) {
      setDailyError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingDaily(false);
    }
  };

  const handleGenerateAccident = async () => {
    if (!accidentMemo.trim()) return;
    setGeneratingAccident(true);
    setAccidentError(null);
    try {
      const draft = await generateAccidentReportDraft(accidentMemo, occurrenceTime || undefined);
      if ('error' in draft) {
        setAccidentError(draft.error);
        return;
      }
      setOccurrenceTime(draft.occurrenceTime);
      setLocation(draft.location);
      setAccidentContent(draft.accidentContent);
      setSituation(draft.situation);
      setImmediateResponse(draft.immediateResponse);
      setParentCorrespondence(draft.parentCorrespondence);
      setDiagnosisTreatment(draft.diagnosisTreatment);
      setPrevention(draft.prevention);
    } catch (e) {
      setAccidentError(e instanceof Error ? e.message : String(e));
    } finally {
      setGeneratingAccident(false);
    }
  };

  const handleSaveAccident = async () => {
    setSavingAccident(true);
    setAccidentMessage(null);
    setAccidentError(null);
    try {
      await saveAccidentReport({
        customerId,
        reportType,
        targetName: selectedFamily?.name ?? '',
        targetDob: selectedFamily?.dob ?? '',
        occurrenceTime,
        location,
        accidentContent,
        situation,
        immediateResponse,
        parentCorrespondence,
        diagnosisTreatment,
        prevention,
        inputText: accidentMemo,
      });
      setAccidentMessage(`${reportType}を保存しました`);
      markCustomerRecentlyUsed(customerId);
    } catch (e) {
      setAccidentError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingAccident(false);
    }
  };

  const MAX_RECEIPT_IMAGES = 6;

  const handleAddImages = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    if (images.length + fileList.length > MAX_RECEIPT_IMAGES) {
      setUploadMessage(`画像は最大${MAX_RECEIPT_IMAGES}枚までです`);
      return;
    }
    const newImages = await Promise.all(
      Array.from(fileList).map(async (file) => ({
        id: crypto.randomUUID(),
        dataUrl: await readFileAsDataUrl(file),
        amount: '',
        storeName: '',
        receiptDate: '',
        ocrLoading: false,
      })),
    );
    setImages((prev) => [...prev, ...newImages]);
  };

  const handleRunOcr = async (id: string) => {
    setImages((prev) => prev.map((img) => (img.id === id ? { ...img, ocrLoading: true } : img)));
    const target = images.find((img) => img.id === id);
    if (!target) return;
    try {
      const result = await extractReceiptOcr(target.dataUrl);
      setImages((prev) =>
        prev.map((img) =>
          img.id === id
            ? {
                ...img,
                amount: String(result.amount ?? ''),
                storeName: result.storeName ?? '',
                receiptDate: result.receiptDate ?? '',
                ocrLoading: false,
              }
            : img,
        ),
      );
    } catch (e) {
      setUploadMessage(e instanceof Error ? e.message : String(e));
      setImages((prev) => prev.map((img) => (img.id === id ? { ...img, ocrLoading: false } : img)));
    }
  };

  const handleUploadReceipts = async () => {
    if (images.length === 0) return;
    setUploading(true);
    setUploadMessage(null);
    try {
      const payloadImages: ReceiptImageUpload[] = images.map((img) => ({
        data: img.dataUrl,
        amount: img.amount || null,
        storeName: img.storeName || null,
        receiptDate: img.receiptDate || null,
      }));
      const result = await uploadReceipts({ customerId, images: payloadImages, handoffText });
      setUploadMessage(result.message);
      markCustomerRecentlyUsed(customerId);
      const duplicateIndexes = new Set(result.duplicates.map((d) => d.index));
      setImages((prev) => prev.filter((_, idx) => duplicateIndexes.has(idx)));
      if (duplicateIndexes.size === 0) setHandoffText('');
    } catch (e) {
      setUploadMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-end sm:items-center justify-center">
      <div className="bg-white w-full max-w-md h-[92vh] sm:h-auto sm:max-h-[90vh] sm:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col">
        <div className="p-4 border-b flex justify-between items-center bg-gray-50 rounded-t-2xl shrink-0">
          <div>
            <h2 className="font-bold text-lg text-gray-800">{customerQuery.data?.name ?? '読み込み中…'}</h2>
            {customerQuery.data?.city && <p className="text-xs text-gray-500">{customerQuery.data.city}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 hover:bg-gray-200 rounded-full text-gray-500 text-xl leading-none"
          >
            &times;
          </button>
        </div>

        <div className="flex border-b shrink-0">
          <button
            type="button"
            onClick={() => setMode('daily')}
            className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${
              mode === 'daily' ? 'text-blue-600 border-blue-600' : 'text-gray-500 border-transparent'
            }`}
          >
            📝 保育日報
          </button>
          <button
            type="button"
            onClick={() => setMode('accident')}
            className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${
              mode === 'accident' ? 'text-blue-600 border-blue-600' : 'text-gray-500 border-transparent'
            }`}
          >
            ⚠️ 事故報告
          </button>
        </div>

        <div className="flex-grow overflow-y-auto p-4 space-y-4">
          {customerQuery.isPending && (
            <div className="flex justify-center py-8">
              <div className="w-8 h-8 rounded-full border-4 border-gray-200 loading-spinner" />
            </div>
          )}

          {customerQuery.data && customerQuery.data.familyMembers.length > 0 && (
            <div>
              <label htmlFor="familySelector" className="text-xs text-gray-500 block mb-1">
                対象者(ご家族)
              </label>
              <select
                id="familySelector"
                value={selectedFamilyId}
                onChange={(e) => setSelectedFamilyId(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm bg-gray-50"
              >
                <option value="">(選択してください)</option>
                {customerQuery.data.familyMembers.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} {calculateAgeLabel(f.dob)}
                  </option>
                ))}
              </select>
            </div>
          )}

          {mode === 'daily' && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label htmlFor="reportDate" className="text-xs text-gray-500 block mb-1">
                    日付
                  </label>
                  <input
                    id="reportDate"
                    type="date"
                    value={reportDate}
                    onChange={(e) => setReportDate(e.target.value)}
                    className="w-full border rounded-lg px-2 py-2 text-sm bg-gray-50"
                  />
                </div>
                <div>
                  <label htmlFor="startTime" className="text-xs text-gray-500 block mb-1">
                    開始時刻
                  </label>
                  <input
                    id="startTime"
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="w-full border rounded-lg px-2 py-2 text-sm bg-gray-50"
                  />
                </div>
                <div>
                  <label htmlFor="endTime" className="text-xs text-gray-500 block mb-1">
                    終了時刻
                  </label>
                  <input
                    id="endTime"
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="w-full border rounded-lg px-2 py-2 text-sm bg-gray-50"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <StarRating value={riskRating} onChange={setRiskRating} label="PSI" />
                <StarRating value={esRating} onChange={setEsRating} label="満足度" />
              </div>

              <div>
                <label htmlFor="memoText" className="text-xs text-gray-500 block mb-1">
                  訪問メモ(口語でOK)
                </label>
                <textarea
                  id="memoText"
                  value={memoText}
                  onChange={(e) => setMemoText(e.target.value)}
                  rows={4}
                  placeholder="①訪問当日のサポート内容\n②お客様情報\n③振り返り"
                  className="w-full border rounded-lg px-3 py-2 text-sm bg-gray-50"
                />
              </div>

              <button
                type="button"
                onClick={handleGenerateDaily}
                disabled={generatingDaily || !memoText.trim()}
                className="w-full py-2.5 bg-blue-50 hover:bg-blue-100 disabled:opacity-60 text-blue-700 font-bold rounded-lg text-sm"
              >
                {generatingDaily ? 'AI生成中…' : '✨ AIでレポート生成'}
              </button>

              {warnings.length > 0 && (
                <p className="text-xs text-orange-600 bg-orange-50 border border-orange-200 rounded-lg p-2">
                  不足している可能性がある項目: {warnings.join('、')}
                </p>
              )}

              <div>
                <label htmlFor="internalText" className="text-xs text-gray-500 block mb-1">
                  社内向けレポート
                </label>
                <textarea
                  id="internalText"
                  value={internalText}
                  onChange={(e) => setInternalText(e.target.value)}
                  rows={4}
                  className="w-full border rounded-lg px-3 py-2 text-sm bg-gray-50"
                />
              </div>
              <div>
                <label htmlFor="customerText" className="text-xs text-gray-500 block mb-1">
                  保護者向けレポート
                </label>
                <textarea
                  id="customerText"
                  value={customerText}
                  onChange={(e) => setCustomerText(e.target.value)}
                  rows={4}
                  className="w-full border rounded-lg px-3 py-2 text-sm bg-gray-50"
                />
              </div>

              {dailyError && <p className="text-red-500 text-sm">{dailyError}</p>}
              {dailyMessage && <p className="text-green-600 text-sm">{dailyMessage}</p>}

              <button
                type="button"
                onClick={handleSaveDaily}
                disabled={savingDaily}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-bold rounded-xl"
              >
                {savingDaily ? '保存中…' : '日報を保存'}
              </button>

              <hr className="my-2" />

              <div className="space-y-2">
                <h3 className="text-sm font-bold text-gray-700">🧾 領収書登録</h3>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => cameraInputRef.current?.click()}
                    className="w-20 h-20 border-2 border-dashed border-blue-300 rounded-xl flex flex-col items-center justify-center text-blue-500 hover:bg-blue-50 transition-colors bg-white"
                  >
                    <span className="text-2xl leading-none mb-1">📷</span>
                    <span className="text-[10px] font-bold">カメラ撮影</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => galleryInputRef.current?.click()}
                    className="w-20 h-20 border-2 border-dashed border-gray-300 rounded-xl flex flex-col items-center justify-center text-gray-400 hover:text-gray-600 hover:border-gray-400 transition-colors bg-gray-50"
                  >
                    <span className="text-2xl leading-none mb-1">🖼️</span>
                    <span className="text-[10px] font-bold">アルバム</span>
                  </button>
                </div>
                {/* カメラは1枚ずつ即撮影(capture属性でスマホのカメラアプリを直接起動)、アルバムは複数選択可。GAS版index.htmlのcameraInput/galleryInputと同じ使い分け。 */}
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => {
                    handleAddImages(e.target.files);
                    e.target.value = '';
                  }}
                  className="hidden"
                />
                <input
                  ref={galleryInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => {
                    handleAddImages(e.target.files);
                    e.target.value = '';
                  }}
                  className="hidden"
                />
                <div className="space-y-2">
                  {images.map((img) => (
                    <div key={img.id} className="border rounded-lg p-2 flex gap-2 items-start">
                      <img src={img.dataUrl} alt="領収書" className="w-16 h-16 object-cover rounded" />
                      <div className="flex-grow space-y-1">
                        <div className="flex gap-1">
                          <input
                            type="text"
                            value={img.amount}
                            onChange={(e) =>
                              setImages((prev) =>
                                prev.map((i) => (i.id === img.id ? { ...i, amount: e.target.value } : i)),
                              )
                            }
                            placeholder="金額"
                            className="w-20 border rounded px-2 py-1 text-xs"
                          />
                          <input
                            type="text"
                            value={img.storeName}
                            onChange={(e) =>
                              setImages((prev) =>
                                prev.map((i) => (i.id === img.id ? { ...i, storeName: e.target.value } : i)),
                              )
                            }
                            placeholder="店舗名"
                            className="flex-grow border rounded px-2 py-1 text-xs"
                          />
                        </div>
                        <input
                          type="text"
                          value={img.receiptDate}
                          onChange={(e) =>
                            setImages((prev) =>
                              prev.map((i) => (i.id === img.id ? { ...i, receiptDate: e.target.value } : i)),
                            )
                          }
                          placeholder="日時(yyyy/MM/dd HH:mm)"
                          className="w-full border rounded px-2 py-1 text-xs"
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => handleRunOcr(img.id)}
                            disabled={img.ocrLoading}
                            className="text-xs text-blue-600 disabled:opacity-60"
                          >
                            {img.ocrLoading ? 'OCR中…' : 'OCRで自動入力'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setImages((prev) => prev.filter((i) => i.id !== img.id))}
                            className="text-xs text-red-500"
                          >
                            削除
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <textarea
                  value={handoffText}
                  onChange={(e) => setHandoffText(e.target.value)}
                  rows={2}
                  placeholder="申し送り(任意)"
                  className="w-full border rounded-lg px-3 py-2 text-sm bg-gray-50"
                />
                {uploadMessage && <p className="text-sm text-gray-700">{uploadMessage}</p>}
                <button
                  type="button"
                  onClick={handleUploadReceipts}
                  disabled={uploading || images.length === 0}
                  className="w-full py-2.5 bg-gray-700 hover:bg-gray-800 disabled:opacity-60 text-white font-bold rounded-lg text-sm"
                >
                  {uploading ? 'アップロード中…' : '領収書登録'}
                </button>
              </div>
            </div>
          )}

          {mode === 'accident' && (
            <div className="space-y-4">
              <div>
                <label htmlFor="reportType" className="text-xs text-gray-500 block mb-1">
                  種別
                </label>
                <select
                  id="reportType"
                  value={reportType}
                  onChange={(e) => setReportType(e.target.value as '事故報告' | 'ヒヤリハット')}
                  className="w-full border rounded-lg px-3 py-2 text-sm bg-gray-50"
                >
                  <option value="事故報告">事故報告</option>
                  <option value="ヒヤリハット">ヒヤリハット</option>
                </select>
              </div>

              <div>
                <label htmlFor="occurrenceTime" className="text-xs text-gray-500 block mb-1">
                  発生時間の目安
                </label>
                <input
                  id="occurrenceTime"
                  type="text"
                  value={occurrenceTime}
                  onChange={(e) => setOccurrenceTime(e.target.value)}
                  placeholder="例: 14時頃"
                  className="w-full border rounded-lg px-3 py-2 text-sm bg-gray-50"
                />
              </div>

              <div>
                <label htmlFor="accidentMemo" className="text-xs text-gray-500 block mb-1">
                  状況メモ(口語でOK)
                </label>
                <textarea
                  id="accidentMemo"
                  value={accidentMemo}
                  onChange={(e) => setAccidentMemo(e.target.value)}
                  rows={4}
                  placeholder="①事実を時系列で、客観的に&#10;②5W1H+初動対応&#10;③ヒヤリハットも記録"
                  className="w-full border rounded-lg px-3 py-2 text-sm bg-gray-50"
                />
              </div>

              <button
                type="button"
                onClick={handleGenerateAccident}
                disabled={generatingAccident || !accidentMemo.trim()}
                className="w-full py-2.5 bg-blue-50 hover:bg-blue-100 disabled:opacity-60 text-blue-700 font-bold rounded-lg text-sm"
              >
                {generatingAccident ? 'AI生成中…' : '✨ AIで項目に整理'}
              </button>

              {accidentError && <p className="text-red-500 text-sm">{accidentError}</p>}

              {(
                [
                  ['location', '発生場所', location, setLocation],
                  ['accidentContent', '事故内容', accidentContent, setAccidentContent],
                  ['situation', '発生状況', situation, setSituation],
                  ['immediateResponse', '発生時の対応', immediateResponse, setImmediateResponse],
                  ['parentCorrespondence', '保護者への対応', parentCorrespondence, setParentCorrespondence],
                  ['diagnosisTreatment', '診断名および処置状況', diagnosisTreatment, setDiagnosisTreatment],
                  ['prevention', '事故防止に向けた今後の対応', prevention, setPrevention],
                ] as const
              ).map(([id, label, value, setter]) => (
                <div key={id}>
                  <label htmlFor={id} className="text-xs text-gray-500 block mb-1">
                    {label}
                  </label>
                  <textarea
                    id={id}
                    value={value}
                    onChange={(e) => setter(e.target.value)}
                    rows={2}
                    className="w-full border rounded-lg px-3 py-2 text-sm bg-gray-50"
                  />
                </div>
              ))}

              {accidentMessage && <p className="text-green-600 text-sm">{accidentMessage}</p>}

              <button
                type="button"
                onClick={handleSaveAccident}
                disabled={savingAccident}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-bold rounded-xl"
              >
                {savingAccident ? '保存中…' : `${reportType}を保存`}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
