import {
  INVOICE_LINE_KINDS,
  INVOICE_STATUSES,
  PAYMENT_CURRENCIES,
  PAYMENT_METHOD_KINDS,
  PAYMENT_STATUSES,
} from '@katahimo/shared';
import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { TENANT_RLS_USING } from './_rls';
import { sqlInList } from './_sqlLiteral';
import { couponRedemptions } from './coupons';
import { customers } from './customers';
import { dailyReports } from './dailyReports';
import { receipts } from './receipts';
import { tenants } from './tenants';

/**
 * 顧客のStripe上の識別子。エンドユーザ(顧客)がカード等で支払えるようにするために持つ。
 *
 * 【customers に列を足さず別テーブルにする理由】
 * - Stripeは本番環境とテスト環境で顧客IDが別物になる。顧客テーブルに1本だけ列を持つと、
 *   テスト用IDで上書きして本番の紐付けを失う事故が起きる(このテーブルなら
 *   環境ごとの行を足す形に拡張できる)。
 * - 決済を使わないテナントでは1行も作られない。顧客テーブルを常にNULLで埋めずに済む。
 * - customers はRESERVA CSVの再取込で列を上書きする対象であり、そこに決済の紐付けを
 *   混ぜると取込のたびに消える危険がある。
 *
 * 【カード番号を保存しない】
 * 保持するのはStripeが返す識別子と、画面表示用のブランド名・下4桁だけ。
 * カード番号・有効期限・セキュリティコードは受け取らず保存もしない(PCI DSSの適用範囲を
 * 広げないため。決済フォームはStripeが提供するものを使う)。
 */
export const customerPaymentProfiles = pgTable(
  'customer_payment_profiles',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    customerId: uuid().notNull(),

    /** Stripe の Customer ID(例 'cus_...')。 */
    stripeCustomerId: text().notNull(),
    /** 既定の支払方法のID(例 'pm_...')。未登録はnull。 */
    defaultPaymentMethodId: text(),
    /** 画面表示用。'visa' 等。Stripeが返す値をそのまま入れる。 */
    defaultPaymentMethodBrand: text(),
    /** 画面表示用のカード下4桁。数字4文字のみ。 */
    defaultPaymentMethodLast4: text(),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    foreignKey({
      name: 'customer_payment_profiles_tenant_customer_fk',
      columns: [t.tenantId, t.customerId],
      foreignColumns: [customers.tenantId, customers.id],
    }),
    // 1顧客1プロフィール。2行あると「どちらのStripe顧客に請求するか」が決まらない。
    unique('customer_payment_profiles_tenant_customer_uk').on(t.tenantId, t.customerId),
    // Stripe顧客IDから自テナントの顧客を逆引きする(Webhook受信時の突き合わせ)ための一意制約。
    unique('customer_payment_profiles_tenant_stripe_customer_uk').on(t.tenantId, t.stripeCustomerId),
    // 下4桁は数字4文字。桁数を縛らないと、うっかり全桁を入れても気付けない。
    check(
      'customer_payment_profiles_last4_check',
      sql`${t.defaultPaymentMethodLast4} IS NULL OR ${t.defaultPaymentMethodLast4} ~ '^[0-9]{4}$'`,
    ),
  ],
).enableRLS();

/**
 * 請求書。1顧客・1請求期間につき1枚。
 *
 * 【金額を全て「円の整数」で持つ理由】
 * 領収書の金額(doc/14 §1)と同じ。numeric や double にすると、丸め方の違いで
 * 請求額と入金額が1円合わない事故が起きる。円未満の端数は税計算の時点で丸め、
 * DBには丸め後の整数だけを入れる。
 *
 * 【合計を保存し、かつCHECK制約で内訳と一致させる理由】
 * 合計は明細から計算できるが、請求書は「送付した時点の金額」が確定値であり、
 * 明細の追加・修正で過去の請求額が動いてはいけない。一方で内訳と合計がズレた行は
 * 読めないため、subtotal - discount + tax = total をDBで強制する。
 * (明細の合計と subtotal が一致しているかは1行のCHECKでは書けないため、
 *  請求書を確定する usecase 側で確認する。)
 */
