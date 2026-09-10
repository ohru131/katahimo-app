import { attendanceRowDataSchema } from '@katahimo/shared';
import type { AttendanceColumnRow } from '../domain/attendance';
import { toColumnRow } from '../domain/attendance';
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
 * 対応する種別は MirrorKind の全て(daily_report / accident_report / receipt /
 * attendance_day / attendance_aggregate)。outbox_jobs.kind はDBでは text 列で、リポジトリが
 * MirrorKind へ無検査キャストしているため、ここに未知の値が届くことは実際に起こりうる
 * (古いジョブが残ったまま種別を廃止した、行を手で入れた等)。その場合は何度試しても
 * 結果が変わらないので、再試行はせずデッドレターに落とす(PermanentMirrorError)。
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
        // doc/14 A項。amountYenが取れればそれを文字列化し、取れなければOCRの生値(amountRaw)、
        // それも無ければ空文字にフォールバックする(GAS版の「金額」列の見え方を崩さないため)。
        amount: record.amountYen !== null ? String(record.amountYen) : (record.amountRaw ?? ''),
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
      // jsonb列は保存前にAPI境界(attendanceRowDataSchema)を通っているはずだが、古いデータ・
      // 手動でのDB操作等で壊れている可能性は残るため、送信直前にもう一度形を確認する。
      // 再試行しても直らないのでデッドレターに落とす(PermanentMirrorError)。
      const parsed = attendanceRowDataSchema.safeParse(record.rowData);
      if (!parsed.success) {
        throw new PermanentMirrorError(`勤怠rowDataの形式が不正です: ${parsed.error.message}`);
      }
      // toColumnRow()は必ず文字列(またはundefined)を返すので、以前あった「文字列以外が
      // 混ざっていないかを確認するループ」は不要になった。ただしMAX_VISITS/MAX_OFFICE_WORKを
      // 超えるデータ(API側のチェックをすり抜けた場合)は例外を投げるので、ここでも
      // 拾ってデッドレターに倒す(こちらも再試行では直らない)。
      let columnRow: AttendanceColumnRow;
      try {
        columnRow = toColumnRow(parsed.data);
      } catch (e) {
        throw new PermanentMirrorError(
          `勤怠rowDataを列記号形式に変換できません: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      const values: Record<string, string> = {};
      for (const [key, value] of Object.entries(columnRow)) {
        if (value !== undefined) values[key] = value;
      }
      await deps.sender.sendAttendanceDay({
        staffName: staffRecord?.name ?? '',
        businessDate: record.businessDate,
        values,
      });
      return;
    }

    case 'attendance_aggregate': {
      // 他の種別と違い、DBの値は送らない(勤怠集計シートはカレンダー+Maps由来の派生データで、
      // attendance_daysの入力列とは形も出自も違う)。対象のスタッフ名と日付だけを渡し、
      // 再計算とシート書き込みはGAS側に任せる(ports/mirrorSender.tsの
      // AttendanceAggregateMirrorPayload参照)。
      const record = await deps.attendanceDays.findById(tenantId, job.targetId);
      if (!record) return;
      const staffRecord = await deps.staff.findById(tenantId, record.staffId);
      // GAS側は勤怠集計シートの行をスタッフ名で突き合わせる(ATTENDANCE_SHEET_HEADERの
      // 「スタッフ名」列)。名前が引けないまま送ると、どのスタッフの行を消して書き直すのかが
      // 決まらず、他スタッフの行を巻き込みかねない。再試行しても引けるようにはならないので
      // その場で打ち切る(attendance_dayのミラーは名前が空でも出勤簿を日付で特定できるため
      // 空文字にフォールバックしているが、こちらは同じ扱いにできない)。
      if (!staffRecord) {
        throw new PermanentMirrorError(`勤怠集計のミラー対象スタッフが見つかりません: ${record.staffId}`);
      }
      await deps.sender.sendAttendanceAggregate({
        staffName: staffRecord.name,
        businessDate: record.businessDate,
      });
      return;
    }

    default:
      // outbox_jobs.kindはtext列なので、MirrorKindに無い値が届くことがある(廃止した種別の
      // 積み残し等)。何度試しても結果は変わらないので、再試行の対象にはしない。
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
