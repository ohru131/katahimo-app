import {
  normalizeAddressComponentForIndex,
  normalizePhoneForIndex,
  normalizeStaffName,
  splitJapaneseFullName,
} from '../domain';
import type { BlindIndexPort, CryptoPort } from '../ports/crypto';
import type { CustomerRepositoryPort, NewCustomerInput } from '../ports/repositories';

export interface CustomerDeps {
  customers: CustomerRepositoryPort;
  crypto: CryptoPort;
  blindIndex: BlindIndexPort;
}

export interface CreateCustomerInput {
  tenantId: string;
  name: string;
  phone?: string;
  city?: string;
}

/** 顧客を登録する。氏名は姓・名それぞれブラインドインデックス化し、「苗字だけで検索」に対応する。 */
export async function createCustomer(deps: CustomerDeps, input: CreateCustomerInput) {
  const { familyName, givenName } = splitJapaneseFullName(input.name);

  const [nameEnc, familyNameBlindIndex, givenNameBlindIndex] = await Promise.all([
    deps.crypto.encrypt(input.tenantId, input.name),
    deps.blindIndex.compute(input.tenantId, familyName),
    deps.blindIndex.compute(input.tenantId, givenName),
  ]);

  const [phoneEnc, phoneBlindIndex] = input.phone
    ? await Promise.all([
        deps.crypto.encrypt(input.tenantId, input.phone),
        deps.blindIndex.compute(input.tenantId, normalizePhoneForIndex(input.phone)),
      ])
    : [null, null];

  const [cityEnc, cityBlindIndex] = input.city
    ? await Promise.all([
        deps.crypto.encrypt(input.tenantId, input.city),
        deps.blindIndex.compute(input.tenantId, normalizeAddressComponentForIndex(input.city)),
      ])
    : [null, null];

  const record: NewCustomerInput = {
    tenantId: input.tenantId,
    name: nameEnc,
    familyNameBlindIndex,
    givenNameBlindIndex,
    phone: phoneEnc,
    phoneBlindIndex,
    city: cityEnc,
    cityBlindIndex,
  };
  return deps.customers.create(record);
}

export interface CustomerView {
  id: string;
  name: string;
  phone: string | null;
  city: string | null;
}

/**
 * 苗字(姓)の完全一致で顧客を検索する。
 * 部分一致/前方一致はブラインドインデックス方式では実現できないため非対応
 * (現場の「苗字だけで検索することがある」要件はトークン単位の完全一致で満たせると確認済み)。
 */
export async function searchCustomersByFamilyName(
  deps: CustomerDeps,
  tenantId: string,
  familyName: string,
): Promise<CustomerView[]> {
  // splitJapaneseFullName内の姓トークンと同じ正規化(NFKC + 空白除去)を検索入力にも適用する。
  // ここがずれると、登録時と検索時でブラインドインデックスが一致しなくなる。
  const normalizedFamilyName = normalizeStaffName(familyName.normalize('NFKC'));
  const blindIndex = await deps.blindIndex.compute(tenantId, normalizedFamilyName);
  const rows = await deps.customers.findByFamilyNameBlindIndex(tenantId, blindIndex);

  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      name: await deps.crypto.decrypt(tenantId, row.name),
      phone: row.phone ? await deps.crypto.decrypt(tenantId, row.phone) : null,
      city: row.city ? await deps.crypto.decrypt(tenantId, row.city) : null,
    })),
  );
}
