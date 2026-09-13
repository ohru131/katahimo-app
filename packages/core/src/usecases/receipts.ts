import { randomUUID } from 'node:crypto';
import {
  addBusinessDays,
  buildReceiptDedupeKey,
  buildReceiptNotificationText,
  canCheckReceiptDuplicate,
  computeReceiptAmount,
  formatJstDateKey,
  formatJstDateTime,
  jstMonthRange,
  normalizeAmount,
  normalizeText,
  parseJstTimestampString,
} from '../domain';
import { buildMirrorIdempotencyKey } from '../domain/mirror/idempotencyKey';
import type { MirrorPort } from '../ports/mirror';
import type { NotifierPort } from '../ports/notifier';
import type {
  CustomerRepositoryPort,
  ReceiptBillingType,
  ReceiptRepositoryPort,
  StaffRepositoryPort,
} from '../ports/repositories';
import type { StoragePort } from '../ports/storage';
import type { UnitOfWorkPort } from '../ports/unitOfWork';

export interface ReceiptDeps {
  receipts: ReceiptRepositoryPort;
  staff: StaffRepositoryPort;
  customers: CustomerRepositoryPort;
  storage: StoragePort;
  notifier: NotifierPort;
  /** 領収書ログシート+Driveフォルダへのミラー書き込み要求をoutboxに積む(Phase 5)。 */
  mirror: MirrorPort;
  /** 領収書レコードの作成とミラー要求のenqueueを、1つのトランザクションにまとめるために使う。 */
  unitOfWork: UnitOfWorkPort;
}

export interface ReceiptImageInput {
  /** data URL('data:image/jpeg;base64,...')。GAS版processReceiptImagesの base64Data と同じ。 */
  data: string;
  amount?: string | number | null;
  storeName?: string | null;
  /** OCRで取得した領収書日時('yyyy/MM/dd HH:mm'等)。無ければfallbackTimestampを使う。 */
  receiptDate?: string | null;
  /**
   * 請求区分(doc/14 §10)。領収書1枚ごとに選べる(同じ訪問でも顧客請求分/会社立替分が
   * 混在しうるため)。未指定ならcompany_expense(取りこぼしが「うっかり顧客に請求してしまう」
   * 向きに転ばないようにするための既定値。receipts.tsのコメントと同じ理由)。
   */
  billingType?: ReceiptBillingType;
}

export interface UploadReceiptsInput {
  staffId: string;
  customerId: string | null;
  images: ReceiptImageInput[];
  /** 'yyyy/MM/dd HH:mm:ss'。各画像にreceiptDateが無い場合のフォールバック時刻。 */
  fallbackTimestamp: string;
  handoffText?: string;
}

export interface ReceiptDuplicateInfo {
  index: number;
  timestamp: string;
  amount: string;
  storeName: string;
}

export interface UploadReceiptsResult {
  success: boolean;
  message: string;
  uploadedCount: number;
  duplicateCount: number;
  duplicates: ReceiptDuplicateInfo[];
}

/**
 * PostgreSQLの一意制約違反(SQLSTATE 23505)かどうかを判定する。
 * `receipts_tenant_dedupe_key_uidx`との競合(同時アップロードのすり抜け)を、
 * それ以外のDBエラーと区別して握りつぶすために使う。エラーの形はドライバ依存
 * (postgres-js/PGliteはトップレベルまたはcauseに`code`を持つ)なので、両方見た上で
 * メッセージによるフォールバック判定も行う。
 */
function isUniqueViolation(error: unknown): boolean {
  const candidates = [error, error instanceof Error ? error.cause : undefined];
  return candidates.some((candidate) => {
    if (!candidate || typeof candidate !== 'object') return false;
    if ('code' in candidate && (candidate as { code?: unknown }).code === '23505') return true;
    return (
      candidate instanceof Error &&
      candidate.message.includes('duplicate key value violates unique constraint')
    );
  });
}

function decodeDataUrl(dataUrl: string): { contentType: string; bytes: Uint8Array } | null {
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex < 0) return null;
  const header = dataUrl.slice(0, commaIndex);
  const base64Body = dataUrl.slice(commaIndex + 1);
  if (!base64Body) return null;
  const match = /^data:(.*?);base64$/.exec(header);
  const contentType = match?.[1] || 'image/jpeg';
  return { contentType, bytes: new Uint8Array(Buffer.from(base64Body, 'base64')) };
}

