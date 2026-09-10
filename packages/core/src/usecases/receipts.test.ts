import { beforeEach, describe, expect, it } from 'vitest';
import { buildReceiptDedupeKey } from '../domain';
import type { AuthDeps } from './auth';
import { registerStaff } from './auth';
import type { CustomerDeps } from './customers';
import { createCustomer } from './customers';
import type { ReceiptDeps } from './receipts';
import { uploadReceipts } from './receipts';
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
      amount,
      storeName,
      handoffText: null,
      fileKey: `${tenantId}/receipts/existing.jpg`,
      contentType: 'image/jpeg',
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
});
