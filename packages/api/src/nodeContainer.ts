import type { Database } from '@katahimo/db';
import {
  DrizzleAccidentReportRepository,
  DrizzleAppSettingsRepository,
  DrizzleAttendanceDayRepository,
  DrizzleCustomerRepository,
  DrizzleDailyReportRepository,
  DrizzleFamilyMemberRepository,
  DrizzleOutboxRepository,
  DrizzleReceiptRepository,
  DrizzleSessionRepository,
  DrizzleStaffRepository,
  DrizzleTenantKeyRepository,
  DrizzleTenantRepository,
} from '@katahimo/db/repositories';
import {
  ConsoleAuditLogPort,
  GasBridgeMapsPort,
  GasBridgeSchedulePort,
  GeminiAiPort,
  LocalBlindIndexPort,
  LocalCryptoPort,
  LocalFileStoragePort,
  LocalKmsPort,
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
  const kms = new LocalKmsPort(env.LOCAL_DEV_KEK);
  const tenantKeys = new DrizzleTenantKeyRepository(db);
  const crypto = new LocalCryptoPort(tenantKeys, kms, new ConsoleAuditLogPort());
  const appSettings = new DrizzleAppSettingsRepository(db);
  const gasBridgeOptions =
    env.GAS_BRIDGE_URL && env.GAS_BRIDGE_SECRET
      ? { baseUrl: env.GAS_BRIDGE_URL, secret: env.GAS_BRIDGE_SECRET }
      : null;

  return {
    tenants: new DrizzleTenantRepository(db),
    staff: new DrizzleStaffRepository(db),
    sessions: new DrizzleSessionRepository(db),
    customers: new DrizzleCustomerRepository(db),
    familyMembers: new DrizzleFamilyMemberRepository(db),
    attendanceDays: new DrizzleAttendanceDayRepository(db),
    dailyReports: new DrizzleDailyReportRepository(db),
    accidentReports: new DrizzleAccidentReportRepository(db),
    receipts: new DrizzleReceiptRepository(db),
    appSettings,
    crypto,
    blindIndex: new LocalBlindIndexPort(env.LOCAL_DEV_MASTER_KEY),
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
    legacyAuthSalt: env.LEGACY_AUTH_SALT,
  };
}
