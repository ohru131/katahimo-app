import { extractReceiptAmount, uploadReceipts } from '@katahimo/core';
import { formatJstDateTime } from '@katahimo/core/domain';
import { RECEIPT_BILLING_TYPES, type ReceiptBillingType } from '@katahimo/core/ports';
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

export function createReceiptRoutes(container: Container) {
  const app = new Hono();

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
