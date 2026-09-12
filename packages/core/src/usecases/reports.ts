import {
  buildAccidentHistoryInternalText,
  buildAccidentReportNotificationText,
  buildDailyReportNotificationText,
  formatJstDateKey,
  formatJstDateTimeShort,
  parseDateOnly,
  parseJstDateTime,
} from '../domain';
import { buildMirrorIdempotencyKey } from '../domain/mirror/idempotencyKey';
import type { AccidentReportContent, DailyReportContent } from '../domain/reports/types';
import type { MirrorPort } from '../ports/mirror';
import type { NotifierPort } from '../ports/notifier';
import type {
  AccidentReportRepositoryPort,
  CouponRedemptionRepositoryPort,
  CouponRepositoryPort,
  CustomerRepositoryPort,
  DailyReportRepositoryPort,
  StaffRepositoryPort,
} from '../ports/repositories';
import type { UnitOfWorkPort } from '../ports/unitOfWork';
import type { DailyReportCouponView } from './coupons';
import { buildDailyReportCouponViews, resolveCouponRedemptionSnapshots } from './coupons';

export interface ReportDeps {
  dailyReports: DailyReportRepositoryPort;
  accidentReports: AccidentReportRepositoryPort;
  customers: CustomerRepositoryPort;
  staff: StaffRepositoryPort;
  coupons: CouponRepositoryPort;
  couponRedemptions: CouponRedemptionRepositoryPort;
  notifier: NotifierPort;
  /** GAS版「日報」「事故報告」シートへのミラー書き込み要求をoutboxに積む(Phase 5)。 */
  mirror: MirrorPort;
  /** 日報/事故報告の保存とミラー要求のenqueueを、1つのトランザクションにまとめるために使う。 */
  unitOfWork: UnitOfWorkPort;
}

async function resolveNames(
  deps: ReportDeps,
  tenantId: string,
  staffId: string,
  customerId: string,
): Promise<{ staffName: string; customerName: string }> {
  const [staffRecord, customerRecord] = await Promise.all([
    deps.staff.findById(tenantId, staffId),
    deps.customers.findById(tenantId, customerId),
  ]);
  if (!staffRecord) throw new Error('スタッフが見つかりません');
  if (!customerRecord) throw new Error('顧客が見つかりません');
  return { staffName: staffRecord.name, customerName: customerRecord.name };
}

export interface SaveDailyReportInput {
  /** 既存レポートの上書き保存(GAS版saveReportのrowIndex指定に相当)。 */
  reportId?: string;
  staffId: string;
  customerId: string;
  /** 'YYYY-MM-DD'。省略時は保存時刻をそのまま使う(GAS版saveReportと同じ)。 */
  reportDate?: string;
  startTime: string;
  endTime: string;
  inputText: string;
  internalText: string;
  customerText: string;
  riskRating: number | null;
  esRating: number | null;
  /**
   * 適用する割引クーポンのID配列(doc/14 §9)。省略/空配列は「クーポン無し」。
   * 既存の適用記録は保存のたびに削除して入れ直す(saveDailyReport内のコメント参照)ため、
   * 編集時にこの配列から外したクーポンは、保存後に自動的に消える。
   */
  couponIds?: string[];
}

export interface DailyReportView {
  id: string;
  occurredAt: Date;
  staffId: string;
  customerId: string;
  riskRating: number | null;
  esRating: number | null;
  startedAt: Date | null;
  endedAt: Date | null;
  content: DailyReportContent;
  /** この日報に適用された割引クーポン(doc/14 §9)。 */
  coupons: DailyReportCouponView[];
}

/**
 * 'YYYY-MM-DD'の訪問日とstart/endTime('HH:mm'。未入力は空文字)から、startedAt/endedAtを
 * 組み立てる(doc/14 §6)。
 *
 * occurredAt(=訪問日+開始時刻。並べ替えキー)とstartedAtは同じ情報の二重管理になるため、
 * 呼び出し側(saveDailyReport)はこの関数が返すstartedAtをoccurredAtとしてもそのまま使う
 * (再度parseJstDateTimeを呼び直さない=Dateオブジェクトそのものを共有し、構造的に食い違いを
 * 起こさないようにする)。startTimeが空文字の場合、startedAtはnull(未入力)になる一方、
 * occurredAt側は呼び出し側が引き続き「00:00固定の並べ替えキー」として扱う(既存挙動を変えない)。
 *
 * 日跨ぎ勤務(22:00〜01:00等)はendedAtがstartedAtより前の時刻になってしまうため、その場合は
 * 日付を1日進める(daily_reports_time_orderのCHECK制約を満たすため)。
 */
