/**
 * 日報・事故報告の未保存入力を端末に控えておく仕組み。GAS版index.htmlの
 * saveReportDraftSnapshot/restoreReportDraftIfAny の移植。
 *
 * 【なぜ要るか】
 * 訪問先でスマホから口語メモを入力し、AIに下書きを作らせてから保存する流れのため、
 * 保存に至るまでの入力が長い。その途中で電話が入る・アプリが落ちる・電池が切れると、
 * 入力が丸ごと消えて訪問の記憶から書き直しになる。保存前の内容を端末に控えておき、
 * 次にアプリを開いたときに書きかけの顧客のダイアログを開き直す。
 *
 * 【サーバーに置かない理由】
 * 控えは「まだ保存していないもの」なので、サーバーに送ると保存済みの記録と区別が付かなくなる
 * (日報は請求のもとになるため、確定していない行をDBに置きたくない)。端末内に留め、
 * 保存が成功した時点で消す。
 */

/**
 * 控えの置き場。**テナントとスタッフごとに分ける。**
 *
 * 現場ではタブレットを複数人で使い回すことがある。1つのキーを共有すると、次にログインした
 * 別のスタッフ(別テナントのこともある)の画面に前の利用者の顧客名や事故報告の内容が出てしまう。
 * キーを分けたうえで、保存した中身にも持ち主を記録し、読み出すときに今のログインと
 * 一致しないものは捨てる(キーだけの分離だと、キーを手で書き換えれば読めてしまう)。
 */
function draftKey(owner: ReportDraftOwner): string {
  return `katahimo_report_draft_v1:${owner.tenantId}:${owner.staffId}`;
}

export interface ReportDraftOwner {
  tenantId: string;
  staffId: string;
}

/** 控えの有効期限。これより古いものは、別の訪問の書きかけとして復元せず捨てる。 */
const DRAFT_TTL_MS = 3 * 24 * 60 * 60 * 1000;

export interface ReportDraftAccident {
  reportType: '事故報告' | 'ヒヤリハット';
  targetName: string;
  targetDob: string;
  occurrenceTime: string;
  location: string;
  accidentContent: string;
  situation: string;
  immediateResponse: string;
  parentCorrespondence: string;
  diagnosisTreatment: string;
  prevention: string;
}

export interface ReportDraft {
  /** 控えた人。読み出すときに今のログインと突き合わせる。 */
  owner: ReportDraftOwner;
  customerId: string;
  customerName: string;
  mode: 'daily' | 'accident';
  /** 'YYYY-MM-DD'。訪問日。 */
  visitDate: string;
  startHour: string;
  startMinute: string;
  endHour: string;
  endMinute: string;
  /** 口語メモ(生成のもと)。日報タブと事故報告タブで別々に持つ。 */
  memoText: string;
  accidentMemo: string;
  /** 生成・加筆した本文。 */
  internalText: string;
  customerText: string;
  riskRating: number | null;
  esRating: number | null;
  accident: ReportDraftAccident;
  savedAt: number;
}

/** 入力が1文字も無ければ控えを残さない(空の控えで「書きかけがあります」と出さないため)。 */
function isEmpty(draft: ReportDraft): boolean {
  const a = draft.accident;
  return (
    !draft.memoText.trim() &&
    !draft.accidentMemo.trim() &&
    !draft.internalText.trim() &&
    !draft.customerText.trim() &&
    draft.riskRating === null &&
    draft.esRating === null &&
    !a.targetName.trim() &&
    !a.occurrenceTime.trim() &&
    !a.location.trim() &&
    !a.accidentContent.trim() &&
    !a.situation.trim() &&
    !a.immediateResponse.trim() &&
    !a.parentCorrespondence.trim() &&
    !a.diagnosisTreatment.trim() &&
    !a.prevention.trim()
  );
}

export function saveReportDraft(draft: ReportDraft): void {
  try {
    if (isEmpty(draft)) {
      clearReportDraft(draft.owner);
      return;
    }
    localStorage.setItem(draftKey(draft.owner), JSON.stringify(draft));
  } catch {
    // 容量超過やプライベートモードでは控えを諦める(保存・送信そのものには影響しない)。
  }
}

export function loadReportDraft(owner: ReportDraftOwner): ReportDraft | null {
  try {
    const raw = localStorage.getItem(draftKey(owner));
    if (!raw) return null;
    const draft = JSON.parse(raw) as ReportDraft;
    if (!draft?.customerId || typeof draft.savedAt !== 'number') {
      clearReportDraft(owner);
      return null;
    }
    // キーを手で書き換えられた場合に備えて、中身の持ち主も確かめる。
    if (draft.owner?.tenantId !== owner.tenantId || draft.owner?.staffId !== owner.staffId) {
      clearReportDraft(owner);
      return null;
    }
    if (Date.now() - draft.savedAt > DRAFT_TTL_MS) {
      clearReportDraft(owner);
      return null;
    }
    return draft;
  } catch {
    clearReportDraft(owner);
    return null;
  }
}

export function clearReportDraft(owner: ReportDraftOwner): void {
  try {
    localStorage.removeItem(draftKey(owner));
  } catch {
    // 消せなくても次回の復元時に期限切れか内容不正として捨てられる。
  }
}