/**
 * 領収書画像をアップロードする。GAS版Main.jsのprocessReceiptImages/uploadReceiptsOnlyに対応。
 * 「スタッフ・顧客・日時・金額・店舗名」が全て一致するものは重複判定キー(receipts.dedupe_key)の
 * 等値一致で検出し登録をブロックする(金額または店舗名が未入力の画像は判定対象外。GAS版canCheckDuplicateと同じ)。
 * 登録成功が1件以上あればGoogle Chatへ通知する。
 */
export async function uploadReceipts(
  deps: ReceiptDeps,
  tenantId: string,
  input: UploadReceiptsInput,
): Promise<UploadReceiptsResult> {
  if (!input.images || input.images.length === 0) {
    return {
      success: false,
      message: '領収書画像がありません。',
      uploadedCount: 0,
      duplicateCount: 0,
      duplicates: [],
    };
  }

  // DB制約(receipts_billable_requires_customer)に落として23514で失敗させるより先に、
  // ここで弾いて分かりやすいエラーにする(顧客未選択なのに顧客請求は画面側でも選べない
  // ようにしているため、ここに来るのは利用者の入力ミスではなく実装・呼び出し側の誤り)。
  if (!input.customerId && input.images.some((img) => img.billingType === 'customer_billable')) {
    throw new Error('顧客に紐付かない領収書は「顧客に請求」にできません');
  }

  const perImage = input.images.map((img, index) => {
    const timestamp = normalizeText(img.receiptDate) || input.fallbackTimestamp;
    const canCheck = canCheckReceiptDuplicate({ amount: img.amount, storeName: img.storeName });
    const dedupeKey = canCheck
      ? buildReceiptDedupeKey({
          timestamp,
          staffId: input.staffId,
          customerId: input.customerId ?? '',
          amount: img.amount,
          storeName: img.storeName,
        })
      : null;
    return { index, img, timestamp, dedupeKey };
  });

  const candidateKeys = perImage.map((p) => p.dedupeKey).filter((v): v is string => v !== null);
  const existing =
    candidateKeys.length > 0
      ? await deps.receipts.findExistingDedupeKeys(tenantId, candidateKeys)
      : new Set<string>();

  const duplicates: ReceiptDuplicateInfo[] = [];
  const registeredImages: { amount: string; storeName: string }[] = [];
  let uploadedCount = 0;

  for (const p of perImage) {
    if (p.dedupeKey && existing.has(p.dedupeKey)) {
      duplicates.push({
        index: p.index,
        timestamp: p.timestamp,
        amount: normalizeAmount(p.img.amount),
        storeName: normalizeText(p.img.storeName),
      });
      continue;
    }

    const decoded = decodeDataUrl(p.img.data);
    if (!decoded) continue;

    const fileKey = `${tenantId}/receipts/${randomUUID()}.jpg`;
    await deps.storage.put(fileKey, decoded.contentType, decoded.bytes);

    // 金額・店舗名・申し送りは正規化済みの平文で保存する(未入力はnull)。
    // amountYen/amountRawの組み立てはdedupeKey(上でp.dedupeKeyとして計算済み)とは独立に行う
    // (doc/14 §1。amountYenをdedupeKeyの材料に使い替えてはいけない)。
    const { amountYen, amountRaw } = computeReceiptAmount(p.img.amount);
    const storeName = p.img.storeName ? normalizeText(p.img.storeName) || null : null;
    const handoffText = input.handoffText?.trim() || null;
    const billingType: ReceiptBillingType = p.img.billingType ?? 'company_expense';

    // 行の作成とミラー要求のenqueueは1つのトランザクションで確定させる(片方だけ確定すると
    // 領収書がスプレッドシートに永久に現れない)。画像はオブジェクトストレージ側なので
    // トランザクションには入らない。ロールバックした場合は置いたファイルを消して揃える。
    try {
      await deps.unitOfWork.run(tenantId, async (scope) => {
        const receiptRecord = await deps.receipts.create(
          {
            tenantId,
            staffId: input.staffId,
            customerId: input.customerId,
            receiptTimestamp: parseJstTimestampString(p.timestamp),
            dedupeKey: p.dedupeKey,
            amountYen,
            amountRaw,
            storeName,
            handoffText,
            fileKey,
            contentType: decoded.contentType,
            billingType,
          },
          scope,
        );
        await deps.mirror.enqueue(
          {
            tenantId,
            kind: 'receipt',
            targetId: receiptRecord.id,
            idempotencyKey: buildMirrorIdempotencyKey('receipt', receiptRecord.id, receiptRecord.createdAt),
          },
          scope,
        );
      });
    } catch (error) {
      await deps.storage.delete(fileKey).catch(() => undefined);
      if (isUniqueViolation(error)) {
        // findExistingDedupeKeys()をすり抜けて同時に登録された同一領収書。DB側の一意
        // インデックスで検出できたので、通常の重複と同じ扱いにして処理を続ける。
        duplicates.push({
          index: p.index,
          timestamp: p.timestamp,
          amount: normalizeAmount(p.img.amount),
          storeName: normalizeText(p.img.storeName),
        });
        continue;
      }
      throw error;
    }

    // バッチ内の後続画像が同じ内容なら重複として検出できるよう、今回登録した分もexistingに加える。
    if (p.dedupeKey) existing.add(p.dedupeKey);

    registeredImages.push({
      amount: normalizeText(String(p.img.amount ?? '')),
      storeName: normalizeText(p.img.storeName),
    });
    uploadedCount++;
  }

  let message = `領収書を${uploadedCount}件アップロードしました`;
  if (duplicates.length > 0) message += `(重複${duplicates.length}件は登録しませんでした)`;

  if (uploadedCount > 0) {
    const staffRecord = await deps.staff.findById(tenantId, input.staffId);
    const staffName = staffRecord ? staffRecord.name : '不明';
    const customerRecord = input.customerId
      ? await deps.customers.findById(tenantId, input.customerId)
      : null;
    const customerName = customerRecord ? customerRecord.name : null;

    const notificationText = buildReceiptNotificationText({
      staffName,
      customerName,
      receiptTimestamp: input.fallbackTimestamp,
      registeredImages,
      handoffText: input.handoffText || '',
    });
    await deps.notifier.notify(tenantId, 'receipt', notificationText);
  }

  return { success: true, message, uploadedCount, duplicateCount: duplicates.length, duplicates };
}