function computeDailyReportTimes(
  reportDateStr: string,
  startTime: string,
  endTime: string,
): { startedAt: Date | null; endedAt: Date | null } {
  const startedAt = startTime ? parseJstDateTime(reportDateStr, startTime) : null;
  if (!endTime) return { startedAt, endedAt: null };

  const endCandidate = parseJstDateTime(reportDateStr, endTime);
  const endedAt =
    startedAt && endCandidate < startedAt
      ? new Date(endCandidate.getTime() + 24 * 60 * 60 * 1000)
      : endCandidate;
  return { startedAt, endedAt };
}

/**
 * 保育日報を保存する。GAS版Main.js saveReportに対応(スタッフ名/顧客IDの権限チェックは
 * 呼び出し側のAPIルートがCLAUDE.mdのセキュリティパターンに沿って解決済みのstaffIdを渡す前提)。
 * 保存に成功したらGoogle Chatへ通知する(GAS版のsendReportNotification相当)。
 */
export async function saveDailyReport(
  deps: ReportDeps,
  tenantId: string,
  input: SaveDailyReportInput,
): Promise<DailyReportView> {
  // reportDate省略時は「今日」のJST日付を補ってstartedAt/endedAtを計算する(そうしないと
  // start/endTimeが入力されていても常にnullになってしまう)。ただしoccurredAt自体は
  // 従来通り「保存操作時刻そのもの」にする(GAS版saveReportと同じ、訪問日時の遡り指定は
  // できない仕様。reportDateが無い=どの日の何時か分からないため、startTimeの値は
  // 信用せず実際の保存時刻を使う)。
  const now = new Date();
  const reportDateStr = input.reportDate ?? formatJstDateKey(now);
  const { startedAt, endedAt } = computeDailyReportTimes(reportDateStr, input.startTime, input.endTime);
  const occurredAt = input.reportDate ? (startedAt ?? parseJstDateTime(reportDateStr, undefined)) : now;

  const content: DailyReportContent = {
    inputText: input.inputText || '',
    internalText: input.internalText || '',
    customerText: input.customerText || '',
  };

  const newInput = {
    tenantId,
    staffId: input.staffId,
    customerId: input.customerId,
    occurredAt,
    riskRating: input.riskRating,
    esRating: input.esRating,
    startedAt,
    endedAt,
    content,
  };

  // クーポンの検証(テナントのものか・activeか・reportDateの時点で有効期間内か)は、
  // DB書き込みを一切伴わない読み取りなので、トランザクションの外で先に済ませておく
  // (unitOfWork.tsの「run()に入る前に済ませておく」というルールに合わせる)。
  // ここで弾いた入力は、DBのCHECK制約(23514)ではなく分かりやすいエラーとして失敗する。
  const couponSnapshots = await resolveCouponRedemptionSnapshots(
    deps,
    tenantId,
    input.couponIds ?? [],
    reportDateStr,
  );

  // 保存とミラー要求のenqueue・クーポン適用記録の書き換えは1つのトランザクションで確定させる。
  // 分けると、日報は保存できたのにスプレッドシートへ永久に反映されない行や、日報とクーポンの
  // 適用記録が食い違ったままの行が、誰にも気づかれずに残る。通知(外部サービス呼び出し)は、
  // この外側で済ませておくこと(unitOfWork.ts参照)。
  const { record, couponRedemptions } = await deps.unitOfWork.run(tenantId, async (scope) => {
    const saved = input.reportId
      ? ((await deps.dailyReports.update(tenantId, input.reportId, newInput, scope)) ??
        (await deps.dailyReports.create(newInput, scope)))
      : await deps.dailyReports.create(newInput, scope);
    await deps.mirror.enqueue(
      {
        tenantId,
        kind: 'daily_report',
        targetId: saved.id,
        idempotencyKey: buildMirrorIdempotencyKey('daily_report', saved.id, saved.updatedAt),
      },
      scope,
    );
    // 既存の適用記録を「削除して入れ直す」(差分更新にしない理由は
    // CouponRedemptionRepositoryPort.replaceForDailyReportのコメント参照。編集でクーポンを
    // 外した場合に、その行が残ってしまう事故を構造的に起こせなくするため)。
    const redemptions = await deps.couponRedemptions.replaceForDailyReport(
      tenantId,
      saved.id,
      couponSnapshots.map((s) => ({ tenantId, dailyReportId: saved.id, ...s })),
      scope,
    );
    return { record: saved, couponRedemptions: redemptions };
  });

  const coupons = await buildDailyReportCouponViews(deps, tenantId, couponRedemptions);

  const { staffName, customerName } = await resolveNames(deps, tenantId, input.staffId, input.customerId);
  const notificationText = buildDailyReportNotificationText({
    staffName,
    customerName,
    // DB保存後のstartedAt/endedAt(timestamptz)を'HH:mm'へ戻す回り道はせず、入力の
    // 生文字列をそのまま使う(notificationText.tsのbuildDailyReportNotificationTextの
    // コメント参照)。
    content: {
      startTime: input.startTime || '',
      endTime: input.endTime || '',
      internalText: content.internalText,
    },
    riskRating: input.riskRating,
    esRating: input.esRating,
  });
  await deps.notifier.notify(tenantId, 'report', notificationText);

  return {
    id: record.id,
    occurredAt: record.occurredAt,
    staffId: record.staffId,
    customerId: record.customerId,
    riskRating: record.riskRating,
    esRating: record.esRating,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    content,
    coupons,
  };
}

