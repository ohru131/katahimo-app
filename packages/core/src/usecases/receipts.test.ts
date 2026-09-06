import { beforeEach, describe, expect, it } from 'vitest';
import type { AuthDeps } from './auth';
import { registerStaff } from './auth';
import type { CustomerDeps } from './customers';
import { createCustomer } from './customers';
import type { ReceiptDeps } from './receipts';
import { uploadReceipts } from './receipts';
import {
  FakeCryptoPort,
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
} from './testDoubles';

describe('uploadReceipts', () => {
  const tenantId = 'tenant-1';
  let deps: ReceiptDeps;
  let staffId: string;
  let customerId: string;

  beforeEach(async () => {
    const crypto = new FakeCryptoPort();
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
      password: 'pw',
      isAdmin: false,
    });
    staffId = createdStaff.id;

    const customerDeps: CustomerDeps = {
      customers,
      familyMembers: new FakeFamilyMemberRepository(),
      crypto,
    };
    const createdCustomer = await createCustomer(customerDeps, { tenantId, name: '田中 一郎' });
    customerId = createdCustomer.id;

    deps = {
      receipts: new FakeReceiptRepository(),
      staff,
      customers,
      crypto,
      blindIndex: {
        async compute(_tenantId: string, normalizedValue: string) {
          return `blind:${normalizedValue}`;
        },
      },
      storage: new FakeStoragePort(),
      notifier: new FakeNotifierPort(),
      mirror: new FakeOutboxRepository(),
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
});
