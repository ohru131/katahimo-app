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

/**
 * 顧客プロファイル。RESERVA CSVの全列(パスワード列を除く)に対応するフィールドを持つ
 * (packages/db/src/schema/customers.ts参照)。個人特定につながる値は全てEncryptedField、
 * 会員種別・支払状況等の分類情報はプレーンな文字列/日付として保持する。
 */
export interface CustomerProfileFields {
  externalSource: string | null;
  externalId: string | null;
  familyNameKana: EncryptedField | null;
  givenNameKana: EncryptedField | null;
  email: EncryptedField | null;
  phone: EncryptedField | null;
  addressDetail: EncryptedField | null;
  city: EncryptedField | null;
  parkingArea: EncryptedField | null;
  parkingDetail: EncryptedField | null;
  emergencyContact: EncryptedField | null;
  emergencyContactRelation: EncryptedField | null;
  evacuationSite: EncryptedField | null;
  memo: EncryptedField | null;
  benefitMemberId: EncryptedField | null;
  address2: EncryptedField | null;
  address2StartDate: string | null;
  address2EndDate: string | null;
  latLng: EncryptedField | null;
  memberType: string | null;
  memberStatus: string | null;
  paymentMethod: string | null;
  paymentStatus: string | null;
  gender: string | null;
  ageBracket: string | null;
  registeredAt: Date | null;
  externalLastUpdatedAt: Date | null;
}

export interface CustomerRecord extends CustomerProfileFields {
  id: string;
  tenantId: string;
  name: EncryptedField;
  deactivatedAt: Date | null;
}

export interface NewCustomerInput extends Partial<CustomerProfileFields> {
  tenantId: string;
  name: EncryptedField;
  familyNameBlindIndex: string;
  givenNameBlindIndex: string;
  phoneBlindIndex?: string | null;
  cityBlindIndex?: string | null;
  emailBlindIndex?: string | null;
}

/** 顧客の更新は「渡されたフィールドだけ上書きする」部分更新(PATCH)方式。 */
export type CustomerPatchInput = Partial<NewCustomerInput>;

export interface CustomerRepositoryPort {
  create(input: NewCustomerInput): Promise<CustomerRecord>;
  findById(tenantId: string, customerId: string): Promise<CustomerRecord | null>;
  findByFamilyNameBlindIndex(tenantId: string, familyNameBlindIndex: string): Promise<CustomerRecord[]>;
  findByExternalId(
    tenantId: string,
    externalSource: string,
    externalId: string,
  ): Promise<CustomerRecord | null>;
  /** 差分取込の比較対象にする、有効(未deactivate)な外部ID一覧。 */
  listActiveExternalIds(tenantId: string, externalSource: string): Promise<string[]>;
  update(tenantId: string, customerId: string, patch: CustomerPatchInput): Promise<CustomerRecord>;
  /** 物理削除はせず、deactivatedAtを設定するソフトデリート。 */
  deactivate(tenantId: string, customerId: string): Promise<void>;
}

export interface FamilyMemberRecord {
  id: string;
  tenantId: string;
  customerId: string;
  name: EncryptedField;
  dob: EncryptedField | null;
  info: EncryptedField | null;
}

export interface NewFamilyMemberInput {
  tenantId: string;
  customerId: string;
  name: EncryptedField;
  dob: EncryptedField | null;
  info: EncryptedField | null;
}

export interface FamilyMemberRepositoryPort {
  createMany(inputs: NewFamilyMemberInput[]): Promise<FamilyMemberRecord[]>;
  listByCustomerId(tenantId: string, customerId: string): Promise<FamilyMemberRecord[]>;
  /** 更新時は全件入れ替え(現在の世帯構成員一覧で置き換える)。誰が増減したかの追跡はしない。 */
  replaceForCustomer(
    tenantId: string,
    customerId: string,
    inputs: NewFamilyMemberInput[],
  ): Promise<FamilyMemberRecord[]>;
}