export interface SaveAccidentReportInput {
  reportId?: string;
  staffId: string;
  customerId: string;
  /** '事故報告' | 'ヒヤリハット'。省略時は'事故報告'(GAS版と同じデフォルト)。 */
  reportType?: string;
  targetName: string;
  targetDob: string;
  occurrenceTime: string;
  location: string;
  accidentContent: string;
  situation: string;
  immediateResponse: string;
  parentCorrespondence: string;
  diagnosisTreatment: string;
  prevention: string;
  inputText: string;
}

export interface AccidentReportView {
  id: string;
  occurredAt: Date;
  staffId: string;
  customerId: string;
  reportType: string;
  content: AccidentReportContent;
}

/**
 * 事故報告/ヒヤリハットを保存する。GAS版Main.js saveAccidentReportに対応。
 * 保存日時は常に保存操作時の時刻(GAS版と同じく、訪問日時の遡り指定はできない)。
 */
export async function saveAccidentReport(
  deps: ReportDeps,
  tenantId: string,
  input: SaveAccidentReportInput,
): Promise<AccidentReportView> {
  // doc/14 §6: targetDob(自由記述由来の生文字列)はtargetDobRawへそのまま残しつつ、
  // parseDateOnlyで解析できた場合だけtargetDobDateに'YYYY-MM-DD'を入れる。
  const targetDobRaw = input.targetDob || '';
  const content: AccidentReportContent = {
    targetName: input.targetName || '',
    targetDobDate: targetDobRaw ? parseDateOnly(targetDobRaw) : null,
    targetDobRaw,
    occurrenceTime: input.occurrenceTime,
    location: input.location,
    accidentContent: input.accidentContent,
    situation: input.situation,
    immediateResponse: input.immediateResponse,
    parentCorrespondence: input.parentCorrespondence,
    diagnosisTreatment: input.diagnosisTreatment,
    prevention: input.prevention,
    inputText: input.inputText,
  };
  const reportType = input.reportType || '事故報告';

  const newInput = {
    tenantId,
    staffId: input.staffId,
    customerId: input.customerId,
    occurredAt: new Date(),
    reportType,
    content,
  };

  const record = await deps.unitOfWork.run(tenantId, async (scope) => {
    const saved = input.reportId
      ? ((await deps.accidentReports.update(tenantId, input.reportId, newInput, scope)) ??
        (await deps.accidentReports.create(newInput, scope)))
      : await deps.accidentReports.create(newInput, scope);
    await deps.mirror.enqueue(
      {
        tenantId,
        kind: 'accident_report',
        targetId: saved.id,
        idempotencyKey: buildMirrorIdempotencyKey('accident_report', saved.id, saved.updatedAt),
      },
      scope,
    );
    return saved;
  });

  const { staffName, customerName } = await resolveNames(deps, tenantId, input.staffId, input.customerId);
  const notificationText = buildAccidentReportNotificationText({
    staffName,
    customerName,
    reportType,
    content,
  });
  await deps.notifier.notify(tenantId, 'report', notificationText);

  return {
    id: record.id,
    occurredAt: record.occurredAt,
    staffId: record.staffId,
    customerId: record.customerId,
    reportType: record.reportType,
    content,
  };
}

export interface SendVisitCompleteInput {
  staffId: string;
  customerId: string;
  /** 'YYYY-MM-DD' */
  visitDate: string;
  /** 'HH:mm' */
  startTime: string;
  /** 'HH:mm' */
  endTime: string;
}

/**
 * 「訪問完了」ボタン用の通知のみ(DB書き込みは無い)。GAS版sendVisitComplete/
 * sendVisitCompleteNotificationに対応。担当者名・顧客名はクライアント指定を信用せず、
 * 常にセッション/DBから解決する(CLAUDE.mdのセキュリティパターン)。
 */
