import type { Container } from '@katahimo/api';
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
  DrizzleTenantKeyRepository,
  DrizzleTenantRepository,
} from '@katahimo/db/repositories';
import type { Database } from '@katahimo/db/tenant-scope';
// バレル(`@katahimo/integrations`)ではなくサブパスから取ること。バレル経由だと
// LocalFileStoragePort(node:fs)まで巻き込まれ、ブラウザ向けビルドが通らなくなる。
import { ConsoleAuditLogPort } from '@katahimo/integrations/audit';
import { GeminiAiPort, listAvailableGeminiModels } from '@katahimo/integrations/gemini';
import { LocalBlindIndexPort, LocalCryptoPort } from '@katahimo/integrations/local-crypto';
import { LocalKmsPort } from '@katahimo/integrations/local-kms';
import { NoopMirrorPort } from '@katahimo/integrations/mirror';
import { BrowserStoragePort } from './ports/browserStoragePort';
import { CannedReportAiPort } from './ports/cannedReportAiPort';
import { DemoAppSettingsRepository } from './ports/demoAppSettingsRepository';
import { DemoMapsPort } from './ports/demoMapsPort';
import { DemoNotifierPort } from './ports/demoNotifierPort';
import { demoPasswordHasher } from './ports/demoPasswordHasher';
import { type CustomerIdByName, DemoSchedulePort } from './ports/demoSchedulePort';

/**
 * デモ用の鍵。
 *
 * 本番のKEK/マスターキーとは無関係の固定値で、公開ビルドに含まれるため誰でも読める。
 * この鍵で守られるのはシードで作った架空データだけなので、公開されていること自体は問題ない。
 *
 * 逆に言えば、この鍵で暗号化したものは実質平文と変わらない。訪問者が入力した本物の秘密
 * (Gemini APIキー等)をこの鍵で暗号化して保存すると「暗号化しているから安全」という
 * 誤った保証を与えることになるため、秘密項目はDemoAppSettingsRepositoryが永続化を止めている。
 */
const DEMO_KEK = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
const DEMO_BLIND_INDEX_KEY = 'ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100';

export interface DemoContainerDeps {
  db: Database;
  /** 予定タブが顧客詳細へ遷移するための、顧客名→ID対応表。 */
  customerIdByName: CustomerIdByName;
  /** ジオコーディングのデモ実装が引く住所→緯度経度。 */
  addressLatLng: ReadonlyMap<string, { lat: number; lng: number }>;
}

export interface DemoContainer extends Container {
  notifier: DemoNotifierPort;
}

/**
 * ブラウザ内で動かすContainerを組み立てる。
 *
 * 差し替えているのはNodeでしか動かない実装(argon2・ファイルシステム)と、
 * 公開デモにAPIキーを置けない実装(Google Maps・Googleカレンダー・Gemini)だけ。
 * 暗号化・ブラインドインデックス・リポジトリ・usecasesは本番と同一のコードが動く。
 */
export function createDemoContainer(deps: DemoContainerDeps): DemoContainer {
  const kms = new LocalKmsPort(DEMO_KEK);
  const crypto = new LocalCryptoPort(new DrizzleTenantKeyRepository(deps.db), kms, new ConsoleAuditLogPort());
  const maps = new DemoMapsPort(deps.addressLatLng);

  return {
    tenants: new DrizzleTenantRepository(deps.db),
    staff: new DrizzleStaffRepository(deps.db),
    sessions: new DrizzleSessionRepository(deps.db),
    customers: new DrizzleCustomerRepository(deps.db),
    familyMembers: new DrizzleFamilyMemberRepository(deps.db),
    attendanceDays: new DrizzleAttendanceDayRepository(deps.db),
    dailyReports: new DrizzleDailyReportRepository(deps.db),
    accidentReports: new DrizzleAccidentReportRepository(deps.db),
    receipts: new DrizzleReceiptRepository(deps.db),
    // 訪問者が入力したAPIキー/Webhook URLはメモリに留め、IndexedDBには書かない。
    appSettings: new DemoAppSettingsRepository(new DrizzleAppSettingsRepository(deps.db)),
    crypto,
    blindIndex: new LocalBlindIndexPort(DEMO_BLIND_INDEX_KEY),
    passwordHasher: demoPasswordHasher,
    storage: new BrowserStoragePort(),
    notifier: new DemoNotifierPort(),
    // APIキー未設定時のフォールバックを定型応答にする。訪問者が管理者設定で自分の
    // Gemini APIキーを登録した場合は、reportAiFactory経由で本物のGeminiが使われる
    // (キーは訪問者のブラウザ内のPGliteに、本番と同じ封筒暗号化をかけて保存される)。
    reportAi: new CannedReportAiPort(),
    reportAiFactory: { create: (options) => new GeminiAiPort(options) },
    listGeminiModels: listAvailableGeminiModels,
    maps,
    schedule: new DemoSchedulePort(maps, deps.customerIdByName),
    // ミラー先のGoogleスプレッドシートが存在しないので、outboxには積まない。
    mirror: new NoopMirrorPort(),
  };
}
