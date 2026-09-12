import { beforeEach, describe, expect, it } from 'vitest';
import type { AttendanceRowData } from '../domain/attendance';
import type { AttendanceDeps } from './attendance';
import { saveAttendanceDay } from './attendance';
import type { AuthDeps } from './auth';
import { registerStaff } from './auth';
import type { CustomerDeps } from './customers';
import { createCustomer } from './customers';
import type { MirrorWorkerDeps } from './mirrorWorker';
import { runOutboxBatch } from './mirrorWorker';
import type { ReceiptDeps } from './receipts';
import { uploadReceipts } from './receipts';
import type { ReportDeps } from './reports';
import { saveAccidentReport, saveDailyReport } from './reports';
import {
  FakeAccidentReportRepository,
  FakeAttendanceDayRepository,
  FakeCouponRedemptionRepository,
  FakeCouponRepository,
  FakeCustomerCouponRepository,
  FakeCustomerRepository,
  FakeDailyReportRepository,
  FakeFamilyMemberRepository,
  FakeMirrorSenderPort,
  FakeNotifierPort,
  FakeOutboxRepository,
  FakePasswordHasherPort,
  FakePasswordResetCodeRepository,
  FakeReceiptRepository,
  FakeSessionRepository,
  FakeStaffRepository,
  FakeStoragePort,
  FakeTenantRepository,
  FakeUnitOfWork,
} from './testDoubles';

