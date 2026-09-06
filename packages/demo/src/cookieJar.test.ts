import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CookieJar } from './cookieJar';

/**
 * CookieJarはブラウザのCookie処理の肩代わりなので、有効期限の扱いを間違えると
 * 「ログアウトしたはずなのに使える」「期限切れのはずのセッションを送り続ける」といった、
 * 認証まわりの挙動が本番とずれる。
 */
describe('CookieJar', () => {
  beforeEach(() => {
    // sessionStorageが無い環境(vitestのnode環境)でも動くことを兼ねて確認する。
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('Set-Cookieの値をCookieヘッダーとして返す', () => {
    const jar = new CookieJar();
    jar.applySetCookie('katahimo_session=abc123; Path=/; HttpOnly; SameSite=Lax');
    expect(jar.header()).toBe('katahimo_session=abc123');
  });

  it('複数のCookieを"; "で連結する', () => {
    const jar = new CookieJar();
    jar.applySetCookie('a=1; Path=/');
    jar.applySetCookie('b=2; Path=/');
    expect(jar.header()).toBe('a=1; b=2');
  });

  it('Max-Age=0は削除指示として扱う(ログアウト)', () => {
    const jar = new CookieJar();
    jar.applySetCookie('katahimo_session=abc123; Path=/');
    jar.applySetCookie('katahimo_session=; Path=/; Max-Age=0');
    expect(jar.header()).toBe('');
  });

  it('過去日時のExpiresも削除指示として扱う', () => {
    const jar = new CookieJar();
    jar.applySetCookie('katahimo_session=abc123; Path=/');
    jar.applySetCookie('katahimo_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT');
    expect(jar.header()).toBe('');
  });

  it('Expiresを過ぎたCookieは送らなくなる', () => {
    const jar = new CookieJar();
    const expires = new Date(Date.now() + 60_000).toUTCString();
    jar.applySetCookie(`katahimo_session=abc123; Path=/; Expires=${expires}`);
    expect(jar.header()).toBe('katahimo_session=abc123');

    vi.advanceTimersByTime(61_000);
    expect(jar.header()).toBe('');
  });

  it('Max-Ageを過ぎたCookieは送らなくなる', () => {
    const jar = new CookieJar();
    jar.applySetCookie('katahimo_session=abc123; Path=/; Max-Age=60');
    expect(jar.header()).toBe('katahimo_session=abc123');

    vi.advanceTimersByTime(61_000);
    expect(jar.header()).toBe('');
  });

  it('Max-AgeはExpiresより優先される(RFC 6265)', () => {
    const jar = new CookieJar();
    const pastExpires = new Date(Date.now() - 60_000).toUTCString();
    jar.applySetCookie(`a=1; Path=/; Expires=${pastExpires}; Max-Age=60`);
    expect(jar.header()).toBe('a=1');
  });

  it('有効期限のないCookieは時間が経っても保持する', () => {
    const jar = new CookieJar();
    jar.applySetCookie('a=1; Path=/');
    vi.advanceTimersByTime(30 * 24 * 60 * 60 * 1000);
    expect(jar.header()).toBe('a=1');
  });

  it('clear()で全て捨てる', () => {
    const jar = new CookieJar();
    jar.applySetCookie('a=1; Path=/');
    jar.clear();
    expect(jar.header()).toBe('');
  });

  it('"="を含まない不正なSet-Cookieは無視する', () => {
    const jar = new CookieJar();
    jar.applySetCookie('こわれている');
    expect(jar.header()).toBe('');
  });

  it('値に"="が含まれていても最初の"="だけで分割する', () => {
    const jar = new CookieJar();
    jar.applySetCookie('session=dGVuYW50=token=; Path=/');
    expect(jar.header()).toBe('session=dGVuYW50=token=');
  });
});