export const invoices = pgTable(
  'invoices',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    customerId: uuid().notNull(),

    /** 請求書番号(テナント内で一意。'2026-0001' 等の運用上の採番)。 */
    invoiceNo: text().notNull(),
    status: text().notNull().default('draft'),

    /** 請求対象期間(月締めなら月初〜月末)。 */
    billingPeriodStart: date().notNull(),
    billingPeriodEnd: date().notNull(),

    /** 明細の小計(割引前・税抜)。 */
    subtotalYen: integer().notNull().default(0),
    /** 割引額(正の数で持つ。合計からは引く)。 */
    discountYen: integer().notNull().default(0),
    /** 消費税額。 */
    taxYen: integer().notNull().default(0),
    /** 請求総額。subtotal - discount + tax と一致する(CHECK制約)。 */
    totalYen: integer().notNull().default(0),

    dueDate: date(),
    /** 確定・送付した時刻。draftの間はnull。 */
    issuedAt: timestamp({ withTimezone: true }),
    paidAt: timestamp({ withTimezone: true }),
    voidedAt: timestamp({ withTimezone: true }),

    /** Stripe側の請求書ID(Stripeに請求書を作らせる運用の場合)。 */
    stripeInvoiceId: text(),
    note: text().notNull().default(''),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    foreignKey({
      name: 'invoices_tenant_customer_fk',
      columns: [t.tenantId, t.customerId],
      foreignColumns: [customers.tenantId, customers.id],
    }),
    unique('invoices_tenant_invoice_no_uk').on(t.tenantId, t.invoiceNo),
    // invoice_lines / payments からの複合FKの参照先。
    unique('invoices_tenant_id_uk').on(t.tenantId, t.id),
    uniqueIndex('invoices_tenant_stripe_invoice_uidx')
      .on(t.tenantId, t.stripeInvoiceId)
      .where(sql`${t.stripeInvoiceId} IS NOT NULL`),
    check('invoices_status_check', sql`${t.status} IN ${sqlInList(INVOICE_STATUSES)}`),
    check('invoices_period_order_check', sql`${t.billingPeriodEnd} >= ${t.billingPeriodStart}`),
    check(
      'invoices_amount_nonneg_check',
      sql`${t.subtotalYen} >= 0 AND ${t.discountYen} >= 0 AND ${t.taxYen} >= 0 AND ${t.totalYen} >= 0`,
    ),
    // 内訳と合計の一致。ここがズレた行は、請求書としてもどの数字が正か分からない。
    check(
      'invoices_total_consistency_check',
      sql`${t.totalYen} = ${t.subtotalYen} - ${t.discountYen} + ${t.taxYen}`,
    ),
    // 状態とタイムスタンプの整合(reservations と同じ考え方)。
    // draft 以外は必ず確定時刻を持つ(確定していない請求書を送れてしまわないように)。
    check('invoices_issued_at_check', sql`(${t.status} = 'draft') = (${t.issuedAt} IS NULL)`),
    check('invoices_paid_at_check', sql`(${t.status} = 'paid') = (${t.paidAt} IS NOT NULL)`),
    check('invoices_voided_at_check', sql`(${t.status} = 'void') = (${t.voidedAt} IS NOT NULL)`),
    // 「この顧客の請求履歴を新しい順に」用。
    index('invoices_tenant_customer_period_idx').on(t.tenantId, t.customerId, t.billingPeriodStart.desc()),
    // 「未入金の請求書」の抽出用。対象行が少ないので部分索引にする。
    index('invoices_tenant_open_idx').on(t.tenantId, t.dueDate).where(sql`${t.status} = 'open'`),
  ],
).enableRLS();

/**
 * 請求明細。「どの業務データから起こした金額か」を必ず持たせる。
 *
 * 【元データへの参照を持つ理由】
 * 請求額の問い合わせに対して「この行はどの訪問(日報)・どの領収書・どのクーポンの分か」を
 * 即答できるようにするため。金額だけを持つ明細は、後から根拠を辿れず、二重請求の検出も
 * できない(同じ領収書を2枚の請求書に載せてしまう)。
 *
 * 【quantity を numeric にする理由】
 * サービス提供分は「1.5時間」のように小数の数量になる。金額(円)は整数のままで、
 * 数量だけ小数を許す。amount_yen は quantity × unit_price_yen を丸めた結果を入れる
 * (丸めた値を保存し、DB側では再計算しない。CHECK制約で掛け算を強制すると、
 *  丸め規則をSQLとアプリの2箇所に書くことになり必ず食い違う)。
 */
