import { beforeEach, describe, expect, it } from 'vitest';
import type { AuthDeps } from './auth';
import { registerStaff } from './auth';
import type { CustomerDeps } from './customers';
import { createCustomer } from './customers';
import { FakeReportAiGenerationRepository } from './reportAiTestDoubles';
import type { ReportDeps } from './reports';
import { getCustomerHistory, saveDailyReport, sendVisitCompleteNotification } from './reports';
import {
  FakeAccidentReportRepository,
  FakeCouponRedemptionRepository,
  FakeCouponRepository,
  FakeCustomerCouponRepository,
  FakeCustomerRepository,
  FakeDailyReportRepository,
  FakeFamilyMemberRepository,
  FakeNotifierPort,
  FakeOutboxRepository,
  FakePasswordHasherPort,
  FakePasswordResetCodeRepository,
  FakeSessionRepository,
  FakeStaffRepository,
  FakeTenantRepository,
  FakeUnitOfWork,
} from './testDoubles';

describe('sendVisitCompleteNotification', () => {
  const tenantId = 'tenant-1';
  let deps: ReportDeps;
  let notifier: FakeNotifierPort;
  let staffId: string;
  let customerId: string;

  beforeEach(async () => {
    const staff = new FakeStaffRepository();
    const customers = new FakeCustomerRepository();
    notifier = new FakeNotifierPort();

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

    deps = {
      // このテストではDB書き込みが発生しないため未使用(型を満たすためのダミー)。
      dailyReports: {} as ReportDeps['dailyReports'],
      accidentReports: {} as ReportDeps['accidentReports'],
      customers,
      staff,
      coupons: new FakeCouponRepository(),
      couponRedemptions: new FakeCouponRedemptionRepository(),
      customerCoupons: new FakeCustomerCouponRepository(),
      familyMembers: new FakeFamilyMemberRepository(),
      reportAiGenerations: new FakeReportAiGenerationRepository(),
      notifier,
      mirror: new FakeOutboxRepository(),
      unitOfWork: new FakeUnitOfWork([]),
    };
  });

  it('担当者名・顧客名をサーバー側で解決し、報告用チャンネルへ通知する', async () => {
    await sendVisitCompleteNotification(deps, tenantId, {
      staffId,
      customerId,
      visitDate: '2026-08-28',
      startTime: '09:00',
      endTime: '11:00',
    });

    expect(notifier.notifications).toEqual([
      {
        tenantId,
        channel: 'report',
        text: '【訪問完了】\n担当: 佐藤 花子\n顧客名: 田中 一郎\n訪問日時: 2026/08/28 09:00〜11:00',
      },
    ]);
  });
});

