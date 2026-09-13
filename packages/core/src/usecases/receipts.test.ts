import { beforeEach, describe, expect, it } from 'vitest';
import { buildReceiptDedupeKey } from '../domain';
import type { AuthDeps } from './auth';
import { registerStaff } from './auth';
import type { CustomerDeps } from './customers';
import { createCustomer } from './customers';
import type { ReceiptDeps } from './receipts';
import { cancelReceipt, listReceiptsForStaff, uploadReceipts } from './receipts';
import {
  FakeCustomerRepository,
  FakeFamilyMemberRepository,
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

describe('uploadReceipts', () => {
  const tenantId = 'tenant-1';
  let deps: ReceiptDeps;
  let staffId: string;
  let customerId: string;
  let receiptRepository: FakeReceiptRepository;
  let storage: FakeStoragePort;

  beforeEach(async () => {
    const staff = new FakeStaffRepository();
    const customers = new FakeCustomerRepository();

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

    receiptRepository = new FakeReceiptRepository();
    storage = new FakeStoragePort();
    const mirror = new FakeOutboxRepository();
    deps = {
      receipts: receiptRepository,
      staff,
      customers,
      storage,
      notifier: new FakeNotifierPort(),
      mirror,
      unitOfWork: new FakeUnitOfWork([receiptRepository, mirror]),
    };
  });

  it('同一バッチ内に同じ内容の領収書が2枚含まれる場合、2枚目を重複として登録しない', async () => {
    const result = await uploadReceipts(deps, tenantId, {
      staffId,
      customerId,
      images: [
        { data: 'data:image/jpeg;base64,AAAA', amount: '1200', storeName: 'コンビニ' },
        { data: 'data:image/jpeg;base64,BBBB', amount: '1200', storeName: 'コンビニ' },
      ],
      fallbackTimestamp: '2026/08/30 10:00:00',
    });

    expect(result.uploadedCount).toBe(1);
    expect(result.duplicateCount).toBe(1);
    expect(result.duplicates).toHaveLength(1);
    expect(result.duplicates[0]).toMatchObject({ index: 1, amount: '1200', storeName: 'コンビニ' });
  });

  it('内容が異なる領収書が2枚の場合はどちらも重複扱いにしない', async () => {
    const result = await uploadReceipts(deps, tenantId, {
      staffId,
      customerId,
      images: [
        { data: 'data:image/jpeg;base64,AAAA', amount: '1200', storeName: 'コンビニ' },
        { data: 'data:image/jpeg;base64,BBBB', amount: '3000', storeName: 'スーパー' },
      ],
      fallbackTimestamp: '2026/08/30 10:00:00',
    });

    expect(result.uploadedCount).toBe(2);
    expect(result.duplicateCount).toBe(0);
  });

  it('findExistingDedupeKeysをすり抜けても、DB側の一意制約違反を重複として扱いファイルを残さない', async () => {
    const fallbackTimestamp = '2026/08/30 10:00:00';
    const amount = '1200';
    const storeName = 'コンビニ';

    // 同時に別リクエストで既に登録済みの領収書(このテストではfindExistingDedupeKeysで
    // 見つからない=競合状態)を、事前にリポジトリへ直接差し込んでおく。
    const dedupeKey = buildReceiptDedupeKey({
      timestamp: fallbackTimestamp,
      staffId,
      customerId,
      amount,
      storeName,
    });
    await receiptRepository.create({
      tenantId,
      staffId,
      customerId,
      receiptTimestamp: new Date(),
      dedupeKey,
      amountYen: 1200,
      amountRaw: amount,
      storeName,
      handoffText: null,
      fileKey: `${tenantId}/receipts/existing.jpg`,
      contentType: 'image/jpeg',
      billingType: 'company_expense',
    });

    // アプリ側の事前チェックがすり抜けた状況を再現する(本来ならexistingに入っているはず)。
    receiptRepository.findExistingDedupeKeys = async () => new Set();

    const result = await uploadReceipts(deps, tenantId, {
      staffId,
      customerId,
      images: [{ data: 'data:image/jpeg;base64,AAAA', amount, storeName }],
      fallbackTimestamp,
    });

    expect(result.duplicateCount).toBe(1);
    expect(result.uploadedCount).toBe(0);
    expect(result.duplicates[0]).toMatchObject({ amount, storeName });
    // 重複と分かった画像のファイルは残さず消す。
    expect(storage.listKeysForTest()).toEqual([]);
  });

  it('billingTypeを指定しない場合はcompany_expenseになる(取りこぼしが顧客請求に転ばないため)', async () => {
    await uploadReceipts(deps, tenantId, {
      staffId,
      customerId,
      images: [{ data: 'data:image/jpeg;base64,AAAA', amount: '1200', storeName: 'コンビニ' }],
      fallbackTimestamp: '2026/08/30 10:00:00',
    });

    const [record] = receiptRepository.listAllForTest();
    expect(record?.billingType).toBe('company_expense');
  });

  it('billingType=customer_billableを指定すればそのまま保存される', async () => {
    await uploadReceipts(deps, tenantId, {
      staffId,
      customerId,
      images: [
        {
          data: 'data:image/jpeg;base64,AAAA',
          amount: '1200',
          storeName: 'コンビニ',
          billingType: 'customer_billable',
        },
      ],
      fallbackTimestamp: '2026/08/30 10:00:00',
    });

    const [record] = receiptRepository.listAllForTest();
    expect(record?.billingType).toBe('customer_billable');
  });

  it('顧客に紐付かないのにcustomer_billableを指定した場合はDBに落とす前に弾く', async () => {
    await expect(
      uploadReceipts(deps, tenantId, {
        staffId,
        customerId: null,
        images: [
          {
            data: 'data:image/jpeg;base64,AAAA',
            amount: '1200',
            storeName: 'コンビニ',
            billingType: 'customer_billable',
          },
        ],
        fallbackTimestamp: '2026/08/30 10:00:00',
      }),
    ).rejects.toThrow('顧客に請求');
    expect(receiptRepository.listAllForTest()).toHaveLength(0);
  });

  it('金額はamountYen(集計用の整数)とamountRaw(生値)の両方に保存される', async () => {
    await uploadReceipts(deps, tenantId, {
      staffId,
      customerId,
      images: [{ data: 'data:image/jpeg;base64,AAAA', amount: '1,200', storeName: 'コンビニ' }],
      fallbackTimestamp: '2026/08/30 10:00:00',
    });

    const [record] = receiptRepository.listAllForTest();
    expect(record?.amountYen).toBe(1200);
    expect(record?.amountRaw).toBe('1,200');
  });
});

describe('listReceiptsForStaff / cancelReceipt(doc/14 §10)', () => {
  const tenantId = 'tenant-1';
  // 2026-09-14は月曜。+2営業日は水曜(2026-09-16)まで。
  const RECEIPT_DAY = '2026/09/14';
  const WITHIN_DEADLINE = new Date('2026-09-16T09:00:00+09:00');
  const AFTER_DEADLINE = new Date('2026-09-17T09:00:00+09:00');

  let deps: ReceiptDeps;
  let staffId: string;
  let otherStaffId: string;
  let customerId: string;
  let receiptRepository: FakeReceiptRepository;

  beforeEach(async () => {
    const staff = new FakeStaffRepository();
    const customers = new FakeCustomerRepository();

    const authDeps: AuthDeps = {
      tenants: new FakeTenantRepository(),
      staff,
      sessions: new FakeSessionRepository(),
      passwordResetCodes: new FakePasswordResetCodeRepository(),
      passwordHasher: new FakePasswordHasherPort(),
    };
    staffId = (
      await registerStaff(authDeps, {
        tenantId,
        name: '佐藤 花子',
        email: 'hanako@example.com',
        password: 'seed-password',
        isAdmin: false,
      })
    ).id;
    otherStaffId = (
      await registerStaff(authDeps, {
        tenantId,
        name: '鈴木 一郎',
        email: 'ichiro@example.com',
        password: 'seed-password',
        isAdmin: false,
      })
    ).id;

    const customerDeps: CustomerDeps = { customers, familyMembers: new FakeFamilyMemberRepository() };
    customerId = (await createCustomer(customerDeps, { tenantId, name: '田中 一郎' })).id;

    receiptRepository = new FakeReceiptRepository();
    const mirror = new FakeOutboxRepository();
    deps = {
      receipts: receiptRepository,
      staff,
      customers,
      storage: new FakeStoragePort(),
      notifier: new FakeNotifierPort(),
      mirror,
      unitOfWork: new FakeUnitOfWork([receiptRepository, mirror]),
    };
  });

  /** 領収書を1枚登録する。atは'yyyy/MM/dd HH:mm:ss'。 */
  async function upload(opts: {
    at: string;
    amount: string;
    storeName: string;
    staffId?: string;
    customerId?: string | null;
    billingType?: 'customer_billable' | 'company_expense';
  }): Promise<void> {
    await uploadReceipts(deps, tenantId, {
      staffId: opts.staffId ?? staffId,
      customerId: opts.customerId === undefined ? customerId : opts.customerId,
      images: [
        {
          data: `data:image/jpeg;base64,${opts.amount}${opts.storeName}`,
          amount: opts.amount,
          storeName: opts.storeName,
          billingType: opts.billingType,
        },
      ],
      fallbackTimestamp: opts.at,
    });
  }

  /** 直近に登録した1枚のIDを返す。 */
  function latestReceiptId(): string {
    const all = receiptRepository.listAllForTest();
    const last = all[all.length - 1];
    if (!last) throw new Error('領収書が作られていません');
    return last.id;
  }

  it('その月・そのスタッフの領収書だけを新しい順で返す', async () => {
    await upload({ at: '2026/08/10 10:00:00', amount: '1000', storeName: '八月の店' });
    await upload({ at: '2026/09/05 10:00:00', amount: '2000', storeName: '九月の店A' });
    await upload({ at: '2026/09/20 10:00:00', amount: '3000', storeName: '九月の店B' });
    await upload({
      at: '2026/09/15 10:00:00',
      amount: '4000',
      storeName: '別の人の店',
      staffId: otherStaffId,
    });

    const view = await listReceiptsForStaff(deps, tenantId, staffId, '2026-09', WITHIN_DEADLINE);
    expect(view?.receipts.map((r) => r.storeName)).toEqual(['九月の店B', '九月の店A']);
  });

  it('月の境界は半開区間([月初, 翌月初))で、JSTの壁時計で判定する', async () => {
    await upload({ at: '2026/09/01 00:00:00', amount: '100', storeName: '月初' });
    await upload({ at: '2026/09/30 23:59:00', amount: '200', storeName: '月末' });
    await upload({ at: '2026/10/01 00:00:00', amount: '300', storeName: '翌月初' });

    const view = await listReceiptsForStaff(deps, tenantId, staffId, '2026-09', WITHIN_DEADLINE);
    expect(view?.receipts.map((r) => r.storeName)).toEqual(['月末', '月初']);
  });

  it('請求区分ごとの合計を出し、金額を読めなかった領収書は件数で示す', async () => {
    await upload({
      at: '2026/09/01 10:00:00',
      amount: '1000',
      storeName: 'A',
      billingType: 'customer_billable',
    });
    await upload({
      at: '2026/09/02 10:00:00',
      amount: '2000',
      storeName: 'B',
      billingType: 'customer_billable',
    });
    await upload({ at: '2026/09/03 10:00:00', amount: '500', storeName: 'C' });
    await upload({ at: '2026/09/04 10:00:00', amount: '読めず', storeName: 'D' });

    const view = await listReceiptsForStaff(deps, tenantId, staffId, '2026-09', WITHIN_DEADLINE);
    expect(view?.customerBillableTotalYen).toBe(3000);
    expect(view?.companyExpenseTotalYen).toBe(500);
    expect(view?.unreadableAmountCount).toBe(1);
  });

  it('顧客名は表示用にcustomersから引き直す(領収書には複製しない)', async () => {
    await upload({ at: '2026/09/01 10:00:00', amount: '1000', storeName: 'A' });
    const view = await listReceiptsForStaff(deps, tenantId, staffId, '2026-09', WITHIN_DEADLINE);
    expect(view?.receipts[0]?.customerName).toBe('田中 一郎');
  });

  it("yearMonthが'YYYY-MM'でなければnullを返す(呼び出し側が400で弾く)", async () => {
    expect(await listReceiptsForStaff(deps, tenantId, staffId, '2026/09')).toBeNull();
    expect(await listReceiptsForStaff(deps, tenantId, staffId, '2026-13')).toBeNull();
  });

  it('取り消すと一覧には残るが、集計からは外れる(消えた履歴を残さないための設計)', async () => {
    await upload({
      at: `${RECEIPT_DAY} 10:00:00`,
      amount: '1000',
      storeName: 'A',
      billingType: 'customer_billable',
    });
    await upload({ at: `${RECEIPT_DAY} 11:00:00`, amount: '500', storeName: 'B' });
    const receiptId = latestReceiptId();

    const result = await cancelReceipt(deps, tenantId, receiptId, {
      requesterStaffId: staffId,
      allowOtherStaff: false,
      reason: '二重に登録したため',
      today: WITHIN_DEADLINE,
    });
    expect(result).toEqual({ ok: true });

    const view = await listReceiptsForStaff(deps, tenantId, staffId, '2026-09', WITHIN_DEADLINE);
    // 行は消えない。
    expect(view?.receipts).toHaveLength(2);
    expect(view?.cancelledCount).toBe(1);
    // 集計からは外れる(Bの500円が消え、Aの1000円だけが残る)。
    expect(view?.companyExpenseTotalYen).toBe(0);
    expect(view?.customerBillableTotalYen).toBe(1000);

    const cancelled = view?.receipts.find((r) => r.id === receiptId);
    expect(cancelled?.cancelledAt).not.toBeNull();
    expect(cancelled?.cancellationReason).toBe('二重に登録したため');
    expect(cancelled?.cancelledByStaffName).toBe('佐藤 花子');
    // 取り消し済みの行に取消ボタンは出さない。
    expect(cancelled?.canCancel).toBe(false);
  });

  it('理由は任意(空ならnullで残る)', async () => {
    await upload({ at: `${RECEIPT_DAY} 10:00:00`, amount: '1000', storeName: 'A' });
    await cancelReceipt(deps, tenantId, latestReceiptId(), {
      requesterStaffId: staffId,
      allowOtherStaff: false,
      reason: '   ',
      today: WITHIN_DEADLINE,
    });

    const view = await listReceiptsForStaff(deps, tenantId, staffId, '2026-09', WITHIN_DEADLINE);
    expect(view?.receipts[0]?.cancellationReason).toBeNull();
  });

  it('領収書の日付+2営業日を過ぎると取り消せない', async () => {
    await upload({ at: `${RECEIPT_DAY} 10:00:00`, amount: '1000', storeName: 'A' });
    const receiptId = latestReceiptId();

    const result = await cancelReceipt(deps, tenantId, receiptId, {
      requesterStaffId: staffId,
      allowOtherStaff: false,
      reason: null,
      today: AFTER_DEADLINE,
    });
    expect(result).toEqual({ ok: false, reason: 'deadline_passed' });

    // 画面側も、期限を過ぎた行には取消ボタンを出さない。
    const view = await listReceiptsForStaff(deps, tenantId, staffId, '2026-09', AFTER_DEADLINE);
    expect(view?.receipts[0]?.canCancel).toBe(false);
  });

  it('期限内なら取消ボタンを出す(期限当日を含む)', async () => {
    await upload({ at: `${RECEIPT_DAY} 10:00:00`, amount: '1000', storeName: 'A' });
    const view = await listReceiptsForStaff(deps, tenantId, staffId, '2026-09', WITHIN_DEADLINE);
    expect(view?.receipts[0]?.canCancel).toBe(true);
  });

  it('週末をまたぐと期限も後ろにずれる(営業日で数えるため)', async () => {
    // 2026/09/18は金曜。+2営業日は火曜(09/22)。
    await upload({ at: '2026/09/18 10:00:00', amount: '1000', storeName: '金曜の店' });
    const onTuesday = new Date('2026-09-22T09:00:00+09:00');
    const onWednesday = new Date('2026-09-23T09:00:00+09:00');

    expect(
      (await listReceiptsForStaff(deps, tenantId, staffId, '2026-09', onTuesday))?.receipts[0]?.canCancel,
    ).toBe(true);
    expect(
      (await listReceiptsForStaff(deps, tenantId, staffId, '2026-09', onWednesday))?.receipts[0]?.canCancel,
    ).toBe(false);
  });

  it('二重取り消しは弾く(取り消した人・理由・時刻を上書きしない)', async () => {
    await upload({ at: `${RECEIPT_DAY} 10:00:00`, amount: '1000', storeName: 'A' });
    const receiptId = latestReceiptId();
    const options = {
      requesterStaffId: staffId,
      allowOtherStaff: false,
      reason: '1回目',
      today: WITHIN_DEADLINE,
    };
    expect(await cancelReceipt(deps, tenantId, receiptId, options)).toEqual({ ok: true });
    expect(await cancelReceipt(deps, tenantId, receiptId, { ...options, reason: '2回目' })).toEqual({
      ok: false,
      reason: 'already_cancelled',
    });

    const view = await listReceiptsForStaff(deps, tenantId, staffId, '2026-09', WITHIN_DEADLINE);
    expect(view?.receipts[0]?.cancellationReason).toBe('1回目');
  });

  it('他スタッフの領収書は取り消せない(RLSはテナントまでしか絞らないため)', async () => {
    await upload({
      at: `${RECEIPT_DAY} 10:00:00`,
      amount: '1000',
      storeName: 'A',
      staffId: otherStaffId,
    });

    const result = await cancelReceipt(deps, tenantId, latestReceiptId(), {
      requesterStaffId: staffId,
      allowOtherStaff: false,
      reason: null,
      today: WITHIN_DEADLINE,
    });
    expect(result).toEqual({ ok: false, reason: 'forbidden' });
  });

  it('管理者(allowOtherStaff)は他スタッフの領収書も取り消せる', async () => {
    await upload({
      at: `${RECEIPT_DAY} 10:00:00`,
      amount: '1000',
      storeName: 'A',
      staffId: otherStaffId,
    });

    const result = await cancelReceipt(deps, tenantId, latestReceiptId(), {
      requesterStaffId: staffId,
      allowOtherStaff: true,
      reason: null,
      today: WITHIN_DEADLINE,
    });
    expect(result).toEqual({ ok: true });
  });

  it('存在しない領収書IDはnot_found', async () => {
    const result = await cancelReceipt(deps, tenantId, 'nonexistent', {
      requesterStaffId: staffId,
      allowOtherStaff: true,
      reason: null,
      today: WITHIN_DEADLINE,
    });
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('取り消した領収書と同じ内容を登録し直せる(訂正の手段が「取消→新規登録」だけのため)', async () => {
    // 顧客の紐付けだけを間違えた場合、金額も店舗名も日時も同じものを登録し直すことになる。
    // 取り消した行が重複判定に残っていると、ここで弾かれて訂正できなくなる。
    await upload({ at: `${RECEIPT_DAY} 10:00:00`, amount: '1200', storeName: 'コンビニ' });
    await cancelReceipt(deps, tenantId, latestReceiptId(), {
      requesterStaffId: staffId,
      allowOtherStaff: false,
      reason: '顧客を間違えたため',
      today: WITHIN_DEADLINE,
    });

    const result = await uploadReceipts(deps, tenantId, {
      staffId,
      customerId,
      images: [{ data: 'data:image/jpeg;base64,AAAA', amount: '1200', storeName: 'コンビニ' }],
      fallbackTimestamp: `${RECEIPT_DAY} 10:00:00`,
    });
    expect(result.uploadedCount).toBe(1);
    expect(result.duplicateCount).toBe(0);
  });
});