export const invoiceLines = pgTable(
  'invoice_lines',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    invoiceId: uuid().notNull(),

    /** 請求書内での表示順(1から)。 */
    lineNo: integer().notNull(),
    kind: text().notNull(),
    description: text().notNull(),
    /** 数量(時間数・個数)。 */
    quantity: numeric({ precision: 10, scale: 2 }).notNull().default('1'),
    /** 単価(円)。実費や調整では null。 */
    unitPriceYen: integer(),
    /** この明細の金額(円)。割引明細(coupon_discount)は負の数。 */
    amountYen: integer().notNull(),

    /** 元データ: サービス提供分の根拠になった日報。 */
    dailyReportId: uuid(),
    /** 元データ: 顧客に請求する立替の領収書。 */
    receiptId: uuid(),
    /** 元データ: 適用したクーポン。 */
    couponRedemptionId: uuid(),

    /**
     * この明細を無効にした時刻。nullなら有効。
     *
     * 【必要な理由】
     * 下の二重請求防止の一意索引を「有効な明細だけ」に限定するために持つ。これが無いと、
     * 誤請求を void して作り直す運用が成立しない: void した請求書の明細も領収書
     * (receipt_id)を掴んだままなので、同じ領収書を新しい請求書に載せた瞬間に
     * 23505 で弾かれる。一方で索引の条件には別テーブル(invoices.status)を書けないため、
     * 「有効かどうか」を明細側に持たせる必要がある。
     *
     * 【invoices.status と二重管理にならないようにする責任の置き場所】
     * 請求書を void にする操作は必ず「invoices の更新 + その明細への superseded_at 設定」を
     * 同一トランザクションで行う(usecase の責務)。DBのCHECK制約では別テーブルの状態を
     * 参照できないため、ここはトリガーを増やすよりも「voidする経路が1つしかない」ことで
     * 担保する。索引が守る不変条件(「1つの領収書は有効な明細1つにしか載らない」)自体は
     * DB側で保証される。
     */
    supersededAt: timestamp({ withTimezone: true }),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    foreignKey({
      name: 'invoice_lines_tenant_invoice_fk',
      columns: [t.tenantId, t.invoiceId],
      foreignColumns: [invoices.tenantId, invoices.id],
    }),
    // 元データへの参照はいずれもnull許容。nullの行はMATCH SIMPLE(既定)によりFK制約の
    // 対象外になる(receipts.tsのcustomerIdと同じ扱い)。
    foreignKey({
      name: 'invoice_lines_tenant_daily_report_fk',
      columns: [t.tenantId, t.dailyReportId],
      foreignColumns: [dailyReports.tenantId, dailyReports.id],
    }),
    foreignKey({
      name: 'invoice_lines_tenant_receipt_fk',
      columns: [t.tenantId, t.receiptId],
      foreignColumns: [receipts.tenantId, receipts.id],
    }),
    foreignKey({
      name: 'invoice_lines_tenant_coupon_redemption_fk',
      columns: [t.tenantId, t.couponRedemptionId],
      foreignColumns: [couponRedemptions.tenantId, couponRedemptions.id],
    }),
    unique('invoice_lines_invoice_line_no_uk').on(t.tenantId, t.invoiceId, t.lineNo),
    // 同じ領収書・同じクーポン適用を2つの「有効な」明細に載せられないようにする
    // (二重請求の防止)。日報は「サービス提供分」と「移動手当」で複数明細に分かれるため
    // 一意にしない。superseded_at IS NULL を条件に含める理由は supersededAt のコメント参照
    // (void した請求書の明細が元データを掴んだままだと、作り直しができなくなる)。
    uniqueIndex('invoice_lines_tenant_receipt_uidx')
      .on(t.tenantId, t.receiptId)
      .where(sql`${t.receiptId} IS NOT NULL AND ${t.supersededAt} IS NULL`),
    uniqueIndex('invoice_lines_tenant_coupon_redemption_uidx')
      .on(t.tenantId, t.couponRedemptionId)
      .where(sql`${t.couponRedemptionId} IS NOT NULL AND ${t.supersededAt} IS NULL`),
    check('invoice_lines_kind_check', sql`${t.kind} IN ${sqlInList(INVOICE_LINE_KINDS)}`),
    check('invoice_lines_line_no_check', sql`${t.lineNo} >= 1`),
    check('invoice_lines_quantity_check', sql`${t.quantity} > 0`),
    check('invoice_lines_unit_price_check', sql`${t.unitPriceYen} IS NULL OR ${t.unitPriceYen} >= 0`),
    // 金額の符号を種別で縛る。割引が正の数で入ると請求額が増える方向に転ぶため、
    // 「割引は負、それ以外は0以上」をDBで強制する(調整だけは両方向を許す)。
    check(
      'invoice_lines_amount_sign_check',
      sql`(${t.kind} = 'coupon_discount' AND ${t.amountYen} <= 0)
        OR (${t.kind} = 'adjustment')
        OR (${t.kind} NOT IN ('coupon_discount', 'adjustment') AND ${t.amountYen} >= 0)`,
    ),
    // 種別と元データの対応。'receipt_billable' なのに領収書を指していない明細は、
    // 根拠を辿れないまま金額だけが残る。
    check(
      'invoice_lines_source_check',
      sql`(${t.kind} = 'receipt_billable' AND ${t.receiptId} IS NOT NULL)
        OR (${t.kind} = 'coupon_discount' AND ${t.couponRedemptionId} IS NOT NULL)
        OR ${t.kind} NOT IN ('receipt_billable', 'coupon_discount')`,
    ),
    index('invoice_lines_tenant_invoice_idx').on(t.tenantId, t.invoiceId, t.lineNo),
    // 「この日報はもう請求済みか」の確認用。
    index('invoice_lines_tenant_daily_report_idx')
      .on(t.tenantId, t.dailyReportId)
      .where(sql`${t.dailyReportId} IS NOT NULL`),
  ],
).enableRLS();

