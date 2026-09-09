import { describe, expect, it } from 'vitest';
import {
  applyFailedLogin,
  isLoginLocked,
  LOGIN_LOCKOUT_MS,
  MAX_FAILED_LOGIN_ATTEMPTS,
} from './loginThrottle';

const now = new Date('2026-09-01T00:00:00.000Z');

describe('ログイン試行の絞り込み', () => {
  it('上限に達するまではロックしない', () => {
    const outcome = applyFailedLogin({ failedLoginAttempts: 0, lockedUntil: null }, now);
    expect(outcome).toEqual({ failedLoginAttempts: 1, lockedUntil: null });
  });

  it('上限に達したらロックし、カウンタを戻す', () => {
    const outcome = applyFailedLogin(
      { failedLoginAttempts: MAX_FAILED_LOGIN_ATTEMPTS - 1, lockedUntil: null },
      now,
    );
    expect(outcome.failedLoginAttempts).toBe(0);
    expect(outcome.lockedUntil).toEqual(new Date(now.getTime() + LOGIN_LOCKOUT_MS));
  });

  it('ロック中はログインを受け付けない', () => {
    const lockedUntil = new Date(now.getTime() + 60_000);
    expect(isLoginLocked({ failedLoginAttempts: 0, lockedUntil }, now)).toBe(true);
  });

  it('ロックは時間で自動的に解ける(締め出しっぱなしにしない)', () => {
    const lockedUntil = new Date(now.getTime() + LOGIN_LOCKOUT_MS);
    const afterLock = new Date(lockedUntil.getTime() + 1);
    expect(isLoginLocked({ failedLoginAttempts: 0, lockedUntil }, afterLock)).toBe(false);
  });

  it('一度もロックされていなければロック扱いにしない', () => {
    expect(isLoginLocked({ failedLoginAttempts: 3, lockedUntil: null }, now)).toBe(false);
  });
});
