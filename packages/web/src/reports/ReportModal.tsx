import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import type { ReceiptBillingType, ReceiptImageUpload } from '../api';
import {
  extractReceiptOcr,
  fetchCouponsForSelection,
  fetchCustomerDetail,
  generateAccidentReportDraft,
  generateDailyReportDraft,
  saveAccidentReport,
  saveDailyReport,
  sendVisitCompleteNotification,
  uploadReceipts,
} from '../api';
import { markCustomerRecentlyUsed } from '../recentCustomers';
import { Button, ErrorNotice, LoadingBlock, StickyActionBar, toFriendlyMessage, useFeedback } from '../ui';
import { ASSESSMENT_DEFINITIONS, type AssessmentType } from './assessmentDefinitions';
import {
  ACCIDENT_MEMO_PLACEHOLDER,
  ACCIDENT_WRITING_HINT,
  DAILY_MEMO_PLACEHOLDER,
  DAILY_WRITING_HINT,
  HIYARI_WRITING_HINT,
} from './promptDefaults';
import { useVoiceInput } from './useVoiceInput';

type Mode = 'daily' | 'accident';

/** GAS版index.htmlのpopulateHours()と同じ('00'〜'23')。 */
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
/** GAS版index.htmlのstartMinute/endMinuteの選択肢と同じ。 */
const MINUTES = ['00', '15', '30', '45'];
const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

/** 入力欄は高さ48px・文字16px(iOSの自動ズーム防止にも必要)。全ての入力欄で同じ見た目にする。 */
const INPUT_CLASS =
  'w-full min-h-[48px] rounded-btn border border-gray-300 bg-white px-3 py-2 text-base text-app-text';
const TEXTAREA_CLASS =
  'w-full rounded-btn border border-gray-300 bg-white px-3 py-2 text-base leading-relaxed text-app-text';

const pad2 = (n: number) => String(n).padStart(2, '0');