/**
 * 入金(決済)1件。Stripeの PaymentIntent 1件、または現地決済1件に対応する。
 *
 * 【請求書と分ける理由】
 * 1枚の請求書に対して分割入金・返金・再試行が起きるため、請求書に「入金済みか」の
 * 1列を持たせるだけでは足りない。逆に請求書を作らない都度払い(予約時に前払い)も
 * あり得るため invoice_id は null 許容にする。
 *
 * 【返金を別テーブルにしない理由】
 * 返金は「元の決済に対する部分的な打ち消し」であり、金額の上限が元の決済額で決まる。
 * 同じ行に refunded_amount_yen として持てば、CHECK制約で「元の決済額を超える返金」を
 * DBで止められる。複数回の返金の内訳が必要になった時点で明細テーブルを足す。
 */
export const payments = pgTable(
  'payments',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    customerId: uuid().notNull(),
    /** 対応する請求書。都度払いなど請求書を伴わない入金はnull。 */
    invoiceId: uuid(),

    status: text().notNull(),
    /** 決済手段。'onsite_cash' はStripeを通らない現地決済。 */
    methodKind: text().notNull(),
    /** 通貨。日本円のみ(理由は @katahimo/shared の paymentCurrencySchema 参照)。 */
    currency: text().notNull().default('jpy'),
    /** 決済額(円)。 */
    amountYen: integer().notNull(),
    /** 返金済み額(円)。全額返金なら amountYen と同じ。 */
    refundedAmountYen: integer().notNull().default(0),

    /** Stripe の PaymentIntent ID(例 'pi_...')。現地決済はnull。 */
    stripePaymentIntentId: text(),
    /** Stripe の Charge ID(例 'ch_...')。 */
    stripeChargeId: text(),
    /** 失敗時のコード(Stripeの decline_code / error code)。 */
    failureCode: text(),
    failureMessage: text(),

    /** 入金が確定した時刻。succeeded のときだけ入る。 */
    paidAt: timestamp({ withTimezone: true }),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    foreignKey({
      name: 'payments_tenant_customer_fk',
      columns: [t.tenantId, t.customerId],
      foreignColumns: [customers.tenantId, customers.id],
    }),
    foreignKey({
      name: 'payments_tenant_invoice_fk',
      columns: [t.tenantId, t.invoiceId],
      foreignColumns: [invoices.tenantId, invoices.id],
    }),
    // Stripeのリトライや重複Webhookで同じ PaymentIntent が2行にならないようにする。
    uniqueIndex('payments_tenant_stripe_payment_intent_uidx')
      .on(t.tenantId, t.stripePaymentIntentId)
      .where(sql`${t.stripePaymentIntentId} IS NOT NULL`),
    check('payments_status_check', sql`${t.status} IN ${sqlInList(PAYMENT_STATUSES)}`),
    check('payments_method_kind_check', sql`${t.methodKind} IN ${sqlInList(PAYMENT_METHOD_KINDS)}`),
    check('payments_currency_check', sql`${t.currency} IN ${sqlInList(PAYMENT_CURRENCIES)}`),
    check('payments_amount_check', sql`${t.amountYen} > 0`),
    // 返金額が決済額を超えた行は、返した金額の方が受け取った金額より多いという
    // ありえない状態。金額の集計が静かに壊れるためDBで止める。
    check(
      'payments_refunded_amount_check',
      sql`${t.refundedAmountYen} >= 0 AND ${t.refundedAmountYen} <= ${t.amountYen}`,
    ),
    check('payments_paid_at_check', sql`(${t.status} = 'succeeded') = (${t.paidAt} IS NOT NULL)`),
    // Stripe経由の決済は必ず PaymentIntent を持ち、現地決済は持たない。
    // これを縛らないと「カード決済なのにStripe上の記録が無い」行を作れてしまう。
    check(
      'payments_stripe_id_presence_check',
      sql`(${t.methodKind} = 'onsite_cash' AND ${t.stripePaymentIntentId} IS NULL)
        OR (${t.methodKind} <> 'onsite_cash' AND ${t.stripePaymentIntentId} IS NOT NULL)`,
    ),
    index('payments_tenant_customer_created_idx').on(t.tenantId, t.customerId, t.createdAt.desc()),
    index('payments_tenant_invoice_idx').on(t.tenantId, t.invoiceId).where(sql`${t.invoiceId} IS NOT NULL`),
  ],
).enableRLS();

