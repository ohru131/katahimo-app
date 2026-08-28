import { createHash, createHmac } from 'node:crypto';
import type { BlindIndexPort, CryptoPort, EncryptedValue } from '../ports/crypto';
import type {
  CustomerPatchInput,
  CustomerProfileFields,
  CustomerRecord,
  CustomerRepositoryPort,
  FamilyMemberRecord,
  FamilyMemberRepositoryPort,
  NewCustomerInput,
  NewFamilyMemberInput,
  NewSessionInput,
  NewStaffInput,
  NewTenantInput,
  SessionRecord,
  SessionRepositoryPort,
  StaffRecord,
  StaffRepositoryPort,
  TenantRecord,
  TenantRepositoryPort,
} from '../ports/repositories';
import type { PasswordHasherPort } from './auth';

/**
 * usecasesのテスト用インメモリ実装群。実DBやKMSを使わず、ports契約だけを満たす形で
 * ドメインロジック(特に「登録時と検索時でブラインドインデックスの正規化が一致しているか」)
 * を検証するためのもの。テスト専用であり、本番コードから参照してはいけない。
 */

/** 暗号化は行わず`ENC:平文`のタグを付けるだけの、検証しやすいフェイク実装。 */
export class FakeCryptoPort implements CryptoPort {
  async encrypt(_tenantId: string, plaintext: string): Promise<EncryptedValue> {
    return { ciphertext: `ENC:${plaintext}`, keyVersion: 1 };
  }
  async decrypt(_tenantId: string, value: EncryptedValue): Promise<string> {
    return value.ciphertext.replace(/^ENC:/, '');
  }
}

/** 本物同様HMAC-SHA256を使う(正規化ミスを検出したいので、ここだけは本物と同じ計算にする)。 */
export class FakeBlindIndexPort implements BlindIndexPort {
  async compute(tenantId: string, normalizedValue: string): Promise<string> {
    const key = createHash('sha256').update('test-fixed-key').update(tenantId).digest();
    return createHmac('sha256', key).update(normalizedValue, 'utf8').digest('hex');
  }
}

export class FakePasswordHasherPort implements PasswordHasherPort {
  async hash(password: string): Promise<string> {
    return `HASH:${password}`;
  }
  async verify(hash: string, password: string): Promise<boolean> {
    return hash === `HASH:${password}`;
  }
}

export class FakeTenantRepository implements TenantRepositoryPort {
  private readonly rows = new Map<string, TenantRecord>();
  private seq = 0;

  async findBySlug(slug: string): Promise<TenantRecord | null> {
    return [...this.rows.values()].find((t) => t.slug === slug) ?? null;
  }
  async create(input: NewTenantInput): Promise<TenantRecord> {
    const record: TenantRecord = { id: `tenant-${++this.seq}`, name: input.name, slug: input.slug };
    this.rows.set(record.id, record);
    return record;
  }
}

export class FakeStaffRepository implements StaffRepositoryPort {
  private readonly rows: StaffRecord[] = [];
  private seq = 0;

  async findByEmailBlindIndex(tenantId: string, emailBlindIndex: string): Promise<StaffRecord | null> {
    return this.rows.find((s) => s.tenantId === tenantId && s.emailBlindIndex === emailBlindIndex) ?? null;
  }
  async findById(tenantId: string, staffId: string): Promise<StaffRecord | null> {
    return this.rows.find((s) => s.tenantId === tenantId && s.id === staffId) ?? null;
  }
  async create(input: NewStaffInput): Promise<StaffRecord> {
    const record: StaffRecord = {
      id: `staff-${++this.seq}`,
      tenantId: input.tenantId,
      name: input.name,
      email: input.email,
      emailBlindIndex: input.emailBlindIndex,
      passwordHash: input.passwordHash,
      isAdmin: input.isAdmin,
      retirementDate: null,
    };
    this.rows.push(record);
    return record;
  }
}

export class FakeSessionRepository implements SessionRepositoryPort {
  private readonly rows: (SessionRecord & { tokenHash: string })[] = [];
  private seq = 0;

  async create(input: NewSessionInput): Promise<SessionRecord> {
    const record = {
      id: `session-${++this.seq}`,
      tenantId: input.tenantId,
      staffId: input.staffId,
      expiresAt: input.expiresAt,
      tokenHash: input.tokenHash,
    };
    this.rows.push(record);
    return record;
  }
  async findByTokenHash(tenantId: string, tokenHash: string): Promise<SessionRecord | null> {
    return this.rows.find((s) => s.tenantId === tenantId && s.tokenHash === tokenHash) ?? null;
  }
}

