import { beforeEach, describe, expect, it } from 'vitest';
import type { CustomerDeps } from './customers';
import { createCustomer, searchCustomersByFamilyName } from './customers';
import { FakeBlindIndexPort, FakeCryptoPort, FakeCustomerRepository } from './testDoubles';

describe('createCustomer / searchCustomersByFamilyName', () => {
  let deps: CustomerDeps;
  const tenantId = 'tenant-1';

  beforeEach(() => {
    deps = {
      customers: new FakeCustomerRepository(),
      crypto: new FakeCryptoPort(),
      blindIndex: new FakeBlindIndexPort(),
    };
  });

  it('登録した顧客を苗字の完全一致で検索できる(登録時と検索時のブラインドインデックスが一致する)', async () => {
    await createCustomer(deps, { tenantId, name: '佐藤 花子', phone: '090-1111-2222', city: '渋谷区' });
    await createCustomer(deps, { tenantId, name: '佐藤 次郎', phone: '090-3333-4444', city: '新宿区' });
    await createCustomer(deps, { tenantId, name: '鈴木 三郎' });

    const result = await searchCustomersByFamilyName(deps, tenantId, '佐藤');
    expect(result.map((c) => c.name).sort()).toEqual(['佐藤 次郎', '佐藤 花子']);
  });

  it('全角スペース区切りで登録した氏名も、検索側の入力(前後空白付き)と正しく一致する', async () => {
    await createCustomer(deps, { tenantId, name: '佐藤　花子' });

    const result = await searchCustomersByFamilyName(deps, tenantId, '  佐藤  ');
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('佐藤　花子');
  });

  it('一致する苗字が無ければ空配列を返す', async () => {
    await createCustomer(deps, { tenantId, name: '佐藤 花子' });
    expect(await searchCustomersByFamilyName(deps, tenantId, '田中')).toEqual([]);
  });

  it('電話・市区町村は復号された値で返る', async () => {
    await createCustomer(deps, { tenantId, name: '佐藤 花子', phone: '090-1111-2222', city: '渋谷区' });
    const [result] = await searchCustomersByFamilyName(deps, tenantId, '佐藤');
    expect(result?.phone).toBe('090-1111-2222');
    expect(result?.city).toBe('渋谷区');
  });

  it('他テナントの同姓顧客はヒットしない(テナント分離)', async () => {
    await createCustomer(deps, { tenantId: 'tenant-2', name: '佐藤 一郎' });
    expect(await searchCustomersByFamilyName(deps, tenantId, '佐藤')).toEqual([]);
  });
});