// ──────────────────────────────────────────────────────────────────────────
// 登録済み領収書の一覧と取り消し(doc/14 §10)
//
// 領収書は登録するだけで見返す画面が無く、金額の読み違い・顧客の紐付け間違いに気付いても
// 直す手段が無かった。
//
// 【編集ではなく取り消しにする理由】
// 領収書は会計の記録なので、金額や紐付け先を後から書き換えられる形にしない
// (いつ誰がいくらに変えたのかが残らない)。訂正は「取り消して登録し直す」の一択にし、
// 取り消した行も一覧にグレーで残す。スタッフから見た使い勝手は「消せる」のと変わらないが、
// 消えた履歴が残らない状態にはならない。
// ──────────────────────────────────────────────────────────────────────────

/** 領収書一覧の1件。顧客名は表示用にcustomersから引き直す(領収書側には複製しない)。 */
export interface ReceiptListItemView {
  id: string;
  /** 'yyyy/MM/dd HH:mm'(JST)。 */
  receiptTimestamp: string;
  /** 金額(円)。OCRが数値化できなかった場合はnull(amountRawを見せる)。 */
  amountYen: number | null;
  /** OCRが返した金額の生文字列。金額の欄が空のときに何が読めていたのかを示す。 */
  amountRaw: string | null;
  storeName: string | null;
  handoffText: string | null;
  customerId: string | null;
  /** 顧客名。顧客に紐付かない経費領収書(駐車場代等)はnull。 */
  customerName: string | null;
  billingType: ReceiptBillingType;
  /** 取り消し済みなら'yyyy/MM/dd HH:mm'(JST)。有効な行はnull。 */
  cancelledAt: string | null;
  /** 取り消しの理由(任意入力)。 */
  cancellationReason: string | null;
  /** 取り消した人の氏名。 */
  cancelledByStaffName: string | null;
  /**
   * いま取り消せるか。取り消せるのは有効な行のうち、領収書の日付+2営業日までの分
   * (canCancelReceiptOn)。画面はこれがfalseなら取消ボタンを出さない。
   */
  canCancel: boolean;
}

