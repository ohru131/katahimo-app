import type { Container } from '@katahimo/api';
import {
  DrizzleAccidentReportRepository,
  DrizzleAppSettingsRepository,
  DrizzleAttendanceDayRepository,
  DrizzleCustomerRepository,
  DrizzleDailyReportRepository,
  DrizzleFamilyMemberRepository,
  DrizzlePasswordResetCodeRepository,
  DrizzleReceiptRepository,
  DrizzleSessionRepository,
  DrizzleStaffRepository,
  DrizzleTenantKeyRepository,
  DrizzleTenantRepository,
} from '@katahimo/db/repositories';
import type { Database } from '@katahimo/db/tenant-scope';
import { DrizzleUnitOfWork } from '@katahimo/db/unit-of-work';
// バレル(`@katahimo/integrations`)ではなくサブパスから取ること。バレル経由だと
// LocalFileStoragePort(node:fs)まで巻き込まれ、ブラウザ向けビルドが通らなくなる。
import { ConsoleAuditLogPort } from '@katahimo/integrations/audit';
import { GeminiAiPort, listAvailableGeminiModels } from '@katahimo/integrations/gemini';
import { LocalCryptoPort } from '@katahimo/integrations/local-crypto';
import { LocalKmsPort } from '@katahimo/integrations/local-kms';
import { NoopMirrorPort } from '@katahimo/integrations/mirror';
import { BrowserStoragePort } from './ports/browserStoragePort';
import { CannedReportAiPort } from './ports/cannedReportAiPort';
import { DemoAppSettingsRepository } from './ports/demoAppSettingsRepository';
import { DemoMailerPort } from './ports/demoMailerPort';
import { DemoMapsPort } from './ports/demoMapsPort';
import { DemoNotifierPort } from './ports/demoNotifierPort';
import { demoPasswordHasher } from './ports/demoPasswordHasher';
import { type CustomerIdByName, DemoSchedulePort } from './ports/demoSchedulePort';

/**
 * デモ用のKEK(テナントDEKをラップする鍵)。
 *
 * 本番のLOCAL_DEV_KEKとは無関係の固定値で、公開ビルドに含まれるため誰でも読める。
 * 暗号化の対象は本番と同じく app_settings の資格情報(Gemini APIキー・Webhook URL)だけで、
 * 顧客・日報などの業務データは平文列。デモが守っているのはシードで作った架空データだけ
 * なので、この鍵が公開されていること自体は問題ない。
 *
 * 逆に言えば、この鍵で暗号化したものは実質平文と変わらない。訪問者が入力した本物の秘密
 * (Gemini APIキー等)をこの鍵で暗号化して保存すると「暗号化しているから安全」という
 * 誤った保証を与えることになるため、秘密項目はDemoAppSettingsRepositoryが永続化を止めている
 * (メモリに留めるだけで、IndexedDBには書かない)。
 */
const DEMO_KEK = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
/**
 * パスワード再設定コードの検証子を計算する鍵。DEMO_KEKと同じく公開ビルドに含まれる固定値。
 *
 * 本番ではこれをDBに置かないことで「DBが漏れても6桁コードを復元できない」を成立させるが、
 * デモはDBもこの鍵も訪問者のブラウザの中にあるので、その保証はもともと成り立たない。
 * 守る対象が架空データだけなので問題にならない。
 */
const DEMO_RESET_CODE_PEPPER = '0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0';

export interface DemoContainerDeps {
  db: Database;
  /** 予定タブが顧客詳細へ遷移するための、顧客名→ID対応表。 */
  customerIdByName: CustomerIdByName;
  /** ジオコーディングのデモ実装が引く住所→緯度経度。 */
  addressLatLng: ReadonlyMap<string, { lat: number; lng: number }>;
}

export interface DemoContainer extends Container {
  notifier: DemoNotifierPort;
  mailer: DemoMailerPort;
}

/**
 * ブラウザ内で動かすContainerを組み立てる。
 *
 * 差し替えているのはNodeでしか動かない実装(argon2・ファイルシステム)と、
 * 公開デモにAPIキーを置けない実装(Google Maps・Googleカレンダー・Gemini)だけ。
 * 資格情報の暗号化・リポジトリ・usecasesは本番と同一のコードが動く。
 */
export function createDemoContainer(deps: DemoContainerDeps): DemoContainer {
  const kms = new LocalKmsPort(DEMO_KEK);
  const audit = new ConsoleAuditLogPort();
  const crypto = new LocalCryptoPort(new DrizzleTenantKeyRepository(deps.db), kms, audit);
  const maps = new DemoMapsPort(deps.addressLatLng);

  return {
    tenants: new DrizzleTenantRepository(deps.db),
    staff: new DrizzleStaffRepository(deps.db),
    sessions: new DrizzleSessionRepository(deps.db),
    passwordResetCodes: new DrizzlePasswordResetCodeRepository(deps.db),
    customers: new DrizzleCustomerRepository(deps.db),
    familyMembers: new DrizzleFamilyMemberRepository(deps.db),
    attendanceDays: new DrizzleAttendanceDayRepository(deps.db),
    dailyReports: new DrizzleDailyReportRepository(deps.db),
    accidentReports: new DrizzleAccidentReportRepository(deps.db),
    receipts: new DrizzleReceiptRepository(deps.db),
    // 訪問者が入力したAPIキー/Webhook URLはメモリに留め、IndexedDBには書かない。
    appSettings: new DemoAppSettingsRepository(new DrizzleAppSettingsRepository(deps.db)),
    crypto,
    passwordHasher: demoPasswordHasher,
    storage: new BrowserStoragePort(),
    notifier: new DemoNotifierPort(),
    // 架空のメールアドレス宛なので実際には送れない。画面に出して、届いたメールを
    // 読むのと同じように認証コード・初期パスワードを拾えるようにする。
    mailer: new DemoMailerPort(),
    resetCodePepper: DEMO_RESET_CODE_PEPPER,
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
    unitOfWork: new DrizzleUnitOfWork(deps.db),
    audit,
  };
}
