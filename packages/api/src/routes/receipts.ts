import {
  cancelReceipt,
  extractReceiptAmount,
  getReceiptImage,
  listReceiptsForStaff,
  uploadReceipts,
} from '@katahimo/core';
import { formatJstDateTime } from '@katahimo/core/domain';
import { RECEIPT_BILLING_TYPES, type ReceiptBillingType } from '@katahimo/core/ports';
import { idSchema } from '@katahimo/shared';
import { Hono } from 'hono';
import type { Container } from '../container';
import { getAuthenticatedSession, resolveReportTargetStaffId } from '../session';

/**
 * billingTypeの値域検証。「文字列かどうか」ではなく「許可された2値かどうか」で判定する
 * (RECEIPT_BILLING_TYPESはDBのCHECK制約・画面と共有しているので、ここがズレるとDB制約
 * 違反(23514)という分かりにくいエラーで初めて気付く形になる)。
 */
function isReceiptBillingType(value: unknown): value is ReceiptBillingType {
  return (RECEIPT_BILLING_TYPES as readonly unknown[]).includes(value);
}

/** 取消理由(任意の1行)の上限。 */
const MAX_CANCELLATION_REASON_LENGTH = 200;

/**
 * パスパラメータのUUIDを検証する。uuid列との比較にUUID以外の文字列を渡すと、PostgreSQLが
 * `invalid input syntax for type uuid` を投げて500になる。入力の形の誤りは400で返す。
 */
