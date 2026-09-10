import type { AttendanceRowData } from '../domain/attendance';
import type { LoginThrottlePolicy } from '../domain/auth/loginThrottle';
import { applyFailedLogin } from '../domain/auth/loginThrottle';
import type { CryptoPort, EncryptedValue } from '../ports/crypto';
import type { MailerPort, MailMessage } from '../ports/mailer';
import type { MirrorJob, OutboxJobRecord, OutboxRepositoryPort } from '../ports/mirror';
import type {
  AccidentReportMirrorPayload,
  AttendanceDayMirrorPayload,
  DailyReportMirrorPayload,
  MirrorSenderPort,
  ReceiptMirrorPayload,
} from '../ports/mirrorSender';
import type { NotificationChannel, NotifierPort } from '../ports/notifier';
import type {
  AccidentReportRecord,
  AccidentReportRepositoryPort,
  ActiveStaffRecord,
  AppSettingsPatchInput,
  AppSettingsRecord,
  AppSettingsRepositoryPort,
  AttendanceDayRecord,
  AttendanceDayRepositoryPort,
  ConsumeResetCodeResult,
  CustomerPatchInput,
  CustomerProfileFields,
  CustomerRecord,
  CustomerRepositoryPort,
  DailyReportRecord,
  DailyReportRepositoryPort,
  FamilyMemberRecord,
  FamilyMemberRepositoryPort,
  IssuePasswordResetCodeInput,
  NewAccidentReportInput,
  NewCustomerInput,
  NewDailyReportInput,
  NewFamilyMemberInput,
  NewReceiptInput,
  NewSessionInput,
  NewStaffInput,
  NewTenantInput,
  PasswordResetCodeRepositoryPort,
  ReceiptRecord,
  ReceiptRepositoryPort,
  ReplacePasswordInput,
  ReplacePasswordResult,
  SessionRecord,
  SessionRepositoryPort,
  StaffAdminRecord,
  StaffRecord,
  StaffRepositoryPort,
  TenantRecord,
  TenantRepositoryPort,
  UpdateStaffInput,
  VerifyPasswordResetCodeInput,
} from '../ports/repositories';
import type { StoragePort, StoredFile } from '../ports/storage';
import type { TransactionScope, UnitOfWorkPort } from '../ports/unitOfWork';
import type { PasswordHasherPort } from './auth';

/**
 * usecasesのテスト用インメモリ実装群。実DBやKMSを使わず、ports契約だけを満たす形で
 * ドメインロジック(特に「登録時と照合時で検索キーの正規化が一致しているか」や
 * 「ドメインの書き込みとoutboxへのenqueueが同じトランザクションに乗っているか」)
 * を検証するためのもの。テスト専用であり、本番コードから参照してはいけない。
 */

/**
 * FakeUnitOfWorkのロールバック対象になれるフェイクの目印。
 * 行の配列を丸ごと退避・復元する(1段の浅いコピーで足りる形の行しか持たせていない)。
 */
export interface FakeTransactionParticipant {
  snapshotForTest(): unknown;
  restoreForTest(snapshot: unknown): void;
}

function snapshotRows<T>(rows: readonly T[]): T[] {
  return rows.map((row) => ({ ...row }));
}

function restoreRows<T>(rows: T[], snapshot: unknown): void {
  rows.length = 0;
  rows.push(...(snapshot as T[]));
}

/**
 * UnitOfWorkPortのインメモリ実装。コールバックが例外を投げたら、参加しているフェイクの
 * 中身を呼び出し前の状態へ戻す。これが無いと「ドメインの書き込みとoutboxへのenqueueが
 * 同じトランザクションに乗っているか」をテストで確かめられず、片方だけ確定してしまう
 * 不具合を素通ししてしまう。
 */
export class FakeUnitOfWork implements UnitOfWorkPort {
  constructor(private readonly participants: readonly FakeTransactionParticipant[]) {}

  async run<T>(tenantId: string, fn: (scope: TransactionScope) => Promise<T>): Promise<T> {
    const snapshots = this.participants.map((p) => [p, p.snapshotForTest()] as const);
    try {
      return await fn({ tenantId });
    } catch (error) {
      for (const [participant, snapshot] of snapshots) participant.restoreForTest(snapshot);
      throw error;
    }
  }
}

