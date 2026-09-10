import { nextOutboxRetryDelayMs } from '../domain/mirror/retry';
import { formatJstDateTime } from '../domain/reports/jstTime';
import type { OutboxJobRecord, OutboxRepositoryPort } from '../ports/mirror';
import type { MirrorSenderPort } from '../ports/mirrorSender';
import type {
  AccidentReportRepositoryPort,
  AttendanceDayRepositoryPort,
  CustomerRepositoryPort,
  DailyReportRepositoryPort,
  ReceiptRepositoryPort,
  StaffRepositoryPort,
} from '../ports/repositories';
import type { StoragePort } from '../ports/storage';

export interface MirrorWorkerDeps {
  outbox: OutboxRepositoryPort;
  dailyReports: DailyReportRepositoryPort;
  accidentReports: AccidentReportRepositoryPort;
  receipts: ReceiptRepositoryPort;
  attendanceDays: AttendanceDayRepositoryPort;
  staff: StaffRepositoryPort;
  customers: CustomerRepositoryPort;
  storage: StoragePort;
  sender: MirrorSenderPort;
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

/**
 * 再試行しても結果が変わらない失敗。バックオフを挟まずその場でデッドレターに落とす。
 * 一時的な不調(GAS側のクォータ・タイムアウト等)と区別するために使う。
 */
export class PermanentMirrorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentMirrorError';
  }
}

/**
 * outbox_jobs1件分を実際にGAS版スプレッドシート/Driveへミラーする。DBの最新値を読み直し、
 * GAS側の列にそのまま書き込める形(MirrorSenderPortのペイロード)に整形する。
 *
 * 対応する種別は daily_report / accident_report / receipt / attendance_day の4つ(Phase 5の
 * うち先行実装分)。attendance_aggregate / calendar_event は未対応(将来のPhaseで追加する)ため、
 * 万一積まれていても再試行はせずデッドレターに落とす(PermanentMirrorError)。
 * targetIdのレコードが既に存在しない場合(削除等)は何もしない(エラーにはしない)。
 */
export async function processOutboxJob(
  deps: MirrorWorkerDeps,
  tenantId: string,
  job: OutboxJobRecord,
): Promise<void> {
  switch (job.kind) {
    case 'daily_report': {
      const record = await deps.dailyReports.findById(tenantId, job.targetId);
      if (!record) return;
      const [staffRecord, customerRecord] = await Promise.all([
        deps.staff.findById(tenantId, record.staffId),
        deps.customers.findById(tenantId, record.customerId),
      ]);
      const content = record.content;
      await deps.sender.sendDailyReport({
        reportId: record.id,
        timestampJst: formatJstDateTime(record.occurredAt),
        startTime: content.startTime,
        endTime: content.endTime,
        staffName: staffRecord?.name ?? '',
        customerId: record.customerId,
        customerName: customerRecord?.name ?? '',
        inputText: content.inputText,
        internalText: content.internalText,
        customerText: content.customerText,
        riskRating: record.riskRating,
        esRating: record.esRating,
      });
      return;
    }

    case 'accident_report': {
      const record = await deps.accidentReports.findById(tenantId, job.targetId);
      if (!record) return;
      const [staffRecord, customerRecord] = await Promise.all([
        deps.staff.findById(tenantId, record.staffId),
        deps.customers.findById(tenantId, record.customerId),
      ]);
      const content = record.content;
      await deps.sender.sendAccidentReport({
        reportId: record.id,
        timestampJst: formatJstDateTime(record.occurredAt),
        staffName: staffRecord?.name ?? '',
        customerId: record.customerId,
        customerName: customerRecord?.name ?? '',
        targetName: content.targetName,
        targetDob: content.targetDob,
        occurrenceTime: content.occurrenceTime,
        location: content.location,
        accidentContent: content.accidentContent,
        situation: content.situation,
        immediateResponse: content.immediateResponse,
        parentCorrespondence: content.parentCorrespondence,
        diagnosisTreatment: content.diagnosisTreatment,
        prevention: content.prevention,
        inputText: content.inputText,
        reportType: record.reportType,
      });
      return;
    }

    case 'receipt': {
      const record = await deps.receipts.findById(tenantId, job.targetId);
      if (!record) return;
      const [staffRecord, customerRecord, imageBytes] = await Promise.all([
        deps.staff.findById(tenantId, record.staffId),
        record.customerId ? deps.customers.findById(tenantId, record.customerId) : Promise.resolve(null),
        deps.storage.get(record.fileKey),
      ]);
      if (!imageBytes) {
        throw new Error(`領収書画像がストレージに見つかりません: ${record.fileKey}`);
      }
      await deps.sender.sendReceipt({
        staffName: staffRecord?.name ?? '',
        customerId: record.customerId ?? '',
        customerName: customerRecord?.name ?? '',
        receiptTimestampJst: formatJstDateTime(record.receiptTimestamp),
        amount: record.amount ?? '',
        storeName: record.storeName ?? '',
        handoffText: record.handoffText ?? '',
        imageDataUrl: `data:${record.contentType};base64,${bytesToBase64(imageBytes)}`,
      });
      return;
    }

    case 'attendance_day': {
      const record = await deps.attendanceDays.findById(tenantId, job.targetId);
      if (!record) return;
      const staffRecord = await deps.staff.findById(tenantId, record.staffId);
      // jsonb列から読んだ値なので、文字列以外が混ざっていないかを念のため確認して落とす。
      const values: Record<string, string> = {};
      for (const [key, value] of Object.entries(record.rowData)) {
        if (typeof value === 'string') values[key] = value;
      }
      await deps.sender.sendAttendanceDay({
        staffName: staffRecord?.name ?? '',
        businessDate: record.businessDate,
        values,
      });
      return;
    }

    default:
      // attendance_aggregate/calendar_eventは未対応(将来のPhaseで追加する)。
      // 何度試しても結果は変わらないので、再試行の対象にはしない。
      throw new PermanentMirrorError(`未対応のミラー種別です: ${job.kind}`);
  }
}