function parsePathId(value: string): string | null {
  const parsed = idSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function createReceiptRoutes(container: Container) {
  const app = new Hono();

  /**
   * 勤怠タブの領収書一覧。指定スタッフが登録した領収書を月単位(`yearMonth`='YYYY-MM')で返す。
   *
   * 管理者だけが `staffId` で他スタッフ分に切り替えられる(resolveReportTargetStaffIdが
   * 管理者以外の指定を常に無視して本人のstaffIdに強制する)。
   */
  app.get('/', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);

    const yearMonth = c.req.query('yearMonth') ?? '';
    const staffId = resolveReportTargetStaffId(session, c.req.query('staffId'));

    const result = await listReceiptsForStaff(container, session.tenantId, staffId, yearMonth, {
      // 管理者は期限後も取り消せる(経理の締め処理で戻すことがあるため。doc/14 §10)。
      // 一覧側でも同じ判定にしないと、取り消せるのにボタンが出ない状態になる。
      ignoreDeadline: session.isAdmin,
    });
    // jstMonthRangeが解釈できない形式のときだけnullになる。
    if (!result) {
      return c.json({ code: 'validation_failed', message: 'yearMonth はYYYY-MM形式で指定してください' }, 400);
    }
    return c.json(result);
  });

  /**
   * 領収書を取り消す(論理削除。doc/14 §10)。
   *
   * 会計の記録なので編集は用意していない。訂正は「取り消して登録し直す」の一択で、
   * 取り消した行も一覧に残る。期限(領収書の日付+2日)はここでも見る
   * (画面はボタンを出さないが、APIを直接叩けば通ってしまうため)。管理者だけは期限後も
   * 取り消せる(経理が締め処理で戻すことがあるため)。
   */
  app.post('/:id/cancel', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);

    const receiptId = parsePathId(c.req.param('id'));
    if (!receiptId) {
      return c.json({ success: false, message: 'IDの形式が不正です' }, 400);
    }

    const body = await c.req.json().catch(() => null);
    const rawReason = (body as Record<string, unknown> | null)?.reason;
    if (rawReason !== undefined && rawReason !== null && typeof rawReason !== 'string') {
      return c.json({ success: false, message: '取消理由は文字列で指定してください' }, 400);
    }
    // 1行の自由記述。長文を貼られても壊れないよう上限だけ決めておく。
    if (typeof rawReason === 'string' && rawReason.length > MAX_CANCELLATION_REASON_LENGTH) {
      return c.json(
        {
          success: false,
          message: `取消理由は${MAX_CANCELLATION_REASON_LENGTH}文字以内で入力してください`,
        },
        400,
      );
    }

    const result = await cancelReceipt(container, session.tenantId, receiptId, {
      requesterStaffId: session.staffId,
      allowOtherStaff: session.isAdmin,
      ignoreDeadline: session.isAdmin,
      reason: typeof rawReason === 'string' ? rawReason : null,
    });
    if (!result.ok) {
      // 他スタッフの領収書は「見つからない」と同じ404にする。同じテナントにそのIDが
      // 存在するかどうか自体を、権限のない相手に伝えないため。
      if (result.reason === 'not_found' || result.reason === 'forbidden') {
        return c.json({ success: false, message: '領収書が見つかりません' }, 404);
      }
      const message =
        result.reason === 'already_cancelled'
          ? 'この領収書は既に取り消されています'
          : '取り消せる期間(領収書の日付+2日)を過ぎています';
      return c.json({ success: false, message }, 400);
    }
    // 管理者が期限後に取り消したときは、既にスプレッドシートへ送られていることがある。
    // あちら側の行はこちらからは消せないので、黙って成功にせず画面へ伝える(doc/14 §10)。
    return c.json({ success: true, mirrorAlreadySent: result.mirrorAlreadySent });
  });

  /**
   * 領収書画像の実体。一覧から現物を確認するために使う(OCRが金額・店舗名を読めなかった
   * 領収書は、画像を見ないとどれなのか分からないため)。
   *
   * 画像URLを推測されても他人の領収書が見えないよう、閲覧可否はPATCHと同じ規則で判定する。
   */
  app.get('/:id/image', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);

    const receiptId = parsePathId(c.req.param('id'));
    if (!receiptId) {
      return c.json({ code: 'validation_failed', message: 'IDの形式が不正です' }, 400);
    }

    const image = await getReceiptImage(container, session.tenantId, receiptId, {
      requesterStaffId: session.staffId,
      allowOtherStaff: session.isAdmin,
    });
    if (!image) return c.json({ code: 'not_found', message: '領収書が見つかりません' }, 404);

    return c.body(image.body as unknown as ArrayBuffer, 200, {
      'Content-Type': image.contentType,
      // 領収書は個人情報を含むため、共有キャッシュには載せない。
      'Cache-Control': 'private, max-age=300',
    });
  });

  /** 領収書画像1枚から金額・店舗名・日時をOCR抽出する。GAS版extractAmountFromImage相当。 */
  app.post('/ocr', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);

    const body = await c.req.json().catch(() => null);
    if (typeof body?.image !== 'string' || !body.image) {
      return c.json({ code: 'validation_failed', message: 'image が必要です' }, 400);
    }

    const result = await extractReceiptAmount(container, session.tenantId, body.image);
    return c.json({ result });
  });

  /** 領収書画像をアップロードする。GAS版uploadReceiptsOnly相当。 */
  app.post('/', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);

    const body = await c.req.json().catch(() => null);
    if (!Array.isArray(body?.images) || body.images.length === 0) {
      return c.json({ success: false, message: '領収書画像がありません。' }, 400);
    }

    // 指定はあるが解釈できない billingType は、既定値(会社立替)に倒さず落とす。
    // 倒すと 'customer_billeable' のような綴り違いが「会社立替として保存された」という
    // 請求の誤りになり、しかもエラーが出ないので気付けない。
    const invalidBillingType = body.images.some(
      (img: unknown) =>
        typeof img === 'object' &&
        img !== null &&
        (img as Record<string, unknown>).billingType !== undefined &&
        !isReceiptBillingType((img as Record<string, unknown>).billingType),
    );
    if (invalidBillingType) {
      return c.json(
        {
          success: false,
          message: `billingType は ${RECEIPT_BILLING_TYPES.join(' / ')} のいずれかにしてください`,
        },
        400,
      );
    }

    const staffId = resolveReportTargetStaffId(session, body.staffId);
    const images = body.images
      .filter((img: unknown): img is Record<string, unknown> => typeof img === 'object' && img !== null)
      .map((img: Record<string, unknown>) => ({
        data: typeof img.data === 'string' ? img.data : '',
        amount: typeof img.amount === 'string' || typeof img.amount === 'number' ? img.amount : null,
        storeName: typeof img.storeName === 'string' ? img.storeName : null,
        receiptDate: typeof img.receiptDate === 'string' ? img.receiptDate : null,
        billingType: isReceiptBillingType(img.billingType) ? img.billingType : undefined,
      }))
      .filter((img: { data: string }) => img.data);

    if (images.length === 0) {
      return c.json({ success: false, message: '領収書画像がありません。' }, 400);
    }

    const result = await uploadReceipts(container, session.tenantId, {
      staffId,
      customerId: typeof body.customerId === 'string' && body.customerId ? body.customerId : null,
      images,
      fallbackTimestamp:
        typeof body.receiptTimestamp === 'string' && body.receiptTimestamp
          ? body.receiptTimestamp
          : formatJstDateTime(new Date()),
      handoffText: typeof body.handoffText === 'string' ? body.handoffText : '',
    });
    return c.json(result);
  });

  return app;
}
