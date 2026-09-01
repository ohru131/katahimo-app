import type { MirrorWorkerDeps } from '@katahimo/core';
import type { Database } from '@katahimo/db';
import {
  DrizzleAccidentReportRepository,
  DrizzleAttendanceDayRepository,
  DrizzleCustomerRepository,
  DrizzleDailyReportRepository,
  DrizzleOutboxRepository,
  DrizzleReceiptRepository,
  DrizzleStaffRepository,
  DrizzleTenantKeyRepository,
  DrizzleTenantRepository,
} from '@katahimo/db/repositories';
import {
  ConsoleAuditLogPort,
  GasBridgeMirrorSenderPort,
  LocalCryptoPort,
  LocalFileStoragePort,
  LocalKmsPort,
  NoopMirrorSenderPort,
} from '@katahimo/integrations';
import type { WorkerEnv } from './env';

export interface WorkerContainer extends MirrorWorkerDeps {
  tenants: DrizzleTenantRepository;
}

export function createWorkerContainer(env: WorkerEnv, db: Database): WorkerContainer {
  const kms = new LocalKmsPort(env.LOCAL_DEV_KEK);
  const tenantKeys = new DrizzleTenantKeyRepository(db);
  const crypto = new LocalCryptoPort(tenantKeys, kms, new ConsoleAuditLogPort());
  if (Boolean(env.GAS_BRIDGE_URL) !== Boolean(env.GAS_BRIDGE_SECRET)) {
    // 片方だけ設定されている場合は入力ミスの可能性が高い。NoopMirrorSenderPortに
    // フォールバックすると出力の見た目上は成功扱いになり、ミラー未送信に気付けなくなるため警告する。
    console.warn(
      '[worker] GAS_BRIDGE_URL/GAS_BRIDGE_SECRET のどちらか片方だけが設定されています。' +
        'GASブリッジへのミラー送信は無効化され(NoopMirrorSenderPort)、記録上は成功扱いのまま何も送信されません。',
    );
  }
  const gasBridgeOptions =
    env.GAS_BRIDGE_URL && env.GAS_BRIDGE_SECRET
      ? { baseUrl: env.GAS_BRIDGE_URL, secret: env.GAS_BRIDGE_SECRET }
      : null;

  return {
    tenants: new DrizzleTenantRepository(db),
    outbox: new DrizzleOutboxRepository(db),
    dailyReports: new DrizzleDailyReportRepository(db),
    accidentReports: new DrizzleAccidentReportRepository(db),
    receipts: new DrizzleReceiptRepository(db),
    attendanceDays: new DrizzleAttendanceDayRepository(db),
    staff: new DrizzleStaffRepository(db),
    customers: new DrizzleCustomerRepository(db),
    crypto,
    storage: new LocalFileStoragePort(env.LOCAL_RECEIPT_STORAGE_DIR),
    sender: gasBridgeOptions ? new GasBridgeMirrorSenderPort(gasBridgeOptions) : new NoopMirrorSenderPort(),
  };
}