export interface ReceiptListView {
  /** 'YYYY-MM'。 */
  yearMonth: string;
  receipts: ReceiptListItemView[];
  /** 顧客に請求する分の合計(円)。取り消し済みとamountYenがnullの行は数えない。 */
  customerBillableTotalYen: number;
  /** 会社が立て替える分の合計(円)。同上。 */
  companyExpenseTotalYen: number;
  /**
   * 金額を数値にできていない領収書の件数(取り消し済みを除く)。合計は「読めた分だけ」の
   * 値なので、何件が合計から漏れているかを画面に出せるようにする。
   */
  unreadableAmountCount: number;
  /** 取り消し済みの件数。一覧には残るが集計には入らないことを画面で示すために返す。 */
  cancelledCount: number;
}

/**
 * その領収書を`today`('YYYY-MM-DD'・JST)の時点で取り消せるか(doc/14 §10)。
 *
 * 期限は「領収書の日付 + 2営業日」の終わりまで。締めたあとの月の記録が動くと会計が合わなく
 * なるため、時間が経ったものは取り消せない。判定の基準日は receipt_timestamp の日付にしている
 * (領収書には訪問日そのものを持っていない。OCRが読んだ領収書の日付、読めなければ登録時刻)。
 */
export function canCancelReceiptOn(receiptDateStr: string, today: string): boolean {
  return today <= addBusinessDays(receiptDateStr, CANCELLABLE_BUSINESS_DAYS);
}

/** 取り消せる期間(営業日)。 */
const CANCELLABLE_BUSINESS_DAYS = 2;

/**
 * 指定スタッフが登録した領収書を月単位で返す(勤怠タブの領収書一覧)。
 *
 * 取り消し済みの行も返す(一覧にグレーで残す仕様のため)。ただし合計には入れない。
 * 氏名はN+1にならないよう、一覧に出てくる顧客ID・スタッフIDの重複を畳んでから引く。
 */
export async function listReceiptsForStaff(
  deps: ReceiptDeps,
  tenantId: string,
  staffId: string,
  yearMonth: string,
  today: Date = new Date(),
): Promise<ReceiptListView | null> {
  const range = jstMonthRange(yearMonth);
  if (!range) return null;

  const records = await deps.receipts.listByStaffInPeriod(tenantId, staffId, range.from, range.to);

  const customerIds = Array.from(
    new Set(records.map((r) => r.customerId).filter((id): id is string => id !== null)),
  );
  const customerNameById = new Map<string, string>();
  await Promise.all(
    customerIds.map(async (customerId) => {
      const customer = await deps.customers.findById(tenantId, customerId);
      if (customer) customerNameById.set(customerId, customer.name);
    }),
  );

  const cancelledByIds = Array.from(
    new Set(records.map((r) => r.cancelledByStaffId).filter((id): id is string => id !== null)),
  );
  const staffNameById = new Map<string, string>();
  await Promise.all(
    cancelledByIds.map(async (id) => {
      const record = await deps.staff.findById(tenantId, id);
      if (record) staffNameById.set(id, record.name);
    }),
  );

  const todayKey = formatJstDateKey(today);
  let customerBillableTotalYen = 0;
  let companyExpenseTotalYen = 0;
  let unreadableAmountCount = 0;
  let cancelledCount = 0;
  for (const record of records) {
    // 取り消し済みは集計から外す(「データ出力時は取消済みを除外する」と同じ扱い)。
    if (record.cancelledAt !== null) {
      cancelledCount += 1;
      continue;
    }
    if (record.amountYen === null) {
      unreadableAmountCount += 1;
      continue;
    }
    if (record.billingType === 'customer_billable') customerBillableTotalYen += record.amountYen;
    else companyExpenseTotalYen += record.amountYen;
  }

  return {
    yearMonth,
    receipts: records.map((record) => ({
      id: record.id,
      receiptTimestamp: formatJstDateTime(record.receiptTimestamp),
      amountYen: record.amountYen,
      amountRaw: record.amountRaw,
      storeName: record.storeName,
      handoffText: record.handoffText,
      customerId: record.customerId,
      customerName: record.customerId ? (customerNameById.get(record.customerId) ?? null) : null,
      billingType: record.billingType,
      cancelledAt: record.cancelledAt ? formatJstDateTime(record.cancelledAt) : null,
      cancellationReason: record.cancellationReason,
      cancelledByStaffName: record.cancelledByStaffId
        ? (staffNameById.get(record.cancelledByStaffId) ?? null)
        : null,
      canCancel:
        record.cancelledAt === null &&
        canCancelReceiptOn(formatJstDateKey(record.receiptTimestamp), todayKey),
    })),
    customerBillableTotalYen,
    companyExpenseTotalYen,
    unreadableAmountCount,
    cancelledCount,
  };
}

