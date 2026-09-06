import { createHash, randomBytes } from 'node:crypto';
import {
  constantTimeEquals,
  generateResetCode,
  isAcceptablePassword,
  normalizeEmailForIndex,
} from '../domain';
import type { MailerPort } from '../ports/mailer';
import type {
  PasswordResetCodeRepositoryPort,
  SessionRepositoryPort,
  StaffRecord,
  StaffRepositoryPort,
  TenantRepositoryPort,
} from '../ports/repositories';
import type { PasswordHasherPort } from './auth';

/** 認証コードの有効期限。GAS版 Auth.js requestPasswordReset と同じ30分。 */
const RESET_CODE_TTL_MS = 30 * 60 * 1000;

/**
 * 1つのコードで許す誤入力の回数。
 *
 * コードは6桁=100万通りしかないので、無制限だと総当たりが成立する。GAS版には
 * この制限が無かった。上限に達したコードは期限内でも無効になり、再発行が必要になる。
 */
const MAX_FAILED_ATTEMPTS = 5;

export interface PasswordResetDeps {
  tenants: TenantRepositoryPort;
  staff: StaffRepositoryPort;
  sessions: SessionRepositoryPort;
  passwordResetCodes: PasswordResetCodeRepositoryPort;
  passwordHasher: PasswordHasherPort;
  mailer: MailerPort;
}

/** 認証コードのDB保存用ハッシュ。セッショントークンと同じ考え方で生の値は保存しない。 */
export function hashResetCode(code: string): string {
  return createHash('sha256').update(code, 'utf8').digest('hex');
}

/** 退職済みかどうか。退職者にパスワードを再設定させない。 */
function isRetired(staffRecord: StaffRecord): boolean {
  if (!staffRecord.retirementDate) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(staffRecord.retirementDate) <= today;
}

/**
 * パスワード再設定の認証コードを発行してメールで送る。GAS版 Auth.js requestPasswordReset に対応。
 *
 * **結果を呼び出し側に返さない**のは意図的。GAS版は「ユーザーIDが見つからないか、
 * メールアドレスが登録されていません」と返しており、誰でも
 * 「このメールアドレスがこの事業所に登録されているか」を確かめられた(ユーザー列挙)。
 * ここでは宛先の有無・退職の有無にかかわらず何も返さず、画面には常に同じ案内を出す。
 */
export async function requestPasswordReset(
  deps: PasswordResetDeps,
  input: { tenantSlug: string; email: string },
): Promise<void> {
  const tenant = await deps.tenants.findBySlug(input.tenantSlug);
  if (!tenant) return;

  const staffRecord = await deps.staff.findByEmail(tenant.id, normalizeEmailForIndex(input.email));
  if (!staffRecord || isRetired(staffRecord)) return;

  // 有効なコードが同時に複数あると総当たりの的が増えるので、発行前に古いものを無効化する。
  await deps.passwordResetCodes.consumeAllForStaff(tenant.id, staffRecord.id);

  const code = generateResetCode((size) => randomBytes(size));
  await deps.passwordResetCodes.create({
    tenantId: tenant.id,
    staffId: staffRecord.id,
    codeHash: hashResetCode(code),
    expiresAt: new Date(Date.now() + RESET_CODE_TTL_MS),
  });

  await deps.mailer.send({
    to: staffRecord.email,
    subject: '【katahimo】パスワード再設定の認証コード',
    body: [
      `${staffRecord.name} 様`,
      '',
      'パスワード再設定のリクエストを受け付けました。',
      'アプリの画面に以下の認証コードを入力してください。',
      '',
      `認証コード: ${code}`,
      `有効期限: ${RESET_CODE_TTL_MS / 60000}分`,
      '',
      'このリクエストに心当たりがない場合は、このメールを破棄してください。',
      'パスワードは変更されません。',
    ].join('\n'),
  });
}

export type ResetPasswordResult = { ok: true } | { ok: false; reason: 'invalid_code' | 'weak_password' };

/**
 * 認証コードでパスワードを再設定する。GAS版 Auth.js resetPasswordWithCode に対応。
 *
 * 失敗理由を `invalid_code` にまとめているのは、requestPasswordReset と同じ理由。
 * 「コードの期限切れ」と「そのメールアドレスは登録されていない」を区別できると、
 * 適当なコードを送るだけでメールアドレスの存在を確かめられてしまう。
 *
 * 再設定に成功したら、そのスタッフの既存セッションを全て破棄する。パスワードを
 * 忘れる状況には乗っ取られている場合も含まれるため、再設定だけして攻撃者の
 * ログインを残すと意味がない(GAS版はセッションを残したままだった)。
 */
export async function resetPasswordWithCode(
  deps: PasswordResetDeps,
  input: { tenantSlug: string; email: string; code: string; newPassword: string },
): Promise<ResetPasswordResult> {
  if (!isAcceptablePassword(input.newPassword)) return { ok: false, reason: 'weak_password' };

  const tenant = await deps.tenants.findBySlug(input.tenantSlug);
  if (!tenant) return { ok: false, reason: 'invalid_code' };

  const staffRecord = await deps.staff.findByEmail(tenant.id, normalizeEmailForIndex(input.email));
  if (!staffRecord || isRetired(staffRecord)) return { ok: false, reason: 'invalid_code' };

  const active = await deps.passwordResetCodes.findLatestActive(tenant.id, staffRecord.id);
  if (!active) return { ok: false, reason: 'invalid_code' };

  if (!constantTimeEquals(active.codeHash, hashResetCode(input.code))) {
    const attempts = await deps.passwordResetCodes.incrementFailedAttempts(tenant.id, active.id);
    if (attempts >= MAX_FAILED_ATTEMPTS) await deps.passwordResetCodes.markConsumed(tenant.id, active.id);
    return { ok: false, reason: 'invalid_code' };
  }

  // 一致したコードでも、それまでの誤入力が上限に達していれば無効として扱う。
  if (active.failedAttempts >= MAX_FAILED_ATTEMPTS) {
    await deps.passwordResetCodes.markConsumed(tenant.id, active.id);
    return { ok: false, reason: 'invalid_code' };
  }

  const passwordHash = await deps.passwordHasher.hash(input.newPassword);
  await deps.staff.setPassword(tenant.id, staffRecord.id, passwordHash, false);
  await deps.passwordResetCodes.consumeAllForStaff(tenant.id, staffRecord.id);
  await deps.sessions.deleteAllForStaff(tenant.id, staffRecord.id);

  return { ok: true };
}