/**
 * Stripe Webhook の受信記録。同じイベントを二度処理しないための台帳。
 *
 * 【必要な理由】
 * StripeはWebhookを「少なくとも1回」配信する仕様で、同じイベントが複数回届く。
 * 冪等化しないと、1回の決済で2行の payments ができたり、返金が二重に計上される。
 * stripe_event_id の一意制約で「既に受け取ったイベント」を弾く。
 *
 * 【テナントの決め方】
 * このテーブルもRLSで守るため tenant_id は必須。Webhookの受信口はテナントごとに
 * 分ける(URLにテナントを含める)か、イベント内の Stripe 顧客IDから
 * customer_payment_profiles を逆引きしてテナントを決める。どちらでも決められない
 * イベントは記録せず拒否する(どのテナントのものか分からないデータを、
 * どこかのテナントの中に置いてしまわないため)。
 *
 * 【payload を持つ理由】
 * 処理に失敗したイベントを、Stripeに再送を頼まずに再処理できるようにするため。
 * 生のJSONをjsonbで持つ。カード番号は含まれない(Stripeが送らない)。
 */
export const stripeWebhookEvents = pgTable(
  'stripe_webhook_events',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),

    /** Stripe のイベントID(例 'evt_...')。冪等化のキー。 */
    stripeEventId: text().notNull(),
    /** イベント種別(例 'payment_intent.succeeded')。 */
    eventType: text().notNull(),
    /** Stripe の API バージョン。仕様変更の影響範囲を後から特定するために持つ。 */
    apiVersion: text(),

    receivedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** 処理が完了した時刻。nullなら未処理(または処理中に失敗)。 */
    processedAt: timestamp({ withTimezone: true }),
    /** 処理に失敗したときのメッセージ。再処理の判断に使う。 */
    processingError: text(),
    /** 受信したイベントの生JSON。 */
    payload: jsonb().notNull(),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    // 冪等化の要。二重処理を止める最後の砦なので、部分索引ではなく無条件の一意制約にする。
    unique('stripe_webhook_events_tenant_event_uk').on(t.tenantId, t.stripeEventId),
    // 中身の形はStripe側の仕様で決まるためCHECKで縛らないが、配列やスカラーが入ると
    // 読み出し側が壊れるのでオブジェクトであることだけ保証する
    // (attendance_days.row_data と同じ考え方)。
    check('stripe_webhook_events_payload_object_check', sql`jsonb_typeof(${t.payload}) = 'object'`),
    // 未処理・失敗したイベントの抽出用(再処理のワーカーが引く)。
    index('stripe_webhook_events_tenant_unprocessed_idx')
      .on(t.tenantId, t.receivedAt)
      .where(sql`${t.processedAt} IS NULL`),
  ],
).enableRLS();