describe('saveDailyReport とクーポン(doc/db/guidelines.md §9)', () => {
  const tenantId = 'tenant-1';
  let deps: ReportDeps;
  let coupons: FakeCouponRepository;
  let couponRedemptions: FakeCouponRedemptionRepository;
  let dailyReports: FakeDailyReportRepository;
  let staffId: string;
  let customerId: string;

  beforeEach(async () => {
    const staff = new FakeStaffRepository();
    const customers = new FakeCustomerRepository();
    dailyReports = new FakeDailyReportRepository();
    coupons = new FakeCouponRepository();
    couponRedemptions = new FakeCouponRedemptionRepository();

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

    deps = {
      dailyReports,
      accidentReports: new FakeAccidentReportRepository(),
      customers,
      staff,
      coupons,
      couponRedemptions,
      customerCoupons: new FakeCustomerCouponRepository(),
      familyMembers: new FakeFamilyMemberRepository(),
      reportAiGenerations: new FakeReportAiGenerationRepository(),
      notifier: new FakeNotifierPort(),
      mirror: new FakeOutboxRepository(),
      unitOfWork: new FakeUnitOfWork([dailyReports, couponRedemptions]),
    };
  });

  const baseInput = {
    startTime: '09:00',
    endTime: '10:00',
    inputText: 'メモ',
    internalText: '社内',
    customerText: '保護者向け',
    stressLevel: 1,
    esRating: 2,
  };

  it('有効期間外のクーポンIDは分かりやすいエラーで弾かれる', async () => {
    const coupon = await coupons.create({
      tenantId,
      code: 'SUMMER',
      name: '夏のキャンペーン',
      discountKind: 'amount',
      discountAmountYen: 300,
      discountPercent: null,
      validFrom: '2026-07-01',
      validTo: '2026-08-31',
      audience: 'all',
      eligibilityKind: 'manual',
      birthdaySubject: null,
      usageLimitKind: 'unlimited',
      active: true,
      note: null,
    });

    await expect(
      saveDailyReport(deps, tenantId, {
        ...baseInput,
        staffId,
        customerId,
        reportDate: '2026-06-01',
        couponIds: [coupon.id],
      }),
    ).rejects.toThrow(/有効期間/);
    // 検証で弾かれたら、日報自体も保存されない(片方だけ確定しない)。
    expect(await dailyReports.listByCustomer(tenantId, customerId, null, 10)).toEqual([]);
  });

  it('active=falseのクーポンIDは分かりやすいエラーで弾かれる', async () => {
    const coupon = await coupons.create({
      tenantId,
      code: 'RETIRED',
      name: '廃止済みクーポン',
      discountKind: 'amount',
      discountAmountYen: 300,
      discountPercent: null,
      validFrom: null,
      validTo: null,
      audience: 'all',
      eligibilityKind: 'manual',
      birthdaySubject: null,
      usageLimitKind: 'unlimited',
      active: false,
      note: null,
    });

    await expect(
      saveDailyReport(deps, tenantId, {
        ...baseInput,
        staffId,
        customerId,
        reportDate: '2026-06-01',
        couponIds: [coupon.id],
      }),
    ).rejects.toThrow(/廃止/);
  });

  it('他テナントのクーポンIDは「見つからない」として弾かれる', async () => {
    const coupon = await coupons.create({
      tenantId: 'other-tenant',
      code: 'OTHER',
      name: '他テナントのクーポン',
      discountKind: 'amount',
      discountAmountYen: 300,
      discountPercent: null,
      validFrom: null,
      validTo: null,
      audience: 'all',
      eligibilityKind: 'manual',
      birthdaySubject: null,
      usageLimitKind: 'unlimited',
      active: true,
      note: null,
    });

    await expect(
      saveDailyReport(deps, tenantId, {
        ...baseInput,
        staffId,
        customerId,
        reportDate: '2026-06-01',
        couponIds: [coupon.id],
      }),
    ).rejects.toThrow(/見つかりません/);
  });

  it('保存に成功すると、適用時点のクーポン名・コード・割引条件がDailyReportViewに含まれる', async () => {
    const coupon = await coupons.create({
      tenantId,
      code: 'INTRO500',
      name: '紹介キャンペーン 500円引き',
      discountKind: 'amount',
      discountAmountYen: 500,
      discountPercent: null,
      validFrom: null,
      validTo: null,
      audience: 'all',
      eligibilityKind: 'manual',
      birthdaySubject: null,
      usageLimitKind: 'unlimited',
      active: true,
      note: null,
    });

    const saved = await saveDailyReport(deps, tenantId, {
      ...baseInput,
      staffId,
      customerId,
      reportDate: '2026-06-01',
      couponIds: [coupon.id],
    });

    expect(saved.coupons).toEqual([
      {
        couponId: coupon.id,
        code: 'INTRO500',
        name: '紹介キャンペーン 500円引き',
        discountKind: 'amount',
        discountAmountYen: 500,
        discountPercent: null,
        birthdaySubjectName: null,
      },
    ]);
  });

  it('編集でクーポンを外す(couponIds無し)と、適用記録も消える', async () => {
    const coupon = await coupons.create({
      tenantId,
      code: 'INTRO500',
      name: '紹介キャンペーン 500円引き',
      discountKind: 'amount',
      discountAmountYen: 500,
      discountPercent: null,
      validFrom: null,
      validTo: null,
      audience: 'all',
      eligibilityKind: 'manual',
      birthdaySubject: null,
      usageLimitKind: 'unlimited',
      active: true,
      note: null,
    });

    const saved = await saveDailyReport(deps, tenantId, {
      ...baseInput,
      staffId,
      customerId,
      reportDate: '2026-06-01',
      couponIds: [coupon.id],
    });
    expect(saved.coupons).toHaveLength(1);

    const edited = await saveDailyReport(deps, tenantId, {
      ...baseInput,
      reportId: saved.id,
      staffId,
      customerId,
      reportDate: '2026-06-01',
      couponIds: [],
    });

    expect(edited.coupons).toEqual([]);
    expect(await couponRedemptions.listByDailyReportId(tenantId, saved.id)).toEqual([]);
  });

  it('あとでクーポンマスタの割引額を変更しても、既に保存した適用記録は変わらない', async () => {
    const coupon = await coupons.create({
      tenantId,
      code: 'INTRO500',
      name: '紹介キャンペーン 500円引き',
      discountKind: 'amount',
      discountAmountYen: 500,
      discountPercent: null,
      validFrom: null,
      validTo: null,
      audience: 'all',
      eligibilityKind: 'manual',
      birthdaySubject: null,
      usageLimitKind: 'unlimited',
      active: true,
      note: null,
    });

    const saved = await saveDailyReport(deps, tenantId, {
      ...baseInput,
      staffId,
      customerId,
      reportDate: '2026-06-01',
      couponIds: [coupon.id],
    });
    expect(saved.coupons[0]?.discountAmountYen).toBe(500);

    // マスタの割引額を書き換える(値下げ改定を想定)。
    await coupons.update(tenantId, coupon.id, { discountAmountYen: 1000 });

    const redemptions = await couponRedemptions.listByDailyReportId(tenantId, saved.id);
    expect(redemptions[0]?.discountAmountYen).toBe(500);
  });
});