describe('runOutboxBatch / processOutboxJob', () => {
  const tenantId = 'tenant-1';
  let staff: FakeStaffRepository;
  let customers: FakeCustomerRepository;
  let outbox: FakeOutboxRepository;
  let sender: FakeMirrorSenderPort;
  let staffId: string;
  let customerId: string;

  beforeEach(async () => {
    staff = new FakeStaffRepository();
    customers = new FakeCustomerRepository();
    outbox = new FakeOutboxRepository();
    sender = new FakeMirrorSenderPort();

    const authDeps: AuthDeps = {
      tenants: new FakeTenantRepository(),
      staff,
      sessions: new FakeSessionRepository(),
      passwordResetCodes: new FakePasswordResetCodeRepository(),
      passwordHasher: new FakePasswordHasherPort(),
    };
    const createdStaff = await registerStaff(authDeps, {
      tenantId,
      name: '佐藤 花子',
      email: 'hanako@example.com',
      password: 'seed-password',
      isAdmin: false,
    });
    staffId = createdStaff.id;

    const customerDeps: CustomerDeps = {
      customers,
      familyMembers: new FakeFamilyMemberRepository(),
    };
    const createdCustomer = await createCustomer(customerDeps, { tenantId, name: '田中 一郎' });
    customerId = createdCustomer.id;
  });

  it('日報を保存するとoutboxに積まれ、ワーカーがGAS側へ送るペイロードに変換される', async () => {
    const dailyReports = new FakeDailyReportRepository();
    const accidentReports = new FakeAccidentReportRepository();
    const couponRedemptions = new FakeCouponRedemptionRepository();
    const reportDeps: ReportDeps = {
      dailyReports,
      accidentReports,
      customers,
      staff,
      coupons: new FakeCouponRepository(),
      couponRedemptions,
      customerCoupons: new FakeCustomerCouponRepository(),
      familyMembers: new FakeFamilyMemberRepository(),
      notifier: new FakeNotifierPort(),
      mirror: outbox,
      unitOfWork: new FakeUnitOfWork([dailyReports, accidentReports, couponRedemptions, outbox]),
    };

    const saved = await saveDailyReport(reportDeps, tenantId, {
      staffId,
      customerId,
      startTime: '09:00',
      endTime: '10:00',
      inputText: '元気に過ごした',
      internalText: '社内向けメモ',
      customerText: '保護者向けメモ',
      riskRating: 3,
      esRating: 4,
    });

    const workerDeps: MirrorWorkerDeps = {
      outbox,
      dailyReports,
      accidentReports: new FakeAccidentReportRepository(),
      receipts: new FakeReceiptRepository(),
      attendanceDays: new FakeAttendanceDayRepository(),
      staff,
      customers,
      storage: new FakeStoragePort(),
      sender,
    };
    const result = await runOutboxBatch(workerDeps, tenantId);

    expect(result).toEqual({ processed: 1, failed: 0, deadLettered: 0 });
    expect(sender.dailyReports).toEqual([
      {
        reportId: saved.id,
        timestampJst: expect.any(String),
        startTime: '09:00',
        endTime: '10:00',
        staffName: '佐藤 花子',
        customerId,
        customerName: '田中 一郎',
        inputText: '元気に過ごした',
        internalText: '社内向けメモ',
        customerText: '保護者向けメモ',
        riskRating: 3,
        esRating: 4,
      },
    ]);
  });

  it('事故報告を保存するとoutboxに積まれ、ワーカーがGAS側へ送るペイロードに変換される', async () => {
    const accidentReports = new FakeAccidentReportRepository();
    const dailyReports = new FakeDailyReportRepository();
    const couponRedemptions = new FakeCouponRedemptionRepository();
    const reportDeps: ReportDeps = {
      dailyReports,
      accidentReports,
      customers,
      staff,
      coupons: new FakeCouponRepository(),
      couponRedemptions,
      customerCoupons: new FakeCustomerCouponRepository(),
      familyMembers: new FakeFamilyMemberRepository(),
      notifier: new FakeNotifierPort(),
      mirror: outbox,
      unitOfWork: new FakeUnitOfWork([dailyReports, accidentReports, couponRedemptions, outbox]),
    };

    const saved = await saveAccidentReport(reportDeps, tenantId, {
      staffId,
      customerId,
      targetName: '田中 太郎',
      targetDob: '2020/01/01',
      occurrenceTime: '14:00',
      location: '公園',
      accidentContent: '転倒した',
      situation: '走っていて転んだ',
      immediateResponse: '患部を冷やした',
      parentCorrespondence: '電話で報告済み',
      diagnosisTreatment: '受診の必要なし',
      prevention: '注意して見守る',
      inputText: '元の入力',
    });

    const workerDeps: MirrorWorkerDeps = {
      outbox,
      dailyReports: new FakeDailyReportRepository(),
      accidentReports,
      receipts: new FakeReceiptRepository(),
      attendanceDays: new FakeAttendanceDayRepository(),
      staff,
      customers,
      storage: new FakeStoragePort(),
      sender,
    };
    const result = await runOutboxBatch(workerDeps, tenantId);

    expect(result).toEqual({ processed: 1, failed: 0, deadLettered: 0 });
    expect(sender.accidentReports).toHaveLength(1);
    expect(sender.accidentReports[0]).toMatchObject({
      reportId: saved.id,
      staffName: '佐藤 花子',
      customerName: '田中 一郎',
      targetName: '田中 太郎',
      reportType: '事故報告',
    });
  });

  it('領収書をアップロードするとoutboxに積まれ、ワーカーが画像データURLに変換して送る', async () => {
    const receipts = new FakeReceiptRepository();
    const storage = new FakeStoragePort();
    const receiptDeps: ReceiptDeps = {
      receipts,
      staff,
      customers,
      storage,
      notifier: new FakeNotifierPort(),
      mirror: outbox,
      unitOfWork: new FakeUnitOfWork([receipts, outbox]),
    };

    await uploadReceipts(receiptDeps, tenantId, {
      staffId,
      customerId,
      images: [
        {
          data: 'data:image/jpeg;base64,AAAA',
          amount: '1200',
          storeName: 'コンビニ',
        },
      ],
      fallbackTimestamp: '2026/08/30 10:00:00',
    });

    const workerDeps: MirrorWorkerDeps = {
      outbox,
      dailyReports: new FakeDailyReportRepository(),
      accidentReports: new FakeAccidentReportRepository(),
      receipts,
      attendanceDays: new FakeAttendanceDayRepository(),
      staff,
      customers,
      storage,
      sender,
    };
    const result = await runOutboxBatch(workerDeps, tenantId);

    expect(result).toEqual({ processed: 1, failed: 0, deadLettered: 0 });
    expect(sender.receipts).toHaveLength(1);
    expect(sender.receipts[0]).toMatchObject({
      staffName: '佐藤 花子',
      customerName: '田中 一郎',
      amount: '1200',
      storeName: 'コンビニ',
      imageDataUrl: 'data:image/jpeg;base64,AAAA',
    });
  });

  it('勤怠(出勤簿)を保存するとoutboxに積まれ、ワーカーが列記号をキーにした値に変換して送る', async () => {
    const attendanceDays = new FakeAttendanceDayRepository();
    const attendanceDeps: AttendanceDeps = {
      attendanceDays,
      mirror: outbox,
      mirrorAttendanceAggregate: false,
      unitOfWork: new FakeUnitOfWork([attendanceDays, outbox]),
    };

    await saveAttendanceDay(attendanceDeps, tenantId, staffId, '2026-08-30', {
      visits: [{ place: '訪問先A', start: '09:00', end: '10:00' }],
    });

    const workerDeps: MirrorWorkerDeps = {
      outbox,
      dailyReports: new FakeDailyReportRepository(),
      accidentReports: new FakeAccidentReportRepository(),
      receipts: new FakeReceiptRepository(),
      attendanceDays,
      staff,
      customers,
      storage: new FakeStoragePort(),
      sender,
    };
    const result = await runOutboxBatch(workerDeps, tenantId);

    expect(result).toEqual({ processed: 1, failed: 0, deadLettered: 0 });
    // ミラー送信(GAS版スプレッドシートの書き込み先)は列記号のワイヤ形式のまま
    // (toColumnRow()を通す。AttendanceDayMirrorPayload.valuesは変えてはいけない)。
    expect(sender.attendanceDays).toEqual([
      {
        staffName: '佐藤 花子',
        businessDate: '2026-08-30',
        values: { C: '訪問先A', D: '09:00', E: '10:00' },
      },
    ]);
  });

  it('mirrorAttendanceAggregate=trueなら勤怠集計の再計算も積み、スタッフ名と日付だけを送る', async () => {
    const attendanceDays = new FakeAttendanceDayRepository();
    const attendanceDeps: AttendanceDeps = {
      attendanceDays,
      mirror: outbox,
      mirrorAttendanceAggregate: true,
      unitOfWork: new FakeUnitOfWork([attendanceDays, outbox]),
    };

    await saveAttendanceDay(attendanceDeps, tenantId, staffId, '2026-08-30', {
      visits: [{ place: '訪問先A', start: '09:00', end: '10:00' }],
    });

    // 出勤簿(attendance_day)と勤怠集計(attendance_aggregate)は別ジョブとして積まれる。
    // 冪等キーがkind込みなので、同じレコード・同じ版でも片方が捨てられることはない。
    expect(
      outbox
        .listAllForTest()
        .map((r) => r.kind)
        .sort(),
    ).toEqual(['attendance_aggregate', 'attendance_day']);

    const workerDeps: MirrorWorkerDeps = {
      outbox,
      dailyReports: new FakeDailyReportRepository(),
      accidentReports: new FakeAccidentReportRepository(),
      receipts: new FakeReceiptRepository(),
      attendanceDays,
      staff,
      customers,
      storage: new FakeStoragePort(),
      sender,
    };
    const result = await runOutboxBatch(workerDeps, tenantId);

    expect(result).toEqual({ processed: 2, failed: 0, deadLettered: 0 });
    // 勤怠集計シートはカレンダー+Maps由来の派生データなので、rowDataの値は一切送らない
    // (再計算はGAS側が行う)。
    expect(sender.attendanceAggregates).toEqual([{ staffName: '佐藤 花子', businessDate: '2026-08-30' }]);
  });

  it('mirrorAttendanceAggregateが既定(false)なら勤怠集計の再計算は積まない', async () => {
    const attendanceDays = new FakeAttendanceDayRepository();
    const attendanceDeps: AttendanceDeps = {
      attendanceDays,
      mirror: outbox,
      mirrorAttendanceAggregate: false,
      unitOfWork: new FakeUnitOfWork([attendanceDays, outbox]),
    };

    await saveAttendanceDay(attendanceDeps, tenantId, staffId, '2026-08-30', {
      visits: [{ place: '訪問先A' }],
    });

    expect(outbox.listAllForTest().map((r) => r.kind)).toEqual(['attendance_day']);
  });

  it('勤怠集計のミラーでスタッフ名が引けない場合は再試行せずデッドレターに落とす', async () => {
    const attendanceDays = new FakeAttendanceDayRepository();
    // スタッフ台帳に存在しないIDの勤怠(スタッフ行が消された等)を直接作る。
    const record = await attendanceDays.upsert(tenantId, 'staff-missing', '2026-08-30', {
      visits: [{ place: '訪問先A' }],
    });
    await outbox.enqueue({
      tenantId,
      kind: 'attendance_aggregate',
      targetId: record.id,
      idempotencyKey: 'attendance_aggregate:missing:1',
    });

    const workerDeps: MirrorWorkerDeps = {
      outbox,
      dailyReports: new FakeDailyReportRepository(),
      accidentReports: new FakeAccidentReportRepository(),
      receipts: new FakeReceiptRepository(),
      attendanceDays,
      staff,
      customers,
      storage: new FakeStoragePort(),
      sender,
    };
    const result = await runOutboxBatch(workerDeps, tenantId);

    // 名前が引けないまま送ると、GAS側がどのスタッフの行を消して書き直すか決められない
    // (勤怠集計シートの行はスタッフ名で突き合わせる)。空文字で送らず打ち切る。
    expect(result).toEqual({ processed: 0, failed: 1, deadLettered: 1 });
    const row = outbox.listAllForTest().find((r) => r.kind === 'attendance_aggregate');
    expect(row?.status).toBe('failed');
    expect(row?.lastError).toContain('勤怠集計のミラー対象スタッフが見つかりません');
    expect(sender.attendanceAggregates).toEqual([]);
  });

  it('領収書の画像がストレージから見つからない場合は失敗扱いにする(成功として握りつぶさない)', async () => {
    const receipts = new FakeReceiptRepository();
    const storage = new FakeStoragePort();
    const receiptDeps: ReceiptDeps = {
      receipts,
      staff,
      customers,
      storage,
      notifier: new FakeNotifierPort(),
      mirror: outbox,
      unitOfWork: new FakeUnitOfWork([receipts, outbox]),
    };

    await uploadReceipts(receiptDeps, tenantId, {
      staffId,
      customerId,
      images: [
        {
          data: 'data:image/jpeg;base64,AAAA',
          amount: '1200',
          storeName: 'コンビニ',
        },
      ],
      fallbackTimestamp: '2026/08/30 10:00:00',
    });
    // 画像ファイルがストレージから消えている状況(ストレージ障害・削除等)を再現する。
    storage.get = async () => null;

    const workerDeps: MirrorWorkerDeps = {
      outbox,
      dailyReports: new FakeDailyReportRepository(),
      accidentReports: new FakeAccidentReportRepository(),
      receipts,
      attendanceDays: new FakeAttendanceDayRepository(),
      staff,
      customers,
      storage,
      sender,
    };
    const result = await runOutboxBatch(workerDeps, tenantId);

    expect(result).toEqual({ processed: 0, failed: 1, deadLettered: 0 });
    expect(sender.receipts).toEqual([]);
  });

  it('勤怠rowDataの形式が不正な場合は再試行せず、その場でデッドレターに落とす', async () => {
    const attendanceDays = new FakeAttendanceDayRepository();

    // DBのjsonb列が何らかの理由で破損し、start(本来"HH:mm"文字列)に数値が紛れ込んだ状況を
    // 再現する。saveAttendanceDayは保存前にattendanceRowDataSchemaで検証してしまうため、
    // 「検証を経ずに壊れたデータがDBに残っている」状況はリポジトリへ直接書き込むことでしか
    // 再現できない(古いデータ・手動でのDB操作等を想定)。
    const record = await attendanceDays.upsert(tenantId, staffId, '2026-08-30', {
      visits: [{ place: '訪問先A', start: 900 }],
    } as unknown as AttendanceRowData);
    await outbox.enqueue({
      tenantId,
      kind: 'attendance_day',
      targetId: record.id,
      idempotencyKey: 'attendance_day:broken:1',
    });

    const workerDeps: MirrorWorkerDeps = {
      outbox,
      dailyReports: new FakeDailyReportRepository(),
      accidentReports: new FakeAccidentReportRepository(),
      receipts: new FakeReceiptRepository(),
      attendanceDays,
      staff,
      customers,
      storage: new FakeStoragePort(),
      sender,
    };
    const result = await runOutboxBatch(workerDeps, tenantId);

    expect(result).toEqual({ processed: 0, failed: 1, deadLettered: 1 });
    const row = outbox.listAllForTest().find((r) => r.kind === 'attendance_day');
    expect(row?.status).toBe('failed');
    expect(row?.lastError).toContain('勤怠rowDataの形式が不正です');
    expect(sender.attendanceDays).toEqual([]);
  });

  it('対象レコードが既に無い場合は何もせず成功扱いにする', async () => {
    await outbox.enqueue({
      tenantId,
      kind: 'daily_report',
      targetId: 'missing-report',
      idempotencyKey: 'idem-1',
    });

    const workerDeps: MirrorWorkerDeps = {
      outbox,
      dailyReports: new FakeDailyReportRepository(),
      accidentReports: new FakeAccidentReportRepository(),
      receipts: new FakeReceiptRepository(),
      attendanceDays: new FakeAttendanceDayRepository(),
      staff,
      customers,
      storage: new FakeStoragePort(),
      sender,
    };
    const result = await runOutboxBatch(workerDeps, tenantId);

    expect(result).toEqual({ processed: 1, failed: 0, deadLettered: 0 });
    expect(sender.dailyReports).toEqual([]);
  });
});
