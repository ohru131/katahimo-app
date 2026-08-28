/**
 * DBアクセスのポート。実装はDrizzleスキーマを持つ @katahimo/db に置く
 * (このパッケージはDBクライアントに依存しないという境界を守るため、インターフェースだけ持つ)。
 */

export interface EncryptedField {
  ciphertext: string;
  keyVersion: number;
}

export interface StaffRecord {
  id: string;
  tenantId: string;
  name: EncryptedField;
  email: EncryptedField;
  emailBlindIndex: string;
  passwordHash: string;
  isAdmin: boolean;
  retirementDate: string | null;
}

export interface NewStaffInput {
  tenantId: string;
  name: EncryptedField;
  familyNameBlindIndex: string;
  givenNameBlindIndex: string;
  email: EncryptedField;
  emailBlindIndex: string;
  passwordHash: string;
  isAdmin: boolean;
}

export interface StaffRepositoryPort {
  findByEmailBlindIndex(tenantId: string, emailBlindIndex: string): Promise<StaffRecord | null>;
  findById(tenantId: string, staffId: string): Promise<StaffRecord | null>;
  create(input: NewStaffInput): Promise<StaffRecord>;
}

export interface NewSessionInput {
  tenantId: string;
  staffId: string;
  tokenHash: string;
  expiresAt: Date;
}

export interface SessionRecord {
  id: string;
  tenantId: string;
  staffId: string;
  expiresAt: Date;
}

export interface SessionRepositoryPort {
  create(input: NewSessionInput): Promise<SessionRecord>;
  /**
   * セッションCookieには `tenantId.rawToken` の形でテナントIDを含める(usecases/auth.ts の
   * encodeSessionCookie/decodeSessionCookie参照)ため、この検索は常にtenantIdが先に分かっている
   * 前提で呼ぶ。sessionsテーブルはRLS対象であり、tenantIdが分からないまま検索しようとすると
   * (app.tenant_idが未設定のため)常に0件になる、というRLSの設計上の制約に対応するための構造。
   */
  findByTokenHash(tenantId: string, tokenHash: string): Promise<SessionRecord | null>;
}

export interface TenantRecord {
  id: string;
  name: string;
  slug: string;
}

export interface NewTenantInput {
  name: string;
  slug: string;
}

export interface TenantRepositoryPort {
  findBySlug(slug: string): Promise<TenantRecord | null>;
  create(input: NewTenantInput): Promise<TenantRecord>;
}

export interface CustomerRecord {
  id: string;
  tenantId: string;
  name: EncryptedField;
  phone: EncryptedField | null;
  city: EncryptedField | null;
}

export interface NewCustomerInput {
  tenantId: string;
  name: EncryptedField;
  familyNameBlindIndex: string;
  givenNameBlindIndex: string;
  phone: EncryptedField | null;
  phoneBlindIndex: string | null;
  city: EncryptedField | null;
  cityBlindIndex: string | null;
}

export interface CustomerRepositoryPort {
  create(input: NewCustomerInput): Promise<CustomerRecord>;
  findByFamilyNameBlindIndex(tenantId: string, familyNameBlindIndex: string): Promise<CustomerRecord[]>;
}