/** 暗号化は行わず`ENC:平文`のタグを付けるだけの、検証しやすいフェイク実装(app_settingsの資格情報用)。 */
export class FakeCryptoPort implements CryptoPort {
  async encrypt(_tenantId: string, plaintext: string): Promise<EncryptedValue> {
    return { ciphertext: `ENC:${plaintext}`, keyVersion: 1 };
  }
  async decrypt(_tenantId: string, value: EncryptedValue): Promise<string> {
    return value.ciphertext.replace(/^ENC:/, '');
  }
}

/** notify()の呼び出しを記録するだけの、通知先を持たないフェイク実装。 */
export class FakeNotifierPort implements NotifierPort {
  readonly notifications: { tenantId: string; channel: NotificationChannel; text: string }[] = [];

  async notify(tenantId: string, channel: NotificationChannel, text: string): Promise<void> {
    this.notifications.push({ tenantId, channel, text });
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
  async listAll(): Promise<TenantRecord[]> {
    return [...this.rows.values()];
  }
}

export class FakeStaffRepository implements StaffRepositoryPort, FakeTransactionParticipant {
  private readonly rows: StaffRecord[] = [];
  private seq = 0;

  /**
   * 本物の実装は`replacePassword`のなかでセッションも消す(同じトランザクション)。
   * その挙動をテストからも観測できるよう、セッション側の置き換えを受け取る。
   */
  constructor(private readonly sessions?: Pick<SessionRepositoryPort, 'deleteAllForStaff'>) {}

  /**
   * 本物のリポジトリはDBから読んだ値のコピーを返す。ここで内部の行をそのまま返すと
   * 呼び出し側が持つ`StaffRecord`が後の更新で勝手に変わり、「読んだ時点の値」を前提に
   * した処理(楽観ロックなど)のテストが通ってしまう。必ずコピーを返す。
   */
  async findByEmail(tenantId: string, email: string): Promise<StaffRecord | null> {
    const record = this.rows.find((s) => s.tenantId === tenantId && s.email === email);
    return record ? { ...record } : null;
  }
  async findById(tenantId: string, staffId: string): Promise<StaffRecord | null> {
    const record = this.rows.find((s) => s.tenantId === tenantId && s.id === staffId);
    return record ? { ...record } : null;
  }
  async create(input: NewStaffInput): Promise<StaffRecord> {
    const record: StaffRecord = {
      id: `staff-${++this.seq}`,
      tenantId: input.tenantId,
      name: input.name,
      email: input.email,
      phone: input.phone ?? null,
      passwordHash: input.passwordHash ?? null,
      legacyPasswordHash: input.legacyPasswordHash ?? null,
      isAdmin: input.isAdmin,
      retirementDate: null,
      failedLoginAttempts: 0,
      lockedUntil: null,
      mustChangePassword: input.mustChangePassword ?? false,
    };
    this.rows.push(record);
    return { ...record };
  }

  async upgradeToArgon2Hash(tenantId: string, staffId: string, passwordHash: string): Promise<void> {
    const record = this.rows.find((s) => s.tenantId === tenantId && s.id === staffId);
    if (record) {
      record.passwordHash = passwordHash;
      record.legacyPasswordHash = null;
    }
  }

  async replacePassword(input: ReplacePasswordInput): Promise<ReplacePasswordResult> {
    const record = this.rows.find((s) => s.tenantId === input.tenantId && s.id === input.staffId);
    if (!record) return 'stale';
    if (input.expect && record.passwordHash !== input.expect.passwordHash) return 'stale';

    // 本物は1トランザクションなので、セッション破棄が失敗すれば書き換えも巻き戻る。
    // ダブルでも同じ観測結果になるよう、破棄を先に済ませてから書き換える。
    if (input.revokeSessions) await this.sessions?.deleteAllForStaff(input.tenantId, input.staffId);

    record.passwordHash = input.passwordHash;
    record.legacyPasswordHash = null;
    record.mustChangePassword = input.mustChangePassword;
    return 'applied';
  }