const EMPTY_PROFILE_FIELDS: CustomerProfileFields = {
  externalSource: null,
  externalId: null,
  familyNameKana: null,
  givenNameKana: null,
  email: null,
  phone: null,
  addressDetail: null,
  city: null,
  parkingArea: null,
  parkingDetail: null,
  emergencyContact: null,
  emergencyContactRelation: null,
  evacuationSite: null,
  memo: null,
  benefitMemberId: null,
  address2: null,
  address2StartDate: null,
  address2EndDate: null,
  latLng: null,
  memberType: null,
  memberStatus: null,
  paymentMethod: null,
  paymentStatus: null,
  gender: null,
  ageBracket: null,
  registeredAt: null,
  externalLastUpdatedAt: null,
};

interface StoredCustomer {
  record: CustomerRecord;
  familyNameBlindIndex: string;
}

export class FakeCustomerRepository implements CustomerRepositoryPort {
  private readonly rows: StoredCustomer[] = [];
  private seq = 0;

  async create(input: NewCustomerInput): Promise<CustomerRecord> {
    const record: CustomerRecord = {
      ...EMPTY_PROFILE_FIELDS,
      ...input,
      id: `customer-${++this.seq}`,
      deactivatedAt: null,
    };
    this.rows.push({ record, familyNameBlindIndex: input.familyNameBlindIndex });
    return record;
  }

  async findById(tenantId: string, customerId: string): Promise<CustomerRecord | null> {
    return (
      this.rows.find((r) => r.record.tenantId === tenantId && r.record.id === customerId)?.record ?? null
    );
  }

  async findByFamilyNameBlindIndex(
    tenantId: string,
    familyNameBlindIndex: string,
  ): Promise<CustomerRecord[]> {
    return this.rows
      .filter((r) => r.record.tenantId === tenantId && r.familyNameBlindIndex === familyNameBlindIndex)
      .map((r) => r.record);
  }

  async findByExternalId(
    tenantId: string,
    externalSource: string,
    externalId: string,
  ): Promise<CustomerRecord | null> {
    return (
      this.rows.find(
        (r) =>
          r.record.tenantId === tenantId &&
          r.record.externalSource === externalSource &&
          r.record.externalId === externalId,
      )?.record ?? null
    );
  }

  async listActiveExternalIds(tenantId: string, externalSource: string): Promise<string[]> {
    return this.rows
      .filter(
        (r) =>
          r.record.tenantId === tenantId &&
          r.record.externalSource === externalSource &&
          r.record.externalId !== null &&
          r.record.deactivatedAt === null,
      )
      .map((r) => r.record.externalId as string);
  }

  async update(tenantId: string, customerId: string, patch: CustomerPatchInput): Promise<CustomerRecord> {
    const stored = this.rows.find((r) => r.record.tenantId === tenantId && r.record.id === customerId);
    if (!stored) throw new Error(`customer not found: ${customerId}`);
    stored.record = { ...stored.record, ...patch };
    if (patch.familyNameBlindIndex) stored.familyNameBlindIndex = patch.familyNameBlindIndex;
    return stored.record;
  }

  async deactivate(tenantId: string, customerId: string): Promise<void> {
    const stored = this.rows.find((r) => r.record.tenantId === tenantId && r.record.id === customerId);
    if (stored) stored.record = { ...stored.record, deactivatedAt: new Date() };
  }
}

interface StoredFamilyMember {
  record: FamilyMemberRecord;
}

export class FakeFamilyMemberRepository implements FamilyMemberRepositoryPort {
  private readonly rows: StoredFamilyMember[] = [];
  private seq = 0;

  private toRecord(input: NewFamilyMemberInput): FamilyMemberRecord {
    return {
      id: `family-member-${++this.seq}`,
      tenantId: input.tenantId,
      customerId: input.customerId,
      name: input.name,
      dob: input.dob,
      info: input.info,
    };
  }

  async createMany(inputs: NewFamilyMemberInput[]): Promise<FamilyMemberRecord[]> {
    const created = inputs.map((i) => this.toRecord(i));
    this.rows.push(...created.map((record) => ({ record })));
    return created;
  }

  async listByCustomerId(tenantId: string, customerId: string): Promise<FamilyMemberRecord[]> {
    return this.rows
      .filter((r) => r.record.tenantId === tenantId && r.record.customerId === customerId)
      .map((r) => r.record);
  }

  async replaceForCustomer(
    tenantId: string,
    customerId: string,
    inputs: NewFamilyMemberInput[],
  ): Promise<FamilyMemberRecord[]> {
    const keep = this.rows.filter(
      (r) => !(r.record.tenantId === tenantId && r.record.customerId === customerId),
    );
    this.rows.length = 0;
    this.rows.push(...keep);
    return this.createMany(inputs);
  }
}
