import type { MirrorWorkerDeps } from '@katahimo/core';
import type { ReportAiGenerationRepositoryPort } from '@katahimo/core/ports';
import type { Database } from '@katahimo/db';
import {
  DrizzleAccidentReportRepository,
  DrizzleAttendanceDayRepository,
  DrizzleCustomerRepository,
  DrizzleDailyReportRepository,
  DrizzleOutboxRepository,
  DrizzleReceiptRepository,
  DrizzleReportAiGenerationRepository,
  DrizzleStaffRepository,
  DrizzleTenantRepository,
} from '@katahimo/db/repositories';
import {
  GasBridgeMirrorSenderPort,
  LocalFileStoragePort,
  NoopMirrorSenderPort,
} from '@katahimo/integrations';
import type { WorkerEnv } from './env';

export interface WorkerContainer extends MirrorWorkerDeps {
  tenants: DrizzleTenantRepository;
  /**
   * AI生成の記録。ワーカーは日次で「どの日報からも参照されていない古い下書き」を消すためだけに使う
   * (doc/db/new-domains.md 第6章。保存された日報が参照する行は残す)。
   */
  reportAiGenerations: ReportAiGenerationRepositoryPort;
}

export function createWorkerContainer(env: WorkerEnv, db: Database): WorkerContainer {
  if (Boolean(env.GAS_BRIDGE_URL) !== Boolean(env.GAS_BRIDGE_SECRET)) {
    // 片方だけ設定されている場合は入力ミスの可能性が高い。ここでNoopMirrorSenderPortに
    // フォールバックすると出力の見た目上は成功扱いのままミラー送信されなくなり、
    // 気付けないまま運用され続けてしまうため、起動自体を止める。
    throw new Error(
      'GAS_BRIDGE_URL と GAS_BRIDGE_SECRET は両方設定するか、両方とも未設定にしてください' +
        '(現在は片方だけ設定されています)。',
    );
  }
  const gasBridgeOptions =
    env.GAS_BRIDGE_URL && env.GAS_BRIDGE_SECRET
      ? {
          baseUrl: env.GAS_BRIDGE_URL,
          secret: env.GAS_BRIDGE_SECRET,
          timeoutMs: env.GAS_BRIDGE_TIMEOUT_MS,
        }
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
    reportAiGenerations: new DrizzleReportAiGenerationRepository(db),
    storage: new LocalFileStoragePort(env.LOCAL_RECEIPT_STORAGE_DIR),
    sender: gasBridgeOptions ? new GasBridgeMirrorSenderPort(gasBridgeOptions) : new NoopMirrorSenderPort(),
  };
}
