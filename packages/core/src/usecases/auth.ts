import { createHash, randomBytes } from 'node:crypto';
import { computeLegacyHash, normalizeEmailForIndex, splitJapaneseFullName } from '../domain';
import type { BlindIndexPort, CryptoPort } from '../ports/crypto';
import type {
  NewSessionInput,
  NewStaffInput,
  SessionRepositoryPort,
  StaffRepositoryPort,
  TenantRepositoryPort,
} from '../ports/repositories';

export interface PasswordHasherPort {
  hash(password: string): Promise<string>;
  verify(hash: string, password: string): Promise<boolean>;
}

export interface AuthDeps {
  tenants: TenantRepositoryPort;
  staff: StaffRepositoryPort;
  sessions: SessionRepositoryPort;
  crypto: CryptoPort;
  blindIndex: BlindIndexPort;
  passwordHasher: PasswordHasherPort;
  /**
   * GAS版Script Properties AUTH_SALTと同じ値。既存スタッフがパスワード変更なしでログイン
   * できるようにするための移行専用の値で、未設定でも新規登録スタッフのログインには影響しない
   * (legacyPasswordHashを持つスタッフだけがこれを必要とする)。
   */
  legacyAuthSalt?: string;
}

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** セッショントークン(生の値)からDB保存用のハッシュを計算する。DBダンプが漏れてもCookieに使える値を得られないようにするため。 */
export function hashSessionToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

export interface LoginInput {
  tenantSlug: string;
  email: string;
  password: string;
}

export type LoginResult =
  | {
      ok: true;
      /** httpOnly Cookieにそのまま保存する値。tenantIdを含むため、これ単体で以後のセッション検証が完結する。 */
      sessionCookieValue: string;
      expiresAt: Date;
      staff: { id: string; tenantId: string; name: string; email: string; isAdmin: boolean };
    }
  | { ok: false; reason: 'tenant_not_found' | 'invalid_credentials' | 'retired' };

const SESSION_COOKIE_SEPARATOR = '.';

/**
 * セッションCookieの値は `tenantId.rawToken` の形にする。
 *
 * sessions テーブルはRLS対象(tenant_idで分離)なので、findByTokenHashを呼ぶには先に
 * tenantIdが分かっている必要がある。ログイン直後は`login()`の戻り値からtenantIdが
 * 分かるが、その後のリクエスト(GET /api/auth/me 等)ではCookieしか手がかりが無いため、
 * Cookie自体にtenantIdを埋め込んでおく。tenantIdだけ分かっても、対応する生トークンを
 * 知らなければセッションを乗っ取れないため、これを平文で保持しても安全。
 */
export function encodeSessionCookie(tenantId: string, rawToken: string): string {
  return `${tenantId}${SESSION_COOKIE_SEPARATOR}${rawToken}`;
}

export function decodeSessionCookie(cookieValue: string): { tenantId: string; rawToken: string } | null {
  const idx = cookieValue.indexOf(SESSION_COOKIE_SEPARATOR);
  if (idx <= 0 || idx === cookieValue.length - 1) return null;
  return { tenantId: cookieValue.slice(0, idx), rawToken: cookieValue.slice(idx + 1) };
}

/**
 * メール+パスワードでのログイン。
 *
 * テナントはURLではなくログインフォームで渡される`tenantSlug`から先に特定する(RLS対象外の
 * tenantsテーブルへの問い合わせ)。テナントが決まって初めて、そのテナント内で
 * emailのブラインドインデックスによる検索ができる(全テナント横断でメールを検索しない)。
 */
