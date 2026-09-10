import { z } from 'zod';

/**
 * 請求書の状態。Stripe の Invoice status に合わせた語を使う(Stripe から届く
 * Webhook の値をそのまま突き合わせられるようにするため。独自の語にすると
 * 対応表をどこかに持つことになり、必ずズレる)。
 *
 * - 'draft'         : 下書き。金額の再計算で明細が入れ替わってよい状態
 * - 'open'          : 確定・送付済みで入金待ち
 * - 'paid'          : 入金済み
 * - 'void'          : 誤請求などで取り消した(金額を0にせず、状態で無効にする)
 * - 'uncollectible' : 回収不能として計上した
 */
export const invoiceStatusSchema = z.enum(['draft', 'open', 'paid', 'void', 'uncollectible']);
export const INVOICE_STATUSES = invoiceStatusSchema.options;
export type InvoiceStatus = z.infer<typeof invoiceStatusSchema>;

/**
 * 請求明細の種別。どの業務データから起こした明細かを表す。
 *
 * - 'service'            : サービス提供分(日報1件=1回の訪問。単価×時間)
 * - 'receipt_billable'   : 顧客に請求する立替(receipts.billing_type='customer_billable')
 * - 'transport_allowance': 移動手当・交通費の転嫁分(travel_legs 由来)
 * - 'coupon_discount'    : 割引クーポンの適用分(coupon_redemptions 由来。金額は負)
 * - 'adjustment'         : 手入力の調整(値引き・加算の両方あり得る)
 */
export const invoiceLineKindSchema = z.enum([
  'service',
  'receipt_billable',
  'transport_allowance',
  'coupon_discount',
  'adjustment',
]);
export const INVOICE_LINE_KINDS = invoiceLineKindSchema.options;
export type InvoiceLineKind = z.infer<typeof invoiceLineKindSchema>;

/**
 * 決済の状態。Stripe PaymentIntent の status に合わせる(理由は invoiceStatusSchema と同じ)。
 * 'onsite_cash' 等の現地決済はStripeを通らないが、状態は同じ語で表す
 * (succeeded で作られ、requires_action を経由しないだけ)。
 */
export const paymentStatusSchema = z.enum([
  'requires_payment_method',
  'requires_action',
  'processing',
  'succeeded',
  'canceled',
  'failed',
]);
export const PAYMENT_STATUSES = paymentStatusSchema.options;
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;

/**
 * 決済手段。Stripe経由のもの('card'/'konbini'/'bank_transfer')と、
 * Stripeを通らない現地決済('onsite_cash')を1つの列挙で扱う。
 * 現地決済も同じテーブルに入れるのは、請求書に対する入金の有無を1箇所で見られるようにするため。
 */
export const paymentMethodKindSchema = z.enum(['card', 'konbini', 'bank_transfer', 'onsite_cash']);
export const PAYMENT_METHOD_KINDS = paymentMethodKindSchema.options;
export type PaymentMethodKind = z.infer<typeof paymentMethodKindSchema>;

/**
 * 取り扱う通貨。日本円のみ。
 *
 * 列を持つ理由は「将来通貨が増えるかもしれない」ではなく、金額列が全て「円の整数」
 * (小数を持たない)という前提を、通貨と一緒に読めば明示できるようにするため。
 * 円以外を足すときは最小単位の扱い(セント等)を決め直す必要があるので、
 * CHECK制約で 'jpy' に固定しておき、勝手に増やせないようにする。
 */
export const paymentCurrencySchema = z.enum(['jpy']);
export const PAYMENT_CURRENCIES = paymentCurrencySchema.options;
export type PaymentCurrency = z.infer<typeof paymentCurrencySchema>;
