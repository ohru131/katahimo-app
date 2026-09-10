import { randomUUID } from 'node:crypto';
import {
  buildReceiptDedupeKey,
  buildReceiptNotificationText,
  canCheckReceiptDuplicate,
  normalizeAmount,
  normalizeText,
  parseJstTimestampString,
} from '../domain';
import { buildMirrorIdempotencyKey } from '../domain/mirror/idempotencyKey';
import type { MirrorPort } from '../ports/mirror';
import type { NotifierPort } from '../ports/notifier';
import type {
  CustomerRepositoryPort,
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
    const amount =
      p.img.amount !== undefined && p.img.amount !== null && p.img.amount !== ''
        ? normalizeAmount(p.img.amount) || null
        : null;
    const storeName = p.img.storeName ? normalizeText(p.img.storeName) || null : null;
    const handoffText = input.handoffText?.trim() || null;

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
            amount,
            storeName,
            handoffText,
            fileKey,
            contentType: decoded.contentType,
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
