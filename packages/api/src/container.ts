import type {
  MapsPort,
  NotifierPort,
  ReportAiPort,
  ReportAiPortFactory,
  StoragePort,
} from '@katahimo/core/ports';
import type { Database } from '@katahimo/db';
import {
  DrizzleAccidentReportRepository,
  DrizzleAppSettingsRepository,
  DrizzleAttendanceDayRepository,
  DrizzleCustomerRepository,
  DrizzleDailyReportRepository,
  DrizzleFamilyMemberRepository,
  DrizzleReceiptRepository,
  DrizzleSessionRepository,
  DrizzleStaffRepository,
  DrizzleTenantRepository,
} from '@katahimo/db/repositories';
import {
  GasBridgeMapsPort,
  GeminiAiPort,
  LocalBlindIndexPort,
  LocalCryptoPort,
  LocalFileStoragePort,
  listAvailableGeminiModels,
  NoopMapsPort,
  NoopReportAiPort,
  WebhookNotifierPort,
} from '@katahimo/integrations';
import { argon2PasswordHasher } from './authAdapters';
import type { Env } from './env';

/** ルートハンドラに配る依存一式。usecases(@katahimo/core)にそのまま渡す形。 */
export interface Container {
  tenants: DrizzleTenantRepository;
  staff: DrizzleStaffRepository;
  sessions: DrizzleSessionRepository;
  customers: DrizzleCustomerRepository;
  familyMembers: DrizzleFamilyMemberRepository;
  attendanceDays: DrizzleAttendanceDayRepository;
  dailyReports: DrizzleDailyReportRepository;
  accidentReports: DrizzleAccidentReportRepository;
  receipts: DrizzleReceiptRepository;
  appSettings: DrizzleAppSettingsRepository;
  crypto: LocalCryptoPort;
  blindIndex: LocalBlindIndexPort;
  passwordHasher: typeof argon2PasswordHasher;
  storage: StoragePort;
  notifier: NotifierPort;
  /** テナントがapp_settingsに独自キーを設定していない場合のフォールバック(.env設定 or Noop)。 */
  reportAi: ReportAiPort;
  /** テナント固有のGemini APIキー/モデルで都度ReportAiPortを組み立てるためのファクトリ。 */
  reportAiFactory: ReportAiPortFactory;
  /** 管理者設定画面の「最新モデル一覧を取得」用。保存前の入力中キーでも確認できるよう独立させている。 */
  listGeminiModels: typeof listAvailableGeminiModels;
  /**
   * ジオコーディング/ルート計算。GAS_BRIDGE_URL/GAS_BRIDGE_SECRETが設定されていれば
   * gas-childcare-visit-appのWeb App(Bridge.js)をプロキシとして使い、未設定ならNoopMapsPort
   * (常にnull)にフォールバックする。
   */
  maps: MapsPort;
  /** GAS版 Script Properties AUTH_SALT と同じ値。移行済みスタッフのログインにのみ使う。 */
  legacyAuthSalt?: string;
}

export function createContainer(env: Env, db: Database): Container {
  const crypto = new LocalCryptoPort(env.LOCAL_DEV_MASTER_KEY);
  const appSettings = new DrizzleAppSettingsRepository(db);

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
    maps:
      env.GAS_BRIDGE_URL && env.GAS_BRIDGE_SECRET
        ? new GasBridgeMapsPort({ baseUrl: env.GAS_BRIDGE_URL, secret: env.GAS_BRIDGE_SECRET })
        : new NoopMapsPort(),
    legacyAuthSalt: env.LEGACY_AUTH_SALT,
  };
}
