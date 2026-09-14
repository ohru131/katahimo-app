import { sql } from 'drizzle-orm';
import { check, integer, pgPolicy, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { TENANT_RLS_USING } from './_rls';
import { sqlNumber } from './_sqlLiteral';
import { tenants } from './tenants';

/**
 * 締め日に指定できる日の上限。29〜31は2月に存在しないため許さない
 * (月末で締める運用はNULLで表す)。doc/db/guidelines.md §10。
 */
export const RECEIPT_CLOSING_DAY_MAX = 28;
/** 領収書を取り消せる日数の上限。 */
export const RECEIPT_CANCELLABLE_DAYS_MAX = 14;

/**
 * テナント単位の管理者設定。GAS版のScript Properties(GEMINI_API_KEY・
 * GEMINI_MODEL_REPORT/OCR・GCHAT_REPORT_WEBHOOK_URL/GCHAT_RECEIPT_WEBHOOK_URL)に対応する、
 * マルチテナント版の置き場所(1テナント1行、tenantIdがPK)。
 *
 * 未設定の値は.env側のデフォルト(GEMINI_API_KEY等)にフォールバックする
 * (packages/api/src/container.ts参照)。GAS版と同様、APIキー・Webhook URLは
 * 空文字での保存を許さない(packages/core/src/usecases/settings.ts参照)。
 */
export const appSettings = pgTable(
  'app_settings',
  {
    tenantId: uuid()
      .primaryKey()
      .references(() => tenants.id),

    geminiApiKeyCiphertext: text(),
    geminiApiKeyKeyVersion: integer(),
    geminiReportModel: text(),
    geminiOcrModel: text(),

    gchatReportWebhookUrlCiphertext: text(),
    gchatReportWebhookUrlKeyVersion: integer(),
    gchatReceiptWebhookUrlCiphertext: text(),
    gchatReceiptWebhookUrlKeyVersion: integer(),

    /**
     * 会計の締め日(1〜28)。NULLは「月末」(doc/db/guidelines.md §10)。
     *
     * 領収書の取り消し期限がここから導かれる。テナントごとに締め日が違う(20日締めなど)
     * ため、定数ではなく設定にしている。
     */
    receiptClosingDay: integer(),
    /** 領収書を取り消せる日数(暦日)。既定2。 */
    receiptCancellableDays: integer().notNull().default(2),

    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    // 値域はDBでも縛る(doc/db/guidelines.md §1.6)。29〜31を許すと2月に存在しない締め日ができ、
    // jstDateKeyWithDayOfMonth が翌月へ繰り上げて黙って別の日を指す。
    check(
      'app_settings_receipt_closing_day_check',
      sql`${t.receiptClosingDay} IS NULL
        OR (${t.receiptClosingDay} >= 1 AND ${t.receiptClosingDay} <= ${sqlNumber(RECEIPT_CLOSING_DAY_MAX)})`,
    ),
    check(
      'app_settings_receipt_cancellable_days_check',
      sql`${t.receiptCancellableDays} >= 0 AND ${t.receiptCancellableDays} <= ${sqlNumber(RECEIPT_CANCELLABLE_DAYS_MAX)}`,
    ),
  ],
).enableRLS();
