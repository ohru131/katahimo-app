import { randomBytes } from 'node:crypto';
import { generateInitialPassword, normalizeEmailForIndex } from '../domain';
import type { MailerPort } from '../ports/mailer';
import type {
  PasswordResetCodeRepositoryPort,
  SessionRepositoryPort,
  StaffAdminRecord,
  StaffRepositoryPort,
  UpdateStaffInput,
} from '../ports/repositories';
import type { PasswordHasherPort } from './auth';

export interface StaffDeps {
  staff: StaffRepositoryPort;
}

export interface StaffAdminDeps extends StaffDeps {
  sessions: SessionRepositoryPort;
  /** パスワードを差し替えたときに、未使用の再設定コードを無効化するために使う。 */
  passwordResetCodes: PasswordResetCodeRepositoryPort;
  passwordHasher: PasswordHasherPort;
  mailer: MailerPort;
}

export interface ActiveStaffView {
  id: string;
  name: string;
}

/**
 * 管理者向け「対象スタッフ」一覧(退職済みは除く)。GAS版PastSchedule.js
 * getActiveStaffNamesForAdminに対応。呼び出し元のAPIルートで管理者権限チェックを行う
 * (管理者以外はここを呼ばず空配列を返す)。
 *
 * 並び替えはGAS版の`names.sort()`(ロケール非依存の単純な文字列比較)と同じ挙動にする。
 */
