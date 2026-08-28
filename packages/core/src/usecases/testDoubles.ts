import { createHash, createHmac } from 'node:crypto';
import type { BlindIndexPort, CryptoPort, EncryptedValue } from '../ports/crypto';
import type {
  CustomerRecord,
  CustomerRepositoryPort,
  NewCustomerInput,
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

interface StoredCustomer {
  record: CustomerRecord;
  familyNameBlindIndex: string;
}

export class FakeCustomerRepository implements CustomerRepositoryPort {
  private readonly rows: StoredCustomer[] = [];
  private seq = 0;

  async create(input: NewCustomerInput): Promise<CustomerRecord> {
    const record: CustomerRecord = {
      id: `customer-${++this.seq}`,
      tenantId: input.tenantId,
      name: input.name,
      phone: input.phone,
      city: input.city,
    };
    this.rows.push({ record, familyNameBlindIndex: input.familyNameBlindIndex });
    return record;
  }
  async findByFamilyNameBlindIndex(
    tenantId: string,
    familyNameBlindIndex: string,
  ): Promise<CustomerRecord[]> {
    return this.rows
      .filter((r) => r.record.tenantId === tenantId && r.familyNameBlindIndex === familyNameBlindIndex)
      .map((r) => r.record);
  }
}
