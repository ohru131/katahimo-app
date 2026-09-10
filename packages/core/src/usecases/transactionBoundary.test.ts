import { beforeEach, describe, expect, it } from 'vitest';
import type { MirrorJob, MirrorPort } from '../ports/mirror';
import type { ReplacePasswordInput, ReplacePasswordResult, StaffRepositoryPort } from '../ports/repositories';
import type { AttendanceDeps } from './attendance';
import { saveAttendanceDay } from './attendance';
import type { PasswordResetDeps } from './passwordReset';
import { requestPasswordReset, resetPasswordWithCode } from './passwordReset';
import type { ReceiptDeps } from './receipts';
import { uploadReceipts } from './receipts';
import type { ReportDeps } from './reports';
import { saveAccidentReport, saveDailyReport } from './reports';
import {
  FakeAccidentReportRepository,
  FakeAttendanceDayRepository,
  FakeCustomerRepository,
  FakeDailyReportRepository,
  FakeMailer,
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

/**
 * 「ドメインの書き込み」と「それと対になる別テーブルへの書き込み」が、片方だけ確定しないことを
 * 固定するテスト。
 *
 * リポジトリはメソッドごとに自分でトランザクションを開くため、素朴に順番に呼ぶと
 * 「日報は保存できたが outbox には積めなかった」「再設定コードは消費したがパスワードは
 * 変わらなかった」という状態が起こりうる。しかもどちらも、あとから気づく手段がない。
 * UnitOfWorkPort でまとめているかどうかを、後段の書き込みを失敗させて確かめる。
 */

const tenantId = 'tenant-1';

/** outboxへの書き込みだけが失敗する状況(ワーカーキューの書き込み失敗)を作る。 */
class FailingMirrorPort implements MirrorPort {
  async enqueue(_job: MirrorJob): Promise<void> {
    throw new Error('outboxへの書き込みに失敗しました');
  }
}

describe('ドメインの書き込みとoutboxへのenqueueは同じトランザクションで確定する', () => {
  let dailyReports: FakeDailyReportRepository;
  let accidentReports: FakeAccidentReportRepository;
  let outbox: FakeOutboxRepository;
  let deps: ReportDeps;
  let staffId: string;
  let customerId: string;

  beforeEach(async () => {
    dailyReports = new FakeDailyReportRepository();
    accidentReports = new FakeAccidentReportRepository();
    outbox = new FakeOutboxRepository();
    const staff = new FakeStaffRepository();
    const customers = new FakeCustomerRepository();

    // 保存成功時は通知のために氏名を引くので、前提として実在させておく。
    const createdStaff = await staff.create({
      tenantId,
      name: '佐藤 花子',
      email: 'hanako@example.com',
      passwordHash: 'hash',
      isAdmin: false,
      mustChangePassword: false,
    });
    staffId = createdStaff.id;
    const createdCustomer = await customers.create({
      tenantId,
      familyName: '田中',
      givenName: '一郎',
      name: '田中 一郎',
    });
    customerId = createdCustomer.id;

    deps = {
      dailyReports,
      accidentReports,
      customers,
      staff,
      notifier: new FakeNotifierPort(),
      mirror: new FailingMirrorPort(),
      unitOfWork: new FakeUnitOfWork([dailyReports, accidentReports, outbox]),
    };
  });

  it('日報: enqueueが失敗したら日報の行も残らない(ミラーされない行が生まれない)', async () => {
    await expect(
      saveDailyReport(deps, tenantId, {
        staffId,
        customerId,
        startTime: '09:00',
        endTime: '10:00',
        inputText: 'メモ',
        internalText: '社内',
        customerText: '保護者向け',
        riskRating: 1,
        esRating: 2,
      }),
    ).rejects.toThrow('outboxへの書き込みに失敗しました');

    expect(await dailyReports.listByCustomer(tenantId, customerId, null, 10)).toEqual([]);
  });

  it('事故報告: enqueueが失敗したら事故報告の行も残らない', async () => {
    await expect(
      saveAccidentReport(deps, tenantId, {
        staffId,
        customerId,
        targetName: '田中 太郎',
        targetDob: '2020-01-01',
        occurrenceTime: '10:00',
        location: '公園',
        accidentContent: '転倒',
        situation: '走っていた',
        immediateResponse: '冷却',
        parentCorrespondence: '電話済み',
        diagnosisTreatment: 'なし',
        prevention: '見守り強化',
        inputText: '',
      }),
    ).rejects.toThrow('outboxへの書き込みに失敗しました');

    expect(await accidentReports.listByCustomer(tenantId, customerId, null, 10)).toEqual([]);
  });

  it('日報の「編集」でも、enqueueが失敗したら編集前の内容のまま残る', async () => {
    // 新規作成と更新は別のコードパスなので、両方を固定する。
    const working: ReportDeps = { ...deps, mirror: new FakeOutboxRepository() };
    const saved = await saveDailyReport(working, tenantId, {
      staffId,
      customerId,
      startTime: '09:00',
      endTime: '10:00',
      inputText: '初回',
      internalText: '初回',
      customerText: '初回',
      riskRating: 1,
      esRating: 2,
    });

    await expect(
      saveDailyReport(deps, tenantId, {
        reportId: saved.id,
        staffId,
        customerId,
        startTime: '11:00',
        endTime: '12:00',
        inputText: '編集後',
        internalText: '編集後',
        customerText: '編集後',
        riskRating: 5,
        esRating: 5,
      }),
    ).rejects.toThrow('outboxへの書き込みに失敗しました');

    const stored = await dailyReports.findById(tenantId, saved.id);
    expect(stored?.riskRating).toBe(1);
  });

  it('事故報告の「編集」でも、enqueueが失敗したら編集前の内容のまま残る', async () => {
    const working: ReportDeps = { ...deps, mirror: new FakeOutboxRepository() };
    const base = {
      staffId,
      customerId,
      targetName: '田中 太郎',
      targetDob: '2020-01-01',
      occurrenceTime: '10:00',
      location: '公園',
      accidentContent: '転倒',
      situation: '走っていた',
      immediateResponse: '冷却',
      parentCorrespondence: '電話済み',
      diagnosisTreatment: 'なし',
      prevention: '見守り強化',
      inputText: '',
    };
    const saved = await saveAccidentReport(working, tenantId, { ...base, reportType: '事故報告' });

    await expect(
      saveAccidentReport(deps, tenantId, {
        ...base,
        reportId: saved.id,
        reportType: 'ヒヤリハット',
      }),
    ).rejects.toThrow('outboxへの書き込みに失敗しました');

    const stored = await accidentReports.findById(tenantId, saved.id);
    expect(stored?.reportType).toBe('事故報告');
  });

  it('勤怠: enqueueが失敗したら勤怠の行も残らない', async () => {
    const attendanceDays = new FakeAttendanceDayRepository();
    const attendanceDeps: AttendanceDeps = {
      attendanceDays,
      mirror: new FailingMirrorPort(),
      unitOfWork: new FakeUnitOfWork([attendanceDays, outbox]),
    };

    await expect(
      saveAttendanceDay(attendanceDeps, tenantId, 'staff-1', '2026-08-30', { C: '訪問先A' }),
    ).rejects.toThrow('outboxへの書き込みに失敗しました');

    expect(await attendanceDays.findByStaffAndDate(tenantId, 'staff-1', '2026-08-30')).toBeNull();
  });

  it('領収書: enqueueが失敗したら行も残らず、置いた画像も消える', async () => {
    const receipts = new FakeReceiptRepository();
    const storage = new FakeStoragePort();
    const receiptDeps: ReceiptDeps = {
      receipts,
      staff: new FakeStaffRepository(),
      customers: new FakeCustomerRepository(),
      storage,
      notifier: new FakeNotifierPort(),
      mirror: new FailingMirrorPort(),
      unitOfWork: new FakeUnitOfWork([receipts, outbox]),
    };

    await expect(
      uploadReceipts(receiptDeps, tenantId, {
        staffId,
        customerId,
        fallbackTimestamp: '2026/08/30 10:00:00',
        handoffText: '',
        images: [{ data: 'data:image/jpeg;base64,AAAA', amount: '1200', storeName: 'コンビニ' }],
      }),
    ).rejects.toThrow('outboxへの書き込みに失敗しました');

    expect(await receipts.findById(tenantId, 'receipt-1')).toBeNull();
    // 画像はオブジェクトストレージ側でトランザクションに入らないため、明示的に消す必要がある。
    expect(storage.listKeysForTest()).toEqual([]);
  });
});

/** replacePasswordだけが失敗する状況(パスワード書き込みの失敗)を作る。 */
class FailingReplacePasswordStaffRepository implements StaffRepositoryPort {
  constructor(private readonly inner: FakeStaffRepository) {}

  findByEmail: StaffRepositoryPort['findByEmail'] = (...args) => this.inner.findByEmail(...args);
  findById: StaffRepositoryPort['findById'] = (...args) => this.inner.findById(...args);
  create: StaffRepositoryPort['create'] = (...args) => this.inner.create(...args);
  upgradeToArgon2Hash: StaffRepositoryPort['upgradeToArgon2Hash'] = (...args) =>
    this.inner.upgradeToArgon2Hash(...args);
  listAll: StaffRepositoryPort['listAll'] = (...args) => this.inner.listAll(...args);
  update: StaffRepositoryPort['update'] = (...args) => this.inner.update(...args);
  listActive: StaffRepositoryPort['listActive'] = (...args) => this.inner.listActive(...args);
  recordFailedLogin: StaffRepositoryPort['recordFailedLogin'] = (...args) =>
    this.inner.recordFailedLogin(...args);
  clearLoginFailures: StaffRepositoryPort['clearLoginFailures'] = (...args) =>
    this.inner.clearLoginFailures(...args);

  async replacePassword(_input: ReplacePasswordInput): Promise<ReplacePasswordResult> {
    throw new Error('パスワードの書き込みに失敗しました');
  }
}

describe('再設定コードの消費とパスワードの書き込みは同じトランザクションで確定する', () => {
  it('パスワードの書き込みが失敗したら、コードは消費されずもう一度使える', async () => {
    const sessions = new FakeSessionRepository();
    const innerStaff = new FakeStaffRepository(sessions);
    const passwordResetCodes = new FakePasswordResetCodeRepository();
    const tenants = new FakeTenantRepository();
    const mailer = new FakeMailer();

    const tenant = await tenants.create({ name: 'テナント', slug: 'demo' });
    await innerStaff.create({
      tenantId: tenant.id,
      name: '田中 一郎',
      email: 'ichiro@example.com',
      passwordHash: 'hash-before',
      isAdmin: false,
      mustChangePassword: false,
    });

    const base: Omit<PasswordResetDeps, 'staff' | 'unitOfWork'> = {
      tenants,
      passwordResetCodes,
      passwordHasher: new FakePasswordHasherPort(),
      mailer,
      resetCodePepper: 'test-pepper',
    };

    await requestPasswordReset(
      { ...base, staff: innerStaff, unitOfWork: new FakeUnitOfWork([innerStaff, passwordResetCodes]) },
      { tenantSlug: 'demo', email: 'ichiro@example.com' },
    );
    const code = mailer.last?.body.match(/認証コード: (\d{6})/)?.[1];
    if (!code) throw new Error('認証コードがメール本文にありません');

    // 1回目: パスワードの書き込みだけが失敗する。
    const failing = new FailingReplacePasswordStaffRepository(innerStaff);
    await expect(
      resetPasswordWithCode(
        { ...base, staff: failing, unitOfWork: new FakeUnitOfWork([innerStaff, passwordResetCodes]) },
        { tenantSlug: 'demo', email: 'ichiro@example.com', code, newPassword: 'new-password-1' },
      ),
    ).rejects.toThrow('パスワードの書き込みに失敗しました');

    // 2回目: 同じコードがまだ生きている(消費だけが先に確定していない)。
    const result = await resetPasswordWithCode(
      { ...base, staff: innerStaff, unitOfWork: new FakeUnitOfWork([innerStaff, passwordResetCodes]) },
      { tenantSlug: 'demo', email: 'ichiro@example.com', code, newPassword: 'new-password-1' },
    );
    expect(result).toEqual({ ok: true });
  });
});