export async function listActiveStaffForAdmin(deps: StaffDeps, tenantId: string): Promise<ActiveStaffView[]> {
  const rows = await deps.staff.listActive(tenantId);
  return rows
    .map((r) => ({ id: r.id, name: r.name }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** 管理者のスタッフ管理画面が表示する1件ぶん。 */
export interface StaffAdminView extends StaffAdminRecord {
  /** 退職日が今日以前かどうか(画面で「在籍中/退職済み」を出し分けるための派生値)。 */
  retired: boolean;
}

function isRetiredOn(retirementDate: string | null, today: Date): boolean {
  if (!retirementDate) return false;
  const boundary = new Date(today);
  boundary.setHours(0, 0, 0, 0);
  return new Date(retirementDate) <= boundary;
}

/** 管理者のスタッフ管理画面用の一覧。退職済みも含め、在籍中を先に、同じ区分では氏名順。 */
export async function listStaffForAdmin(
  deps: StaffDeps,
  tenantId: string,
  today: Date = new Date(),
): Promise<StaffAdminView[]> {
  const rows = await deps.staff.listAll(tenantId);
  return rows
    .map((r) => ({ ...r, retired: isRetiredOn(r.retirementDate, today) }))
    .sort((a, b) => {
      if (a.retired !== b.retired) return a.retired ? 1 : -1;
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });
}

export interface CreateStaffInput {
  name: string;
  email: string;
  isAdmin: boolean;
}

export type CreateStaffResult =
  | {
      ok: true;
      staffId: string;
      /**
       * 初期パスワードのメールを送れたか。
       *
       * falseでもアカウントは作成済み。「作成に失敗した」と返してしまうと、
       * 管理者がやり直しても `email_taken` になり、誰も知らないパスワードの
       * アカウントが残ったまま身動きが取れなくなる。画面には「初期パスワードを
       * 再発行してください」と案内させる。
       */
      mailDelivered: boolean;
    }
  | { ok: false; reason: 'invalid_input' | 'email_taken' };

/**
 * 管理者がスタッフを登録する。パスワードは管理者に決めさせず、その場で作った
 * 初期パスワードを本人のメールへ送る。
 *
 * 管理者がパスワードを決める方式にしないのは、管理者が本人のパスワードを
 * 知っている状態を作らないため。初期パスワードは `mustChangePassword` が立った
 * 状態で保存され、本人が変更するまで他の操作ができない。
 */
export async function createStaffWithInitialPassword(
  deps: StaffAdminDeps,
  tenantId: string,
  input: CreateStaffInput,
): Promise<CreateStaffResult> {
  const name = input.name.trim();
  const email = normalizeEmailForIndex(input.email);
  // 初期パスワードの届け先になるので、メールアドレスの形だけは確かめる。
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, reason: 'invalid_input' };

  const existing = await deps.staff.findByEmail(tenantId, email);
  if (existing) return { ok: false, reason: 'email_taken' };

  const initialPassword = generateInitialPassword((size) => randomBytes(size));
  const created = await deps.staff.create({
    tenantId,
    name,
    email,
    passwordHash: await deps.passwordHasher.hash(initialPassword),
    isAdmin: input.isAdmin,
    mustChangePassword: true,
  });

  // 作成済みなので、メール送信の失敗を作成の失敗として返さない(上の mailDelivered 参照)。
  const mailDelivered = await sendInitialPasswordMail(deps, { name, email, initialPassword });
  return { ok: true, staffId: created.id, mailDelivered };
}

export type ResetStaffPasswordResult =
  | { ok: true; mailDelivered: boolean }
  | { ok: false; reason: 'not_found' };

/**
 * 管理者がスタッフの初期パスワードを再発行する。
 * 再設定コードのメールが届かない場合の逃げ道で、GAS版には無かった導線。
 *
 * 発行と同時に既存セッションを破棄する。退職者の締め出しや、
 * 端末を紛失したスタッフの復旧にそのまま使えるようにするため。
 */
export async function resetStaffPasswordByAdmin(
  deps: StaffAdminDeps,
  tenantId: string,
  staffId: string,
): Promise<ResetStaffPasswordResult> {
  const staffRecord = await deps.staff.findById(tenantId, staffId);
  if (!staffRecord) return { ok: false, reason: 'not_found' };

  const initialPassword = generateInitialPassword((size) => randomBytes(size));
  await deps.staff.setPassword(tenantId, staffId, await deps.passwordHasher.hash(initialPassword), true);
  await deps.sessions.deleteAllForStaff(tenantId, staffId);
  // 未使用の再設定コードが残っていると、再発行した初期パスワードをそれで上書きできてしまう。
  await deps.passwordResetCodes.consumeAllForStaff(tenantId, staffId);

  const mailDelivered = await sendInitialPasswordMail(deps, {
    name: staffRecord.name,
    email: staffRecord.email,
    initialPassword,
  });
  return { ok: true, mailDelivered };
}

export type UpdateStaffResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'invalid_input' | 'cannot_change_own_role' };

/**
 * 管理者がスタッフの氏名・権限・退職日を変更する。
 *
 * 自分自身の管理者権限を外すことと自分を退職扱いにすることは拒否する。
 * 管理者が1人しかいない事業所でそれをやると、誰も管理者設定に入れなくなるため。
 */
export async function updateStaffByAdmin(
  deps: StaffAdminDeps,
  tenantId: string,
  actorStaffId: string,
  staffId: string,
  input: UpdateStaffInput,
): Promise<UpdateStaffResult> {
  const staffRecord = await deps.staff.findById(tenantId, staffId);
  if (!staffRecord) return { ok: false, reason: 'not_found' };

  if (input.name !== undefined && !input.name.trim()) return { ok: false, reason: 'invalid_input' };

  const losingOwnAdmin = staffId === actorStaffId && input.isAdmin === false;
  const retiringSelf = staffId === actorStaffId && input.retirementDate != null;
  if (losingOwnAdmin || retiringSelf) return { ok: false, reason: 'cannot_change_own_role' };

  await deps.staff.update(tenantId, staffId, {
    ...input,
    name: input.name?.trim(),
  });

  // 退職日を今日以前にしたなら、その場でログインを切る(次のリクエストから弾かれる)。
  if (input.retirementDate !== undefined && isRetiredOn(input.retirementDate, new Date())) {
    await deps.sessions.deleteAllForStaff(tenantId, staffId);
  }
  return { ok: true };
}

/**
 * 初期パスワードの通知メール。登録直後と管理者による再発行で同じ文面を使う。
 *
 * 送信できたかを戻り値で返し、例外は投げない。呼び出し側では既にアカウントの
 * 作成やパスワードの差し替えが済んでいるため、ここで例外にすると
 * 「DBは変わったのに呼び出し側は失敗と受け取る」ずれが起きる。
 */
async function sendInitialPasswordMail(
  deps: StaffAdminDeps,
  input: { name: string; email: string; initialPassword: string },
): Promise<boolean> {
  try {
    await deps.mailer.send({
      to: input.email,
      subject: '【katahimo】初期パスワードのお知らせ',
      body: [
        `${input.name} 様`,
        '',
        'katahimo 訪問管理のアカウントを発行しました。',
        '以下の初期パスワードでログインし、続けて表示される画面でご自身のパスワードに変更してください。',
        '',
        `メールアドレス: ${input.email}`,
        `初期パスワード: ${input.initialPassword}`,
        '',
        '初期パスワードは変更するまで有効です。第三者に知られないようご注意ください。',
      ].join('\n'),
    });
    return true;
  } catch (error) {
    console.error('[staff] 初期パスワードのメール送信に失敗しました', error);
    return false;
  }
}