  async listAll(tenantId: string): Promise<StaffAdminRecord[]> {
    return this.rows
      .filter((s) => s.tenantId === tenantId)
      .map((s) => ({
        id: s.id,
        name: s.name,
        email: s.email,
        isAdmin: s.isAdmin,
        retirementDate: s.retirementDate,
        mustChangePassword: s.mustChangePassword,
      }));
  }

  async update(tenantId: string, staffId: string, input: UpdateStaffInput): Promise<void> {
    const record = this.rows.find((s) => s.tenantId === tenantId && s.id === staffId);
    if (!record) return;
    if (input.name !== undefined) record.name = input.name;
    if (input.isAdmin !== undefined) record.isAdmin = input.isAdmin;
    if (input.retirementDate !== undefined) record.retirementDate = input.retirementDate;
  }

  async listActive(tenantId: string): Promise<ActiveStaffRecord[]> {
    const todayStr = new Date().toISOString().slice(0, 10);
    return this.rows
      .filter((s) => s.tenantId === tenantId && (!s.retirementDate || s.retirementDate > todayStr))
      .map((s) => ({ id: s.id, name: s.name }));
  }

  /** テスト専用: 退職日を設定する(create()の入力にretirementDateが無いため)。 */
  setRetirementDateForTest(tenantId: string, staffId: string, retirementDate: string | null): void {
    const record = this.rows.find((s) => s.tenantId === tenantId && s.id === staffId);
    if (record) record.retirementDate = retirementDate;
  }

  async recordFailedLogin(tenantId: string, staffId: string, policy: LoginThrottlePolicy): Promise<void> {
    const row = this.rows.find((r) => r.tenantId === tenantId && r.id === staffId);
    if (!row) return;
    // 本物の実装と同じく、保存されている現在値から遷移を計算する
    // (呼び出し側が読んだ値ではない。staffRepository.ts の行ロック参照)。
    const next = applyFailedLogin(row, new Date(), policy);
    row.failedLoginAttempts = next.failedLoginAttempts;
    row.lockedUntil = next.lockedUntil;
  }

  async clearLoginFailures(tenantId: string, staffId: string): Promise<void> {
    const row = this.rows.find((r) => r.tenantId === tenantId && r.id === staffId);
    if (!row) return;
    row.failedLoginAttempts = 0;
    row.lockedUntil = null;
  }

  /** テスト専用: ロック状態を直接設定する。 */
  setLockForTest(staffId: string, lockedUntil: Date | null, failedLoginAttempts = 0): void {
    const row = this.rows.find((r) => r.id === staffId);
    if (!row) return;
    row.lockedUntil = lockedUntil;
    row.failedLoginAttempts = failedLoginAttempts;
  }

  snapshotForTest(): unknown {
    return snapshotRows(this.rows);
  }