export async function login(deps: AuthDeps, input: LoginInput): Promise<LoginResult> {
  const tenant = await deps.tenants.findBySlug(input.tenantSlug);
  if (!tenant) return { ok: false, reason: 'tenant_not_found' };

  const emailBlindIndex = await deps.blindIndex.compute(tenant.id, normalizeEmailForIndex(input.email));
  const staff = await deps.staff.findByEmailBlindIndex(tenant.id, emailBlindIndex);
  if (!staff) return { ok: false, reason: 'invalid_credentials' };

  if (staff.retirementDate) {
    const retireDate = new Date(staff.retirementDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (retireDate <= today) return { ok: false, reason: 'retired' };
  }

  let matched = staff.passwordHash
    ? await deps.passwordHasher.verify(staff.passwordHash, input.password)
    : false;

  // GAS版から移行したスタッフ(まだargon2idハッシュを持たない)は、レガシーハッシュ
  // (sha256(password + AUTH_SALT))で検証する。一致したらargon2idへサイレント再ハッシュし、
  // 次回以降はargon2idだけで検証される(パスワード変更を利用者に求めずに移行するための仕組み)。
  if (!matched && staff.legacyPasswordHash && deps.legacyAuthSalt) {
    const legacyHash = computeLegacyHash(input.password, deps.legacyAuthSalt);
    if (legacyHash === staff.legacyPasswordHash) {
      matched = true;
      const upgradedHash = await deps.passwordHasher.hash(input.password);
      await deps.staff.upgradeToArgon2Hash(tenant.id, staff.id, upgradedHash);
    }
  }

  if (!matched) return { ok: false, reason: 'invalid_credentials' };

  const rawToken = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const sessionInput: NewSessionInput = {
    tenantId: tenant.id,
    staffId: staff.id,
    tokenHash: hashSessionToken(rawToken),
    expiresAt,
  };
  await deps.sessions.create(sessionInput);

  const name = await deps.crypto.decrypt(tenant.id, staff.name);
  const email = await deps.crypto.decrypt(tenant.id, staff.email);

  return {
    ok: true,
    sessionCookieValue: encodeSessionCookie(tenant.id, rawToken),
    expiresAt,
    staff: { id: staff.id, tenantId: tenant.id, name, email, isAdmin: staff.isAdmin },
  };
}

export interface ResolvedSession {
  tenantId: string;
  staffId: string;
  name: string;
  email: string;
  isAdmin: boolean;
}

/**
 * セッションCookieの値からログイン中ユーザーを解決する。
 * `checkSession(token)` (GAS版 Auth.js)の後継。クライアント指定のスタッフ名を一切信用せず、
 * サーバー側でCookieだけから本人を特定する、というCLAUDE.mdのセキュリティパターンをここで担う。
 */
export async function resolveSession(deps: AuthDeps, cookieValue: string): Promise<ResolvedSession | null> {
  const decoded = decodeSessionCookie(cookieValue);
  if (!decoded) return null;

  const session = await deps.sessions.findByTokenHash(decoded.tenantId, hashSessionToken(decoded.rawToken));
  if (!session) return null;
  if (session.expiresAt.getTime() <= Date.now()) return null;

  const staffRecord = await deps.staff.findById(session.tenantId, session.staffId);
  if (!staffRecord) return null;

  const [name, email] = await Promise.all([
    deps.crypto.decrypt(session.tenantId, staffRecord.name),
    deps.crypto.decrypt(session.tenantId, staffRecord.email),
  ]);

  return {
    tenantId: session.tenantId,
    staffId: staffRecord.id,
    name,
    email,
    isAdmin: staffRecord.isAdmin,
  };
}

export interface RegisterStaffInput {
  tenantId: string;
  name: string;
  email: string;
  password: string;
  isAdmin: boolean;
}

/**
 * スタッフを新規登録する(現状はシード/管理者による追加を想定。セルフサインアップの
 * 導線はまだない)。氏名は姓・名に分割してそれぞれブラインドインデックスを持たせる。
 */
export async function registerStaff(deps: AuthDeps, input: RegisterStaffInput) {
  const { familyName, givenName } = splitJapaneseFullName(input.name);
  const [nameEnc, emailEnc, passwordHash, familyNameBlindIndex, givenNameBlindIndex, emailBlindIndex] =
    await Promise.all([
      deps.crypto.encrypt(input.tenantId, input.name),
      deps.crypto.encrypt(input.tenantId, input.email),
      deps.passwordHasher.hash(input.password),
      deps.blindIndex.compute(input.tenantId, familyName),
      deps.blindIndex.compute(input.tenantId, givenName),
      deps.blindIndex.compute(input.tenantId, normalizeEmailForIndex(input.email)),
    ]);

  const record: NewStaffInput = {
    tenantId: input.tenantId,
    name: nameEnc,
    familyNameBlindIndex,
    givenNameBlindIndex,
    email: emailEnc,
    emailBlindIndex,
    passwordHash,
    isAdmin: input.isAdmin,
  };
  return deps.staff.create(record);
}

export interface ImportLegacyStaffInput {
  tenantId: string;
  name: string;
  email: string;
  /** GAS版 Auth.js の computeHash(password) で計算済みのハッシュ値(Staffシートの列Jの値そのもの)。 */
  legacyPasswordHash: string;
  isAdmin: boolean;
}

/**
 * GAS版のスタッフ台帳(Staffシート)から、既存のパスワードハッシュ(SHA-256+salt)ごと
 * スタッフを移行する。パスワードそのものは分からない(ハッシュしか無い)ため、
 * ここではargon2idハッシュを発行せず、初回ログイン成功時に login() がサイレント再ハッシュする。
 */
export async function importLegacyStaff(deps: AuthDeps, input: ImportLegacyStaffInput) {
  const { familyName, givenName } = splitJapaneseFullName(input.name);
  const [nameEnc, emailEnc, familyNameBlindIndex, givenNameBlindIndex, emailBlindIndex] = await Promise.all([
    deps.crypto.encrypt(input.tenantId, input.name),
    deps.crypto.encrypt(input.tenantId, input.email),
    deps.blindIndex.compute(input.tenantId, familyName),
    deps.blindIndex.compute(input.tenantId, givenName),
    deps.blindIndex.compute(input.tenantId, normalizeEmailForIndex(input.email)),
  ]);

  const record: NewStaffInput = {
    tenantId: input.tenantId,
    name: nameEnc,
    familyNameBlindIndex,
    givenNameBlindIndex,
    email: emailEnc,
    emailBlindIndex,
    passwordHash: null,
    legacyPasswordHash: input.legacyPasswordHash,
    isAdmin: input.isAdmin,
  };
  return deps.staff.create(record);
}
