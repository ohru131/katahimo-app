import { createHmac, randomBytes } from 'node:crypto';
import { generateResetCode, isAcceptablePassword, normalizeEmailForIndex } from '../domain';
import type { MailerPort } from '../ports/mailer';
import type {
  PasswordResetCodeRepositoryPort,
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
  passwordResetCodes: PasswordResetCodeRepositoryPort;
  passwordHasher: PasswordHasherPort;
  mailer: MailerPort;
  /**
   * 認証コードの検証子を計算する鍵(ペッパー)。DBには置かず、環境変数から渡す。
   * これが無いと検証子からコードを逆算できない、という状態を作るためのもの。
   */
  resetCodePepper: string;
}

/**
 * 認証コードのDB保存用の検証子。
 *
 * 単純なハッシュ(sha256)にしないのは、6桁=100万通りしかないため。DBが漏れた時点で
 * 全パターンのハッシュを計算して突き合わせれば、有効期限内のコードを復元できてしまう。
 * DBに無いペッパーを鍵にしたHMACにしておくと、DBだけではこの計算ができない。
 */
export function computeResetCodeVerifier(pepper: string, code: string): string {
  return createHmac('sha256', pepper).update(code, 'utf8').digest('hex');
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

  const code = generateResetCode((size) => randomBytes(size));
  await deps.passwordResetCodes.issue({
    tenantId: tenant.id,
    staffId: staffRecord.id,
    codeVerifier: computeResetCodeVerifier(deps.resetCodePepper, code),
    expiresAt: new Date(Date.now() + RESET_CODE_TTL_MS),
  });

  try {
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
  } catch (error) {
    // 送信失敗を呼び出し側へ伝えない。ここで例外にすると「宛先が無いときは成功、
    // 宛先があってメールが失敗したときはエラー」となり、応答の違いから
    // メールアドレスの登録有無が分かってしまう(この関数が防ごうとしていることそのもの)。
    console.error('[passwordReset] 認証コードのメール送信に失敗しました', error);
  }
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

  // 検証と使用済み化を1操作にまとめている。分けると、同時に届いた試行が揃って
  // 加算前の試行回数を読み、上限をすり抜けて何度でも推測できてしまう。
  const outcome = await deps.passwordResetCodes.verifyAndConsume({
    tenantId: tenant.id,
    staffId: staffRecord.id,
    codeVerifier: computeResetCodeVerifier(deps.resetCodePepper, input.code),
    maxFailedAttempts: MAX_FAILED_ATTEMPTS,
  });
  if (outcome !== 'consumed') return { ok: false, reason: 'invalid_code' };

  const passwordHash = await deps.passwordHasher.hash(input.newPassword);
  // パスワードの差し替えとセッション破棄を1トランザクションで行う。分けると、破棄だけ
  // 失敗したときに「パスワードは変わったのに乗っ取り側のログインは生きている」状態が残る。
  //
  // `expect` は、コードを消費してからこの書き込みまでの間に別経路(管理者による初期
  // パスワードの再発行など)がパスワードを差し替えていたら、こちらを捨てるための条件。
  // 端末を紛失したスタッフの締め出しを、生きている再設定コードで巻き戻せてしまうため。
  const replaced = await deps.staff.replacePassword({
    tenantId: tenant.id,
    staffId: staffRecord.id,
    passwordHash,
    mustChangePassword: false,
    revokeSessions: true,
    expect: { passwordHash: staffRecord.passwordHash },
  });
  // 差し替えを捨てた場合、コードは既に使用済みになっている。利用者から見ると
  // 「コードが無効」なので、案内も再発行からやり直してもらう形に揃える。
  if (replaced === 'stale') return { ok: false, reason: 'invalid_code' };

  return { ok: true };
}