export async function sendVisitCompleteNotification(
  deps: ReportDeps,
  tenantId: string,
  input: SendVisitCompleteInput,
): Promise<void> {
  const { staffName, customerName } = await resolveNames(deps, tenantId, input.staffId, input.customerId);
  const [y, m, d] = input.visitDate.split('-');
  const dateStr = `${y}/${m}/${d}`;
  const message = `【訪問完了】\n担当: ${staffName}\n顧客名: ${customerName}\n訪問日時: ${dateStr} ${input.startTime}〜${input.endTime}`;
  await deps.notifier.notify(tenantId, 'report', message);
}

export interface HistoryItem {
  type: 'daily' | 'accident';
  id: string;
  /** カーソルページネーションの次回startAfterに使う。ISO8601文字列。 */
  occurredAtIso: string;
  /** 表示用 'yyyy/MM/dd HH:mm'。GAS版getCustomerReportsのfmt()と同じ書式。 */
  timestamp: string;
  staff: string;
  original: string;
  internal: string;
  customer: string;
  risk?: number | null;
  es?: number | null;
  isAccident?: boolean;
  subtype?: string;
  /** この日報に適用された割引クーポン(doc/14 §9)。日報(type: 'daily')にのみ持つ。 */
  coupons?: DailyReportCouponView[];
}

/**
 * 顧客の活動記録(日報+事故報告)を新しい順に取得する。GAS版Main.js getCustomerReportsに対応。
 * beforeを渡すと、それより古いものだけを返す(「もっと見る」ページネーション)。
 */
export async function getCustomerHistory(
  deps: ReportDeps,
  tenantId: string,
  customerId: string,
  before: Date | null,
  limit = 5,
): Promise<HistoryItem[]> {
  const [dailyRecords, accidentRecords] = await Promise.all([
    deps.dailyReports.listByCustomer(tenantId, customerId, before, limit),
    deps.accidentReports.listByCustomer(tenantId, customerId, before, limit),
  ]);

  const staffIds = Array.from(
    new Set([...dailyRecords.map((r) => r.staffId), ...accidentRecords.map((r) => r.staffId)]),
  );
  const staffNameById = new Map<string, string>();
  await Promise.all(
    staffIds.map(async (staffId) => {
      const staffRecord = await deps.staff.findById(tenantId, staffId);
      if (!staffRecord) return;
      staffNameById.set(staffId, staffRecord.name);
    }),
  );

  // 日報履歴にも適用済みクーポンを含める(doc/14 §9)。事故報告にはcoupon_redemptionsの
  // FKが無い(日報にしか紐付かない)ため対象外。
  const redemptions = await deps.couponRedemptions.listByDailyReportIds(
    tenantId,
    dailyRecords.map((r) => r.id),
  );
  const couponViews = await buildDailyReportCouponViews(deps, tenantId, redemptions);
  const couponViewsByDailyReportId = new Map<string, DailyReportCouponView[]>();
  redemptions.forEach((redemption, index) => {
    const view = couponViews[index];
    if (!view) return;
    const list = couponViewsByDailyReportId.get(redemption.dailyReportId) ?? [];
    list.push(view);
    couponViewsByDailyReportId.set(redemption.dailyReportId, list);
  });

  const dailyItems: HistoryItem[] = dailyRecords.map((r) => {
    const content = r.content;
    return {
      type: 'daily' as const,
      id: r.id,
      occurredAtIso: r.occurredAt.toISOString(),
      timestamp: formatJstDateTimeShort(r.occurredAt),
      staff: staffNameById.get(r.staffId) ?? '',
      original: content.inputText,
      internal: content.internalText,
      customer: content.customerText,
      risk: r.riskRating,
      es: r.esRating,
      coupons: couponViewsByDailyReportId.get(r.id) ?? [],
    };
  });

  const accidentItems: HistoryItem[] = accidentRecords.map((r) => {
    const content = r.content;
    return {
      type: 'accident' as const,
      id: r.id,
      occurredAtIso: r.occurredAt.toISOString(),
      timestamp: formatJstDateTimeShort(r.occurredAt),
      staff: staffNameById.get(r.staffId) ?? '',
      original: content.inputText,
      internal: buildAccidentHistoryInternalText(content),
      customer: content.parentCorrespondence,
      isAccident: true,
      subtype: r.reportType || '事故報告',
    };
  });

  return [...dailyItems, ...accidentItems]
    .sort((a, b) => (a.occurredAtIso < b.occurredAtIso ? 1 : a.occurredAtIso > b.occurredAtIso ? -1 : 0))
    .slice(0, limit);
}
