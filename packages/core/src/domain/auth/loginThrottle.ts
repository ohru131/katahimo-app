/**
 * ログイン試行の絞り込み。
 *
 * 再設定コードには5回の試行上限があるのに、ログインには何も無かった。8文字以上という
 * 最低条件しか課していない以上、無制限に試せる状態は総当たりに対して弱い。
 *
 * 恒久ロックにはしない。特定のアカウントを狙って失敗させ続ければ、その人を締め出せて
 * しまう(業務が止まる)。時間で自動的に解ける形にして、攻撃の速度だけを落とす。
 */

/** 連続失敗がこの回数に達したらロックする。 */
export const MAX_FAILED_LOGIN_ATTEMPTS = 10;

/** ロックの継続時間。 */
export const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;

export interface LoginThrottleState {
  failedLoginAttempts: number;
  lockedUntil: Date | null;
}

/** いま時点でログインを受け付けない状態かどうか。 */
export function isLoginLocked(state: LoginThrottleState, now: Date): boolean {
  return state.lockedUntil !== null && state.lockedUntil.getTime() > now.getTime();
}

export interface FailedLoginOutcome {
  failedLoginAttempts: number;
  lockedUntil: Date | null;
}

/**
 * 失敗を1回加算した後の状態を返す。上限に達したらロックし、カウンタは0に戻す
 * (ロックが明けたら、また上限までは試せる = 1回失敗するたびに即ロック、にはしない)。
 *
 * ロック中の状態は呼び出し前に弾かれている前提なので、ここでは考えない。
 */
export function applyFailedLogin(state: LoginThrottleState, now: Date): FailedLoginOutcome {
  const attempts = state.failedLoginAttempts + 1;
  if (attempts < MAX_FAILED_LOGIN_ATTEMPTS) {
    return { failedLoginAttempts: attempts, lockedUntil: null };
  }
  return { failedLoginAttempts: 0, lockedUntil: new Date(now.getTime() + LOGIN_LOCKOUT_MS) };
}
