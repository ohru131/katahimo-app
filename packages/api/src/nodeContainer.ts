import type { Database } from '@katahimo/db';
import {
  DrizzleAccidentReportRepository,
  DrizzleAppSettingsRepository,
  DrizzleAttendanceDayRepository,
  DrizzleCouponRedemptionRepository,
  DrizzleCouponRepository,
  DrizzleCustomerCouponRepository,
  DrizzleCustomerRepository,
  DrizzleDailyReportRepository,
  DrizzleFamilyMemberRepository,
  DrizzleOutboxRepository,
  DrizzlePasswordResetCodeRepository,
  DrizzleReceiptRepository,
  DrizzleSessionRepository,
  DrizzleStaffRepository,
  DrizzleTenantKeyRepository,
  DrizzleTenantRepository,
} from '@katahimo/db/repositories';
import { DrizzleUnitOfWork } from '@katahimo/db/unit-of-work';
import {
  ConsoleAuditLogPort,
  GasBridgeMailerPort,
  GasBridgeMapsPort,
  GasBridgeSchedulePort,
  GeminiAiPort,
  LocalCryptoPort,
  LocalFileStoragePort,
  LocalKmsPort,
  LoggingMailerPort,
  listAvailableGeminiModels,
  NoopMapsPort,
  NoopMirrorPort,
  NoopReportAiPort,
  NoopSchedulePort,
  WebhookNotifierPort,
} from '@katahimo/integrations';
import { argon2PasswordHasher } from './authAdapters';
import type { Container } from './container';
import type { Env } from './env';

/**
 * Node(APIサーバー/ワーカー)向けのContainer実装。PostgreSQL・ファイルシステム・argon2の
 * ネイティブバインディングに依存するため、ブラウザからはimportできない。
 * ブラウザ向けの組み立ては packages/demo にある。
 */
export function createContainer(env: Env, db: Database): Container {
  // app_settingsの資格情報(Gemini APIキー・Webhook URL)を暗号化/復号するためだけの構成。
  // 業務データは平文列なので、CryptoPortが必要なのは settings/reportAi/notifier の解決だけ。
  const kms = new LocalKmsPort(env.LOCAL_DEV_KEK);
  const tenantKeys = new DrizzleTenantKeyRepository(db);
  const audit = new ConsoleAuditLogPort();
  const crypto = new LocalCryptoPort(tenantKeys, kms, audit);
  const appSettings = new DrizzleAppSettingsRepository(db);
  const gasBridgeOptions =
    env.GAS_BRIDGE_URL && env.GAS_BRIDGE_SECRET
      ? { baseUrl: env.GAS_BRIDGE_URL, secret: env.GAS_BRIDGE_SECRET }
      : null;

  return {
    tenants: new DrizzleTenantRepository(db),
    staff: new DrizzleStaffRepository(db),
    sessions: new DrizzleSessionRepository(db),
    passwordResetCodes: new DrizzlePasswordResetCodeRepository(db),
    customers: new DrizzleCustomerRepository(db),
    familyMembers: new DrizzleFamilyMemberRepository(db),
    attendanceDays: new DrizzleAttendanceDayRepository(db),
    dailyReports: new DrizzleDailyReportRepository(db),
    accidentReports: new DrizzleAccidentReportRepository(db),
    receipts: new DrizzleReceiptRepository(db),
    coupons: new DrizzleCouponRepository(db),
    couponRedemptions: new DrizzleCouponRedemptionRepository(db),
    customerCoupons: new DrizzleCustomerCouponRepository(db),
    appSettings,
    crypto,
    passwordHasher: argon2PasswordHasher,
    storage: new LocalFileStoragePort(env.LOCAL_RECEIPT_STORAGE_DIR),
    notifier: new WebhookNotifierPort({
      async resolve(tenantId, channel) {
        const settings = await appSettings.find(tenantId);
        const encrypted =
          channel === 'report' ? settings?.gchatReportWebhookUrl : settings?.gchatReceiptWebhookUrl;
        if (encrypted) return crypto.decrypt(tenantId, encrypted);
        return channel === 'report' ? env.GCHAT_REPORT_WEBHOOK_URL : env.GCHAT_RECEIPT_WEBHOOK_URL;
      },
    }),
    // パスワード再設定コード・初期パスワードの通知。GAS版と同じくMailApp経由で送る
    // (doc/10「新規GCP APIより既存GASブリッジを優先」)。未設定ならログに出すだけ。
    mailer: gasBridgeOptions
      ? new GasBridgeMailerPort(gasBridgeOptions)
      : new LoggingMailerPort(env.NODE_ENV !== 'production'),
    resetCodePepper: env.PASSWORD_RESET_PEPPER,
    reportAi: env.GEMINI_API_KEY
      ? new GeminiAiPort({
          apiKey: env.GEMINI_API_KEY,
          reportModel: env.GEMINI_MODEL_REPORT,
          ocrModel: env.GEMINI_MODEL_OCR,
        })
      : new NoopReportAiPort(),
    reportAiFactory: { create: (opts) => new GeminiAiPort(opts) },
    listGeminiModels: listAvailableGeminiModels,
    maps: gasBridgeOptions ? new GasBridgeMapsPort(gasBridgeOptions) : new NoopMapsPort(),
    schedule: gasBridgeOptions ? new GasBridgeSchedulePort(gasBridgeOptions) : new NoopSchedulePort(),
    mirror: env.MIRROR_TO_GOOGLE_SHEETS ? new DrizzleOutboxRepository(db) : new NoopMirrorPort(),
    mirrorAttendanceAggregate: env.MIRROR_ATTENDANCE_AGGREGATE,
    unitOfWork: new DrizzleUnitOfWork(db),
    audit,
    legacyAuthSalt: env.LEGACY_AUTH_SALT,
  };
}