export interface RunOutboxBatchResult {
  processed: number;
  /** 今回の試行で失敗した件数(再試行待ちに戻したものと、デッドレターに落としたものの合計)。 */
  failed: number;
  /**
   * そのうち `failed` で終端したもの。再試行の上限に達した分と、再試行しても結果が
   * 変わらない失敗(PermanentMirrorError)で即座に打ち切った分の合計。運用が気づくべき件数。
   */
  deadLettered: number;
}

/**
 * 指定テナントのpendingジョブを最大batchSize件処理する。ワーカー(packages/worker)が
 * テナントごとに呼び出す想定(outbox_jobsはRLS対象のため、テナントを跨いで一度に処理できない)。
 */
export async function runOutboxBatch(
  deps: MirrorWorkerDeps,
  tenantId: string,
  batchSize = 10,
  now: () => Date = () => new Date(),
): Promise<RunOutboxBatchResult> {
  const jobs = await deps.outbox.claimPending(tenantId, batchSize);
  let processed = 0;
  let failed = 0;
  let deadLettered = 0;
  for (const job of jobs) {
    try {
      await processOutboxJob(deps, tenantId, job);
      await deps.outbox.markDone(tenantId, job.id);
      processed++;
    } catch (e) {
      // 送信先は外部サービス(GAS Web App)で、実行時間制限やクォータによる一時的な失敗が
      // 起こりうる。一度の失敗で終端させると、そのレコードは人手の介入なしには二度と
      // 反映されない。指数バックオフで戻し、上限に達したものだけデッドレターにする。
      const delayMs = e instanceof PermanentMirrorError ? null : nextOutboxRetryDelayMs(job.attempts);
      const nextAttemptAt = delayMs === null ? null : new Date(now().getTime() + delayMs);
      await deps.outbox.markFailed(
        tenantId,
        job.id,
        e instanceof Error ? e.message : String(e),
        nextAttemptAt,
      );
      failed++;
      if (nextAttemptAt === null) deadLettered++;
    }
  }
  return { processed, failed, deadLettered };
}