/** GAS版updateDateDisplay()と同じ表示形式(折りたたみの中の日付送りで使う)。 */
function formatDateDisplay(d: Date): string {
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日(${WEEKDAY_LABELS[d.getDay()]})`;
}

/** 画面上部の1行表示用。提案書の「9月3日(水)」と同じ、年を省いた書き方。 */
function formatDateShort(d: Date): string {
  return `${d.getMonth() + 1}月${d.getDate()}日(${WEEKDAY_LABELS[d.getDay()]})`;
}

/** 'YYYY-MM-DD'(タイムゾーンのずれを避けるためtoLocaleDateString('sv-SE')を使う。AttendanceTabと同じ手法)。 */
function formatDateKey(d: Date): string {
  return d.toLocaleDateString('sv-SE');
}

/**
 * AIが書き終わるまでの経過秒数。「AIが書いています…(12秒)」のように、何をどれくらい待つのかを
 * 文字で伝えるために数える(提案書「待っている間は必ず文字で伝える」)。
 */
function useElapsedSeconds(active: boolean): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!active) {
      setSeconds(0);
      return;
    }
    const startedAt = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return seconds;
}

/**
 * 画面の1かたまり(カード)。見出しは必ず付け、必要なら「次にすること」を1文添える。
 * 見出しを入力欄のラベルにしたいときはlabelForにその入力欄のidを渡す。
 */
function Section({
  title,
  note,
  labelFor,
  children,
}: {
  title: ReactNode;
  note?: string;
  labelFor?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-card border border-gray-200 bg-white p-3.5">
      <div>
        {labelFor ? (
          <label htmlFor={labelFor} className="block text-base font-bold text-app-text">
            {title}
          </label>
        ) : (
          <h3 className="text-base font-bold text-app-text">{title}</h3>
        )}
        {note && <p className="mt-1 text-sm leading-relaxed text-app-muted">{note}</p>}
      </div>
      {children}
    </section>
  );
}

/**
 * 入力欄の見出し。画面にはやさしい語を出し、帳票の正式名(「発生状況」など)は
 * 括弧の中に小さく薄く添える(提案書「やさしい語(正式名)」)。
 */
function FieldLabel({
  htmlFor,
  formal,
  children,
}: {
  htmlFor: string;
  formal?: string;
  children: ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-base font-bold text-app-text">
      {children}
      {formal && <span className="ml-1 text-sm font-normal text-app-muted">({formal})</span>}
    </label>
  );
}

/**
 * PSI/従業員満足度(ES)の★評価。GAS版のupdateStarDisplay/setRatingと同じ挙動にしている:
 * - 選択中の★の色はtext-yellow-400、未選択はtext-gray-300。
 * - 星の下にASSESSMENT_DEFINITIONSから引いた評価ラベル(例: 「要観察」)を16pxで表示する
 *   (未評価時は「まだ選んでいません」。GAS版のlabel-risk/label-esと同じ場所の情報)。
 * - 左端(1番目)の★が既に選択済みの状態でもう一度押すと、全て☆(未評価=0)に戻せる
 *   (GAS版setRatingの`score === 1 && assessmentRatings[type] === 1`と同じ特別扱い。
 *   他の★を再度押しても解除はされない)。
 * - 見出しはやさしい質問文にし、略号(PSI/ES)はtext-smで薄く添える。
 * - 星1つは40×40pxのタップ領域・文字30px(提案書「押せるものの大きさ」)。
 * - 「ⓘ 目安を見る」から、評価基準の一覧(AssessmentHintModal)を確認できる。
 */
function StarRating({
  type,
  value,
  onChange,
  onShowHint,
}: {
  type: AssessmentType;
  value: number | null;
  onChange: (v: number | null) => void;
  onShowHint: () => void;
}) {
  const definition = ASSESSMENT_DEFINITIONS[type];
  const currentLevel = definition.levels.find((l) => l.score === value);

  const handleClick = (n: number) => {
    if (n === 1 && value === 1) {
      onChange(null);
    } else {
      onChange(n);
    }
  };

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center gap-x-2">
        <span className="text-base font-bold text-app-text">{definition.question}</span>
        <span className="text-sm text-app-muted">({definition.title})</span>
        <button
          type="button"
          onClick={onShowHint}
          className="ml-auto min-h-[44px] rounded-btn px-2 text-sm font-bold text-app-primary active:bg-app-primary-bg"
        >
          ⓘ 目安を見る
        </button>
      </div>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => handleClick(n)}
            aria-label={`${definition.question} ${n}`}
            className={`flex h-10 w-10 items-center justify-center text-3xl leading-none ${
              value !== null && n <= value ? 'text-yellow-400' : 'text-gray-300'
            }`}
          >
            ★
          </button>
        ))}
      </div>
      <p className={`mt-1 text-base ${currentLevel ? 'font-bold text-app-text' : 'text-app-muted'}`}>
        {currentLevel ? currentLevel.label : 'まだ選んでいません(星を押してください)'}
      </p>
    </div>
  );
}

/** 説明だけを見せる小さなモーダル。閉じるボタンは記号だけにせず「✕ 閉じる」と書く。 */
function InfoModal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="flex max-h-[85vh] w-full max-w-md flex-col rounded-card bg-white">
        <div className="flex shrink-0 items-center justify-between gap-3 rounded-t-card border-b bg-gray-50 p-4">
          <h3 className="text-base font-bold text-app-text">{title}</h3>
          <Button variant="subtle" size="sub" onClick={onClose}>
            ✕ 閉じる
          </Button>
        </div>
        <div className="overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

/** GAS版showAssessmentHintと同じ、評価基準一覧のモーダル。 */
function AssessmentHintModal({ type, onClose }: { type: AssessmentType; onClose: () => void }) {
  const definition = ASSESSMENT_DEFINITIONS[type];
  return (
    <InfoModal title={`${definition.question}の目安`} onClose={onClose}>
      <p className="mb-3 text-sm text-app-muted">正式な指標名: {definition.title}</p>
      <div className="space-y-3">
        {definition.levels.map((l) => (
          <div key={l.score} className="rounded-card border border-gray-200 p-3">
            <p className="text-base font-bold text-app-text">
              <span className="text-yellow-400">{'★'.repeat(l.score)}</span> {l.label}
            </p>
            <p className="mt-1 whitespace-pre-wrap text-base leading-relaxed text-app-text">{l.desc}</p>
          </div>
        ))}
      </div>
    </InfoModal>
  );
}

/** 「💡 書き方のヒント」で開く文章。日報・事故報告・ヒヤリハットで中身だけ差し替える。 */
function WritingHintModal({
  title,
  content,
  onClose,
}: {
  title: string;
  content: string;
  onClose: () => void;
}) {
  return (
    <InfoModal title={title} onClose={onClose}>
      <p className="whitespace-pre-wrap text-base leading-relaxed text-app-text">{content}</p>
    </InfoModal>
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
  /** 読み取り失敗時のメッセージ(表示用)。成功時・未実行時はnull。 */
  ocrError: string | null;
  /**
   * 請求区分(doc/14 §10)。領収書1枚ごとに選べる。既定は'company_expense'
   * (取りこぼしが「うっかり顧客に請求してしまう」向きに転ばないようにするため。
   * DB側のデフォルトと同じ理由)。
   */
  billingType: ReceiptBillingType;
}

/**
 * AI生成・写真の読み取りのエラーコード('API Error'/'API Key Missing'。GAS版GeminiReport.jsの
 * generateReportWithWarnings/generateAccidentReport/extractAmountFromImageが返す値と同じ)を、
 * スタッフ向けの分かりやすい文言に変換する。GAS版はこれらをそのまま(あるいは無言で)表示していて
 * 不親切だったため、katahimo-app側で追加した変換。英語・略語は画面に出さない。
 */
function friendlyAiErrorMessage(raw: string): string {
  if (raw === 'API Key Missing') {
    return 'AIに書いてもらう準備がまだできていません。事務局にご連絡ください';
  }
  if (raw === 'API Error') {
    return 'AIが書けませんでした。少し待ってから、もう一度押してください';
  }
  return toFriendlyMessage(raw, 'AIの応答');
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** GAS版resizeAndAddImageのMAX_WIDTH/MAX_HEIGHT・JPEG品質と同じ値。 */
const RECEIPT_IMAGE_MAX_DIMENSION = 1200;
const RECEIPT_IMAGE_JPEG_QUALITY = 0.7;

/** 長辺1200px以内・JPEG品質0.7へリサイズ/圧縮する。GAS版resizeAndAddImageと同じロジック。 */
function resizeReceiptImage(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let { width, height } = img;
      if (width > height) {
        if (width > RECEIPT_IMAGE_MAX_DIMENSION) {
          height *= RECEIPT_IMAGE_MAX_DIMENSION / width;
          width = RECEIPT_IMAGE_MAX_DIMENSION;
        }
      } else if (height > RECEIPT_IMAGE_MAX_DIMENSION) {
        width *= RECEIPT_IMAGE_MAX_DIMENSION / height;
        height = RECEIPT_IMAGE_MAX_DIMENSION;
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas 2D contextの取得に失敗しました'));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', RECEIPT_IMAGE_JPEG_QUALITY));
    };
    img.onerror = () => reject(new Error('画像の読み込みに失敗しました'));
    img.src = dataUrl;
  });
}

/** 'yyyy/MM/dd HH:mm'形式で現在時刻を返す(写真から日時を読み取れなかった場合のフォールバック)。GAS版getNowDatetimeLocalと同じ役割。 */
function formatNowForReceipt(): string {
  const d = new Date();
  return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * 顧客カードタップで開く報告作成モーダル。GAS版index.htmlのreportModal(保育日報/事故報告の
 * 2タブ+領収書登録)に対応。「顧客情報」「活動記録」は別モーダル(CustomerDetail/HistoryModal)
 * に分かれている点もGAS版と同じ(openModal(customer)は常にこの報告モーダルを開く)。
 *
 * 並び順は提案書(doc/16_UIUX改善提案_2026-09-03.html)の「メモ(声)→ AI → 直す → 送る」に
 * 合わせてある。日付と時間は上部の1行にまとめ、「変える」で折りたたみを開く。星評価・領収書は
 * あとから足す補助情報なので後ろに置く。主ボタン(AIに書いてもらう→保存する)は画面下の
 * 固定バーに1つだけ置く。
 */
export function ReportModal({ customerId, onClose }: { customerId: string; onClose: () => void }) {
  const { showSuccess, showError, confirm } = useFeedback();
  const customerQuery = useQuery({
    queryKey: ['customer', customerId],
    queryFn: () => fetchCustomerDetail(customerId),
  });

  const [mode, setMode] = useState<Mode>('daily');
  const [selectedFamilyId, setSelectedFamilyId] = useState('');

  // ── 日付・時間(保育日報/事故報告で共有。GAS版のmodalDateSection/modalTimeSectionと同じ) ──
  const [visitDate, setVisitDate] = useState(() => new Date());
  const [startHour, setStartHour] = useState(() => localStorage.getItem('last_start_hour') || '09');
  const [startMinute, setStartMinute] = useState(() => localStorage.getItem('last_start_minute') || '00');
  const [endHour, setEndHour] = useState('11');
  const [endMinute, setEndMinute] = useState('00');
  /** 日付・時間の折りたたみ。既定は閉じていて、上部1行の「変える」で開く。 */
  const [showDateTimeEditor, setShowDateTimeEditor] = useState(false);
  const [sendingVisitComplete, setSendingVisitComplete] = useState(false);
  /** 「訪問おわりました」を送った時刻('HH:MM')。送信後はボタンを無効にして二重送信を防ぐ。 */
  const [visitCompletedAt, setVisitCompletedAt] = useState<string | null>(null);

  /** GAS版changeDate()と同じ。未来日への変更は禁止する。 */
  const changeDate = (offsetDays: number) => {
    setVisitDate((prev) => {
      const next = new Date(prev);
      next.setDate(next.getDate() + offsetDays);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const check = new Date(next);
      check.setHours(0, 0, 0, 0);
      if (offsetDays > 0 && check > today) return prev;
      return next;
    });
  };
  const isNextDateDisabled = (() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(visitDate);
    target.setHours(0, 0, 0, 0);
    return target >= today;
  })();

  /** GAS版autoSetEndTime()と同じ(開始+2時間、分は開始と同じ)。 */
  const handleStartHourChange = (value: string) => {
    setStartHour(value);
    localStorage.setItem('last_start_hour', value);
    setEndHour(String((Number.parseInt(value, 10) + 2) % 24).padStart(2, '0'));
  };
  const handleStartMinuteChange = (value: string) => {
    setStartMinute(value);
    localStorage.setItem('last_start_minute', value);
    setEndMinute(value);
  };

  /**
   * 事務局へ通知が飛ぶ操作なので、押す前に確認を出す(提案書「訪問完了を緑の大ボタンにし、
   * 確認を出す」)。送信後はボタンを「✅ 送りました HH:MM」に変えて押せなくする。
   */
  const handleVisitComplete = async () => {
    const ok = await confirm({
      message: '事務局に『訪問おわりました』を送りますか?',
      confirmLabel: '送る',
    });
    if (!ok) return;
    setSendingVisitComplete(true);
    try {
      await sendVisitCompleteNotification(
        customerId,
        formatDateKey(visitDate),
        `${startHour}:${startMinute}`,
        `${endHour}:${endMinute}`,
      );
      const now = new Date();
      setVisitCompletedAt(`${pad2(now.getHours())}:${pad2(now.getMinutes())}`);
      showSuccess('✅ 事務局に知らせました');
    } catch (e) {
      showError(toFriendlyMessage(e, '訪問おわりましたの送信'));
    } finally {
      setSendingVisitComplete(false);
    }
  };

  // ── 保育日報 ──
  const [riskRating, setRiskRating] = useState<number | null>(null);
  const [esRating, setEsRating] = useState<number | null>(null);
  const [hintType, setHintType] = useState<AssessmentType | null>(null);
  /** 「💡 書き方のヒント」で開く文章(日報/事故報告/ヒヤリハットで中身が変わる)。 */
  const [writingHint, setWritingHint] = useState<{ title: string; content: string } | null>(null);
  const [memoText, setMemoText] = useState('');
  const [internalText, setInternalText] = useState('');
  const [customerText, setCustomerText] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [generatingDaily, setGeneratingDaily] = useState(false);
  const dailyElapsedSeconds = useElapsedSeconds(generatingDaily);
  const [savingDaily, setSavingDaily] = useState(false);
  const [dailyError, setDailyError] = useState<string | null>(null);
  /** AIを使わずに自分で書くとき用。押すと日報の文面欄を先に開く。 */
  const [writingDailyByHand, setWritingDailyByHand] = useState(false);
  /**
   * 保存済み日報のID+保存時点の内容スナップショット(JSON文字列)。GAS版のsavedReportsState/
   * rowIndexに相当し、「保存する」を複数回押しても同じ内容の行を重複作成しないための仕組み。
   * - 未保存(null): 保存時はDBに新規作成し、IDとスナップショットを記録する。
   * - 保存済みで内容が前回と同一: 保存をスキップする(重複行の原因だったため)。
   * - 保存済みで内容が変わっている: 上書き確認のうえ、IDを指定してDB側で更新(アップサート)する。
   */
  const [dailySavedId, setDailySavedId] = useState<string | null>(null);
  const [dailySavedSnapshot, setDailySavedSnapshot] = useState<string | null>(null);

  // ── 適用クーポン(doc/14 §9。日報タブのみ) ──
  // 「使えるかどうか」の判定は全てサーバー側(listCouponsForSelection)で済ませ、ここには
  // 使える条件を満たすものだけが返ってくる。スタッフが「今月はこの子の誕生月か」「この世帯に
  // 配ってあるクーポンか」を自分で確かめる必要は無い。
  //
  // 判定は顧客と対象日('YYYY-MM-DD')と編集中の日報に依存するため、queryKeyに3つとも含める。
  // 日付を変えるとreact-queryが自動的に取り直すので、「前の日の一覧が出たまま」を防げる。
  const dateKey = formatDateKey(visitDate);
  const couponsQuery = useQuery({
    queryKey: ['coupons', customerId, dateKey, dailySavedId],
    queryFn: () => fetchCouponsForSelection(customerId, dateKey, dailySavedId),
  });
  const [selectedCouponIds, setSelectedCouponIds] = useState<string[]>([]);
  // 訪問日を変えて一覧が入れ替わったとき、選択済みだったが新しい一覧には無くなった
  // クーポン(=対象日には有効でなくなったもの)は選択から外す。外さないと、前日には
  // 有効だったクーポンが選ばれたまま保存されようとしてしまう(保存自体はサーバー側の検証で
  // 弾かれるが、画面上は選択されたままに見えて分かりにくい)。
  useEffect(() => {
    if (!couponsQuery.data) return;
    // 使用済み(alreadyUsed)のものは一覧には残るが選べないので、選択からも外す。
    const selectableIds = new Set(couponsQuery.data.filter((c) => !c.alreadyUsed).map((c) => c.id));
    setSelectedCouponIds((prev) => prev.filter((id) => selectableIds.has(id)));
  }, [couponsQuery.data]);
  const toggleCoupon = (couponId: string) => {
    setSelectedCouponIds((prev) =>
      prev.includes(couponId) ? prev.filter((id) => id !== couponId) : [...prev, couponId],
    );
  };

  /** GAS版copyToClipboard('customerResult')と同じ役割。貼りつけ先(LINE)まで知らせる。 */
  const handleCopyCustomerText = async () => {
    try {
      await navigator.clipboard.writeText(customerText);
      showSuccess('コピーしました。LINEを開いて貼りつけてください');
    } catch (e) {
      showError(
        toFriendlyMessage(e, '保護者に送る文のコピー', 'コピーできませんでした。もう一度押してください'),
      );
    }
  };
  const dailyVoice = useVoiceInput((text) => setMemoText((prev) => (prev ? `${prev}\n${text}` : text)));

  // ── 事故報告/ヒヤリハット ──
  const [reportType, setReportType] = useState<'事故報告' | 'ヒヤリハット'>('事故報告');
  const [accidentMemo, setAccidentMemo] = useState('');
  const accidentVoice = useVoiceInput((text) =>
    setAccidentMemo((prev) => (prev ? `${prev}\n${text}` : text)),
  );
  const [accTargetName, setAccTargetName] = useState('');
  const [accTargetDob, setAccTargetDob] = useState('');
  const [occurrenceTime, setOccurrenceTime] = useState('');
  const [location, setLocation] = useState('');
  const [accidentContent, setAccidentContent] = useState('');
  const [situation, setSituation] = useState('');
  const [immediateResponse, setImmediateResponse] = useState('');
  const [parentCorrespondence, setParentCorrespondence] = useState('');
  const [diagnosisTreatment, setDiagnosisTreatment] = useState('');
  const [prevention, setPrevention] = useState('');
  const [generatingAccident, setGeneratingAccident] = useState(false);
  const accidentElapsedSeconds = useElapsedSeconds(generatingAccident);
  const [savingAccident, setSavingAccident] = useState(false);
  const [accidentError, setAccidentError] = useState<string | null>(null);
  /** 保存済み事故報告のID+保存時点の内容スナップショット。dailySavedId/dailySavedSnapshotと同じ役割。 */
  const [accidentSavedId, setAccidentSavedId] = useState<string | null>(null);
  const [accidentSavedSnapshot, setAccidentSavedSnapshot] = useState<string | null>(null);

  // ── 領収書登録(日報タブのみ。GAS版と同じ制約) ──
  const [images, setImages] = useState<ReceiptImageState[]>([]);
  const [handoffText, setHandoffText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  /** 対象者選択(GAS版onFamilySelect()と同じ、事故報告の対象者氏名/生年月日を自動入力する)。 */
  const handleFamilySelect = (id: string) => {
    setSelectedFamilyId(id);
    const fam = customerQuery.data?.familyMembers.find((f) => f.id === id);
    setAccTargetName(fam?.name ?? '');
    // doc/14 §6でdobはdobDate/dobRawに分かれた。ここは自由記述テキストとして事故報告の
    // 対象者生年月日欄に流し込む用途のため、元表記(dobRaw)を優先する。
    setAccTargetDob(fam?.dobRaw ?? fam?.dobDate ?? '');
  };

  const handleGenerateDaily = async () => {
    if (!memoText.trim()) return;
    setGeneratingDaily(true);
    setDailyError(null);
    try {
      const draft = await generateDailyReportDraft(
        memoText,
        `${startHour}:${startMinute}`,
        `${endHour}:${endMinute}`,
      );
      // GAS版onReportGeneratedのisApiErrorチェックと同じ。'API Error'/'API Key Missing'は
      // 「不足項目」ではなく生成そのものの失敗なので、結果欄には反映せず分かりやすいエラーとして表示する
      // (GAS版はresult.internalの生エラー文言をそのまま画面に出しており不親切だった)。
      const failureCode = draft.warnings.find((w) => w === 'API Error' || w === 'API Key Missing');
      if (failureCode) {
        setWarnings([]);
        setDailyError(friendlyAiErrorMessage(failureCode));
        return;
      }
      setWarnings(draft.warnings);
      setInternalText(draft.internal);
      setCustomerText(draft.customer);
    } catch (e) {
      setDailyError(toFriendlyMessage(e, '日報のAI作成'));
    } finally {
      setGeneratingDaily(false);
    }
  };

  const handleSaveDaily = async () => {
    if (!customerQuery.data) return;
    const payload = {
      customerId,
      reportDate: formatDateKey(visitDate),
      startTime: `${startHour}:${startMinute}`,
      endTime: `${endHour}:${endMinute}`,
      inputText: memoText,
      internalText,
      customerText,
      riskRating,
      esRating,
      // 選んだ順ではなくソートしてから含める。トグルの順序が違うだけの同じ組み合わせを
      // 「内容が変わった」と誤判定して、下の重複保存防止(snapshot比較)をすり抜けさせないため。
      couponIds: [...selectedCouponIds].sort(),
    };
    const snapshot = JSON.stringify(payload);
    // GAS版savedReportsState/rowIndexと同じ考え方: 既に保存済みで内容が変わっていなければ
    // 再度保存ボタンを押しても何もしない(これが「複数回押すと同じ内容が重複登録される」原因だった)。
    if (dailySavedId && snapshot === dailySavedSnapshot) {
      showSuccess('✅ 保存しました(内容は変わっていません)');
      return;
    }
    if (dailySavedId) {
      const confirmed = await confirm({
        message: '前に保存した日報を、今の内容に書きかえますか?',
        confirmLabel: '書きかえる',
      });
      if (!confirmed) return;
    }
    setSavingDaily(true);
    setDailyError(null);
    try {
      const report = await saveDailyReport({ ...payload, reportId: dailySavedId ?? undefined });
      setDailySavedId(report.id);
      setDailySavedSnapshot(snapshot);
      // サーバーが実際に確定させた適用記録で選択状態を揃える(同じクーポンIDが重複して
      // 渡された場合の畳み込み等、保存側の正規化結果を画面にも反映するため)。これが
      // 「編集時に既存の適用済みクーポンを初期選択として表示する」の実体になる
      // (このモーダルは新規作成の1セッション内でしか編集できず、保存するたびにここで
      // サーバー側の状態と選択状態を合わせ直している)。
      setSelectedCouponIds(report.coupons.map((c) => c.couponId));
      showSuccess('✅ 保存しました');
      markCustomerRecentlyUsed(customerId);
    } catch (e) {
      setDailyError(toFriendlyMessage(e, '日報の保存'));
    } finally {
      setSavingDaily(false);
    }
  };

  const handleGenerateAccident = async () => {
    if (!accidentMemo.trim()) return;
    setGeneratingAccident(true);
    setAccidentError(null);
    try {
      const draft = await generateAccidentReportDraft(accidentMemo, `${startHour}:${startMinute}`);
      if ('error' in draft) {
        setAccidentError(friendlyAiErrorMessage(draft.error));
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
      setAccidentError(toFriendlyMessage(e, '事故報告のAI下書き'));
    } finally {
      setGeneratingAccident(false);
    }
  };

  const handleSaveAccident = async () => {
    const payload = {
      customerId,
      reportType,
      targetName: accTargetName,
      targetDob: accTargetDob,
      occurrenceTime,
      location,
      accidentContent,
      situation,
      immediateResponse,
      parentCorrespondence,
      diagnosisTreatment,
      prevention,
      inputText: accidentMemo,
    };
    const snapshot = JSON.stringify(payload);
    if (accidentSavedId && snapshot === accidentSavedSnapshot) {
      showSuccess('✅ 保存しました(内容は変わっていません)');
      return;
    }
    if (accidentSavedId) {
      const confirmed = await confirm({
        message: `前に保存した${reportType}を、今の内容に書きかえますか?`,
        confirmLabel: '書きかえる',
      });
      if (!confirmed) return;
    }
    setSavingAccident(true);
    setAccidentError(null);
    try {
      const report = await saveAccidentReport({ ...payload, reportId: accidentSavedId ?? undefined });
      setAccidentSavedId(report.id);
      setAccidentSavedSnapshot(snapshot);
      showSuccess('✅ 保存しました');
      markCustomerRecentlyUsed(customerId);
    } catch (e) {
      setAccidentError(toFriendlyMessage(e, `${reportType}の保存`));
    } finally {
      setSavingAccident(false);
    }
  };

  const MAX_RECEIPT_IMAGES = 6;

  /**
   * 写真1枚をリサイズ/圧縮してプレビューに追加し、そのまま金額の読み取りを実行する。
   * GAS版resizeAndAddImage→runOcrと同じ流れ(手動の読み取りボタンは無く、追加した瞬間に
   * 自動で読み取りが走る)。複数枚を同時に追加した場合、各写真は互いを待たず
   * 独立に処理される(GAS版がFileReader+resizeAndAddImageをファイルごとに並行して
   * 呼んでいるのと同じ)。
   */
  const addAndOcrReceiptImage = async (file: File) => {
    const id = crypto.randomUUID();
    let dataUrl: string;
    try {
      dataUrl = await resizeReceiptImage(await readFileAsDataUrl(file));
    } catch (e) {
      showError(
        toFriendlyMessage(e, '領収書の写真の取り込み', '写真を取り込めませんでした。もう一度撮ってください'),
      );
      return;
    }
    setImages((prev) => [
      ...prev,
      {
        id,
        dataUrl,
        amount: '',
        storeName: '',
        receiptDate: '',
        ocrLoading: true,
        ocrError: null,
        billingType: 'company_expense',
      },
    ]);

    try {
      const result = await extractReceiptOcr(dataUrl);
      // GAS版extractAmountFromImageは失敗時も空値を返すのみで無言だったため、
      // 金額等が空のまま何のエラーも表示されない不親切な挙動になっていた。ここでは
      // result.errorを表示し、手入力が必要なことに気付けるようにする。
      setImages((prev) =>
        prev.map((img) =>
          img.id === id
            ? {
                ...img,
                amount: result.amount ? String(result.amount) : img.amount,
                storeName: result.storeName || img.storeName,
                receiptDate: result.receiptDate || formatNowForReceipt(),
                ocrLoading: false,
                ocrError: result.error ? friendlyAiErrorMessage(result.error) : null,
              }
            : img,
        ),
      );
    } catch (e) {
      setImages((prev) =>
        prev.map((img) =>
          img.id === id
            ? {
                ...img,
                receiptDate: img.receiptDate || formatNowForReceipt(),
                ocrLoading: false,
                ocrError: toFriendlyMessage(e, '領収書の読み取り'),
              }
            : img,
        ),
      );
    }
  };

  const handleAddImages = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setDuplicateWarning(null);
    const files = Array.from(fileList);
    if (images.length + files.length > MAX_RECEIPT_IMAGES) {
      showError(`写真は${MAX_RECEIPT_IMAGES}枚までです。いらない写真を消してから足してください`);
      return;
    }
    for (const file of files) {
      void addAndOcrReceiptImage(file);
    }
  };

  const handleUploadReceipts = async () => {
    if (images.length === 0) return;
    // 読み取り中の写真があると金額が空のまま送られてしまう。何を待っているのかを書いて止める。
    if (images.some((img) => img.ocrLoading)) {
      showError('写真から金額を読み取っています。少し待ってからもう一度押してください');
      return;
    }
    setUploading(true);
    setDuplicateWarning(null);
    try {
      const payloadImages: ReceiptImageUpload[] = images.map((img) => ({
        data: img.dataUrl,
        amount: img.amount || null,
        storeName: img.storeName || null,
        receiptDate: img.receiptDate || null,
        billingType: img.billingType,
      }));
      const result = await uploadReceipts({ customerId, images: payloadImages, handoffText });
      markCustomerRecentlyUsed(customerId);
      const duplicateIndexes = new Set(result.duplicates.map((d) => d.index));
      setImages((prev) => prev.filter((_, idx) => duplicateIndexes.has(idx)));
      if (duplicateIndexes.size === 0) setHandoffText('');

      // GAS版showReceiptDuplicateWarningと同じ、重複でスキップされた領収書の一覧表示。
      if (result.duplicates.length > 0) {
        const customerName = customerQuery.data?.name ?? '';
        const lines = result.duplicates.map(
          (d, idx) =>
            `${idx + 1}. ${d.timestamp} / お客様:${customerName} / 金額:${d.amount}円 / お店:${d.storeName}`,
        );
        setDuplicateWarning(`この領収書は前に送ってあります(送っていません)\n${lines.join('\n')}`);
      } else {
        // サーバーの文言(「領収書を2件アップロードしました」)はカタカナ英語なので、
        // 件数だけを受け取って画面向けの言い方に置きかえる(APIの戻り値は変えない)。
        showSuccess(`✅ 領収書を${result.uploadedCount}枚送りました`);
      }
    } catch (e) {
      showError(toFriendlyMessage(e, '領収書の送信'));
    } finally {
      setUploading(false);
    }
  };

  // ── 画面の状態(どの主ボタンを下の固定バーに出すか) ──
  // 日報: AIの結果(または自分で書いた文)がまだ無いうちは「AIに日報を書いてもらう」、
  //       出たら「保存する」。事故報告も同じ考え方(下書きの欄が1つでも埋まったら保存)。
  const hasDailyResult = internalText.trim() !== '' || customerText.trim() !== '' || dailySavedId !== null;
  const dailyResultVisible = hasDailyResult || writingDailyByHand;
  const hasAccidentDraft =
    accidentSavedId !== null ||
    [
      occurrenceTime,
      location,
      accidentContent,
      situation,
      immediateResponse,
      parentCorrespondence,
      diagnosisTreatment,
      prevention,
    ].some((v) => v.trim() !== '');

  const customerName = customerQuery.data?.name ?? '';
  const timeSummary =
    mode === 'daily'
      ? `${startHour}:${startMinute}〜${endHour}:${endMinute}`
      : `${startHour}:${startMinute} ごろ`;

  const dailyMainLabel = (() => {
    if (dailyResultVisible) return savingDaily ? '保存しています…' : '保存する';
    return generatingDaily ? 'AIが書いています…' : '✨ AIに日報を書いてもらう';
  })();
  const accidentMainLabel = (() => {
    if (hasAccidentDraft) return savingAccident ? '保存しています…' : '保存する';
    return generatingAccident ? 'AIが書いています…' : '✨ AIに報告書の下書きを作ってもらう';
  })();

  const visitCompleteLabel = (() => {
    if (visitCompletedAt) return `✅ 送りました ${visitCompletedAt}`;
    if (sendingVisitComplete) return '送っています…';
    return '✅ 訪問おわりました(事務局に知らせる)';
  })();

  /**
   * 「訪問おわりました」は事務局へ通知が飛ぶ操作。GAS版と同じく日報・事故報告のどちらのタブからでも
   * 押せるようにしたいので、ここで組み立てて両方のタブの最後に置く。
   */
  const visitCompleteSection = (
    <Section title="訪問がおわったら" note="事務局に「おわりました」を知らせます">
      <Button
        variant="done"
        fullWidth
        onClick={handleVisitComplete}
        disabled={sendingVisitComplete || visitCompletedAt !== null}
      >
        {visitCompleteLabel}
      </Button>
    </Section>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black bg-opacity-50 sm:items-center">
      <div className="flex h-[92vh] w-full max-w-md flex-col rounded-t-card bg-white sm:h-auto sm:max-h-[90vh] sm:rounded-card">
        <div className="flex shrink-0 items-center justify-between gap-3 rounded-t-card border-b bg-gray-50 p-4">
          <div>
            <h2 className="text-lg font-bold text-app-text">{customerName || '読み込んでいます…'}</h2>
            {customerQuery.data?.city && <p className="text-sm text-app-muted">{customerQuery.data.city}</p>}
          </div>
          <Button variant="subtle" size="sub" onClick={onClose}>
            ✕ 閉じる
          </Button>
        </div>

        <div className="flex shrink-0 border-b">
          <button
            type="button"
            onClick={() => setMode('daily')}
            className={`min-h-[48px] flex-1 border-b-4 px-2 py-3 text-base font-bold transition-colors ${
              mode === 'daily' ? 'border-app-primary text-app-primary' : 'border-transparent text-app-muted'
            }`}
          >
            📝 きょうの日報
          </button>
          <button
            type="button"
            onClick={() => setMode('accident')}
            className={`min-h-[48px] flex-1 border-b-4 px-2 py-3 text-base font-bold transition-colors ${
              mode === 'accident'
                ? 'border-app-primary text-app-primary'
                : 'border-transparent text-app-muted'
            }`}
          >
            ⚠️ 事故・ヒヤリ
          </button>
        </div>

        <div className="flex-grow space-y-3 overflow-y-auto bg-gray-50 p-4">
          {customerQuery.isPending && <LoadingBlock text="読み込んでいます…" />}

          {/* 日付と時間は1行にまとめ、直したいときだけ「変える」で折りたたみを開く
              (提案書「日付と時間は上部に1行で見せ、『変える』で開く」)。 */}
          <section className="space-y-3 rounded-card border border-gray-200 bg-white p-3.5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-base font-bold leading-relaxed text-app-text">
                {formatDateShort(visitDate)} {timeSummary}
              </p>
              <Button
                variant="subtle"
                size="sub"
                onClick={() => setShowDateTimeEditor((prev) => !prev)}
                className="shrink-0"
              >
                {showDateTimeEditor ? '閉じる' : '変える'}
              </Button>
            </div>

            {showDateTimeEditor && (
              <div className="space-y-3 border-t border-gray-200 pt-3">
                {/* 日付(保育日報/事故報告で共有)。GAS版modalDateSectionと同じ。
                    ‹ › の細い記号は押しにくいので文字つきのボタンにしている。 */}
                <div className="flex items-center justify-between gap-2">
                  <Button variant="subtle" size="sub" onClick={() => changeDate(-1)}>
                    ◀ 前の日
                  </Button>
                  <span className="text-base font-bold text-app-text">{formatDateDisplay(visitDate)}</span>
                  <Button
                    variant="subtle"
                    size="sub"
                    onClick={() => changeDate(1)}
                    disabled={isNextDateDisabled}
                  >
                    次の日 ▶
                  </Button>
                </div>

                {/* 時間(保育日報/事故報告で共有)。GAS版modalTimeSectionと同じ(hour/minuteセレクト)。
                    兼用ラベル「開始時間/発生時間」はやめ、タブごとの言い方にしている。 */}
                <div>
                  <FieldLabel htmlFor="startHour">
                    {mode === 'daily' ? '始めた時間' : '起きた時間'}
                  </FieldLabel>
                  <div className="flex items-center gap-2">
                    <select
                      id="startHour"
                      value={startHour}
                      onChange={(e) => handleStartHourChange(e.target.value)}
                      className={`flex-1 ${INPUT_CLASS}`}
                    >
                      {HOURS.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                    <span className="text-base text-app-muted">:</span>
                    <select
                      aria-label={mode === 'daily' ? '始めた時間(分)' : '起きた時間(分)'}
                      value={startMinute}
                      onChange={(e) => handleStartMinuteChange(e.target.value)}
                      className={`flex-1 ${INPUT_CLASS}`}
                    >
                      {MINUTES.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {mode === 'daily' && (
                  <div>
                    <FieldLabel htmlFor="endHour">終わった時間</FieldLabel>
                    <div className="flex items-center gap-2">
                      <select
                        id="endHour"
                        value={endHour}
                        onChange={(e) => setEndHour(e.target.value)}
                        className={`flex-1 ${INPUT_CLASS}`}
                      >
                        {HOURS.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </select>
                      <span className="text-base text-app-muted">:</span>
                      <select
                        aria-label="終わった時間(分)"
                        value={endMinute}
                        onChange={(e) => setEndMinute(e.target.value)}
                        className={`flex-1 ${INPUT_CLASS}`}
                      >
                        {MINUTES.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>

          {mode === 'daily' && (
            <>
              {/* 1. きょうのできごとメモ → 2. 話して入力/書き方のヒント */}
              <Section
                title="きょうのできごと メモ"
                note="話しことばのままでかまいません。このメモをもとにAIが日報を書きます"
                labelFor="memoText"
              >
                <textarea
                  id="memoText"
                  value={memoText}
                  onChange={(e) => setMemoText(e.target.value)}
                  rows={5}
                  placeholder={DAILY_MEMO_PLACEHOLDER}
                  className={TEXTAREA_CLASS}
                />
                {dailyVoice.error && <ErrorNotice text={dailyVoice.error} />}
                {/* 横並びにすると「書き方のヒ/ント」のように折り返すので縦に積む。 */}
                <div className="flex flex-col gap-3">
                  <Button
                    variant={dailyVoice.listening ? 'danger' : 'outline'}
                    size="sub"
                    fullWidth
                    onClick={dailyVoice.toggle}
                    className="px-2"
                  >
                    {dailyVoice.listening ? '⏹ 止める(聞いています…)' : '🎤 話して入力'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sub"
                    fullWidth
                    onClick={() =>
                      setWritingHint({ title: '日報の書き方ヒント', content: DAILY_WRITING_HINT })
                    }
                    className="px-2"
                  >
                    💡 書き方のヒント
                  </Button>
                </div>
              </Section>

              {/* 3. AIに書いてもらう。主ボタンは画面下の固定バーにあるので、ここには待ち時間の
                  目安だけを常時出す(提案書「AIボタンの下に待ち時間の目安を常時表示」)。 */}
              <section className="space-y-3">
                {generatingDaily ? (
                  <LoadingBlock
                    text={`AIが書いています…(${dailyElapsedSeconds}秒)`}
                    note="1分ほどかかることがあります"
                    className="rounded-card border border-gray-200 bg-white py-6"
                  />
                ) : (
                  !dailyResultVisible && (
                    <div className="space-y-3 rounded-card border border-gray-200 bg-white p-3.5">
                      <p className="text-sm leading-relaxed text-app-muted">
                        ✨ メモが書けたら、画面の下の「AIに日報を書いてもらう」を押してください。
                        1分ほどかかることがあります。書けたら下に出ます
                      </p>
                      <Button
                        variant="outline"
                        size="sub"
                        fullWidth
                        onClick={() => setWritingDailyByHand(true)}
                      >
                        ✏️ AIを使わず自分で書く
                      </Button>
                    </div>
                  )
                )}
                {dailyError && <ErrorNotice text={dailyError} />}
              </section>

              {/* 4. AIの結果(事務局に送る文/保護者に送る文) */}
              {dailyResultVisible && (
                <Section title="✨ AIが書いた日報" note="直したいところは、そのまま書きかえられます">
                  {warnings.length > 0 && (
                    <p className="rounded-btn border border-app-danger bg-app-danger-bg p-3 text-base leading-relaxed text-app-text">
                      ⚠️ 足りない情報があります:{warnings.join('、')}
                    </p>
                  )}

                  <div>
                    <FieldLabel htmlFor="internalText">事務局に送る文</FieldLabel>
                    <textarea
                      id="internalText"
                      value={internalText}
                      onChange={(e) => setInternalText(e.target.value)}
                      rows={5}
                      className={TEXTAREA_CLASS}
                    />
                    <p className="mt-1 text-sm text-app-muted">{internalText.length}文字</p>
                  </div>

                  <div>
                    <FieldLabel htmlFor="customerText">保護者に送る文</FieldLabel>
                    <textarea
                      id="customerText"
                      value={customerText}
                      onChange={(e) => setCustomerText(e.target.value)}
                      rows={5}
                      className={TEXTAREA_CLASS}
                    />
                    <p className="mt-1 text-sm text-app-muted">{customerText.length}文字</p>
                    <Button
                      variant="outline"
                      size="sub"
                      fullWidth
                      onClick={handleCopyCustomerText}
                      className="mt-2"
                    >
                      📋 コピーしてLINEに貼る
                    </Button>
                  </div>

                  <Button
                    variant="outline"
                    size="sub"
                    fullWidth
                    onClick={handleGenerateDaily}
                    disabled={generatingDaily || !memoText.trim()}
                  >
                    ✨ AIにもう一度書いてもらう
                  </Button>
                </Section>
              )}

              {/* 5. 星評価(補助情報なのでAIの結果より後ろ) */}
              <Section title="きょうの様子をふり返る" note="あてはまる星の数を押してください">
                <StarRating
                  type="risk"
                  value={riskRating}
                  onChange={setRiskRating}
                  onShowHint={() => setHintType('risk')}
                />
                <StarRating
                  type="es"
                  value={esRating}
                  onChange={setEsRating}
                  onShowHint={() => setHintType('es')}
                />
              </Section>

              {/* 適用クーポン(doc/14 §9。日報タブのみ)。1回の訪問に複数適用しうるので
                  チェックボックスの複数選択にしている。クーポンを1件も登録していないテナントでは、
                  一覧が確実に空だと分かった時点でセクションごと隠す。空の一覧をそのまま見せると
                  「クーポン機能が壊れている」ように見えてしまい、登録の予定が無いテナントには
                  単なる邪魔になるため(登録は設定→クーポン管理から行う)。 */}
              {!(couponsQuery.data && couponsQuery.data.length === 0) && (
                <Section title="🎁 使うクーポン" note="使うものがあれば選んでください">
                  {couponsQuery.isPending && <LoadingBlock text="読み込んでいます…" className="py-4" />}
                  {couponsQuery.isError && (
                    <ErrorNotice
                      text={toFriendlyMessage(
                        couponsQuery.error,
                        'クーポンの読み込み',
                        'クーポンを読み込めませんでした。電波を確認して、もう一度開いてください',
                      )}
                    />
                  )}
                  <div className="space-y-2">
                    {(couponsQuery.data ?? []).map((coupon) => (
                      <label
                        key={coupon.id}
                        className={`flex min-h-[48px] flex-wrap items-center gap-2 rounded-btn border p-3 text-base ${
                          coupon.alreadyUsed
                            ? 'cursor-not-allowed border-gray-200 bg-gray-50 text-app-muted'
                            : selectedCouponIds.includes(coupon.id)
                              ? 'cursor-pointer border-app-primary bg-app-primary-bg'
                              : 'cursor-pointer border-gray-300 active:bg-gray-100'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedCouponIds.includes(coupon.id)}
                          onChange={() => toggleCoupon(coupon.id)}
                          disabled={coupon.alreadyUsed}
                          className="h-6 w-6"
                        />
                        <span className={coupon.alreadyUsed ? '' : 'font-bold text-app-text'}>
                          {coupon.name}
                        </span>
                        <span className="text-sm text-app-muted">
                          (
                          {coupon.discountKind === 'amount'
                            ? `${coupon.discountAmountYen}円引き`
                            : `${coupon.discountPercent}%引き`}
                          )
                        </span>
                        {/* なぜ今このクーポンが出ているのかを一目で分かるようにする
                            (スタッフが誕生月を自分で確かめなくて済むのがこの機能の目的のため)。 */}
                        {coupon.birthdaySubjectName && (
                          <span className="text-sm text-app-text">
                            🎂 {coupon.birthdaySubjectName}さんの誕生月
                          </span>
                        )}
                        {coupon.alreadyUsed && <span className="ml-auto text-sm">使用済み</span>}
                      </label>
                    ))}
                  </div>
                </Section>
              )}

              {/* 6. レシート・領収書(あれば)。GAS版imageUploadSectionと同じ機能だが、
                  補助の情報なので日報の後ろに置いている。 */}
              <Section
                title="🧾 レシート・領収書を撮る(あれば)"
                note="6枚まで送れます。撮ると、金額とお店の名前を自動で読み取ります"
              >
                {duplicateWarning && <ErrorNotice text={duplicateWarning} />}

                <div className="space-y-3">
                  {images.map((img) => (
                    <div key={img.id} className="space-y-3 rounded-card border border-gray-200 p-3">
                      <div className="flex items-start gap-3">
                        <img
                          src={img.dataUrl}
                          alt="撮ったレシート"
                          className="h-24 w-24 shrink-0 rounded-btn border border-gray-200 object-cover"
                        />
                        <div className="flex-grow space-y-2">
                          {img.ocrLoading && (
                            <LoadingBlock text="写真から読み取っています…" className="py-2" />
                          )}
                          {img.ocrError && (
                            <p className="text-sm leading-relaxed text-app-muted">
                              写真から読み取れませんでした。金額とお店の名前を手で入れてください
                            </p>
                          )}
                          <Button
                            variant="danger"
                            size="sub"
                            fullWidth
                            onClick={() => setImages((prev) => prev.filter((i) => i.id !== img.id))}
                          >
                            ✕ この写真を消す
                          </Button>
                        </div>
                      </div>

                      <div>
                        <FieldLabel htmlFor={`receiptDate-${img.id}`}>レシートの日付</FieldLabel>
                        <input
                          id={`receiptDate-${img.id}`}
                          type="text"
                          value={img.receiptDate}
                          onChange={(e) =>
                            setImages((prev) =>
                              prev.map((i) => (i.id === img.id ? { ...i, receiptDate: e.target.value } : i)),
                            )
                          }
                          placeholder="2026/09/03 10:00"
                          className={INPUT_CLASS}
                        />
                      </div>
                      <div>
                        <FieldLabel htmlFor={`receiptAmount-${img.id}`}>金額(円)</FieldLabel>
                        <input
                          id={`receiptAmount-${img.id}`}
                          type="text"
                          inputMode="numeric"
                          value={img.amount}
                          onChange={(e) =>
                            setImages((prev) =>
                              prev.map((i) => (i.id === img.id ? { ...i, amount: e.target.value } : i)),
                            )
                          }
                          className={INPUT_CLASS}
                        />
                      </div>
                      <div>
                        <FieldLabel htmlFor={`receiptStore-${img.id}`}>お店の名前</FieldLabel>
                        <input
                          id={`receiptStore-${img.id}`}
                          type="text"
                          value={img.storeName}
                          onChange={(e) =>
                            setImages((prev) =>
                              prev.map((i) => (i.id === img.id ? { ...i, storeName: e.target.value } : i)),
                            )
                          }
                          className={INPUT_CLASS}
                        />
                      </div>
                      {/* 請求区分(doc/14 §10)。日付・金額・お店の名前と違い、選択肢の欄には
                          プレースホルダで「何の欄か」を書けない。ラベルを付けないと既定値の
                          「会社立替」だけが見えている状態になり、何を選ぶ欄なのか分からないまま
                          素通りされる(=お客様に請求すべき領収書が会社立替のまま登録される)。
                          お客様に請求する側は色を変えて、複数枚並べたときに一目で数えられるようにする。

                          お客様が選択されていない場合はDB制約(receipts_billable_requires_customer)と
                          同じ制限を画面でも表現するため「お客様に請求」を選べないようにする。 */}
                      <div>
                        <FieldLabel htmlFor={`receiptBilling-${img.id}`} formal="請求区分">
                          この支払いはどちら
                        </FieldLabel>
                        <select
                          id={`receiptBilling-${img.id}`}
                          value={img.billingType}
                          disabled={!customerId}
                          onChange={(e) =>
                            setImages((prev) =>
                              prev.map((i) =>
                                i.id === img.id
                                  ? { ...i, billingType: e.target.value as ReceiptBillingType }
                                  : i,
                              ),
                            )
                          }
                          className={`${INPUT_CLASS} disabled:opacity-60 ${
                            img.billingType === 'customer_billable'
                              ? 'border-app-primary bg-app-primary-bg font-bold'
                              : ''
                          }`}
                        >
                          <option value="company_expense">会社が立てかえる</option>
                          <option value="customer_billable" disabled={!customerId}>
                            お客様に請求する
                          </option>
                        </select>
                      </div>
                    </div>
                  ))}
                </div>

                {/* 横並びにすると「写真から選/ぶ」と折り返すので縦に積む。 */}
                <div className="flex flex-col gap-3">
                  <Button variant="outline" fullWidth onClick={() => cameraInputRef.current?.click()}>
                    📷 撮る
                  </Button>
                  <Button variant="outline" fullWidth onClick={() => galleryInputRef.current?.click()}>
                    🖼️ 写真から選ぶ
                  </Button>
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

                <div>
                  <FieldLabel htmlFor="handoffText">事務局へのひとこと(あれば)</FieldLabel>
                  <textarea
                    id="handoffText"
                    value={handoffText}
                    onChange={(e) => setHandoffText(e.target.value)}
                    rows={2}
                    className={TEXTAREA_CLASS}
                  />
                </div>

                <Button
                  variant="outline"
                  fullWidth
                  onClick={handleUploadReceipts}
                  disabled={uploading || images.length === 0}
                >
                  {uploading ? '送っています…' : '🧾 この領収書を送る'}
                </Button>
              </Section>

              {/* 7. 訪問おわりました(事務局に通知が飛ぶ操作。緑の大ボタン+確認) */}
              {visitCompleteSection}
            </>
          )}

          {mode === 'accident' && (
            <>
              {/* GAS版familySelectorContainerと同じく、事故報告タブでのみ表示する
                  (対象者氏名/生年月日の自動入力に使うため。日報タブでは非表示)。 */}
              {customerQuery.data && customerQuery.data.familyMembers.length > 0 && (
                <Section title="だれのことですか" labelFor="familySelector">
                  <select
                    id="familySelector"
                    value={selectedFamilyId}
                    onChange={(e) => handleFamilySelect(e.target.value)}
                    className={INPUT_CLASS}
                  >
                    <option value="">お子様を選んでください</option>
                    {customerQuery.data.familyMembers.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name} {calculateAgeLabel(f.dobDate ?? f.dobRaw)}
                      </option>
                    ))}
                  </select>
                </Section>
              )}

              <Section title="どちらの報告ですか" labelFor="reportType">
                <select
                  id="reportType"
                  value={reportType}
                  onChange={(e) => setReportType(e.target.value as '事故報告' | 'ヒヤリハット')}
                  className={INPUT_CLASS}
                >
                  <option value="事故報告">事故報告(けがなどが起きた)</option>
                  <option value="ヒヤリハット">ヒヤリハット(あぶなかった)</option>
                </select>
              </Section>

              <Section
                title="何があったか メモ"
                note="話しことばのままでかまいません。このメモをもとにAIが下書きを作ります"
                labelFor="accidentMemo"
              >
                <textarea
                  id="accidentMemo"
                  value={accidentMemo}
                  onChange={(e) => setAccidentMemo(e.target.value)}
                  rows={5}
                  placeholder={ACCIDENT_MEMO_PLACEHOLDER}
                  className={TEXTAREA_CLASS}
                />
                {accidentVoice.error && <ErrorNotice text={accidentVoice.error} />}
                {/* 横並びにすると折り返すので縦に積む(日報タブと同じ)。 */}
                <div className="flex flex-col gap-3">
                  <Button
                    variant={accidentVoice.listening ? 'danger' : 'outline'}
                    size="sub"
                    fullWidth
                    onClick={accidentVoice.toggle}
                    className="px-2"
                  >
                    {accidentVoice.listening ? '⏹ 止める(聞いています…)' : '🎤 話して入力'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sub"
                    fullWidth
                    onClick={() =>
                      setWritingHint({
                        title:
                          reportType === 'ヒヤリハット'
                            ? 'ヒヤリハットの書き方ヒント'
                            : '事故報告書の書き方ヒント',
                        content: reportType === 'ヒヤリハット' ? HIYARI_WRITING_HINT : ACCIDENT_WRITING_HINT,
                      })
                    }
                    className="px-2"
                  >
                    💡 書き方のヒント
                  </Button>
                </div>
              </Section>

              <section className="space-y-3">
                {generatingAccident ? (
                  <LoadingBlock
                    text={`AIが書いています…(${accidentElapsedSeconds}秒)`}
                    note="1分ほどかかることがあります"
                    className="rounded-card border border-gray-200 bg-white py-6"
                  />
                ) : (
                  !hasAccidentDraft && (
                    <p className="rounded-card border border-gray-200 bg-white p-3.5 text-sm leading-relaxed text-app-muted">
                      ✨ メモが書けたら、画面の下の「AIに報告書の下書きを作ってもらう」を押してください。
                      1分ほどかかることがあります。書けたら下に出ます
                    </p>
                  )
                )}
                {accidentError && <ErrorNotice text={accidentError} />}
              </section>

              {hasAccidentDraft && (
                <Button
                  variant="outline"
                  size="sub"
                  fullWidth
                  onClick={handleGenerateAccident}
                  disabled={generatingAccident || !accidentMemo.trim()}
                >
                  ✨ AIにもう一度下書きを作ってもらう
                </Button>
              )}

              {/* 事故報告書の入力欄。帳票の項目はそのままに、画面の見出しだけ
                  「やさしい語(正式名)」にしている。 */}
              <Section
                title="事故報告書(AIの下書き)"
                note="内容を確認して直してください。空いているところは手で書き足せます"
              >
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <FieldLabel htmlFor="accTargetName" formal="対象者氏名">
                      お子様の名前
                    </FieldLabel>
                    <input
                      id="accTargetName"
                      type="text"
                      value={accTargetName}
                      onChange={(e) => setAccTargetName(e.target.value)}
                      className={INPUT_CLASS}
                    />
                  </div>
                  <div>
                    <FieldLabel htmlFor="accTargetDob" formal="生年月日">
                      生まれた日
                    </FieldLabel>
                    <input
                      id="accTargetDob"
                      type="text"
                      value={accTargetDob}
                      onChange={(e) => setAccTargetDob(e.target.value)}
                      className={INPUT_CLASS}
                    />
                  </div>
                </div>

                <div>
                  <FieldLabel htmlFor="accOccurrenceTime" formal="発生日時">
                    起きた日時
                  </FieldLabel>
                  <input
                    id="accOccurrenceTime"
                    type="text"
                    value={occurrenceTime}
                    onChange={(e) => setOccurrenceTime(e.target.value)}
                    className={INPUT_CLASS}
                  />
                </div>

                {/* 画面の見出しはやさしい語、括弧の中は帳票の正式名(そのまま残す)。 */}
                {(
                  [
                    ['location', '起きた場所', '発生場所', location, setLocation],
                    ['accidentContent', '何が起きたか', '事故内容', accidentContent, setAccidentContent],
                    ['situation', 'くわしい状況', '発生状況', situation, setSituation],
                    [
                      'immediateResponse',
                      'その場でしたこと',
                      '発生時の対応',
                      immediateResponse,
                      setImmediateResponse,
                    ],
                    [
                      'parentCorrespondence',
                      '保護者に伝えたこと',
                      '保護者への対応',
                      parentCorrespondence,
                      setParentCorrespondence,
                    ],
                    [
                      'diagnosisTreatment',
                      '病院での診断・手当て',
                      '診断名および処置状況',
                      diagnosisTreatment,
                      setDiagnosisTreatment,
                    ],
                    ['prevention', 'これからの対策', '今後の対応', prevention, setPrevention],
                  ] as const
                ).map(([id, label, formal, value, setter]) => (
                  <div key={id}>
                    <FieldLabel htmlFor={id} formal={formal}>
                      {label}
                    </FieldLabel>
                    <textarea
                      id={id}
                      value={value}
                      onChange={(e) => setter(e.target.value)}
                      rows={3}
                      className={TEXTAREA_CLASS}
                    />
                  </div>
                ))}
              </Section>

              {visitCompleteSection}
            </>
          )}
        </div>

        {/* 主ボタンは下に固定し、1モーダルに青は1つだけ。取り消しは左・グレー、進むは右・青。
            AIの結果がまだ無いうちは「AIに書いてもらう」、出たら「保存する」に切りかわる。 */}
        {/* 主ボタンは横に割らず全幅にする。「閉じる」と横並びにすると、狭い端末では
            「✨ AIに日報を書いてもらう」が2行に折り返して読みにくい。閉じる導線は
            ヘッダーの「✕ 閉じる」と、このバーの下段の両方に残してある。 */}
        <StickyActionBar>
          <div className="space-y-2">
            {mode === 'daily' ? (
              <Button
                variant="primary"
                fullWidth
                className="px-2"
                onClick={dailyResultVisible ? handleSaveDaily : handleGenerateDaily}
                disabled={
                  dailyResultVisible
                    ? savingDaily || !customerQuery.data
                    : generatingDaily || !memoText.trim()
                }
              >
                {dailyMainLabel}
              </Button>
            ) : (
              <Button
                variant="primary"
                fullWidth
                className="px-2"
                onClick={hasAccidentDraft ? handleSaveAccident : handleGenerateAccident}
                disabled={hasAccidentDraft ? savingAccident : generatingAccident || !accidentMemo.trim()}
              >
                {accidentMainLabel}
              </Button>
            )}
            <Button variant="subtle" size="sub" fullWidth onClick={onClose}>
              閉じる
            </Button>
          </div>
        </StickyActionBar>
      </div>

      {hintType && <AssessmentHintModal type={hintType} onClose={() => setHintType(null)} />}
      {writingHint && (
        <WritingHintModal
          title={writingHint.title}
          content={writingHint.content}
          onClose={() => setWritingHint(null)}
        />
      )}
    </div>
  );
}