describe('getCustomerHistory とクーポン', () => {
  const tenantId = 'tenant-1';
  let deps: ReportDeps;
  let staffId: string;
  let customerId: string;

  beforeEach(async () => {
    const staff = new FakeStaffRepository();
    const customers = new FakeCustomerRepository();
    const dailyReports = new FakeDailyReportRepository();
    const couponRedemptions = new FakeCouponRedemptionRepository();

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

    deps = {
      dailyReports,
      accidentReports: new FakeAccidentReportRepository(),
      customers,
      staff,
      coupons: new FakeCouponRepository(),
      couponRedemptions,
      customerCoupons: new FakeCustomerCouponRepository(),
      familyMembers: new FakeFamilyMemberRepository(),
      reportAiGenerations: new FakeReportAiGenerationRepository(),
      notifier: new FakeNotifierPort(),
      mirror: new FakeOutboxRepository(),
      unitOfWork: new FakeUnitOfWork([dailyReports, couponRedemptions]),
    };
  });

  it('日報履歴に適用済みクーポンが含まれる', async () => {
    const coupon = await deps.coupons.create({
      tenantId,
      code: 'INTRO500',
      name: '紹介キャンペーン 500円引き',
      discountKind: 'amount',
      discountAmountYen: 500,
      discountPercent: null,
      validFrom: null,
      validTo: null,
      audience: 'all',
      eligibilityKind: 'manual',
      birthdaySubject: null,
      usageLimitKind: 'unlimited',
      active: true,
      note: null,
    });

    await saveDailyReport(deps, tenantId, {
      staffId,
      customerId,
      reportDate: '2026-06-01',
      startTime: '09:00',
      endTime: '10:00',
      inputText: 'メモ',
      internalText: '社内',
      customerText: '保護者向け',
      stressLevel: 1,
      esRating: 2,
      couponIds: [coupon.id],
    });

    const history = await getCustomerHistory(deps, tenantId, customerId, null, 5);
    expect(history).toHaveLength(1);
    expect(history[0]?.coupons).toEqual([
      {
        couponId: coupon.id,
        code: 'INTRO500',
        name: '紹介キャンペーン 500円引き',
        discountKind: 'amount',
        discountAmountYen: 500,
        discountPercent: null,
        birthdaySubjectName: null,
      },
    ]);
  });
});

/**
 * 日報が指す対象児・AI生成の記録。DBには (tenant_id, customer_id, id) の複合FKがあるが、
 * FK違反(23503)で落ちると画面には何が悪いのか分からないエラーしか出ないので、保存の手前で弾く。
 */