export type CancelReceiptResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'forbidden' | 'already_cancelled' | 'deadline_passed' };

/**
 * 領収書を取り消す(論理削除。doc/14 §10)。行は消さず cancelled_at を立てるだけ。
 *
 * 【他人の領収書を取り消せないようにする場所】
 * RLSはテナントまでしか絞らないため、同じテナントの別スタッフの領収書IDを指定すれば
 * 届いてしまう。requesterStaffIdと突き合わせてここで弾く(管理者は対象スタッフを
 * 切り替えて扱えるよう、呼び出し側=APIルートがallowOtherStaffを立てる)。
 *
 * 【期限をサーバー側でも見る理由】
 * 画面は期限切れの行に取消ボタンを出さないが、APIを直接叩けば通ってしまう。締めた月の
 * 会計が動く操作なので、画面の出し分けだけに頼らない。
 */
export async function cancelReceipt(
  deps: ReceiptDeps,
  tenantId: string,
  receiptId: string,
  options: {
    requesterStaffId: string;
    allowOtherStaff: boolean;
    /** 任意の1行。未入力はnull。 */
    reason: string | null;
    today?: Date;
  },
): Promise<CancelReceiptResult> {
  const record = await deps.receipts.findById(tenantId, receiptId);
  if (!record) return { ok: false, reason: 'not_found' };
  if (!options.allowOtherStaff && record.staffId !== options.requesterStaffId) {
    return { ok: false, reason: 'forbidden' };
  }
  // 二重取り消しは、取り消した人・理由・時刻を上書きしてしまうので弾く。
  if (record.cancelledAt !== null) return { ok: false, reason: 'already_cancelled' };

  const todayKey = formatJstDateKey(options.today ?? new Date());
  if (!canCancelReceiptOn(formatJstDateKey(record.receiptTimestamp), todayKey)) {
    return { ok: false, reason: 'deadline_passed' };
  }

  const cancelled = await deps.receipts.cancel(tenantId, receiptId, {
    cancelledByStaffId: options.requesterStaffId,
    reason: options.reason?.trim() ? options.reason.trim() : null,
  });
  if (!cancelled) return { ok: false, reason: 'not_found' };
  return { ok: true };
}

/**
 * 領収書画像の実体を返す(一覧から現物を確認するため)。
 *
 * 金額・店舗名はOCRが読めないことがあり、その場合は行に何も出ない。どの領収書を取り消して
 * いるのかを確かめる手段が無いと取り消しの判断ができないため、画像を出せるようにする。
 * 閲覧可否の判定はcancelReceiptと同じ規則にする。
 */
export async function getReceiptImage(
  deps: ReceiptDeps,
  tenantId: string,
  receiptId: string,
  options: { requesterStaffId: string; allowOtherStaff: boolean },
): Promise<{ body: Uint8Array; contentType: string } | null> {
  const record = await deps.receipts.findById(tenantId, receiptId);
  if (!record) return null;
  if (!options.allowOtherStaff && record.staffId !== options.requesterStaffId) return null;

  const body = await deps.storage.get(record.fileKey);
  if (!body) return null;
  return { body, contentType: record.contentType };
}