  restoreForTest(snapshot: unknown): void {
    restoreRows(this.rows, snapshot);
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
  async deleteAllForStaff(tenantId: string, staffId: string): Promise<void> {
    for (let i = this.rows.length - 1; i >= 0; i--) {
      const row = this.rows[i];
      if (row && row.tenantId === tenantId && row.staffId === staffId) this.rows.splice(i, 1);
    }
  }
  async findByTokenHash(tenantId: string, tokenHash: string): Promise<SessionRecord | null> {
    return this.rows.find((s) => s.tenantId === tenantId && s.tokenHash === tokenHash) ?? null;
  }

  /** テスト専用: そのスタッフのセッション数。再設定で破棄されたことを確かめるのに使う。 */
  countForStaff(tenantId: string, staffId: string): number {
    return this.rows.filter((s) => s.tenantId === tenantId && s.staffId === staffId).length;
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
    this.rows.push({ record });
    return record;
  }

  async findById(tenantId: string, customerId: string): Promise<CustomerRecord | null> {
    return (
      this.rows.find((r) => r.record.tenantId === tenantId && r.record.id === customerId)?.record ?? null
    );
  }

  async findByFamilyName(tenantId: string, familyName: string): Promise<CustomerRecord[]> {
    return this.rows
      .filter((r) => r.record.tenantId === tenantId && r.record.familyName === familyName)
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

  async listActive(tenantId: string): Promise<CustomerRecord[]> {
    return this.rows
      .filter((r) => r.record.tenantId === tenantId && r.record.deactivatedAt === null)
      .map((r) => r.record);
  }

  async update(tenantId: string, customerId: string, patch: CustomerPatchInput): Promise<CustomerRecord> {
    const stored = this.rows.find((r) => r.record.tenantId === tenantId && r.record.id === customerId);
    if (!stored) throw new Error(`customer not found: ${customerId}`);
    stored.record = { ...stored.record, ...patch };
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

export class FakeAttendanceDayRepository implements AttendanceDayRepositoryPort, FakeTransactionParticipant {
  private readonly rows: AttendanceDayRecord[] = [];
  private seq = 0;

  async findByStaffAndDate(
    tenantId: string,
    staffId: string,
    businessDate: string,
  ): Promise<AttendanceDayRecord | null> {
    return (
      this.rows.find(
        (r) => r.tenantId === tenantId && r.staffId === staffId && r.businessDate === businessDate,
      ) ?? null
    );
  }

  async findById(tenantId: string, id: string): Promise<AttendanceDayRecord | null> {
    return this.rows.find((r) => r.tenantId === tenantId && r.id === id) ?? null;
  }

  /** 指定スタッフ・指定日の勤怠行があれば上書き、無ければ新規作成する。 */
  async upsert(
    tenantId: string,
    staffId: string,
    businessDate: string,
    rowData: AttendanceRowData,
  ): Promise<AttendanceDayRecord> {
    const existing = this.rows.find(
      (r) => r.tenantId === tenantId && r.staffId === staffId && r.businessDate === businessDate,
    );
    if (existing) {
      existing.rowData = rowData;
      existing.updatedAt = new Date();
      return existing;
    }
    const record: AttendanceDayRecord = {
      id: `attendance-day-${++this.seq}`,
      tenantId,
      staffId,
      businessDate,
      rowData,
      updatedAt: new Date(),
    };
    this.rows.push(record);
    return record;
  }

  async listByStaffAndMonth(
    tenantId: string,
    staffId: string,
    yearMonth: string,
  ): Promise<AttendanceDayRecord[]> {
    return this.rows.filter(
      (r) => r.tenantId === tenantId && r.staffId === staffId && r.businessDate.startsWith(yearMonth),
    );
  }

  async listByStaffAndDateRange(
    tenantId: string,
    staffId: string,
    startDate: string,
    endDate: string,
  ): Promise<AttendanceDayRecord[]> {
    return this.rows.filter(
      (r) =>
        r.tenantId === tenantId &&
        r.staffId === staffId &&
        r.businessDate >= startDate &&
        r.businessDate <= endDate,
    );
  }

  snapshotForTest(): unknown {
    return snapshotRows(this.rows);
  }

  restoreForTest(snapshot: unknown): void {
    restoreRows(this.rows, snapshot);
  }
}

export class FakeAppSettingsRepository implements AppSettingsRepositoryPort {
  private readonly rows = new Map<string, AppSettingsRecord>();

  async find(tenantId: string): Promise<AppSettingsRecord | null> {
    return this.rows.get(tenantId) ?? null;
  }

  async upsert(tenantId: string, patch: AppSettingsPatchInput): Promise<AppSettingsRecord> {
    const existing: AppSettingsRecord = this.rows.get(tenantId) ?? {
      tenantId,
      geminiApiKey: null,
      geminiReportModel: null,
      geminiOcrModel: null,
      gchatReportWebhookUrl: null,
      gchatReceiptWebhookUrl: null,
    };
    const updated: AppSettingsRecord = { ...existing, ...patch };
    this.rows.set(tenantId, updated);
    return updated;
  }
}

/** ファイルシステムを使わないインメモリ実装。 */
export class FakeStoragePort implements StoragePort {
  private readonly files = new Map<string, { contentType: string; body: Uint8Array }>();

  async put(key: string, contentType: string, body: Uint8Array): Promise<StoredFile> {
    this.files.set(key, { contentType, body });
    return { key, contentType, byteSize: body.byteLength };
  }
  async get(key: string): Promise<Uint8Array | null> {
    return this.files.get(key)?.body ?? null;
  }
  async delete(key: string): Promise<void> {
    this.files.delete(key);
  }
  async signedUrl(key: string): Promise<string> {
    return `fake://${key}`;
  }

  /** テスト専用: 現在置かれているファイルのキー一覧。 */
  listKeysForTest(): string[] {
    return [...this.files.keys()];
  }
}

export class FakeDailyReportRepository implements DailyReportRepositoryPort, FakeTransactionParticipant {
  private readonly rows: DailyReportRecord[] = [];
  private seq = 0;

  async create(input: NewDailyReportInput): Promise<DailyReportRecord> {
    const record: DailyReportRecord = { id: `daily-report-${++this.seq}`, ...input, updatedAt: new Date() };
    this.rows.push(record);
    return record;
  }
  async update(tenantId: string, id: string, input: NewDailyReportInput): Promise<DailyReportRecord | null> {
    const index = this.rows.findIndex((r) => r.tenantId === tenantId && r.id === id);
    if (index === -1) return null;
    const record: DailyReportRecord = { id, ...input, updatedAt: new Date() };
    this.rows[index] = record;
    return record;
  }
  async findById(tenantId: string, id: string): Promise<DailyReportRecord | null> {
    return this.rows.find((r) => r.tenantId === tenantId && r.id === id) ?? null;
  }
  async listByCustomer(
    tenantId: string,
    customerId: string,
    before: Date | null,
    limit: number,
  ): Promise<DailyReportRecord[]> {
    return this.rows
      .filter(
        (r) => r.tenantId === tenantId && r.customerId === customerId && (!before || r.occurredAt < before),
      )
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
      .slice(0, limit);
  }

  snapshotForTest(): unknown {
    return snapshotRows(this.rows);
  }

  restoreForTest(snapshot: unknown): void {
    restoreRows(this.rows, snapshot);
  }
}

export class FakeAccidentReportRepository
  implements AccidentReportRepositoryPort, FakeTransactionParticipant
{
  private readonly rows: AccidentReportRecord[] = [];
  private seq = 0;

  async create(input: NewAccidentReportInput): Promise<AccidentReportRecord> {
    const record: AccidentReportRecord = {
      id: `accident-report-${++this.seq}`,
      ...input,
      updatedAt: new Date(),
    };
    this.rows.push(record);
    return record;
  }
  async update(
    tenantId: string,
    id: string,
    input: NewAccidentReportInput,
  ): Promise<AccidentReportRecord | null> {
    const index = this.rows.findIndex((r) => r.tenantId === tenantId && r.id === id);
    if (index === -1) return null;
    const record: AccidentReportRecord = { id, ...input, updatedAt: new Date() };
    this.rows[index] = record;
    return record;
  }
  async findById(tenantId: string, id: string): Promise<AccidentReportRecord | null> {
    return this.rows.find((r) => r.tenantId === tenantId && r.id === id) ?? null;
  }
  async listByCustomer(
    tenantId: string,
    customerId: string,
    before: Date | null,
    limit: number,
  ): Promise<AccidentReportRecord[]> {
    return this.rows
      .filter(
        (r) => r.tenantId === tenantId && r.customerId === customerId && (!before || r.occurredAt < before),
      )
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
      .slice(0, limit);
  }

  snapshotForTest(): unknown {
    return snapshotRows(this.rows);
  }

  restoreForTest(snapshot: unknown): void {
    restoreRows(this.rows, snapshot);
  }
}

interface StoredReceipt {
  record: ReceiptRecord;
  dedupeKey: string | null;
}

export class FakeReceiptRepository implements ReceiptRepositoryPort, FakeTransactionParticipant {
  private readonly rows: StoredReceipt[] = [];
  private seq = 0;

  /**
   * 領収書を1件作成する。`receipts_tenant_dedupe_key_uidx`(dedupeKeyがある行だけの一意
   * インデックス)を再現するため、同一tenantId・同一dedupeKeyの行が既にあれば
   * PostgreSQLの一意制約違反(SQLSTATE 23505)と同じ形のエラーを投げる。
   */
  async create(input: NewReceiptInput): Promise<ReceiptRecord> {
    if (input.dedupeKey !== null) {
      const conflict = this.rows.some(
        (r) => r.record.tenantId === input.tenantId && r.dedupeKey === input.dedupeKey,
      );
      if (conflict) {
        throw Object.assign(
          new Error('duplicate key value violates unique constraint "receipts_tenant_dedupe_key_uidx"'),
          { code: '23505' },
        );
      }
    }
    const record: ReceiptRecord = {
      id: `receipt-${++this.seq}`,
      tenantId: input.tenantId,
      staffId: input.staffId,
      customerId: input.customerId,
      receiptTimestamp: input.receiptTimestamp,
      amount: input.amount,
      storeName: input.storeName,
      handoffText: input.handoffText,
      fileKey: input.fileKey,
      contentType: input.contentType,
      createdAt: new Date(),
    };
    this.rows.push({ record, dedupeKey: input.dedupeKey });
    return record;
  }

  async findById(tenantId: string, id: string): Promise<ReceiptRecord | null> {
    return this.rows.find((r) => r.record.tenantId === tenantId && r.record.id === id)?.record ?? null;
  }

  /** 渡されたdedupeKeyのうち、このテナントで既に登録済みのものだけを返す。 */
  async findExistingDedupeKeys(tenantId: string, dedupeKeys: string[]): Promise<Set<string>> {
    const keys = new Set(dedupeKeys);
    return new Set(
      this.rows
        .filter((r) => r.record.tenantId === tenantId && r.dedupeKey && keys.has(r.dedupeKey))
        .map((r) => r.dedupeKey as string),
    );
  }

  snapshotForTest(): unknown {
    return snapshotRows(this.rows);
  }

  restoreForTest(snapshot: unknown): void {
    restoreRows(this.rows, snapshot);
  }
}

/**
 * outbox_jobsのインメモリ実装。テナントごとの配列で保持し、claimPendingはDrizzle実装と同様に
 * pending→processingへ遷移させてから返す(実DBのFOR UPDATE SKIP LOCKEDに相当する排他制御は
 * テストでは不要なため省略)。
 */
export interface OutboxRowForTest extends OutboxJobRecord {
  idempotencyKey: string;
  status: string;
  nextAttemptAt: Date | null;
  lastError: string | null;
}

export class FakeOutboxRepository implements OutboxRepositoryPort, FakeTransactionParticipant {
  private readonly rows: OutboxRowForTest[] = [];
  private seq = 0;

  /** 再試行の待ち時間を検証できるよう、時刻を差し替えられるようにしてある。 */
  constructor(private readonly now: () => Date = () => new Date()) {}

  async enqueue(job: MirrorJob): Promise<void> {
    if (this.rows.some((r) => r.tenantId === job.tenantId && r.idempotencyKey === job.idempotencyKey)) {
      return;
    }
    this.rows.push({
      id: `outbox-${++this.seq}`,
      tenantId: job.tenantId,
      kind: job.kind,
      targetId: job.targetId,
      idempotencyKey: job.idempotencyKey,
      attempts: 0,
      status: 'pending',
      nextAttemptAt: null,
      lastError: null,
    });
  }

  async claimPending(tenantId: string, limit: number): Promise<OutboxJobRecord[]> {
    const now = this.now().getTime();
    const claimed = this.rows
      .filter(
        (r) =>
          r.tenantId === tenantId &&
          r.status === 'pending' &&
          (r.nextAttemptAt === null || r.nextAttemptAt.getTime() <= now),
      )
      .slice(0, limit);
    for (const r of claimed) {
      r.status = 'processing';
      r.attempts += 1;
    }
    return claimed.map(({ id, tenantId: t, kind, targetId, attempts }) => ({
      id,
      tenantId: t,
      kind,
      targetId,
      attempts,
    }));
  }

  async markDone(tenantId: string, id: string): Promise<void> {
    const row = this.rows.find((r) => r.tenantId === tenantId && r.id === id);
    if (row) row.status = 'done';
  }

  async markFailed(tenantId: string, id: string, error: string, nextAttemptAt: Date | null): Promise<void> {
    const row = this.rows.find((r) => r.tenantId === tenantId && r.id === id);
    if (!row) return;
    row.lastError = error;
    // nextAttemptAtがあれば再試行待ち(pending)へ戻す。nullなら終端(デッドレター)。
    row.status = nextAttemptAt === null ? 'failed' : 'pending';
    row.nextAttemptAt = nextAttemptAt;
  }

  /** テスト専用: 現在保持しているジョブ一覧(status/再試行予定を含む)を確認する。 */
  listAllForTest(): readonly OutboxRowForTest[] {
    return this.rows;
  }

  snapshotForTest(): unknown {
    return snapshotRows(this.rows);
  }

  restoreForTest(snapshot: unknown): void {
    restoreRows(this.rows, snapshot);
  }
}

/** send*()の呼び出し引数を記録するだけの、実際には何も送らないフェイク実装。 */
export class FakeMirrorSenderPort implements MirrorSenderPort {
  readonly dailyReports: DailyReportMirrorPayload[] = [];
  readonly accidentReports: AccidentReportMirrorPayload[] = [];
  readonly receipts: ReceiptMirrorPayload[] = [];
  readonly attendanceDays: AttendanceDayMirrorPayload[] = [];

  async sendDailyReport(payload: DailyReportMirrorPayload): Promise<void> {
    this.dailyReports.push(payload);
  }
  async sendAccidentReport(payload: AccidentReportMirrorPayload): Promise<void> {
    this.accidentReports.push(payload);
  }
  async sendReceipt(payload: ReceiptMirrorPayload): Promise<void> {
    this.receipts.push(payload);
  }
  async sendAttendanceDay(payload: AttendanceDayMirrorPayload): Promise<void> {
    this.attendanceDays.push(payload);
  }
}

/** 送ったメールを溜めるだけの MailerPort。文面と宛先の検証に使う。 */
export class FakeMailer implements MailerPort {
  readonly sent: MailMessage[] = [];
  private failNext = false;

  async send(message: MailMessage): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('メール送信に失敗しました(テスト)');
    }
    this.sent.push(message);
  }

  /** テスト専用: 次の1通だけ送信を失敗させる。 */
  failNextForTest(): void {
    this.failNext = true;
  }

  /** 最後に送ったメール。1通も送っていなければ undefined。 */
  get last(): MailMessage | undefined {
    return this.sent[this.sent.length - 1];
  }
}

export class FakePasswordResetCodeRepository
  implements PasswordResetCodeRepositoryPort, FakeTransactionParticipant
{
  private readonly rows: {
    id: string;
    tenantId: string;
    staffId: string;
    codeVerifier: string;
    expiresAt: Date;
    consumedAt: Date | null;
    failedAttempts: number;
  }[] = [];
  private seq = 0;

  async issue(input: IssuePasswordResetCodeInput): Promise<void> {
    await this.consumeAllForStaff(input.tenantId, input.staffId);
    this.rows.push({
      id: `reset-${++this.seq}`,
      tenantId: input.tenantId,
      staffId: input.staffId,
      codeVerifier: input.codeVerifier,
      expiresAt: input.expiresAt,
      consumedAt: null,
      failedAttempts: 0,
    });
  }

  async verifyAndConsume(input: VerifyPasswordResetCodeInput): Promise<ConsumeResetCodeResult> {
    const now = Date.now();
    // 実装(Drizzle側)は created_at の降順で1件だけ見るので、後に作ったものを優先する。
    const row = [...this.rows]
      .reverse()
      .find(
        (r) =>
          r.tenantId === input.tenantId &&
          r.staffId === input.staffId &&
          !r.consumedAt &&
          r.expiresAt.getTime() > now,
      );
    if (!row) return 'unavailable';

    if (row.failedAttempts >= input.maxFailedAttempts) {
      row.consumedAt = new Date();
      return 'unavailable';
    }
    if (row.codeVerifier !== input.codeVerifier) {
      row.failedAttempts += 1;
      return 'mismatch';
    }
    row.consumedAt = new Date();
    return 'consumed';
  }

  async consumeAllForStaff(tenantId: string, staffId: string): Promise<void> {
    for (const row of this.rows) {
      if (row.tenantId === tenantId && row.staffId === staffId && !row.consumedAt) {
        row.consumedAt = new Date();
      }
    }
  }

  /** テスト専用: 有効なコードの期限を過去にずらす。 */
  expireAllForTest(): void {
    for (const row of this.rows) row.expiresAt = new Date(Date.now() - 1000);
  }

  snapshotForTest(): unknown {
    return snapshotRows(this.rows);
  }

  restoreForTest(snapshot: unknown): void {
    restoreRows(this.rows, snapshot);
  }
}