describe('saveDailyReport の対象児・AI生成の記録', () => {
  const tenantId = 'tenant-1';
  let deps: ReportDeps;
  let dailyReports: FakeDailyReportRepository;
  let familyMembers: FakeFamilyMemberRepository;
  let reportAiGenerations: FakeReportAiGenerationRepository;
  let staffId: string;
  let customerId: string;
  let otherCustomerId: string;

  beforeEach(async () => {
    const staff = new FakeStaffRepository();
    const customers = new FakeCustomerRepository();
    const couponRedemptions = new FakeCouponRedemptionRepository();
    dailyReports = new FakeDailyReportRepository();
    familyMembers = new FakeFamilyMemberRepository();
    reportAiGenerations = new FakeReportAiGenerationRepository();

    const createdStaff = await registerStaff(
      {
        tenants: new FakeTenantRepository(),
        staff,
        sessions: new FakeSessionRepository(),
        passwordResetCodes: new FakePasswordResetCodeRepository(),
        passwordHasher: new FakePasswordHasherPort(),
      },
      { tenantId, name: '佐藤 花子', email: 'hanako@example.com', password: 'seed-password', isAdmin: false },
    );
    staffId = createdStaff.id;

    const customerDeps: CustomerDeps = { customers, familyMembers };
    customerId = (await createCustomer(customerDeps, { tenantId, name: '田中 一郎' })).id;
    otherCustomerId = (await createCustomer(customerDeps, { tenantId, name: '鈴木 次郎' })).id;

    deps = {
      dailyReports,
      accidentReports: new FakeAccidentReportRepository(),
      customers,
      staff,
      coupons: new FakeCouponRepository(),
      couponRedemptions,
      customerCoupons: new FakeCustomerCouponRepository(),
      familyMembers,
      reportAiGenerations,
      notifier: new FakeNotifierPort(),
      mirror: new FakeOutboxRepository(),
      unitOfWork: new FakeUnitOfWork([dailyReports, couponRedemptions]),
    };
  });

  const baseInput = {
    reportDate: '2026-06-01',
    startTime: '09:00',
    endTime: '10:00',
    inputText: 'メモ',
    internalText: '社内',
    customerText: '保護者向け',
    stressLevel: 3,
    esRating: 4,
  };

  /** その顧客の子を1人作る。 */
  async function addChild(ofCustomerId: string): Promise<string> {
    const created = await familyMembers.createMany([
      {
        tenantId,
        customerId: ofCustomerId,
        name: '太郎',
        dobDate: '2025-01-15',
        dobRaw: '2025-01-15',
        info: '',
        allergyStatus: 'unknown',
        allergyNote: null,
      },
    ]);
    const member = created[0];
    if (!member) throw new Error('テストの前提が崩れています');
    return member.id;
  }

  /** その顧客のAI生成を1件作る。 */
  async function addGeneration(ofCustomerId: string): Promise<string> {
    const record = await reportAiGenerations.create({
      tenantId,
      staffId,
      customerId: ofCustomerId,
      targetFamilyMemberId: null,
      promptTemplateId: null,
      promptText: 'prompt',
      model: 'test-model',
      childAgeMonths: null,
      educationLevel: null,
      effectiveEducationLevel: 2,
      stressLevel: null,
      escalationRequired: false,
      inputText: 'メモ',
      timeInfo: '時間指定なし',
      outputJson: { warnings: [], internal: '', customer: '' },
      errorMessage: null,
      candidateKeywordIds: [],
      usedKeywordIds: [],
    });
    return record.id;
  }

  it('省略したら両方 null で保存する(手書きのみ・対象児なし)', async () => {
    const saved = await saveDailyReport(deps, tenantId, { ...baseInput, staffId, customerId });
    expect(saved.targetFamilyMemberId).toBeNull();
    expect(saved.aiGenerationId).toBeNull();
  });

  it('同じ顧客の子・生成なら保存し、履歴にも出す', async () => {
    const memberId = await addChild(customerId);
    const generationId = await addGeneration(customerId);

    const saved = await saveDailyReport(deps, tenantId, {
      ...baseInput,
      staffId,
      customerId,
      targetFamilyMemberId: memberId,
      aiGenerationId: generationId,
    });
    expect(saved.targetFamilyMemberId).toBe(memberId);
    expect(saved.aiGenerationId).toBe(generationId);

    const history = await getCustomerHistory(deps, tenantId, customerId, null, 5);
    expect(history[0]?.targetFamilyMemberId).toBe(memberId);
    expect(history[0]?.aiGenerationId).toBe(generationId);
  });

  it('別の顧客の子は弾く(日報も保存しない)', async () => {
    const otherChild = await addChild(otherCustomerId);

    await expect(
      saveDailyReport(deps, tenantId, {
        ...baseInput,
        staffId,
        customerId,
        targetFamilyMemberId: otherChild,
      }),
    ).rejects.toThrow('対象児が見つかりません');
    expect(await dailyReports.listByCustomer(tenantId, customerId, null, 10)).toEqual([]);
  });

  it('別の顧客のAI生成・存在しないIDは弾く', async () => {
    const otherGeneration = await addGeneration(otherCustomerId);

    await expect(
      saveDailyReport(deps, tenantId, {
        ...baseInput,
        staffId,
        customerId,
        aiGenerationId: otherGeneration,
      }),
    ).rejects.toThrow('AI生成の記録が見つかりません');

    await expect(
      saveDailyReport(deps, tenantId, { ...baseInput, staffId, customerId, aiGenerationId: 'missing' }),
    ).rejects.toThrow('AI生成の記録が見つかりません');
    expect(await dailyReports.listByCustomer(tenantId, customerId, null, 10)).toEqual([]);
  });
});
