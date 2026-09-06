const STORAGE_KEY = 'katahimo-demo-cookies';

/**
 * デモ用の簡易Cookieストア。
 *
 * ブラウザは `Cookie` / `Set-Cookie` を「禁止ヘッダー」として扱い、スクリプトが作った
 * Request/Responseからは問答無用で取り除く(実際に検証済み)。つまりブラウザ内で動かす
 * Honoアプリとの間では、ヘッダーに載せてCookieを往復させることが原理的にできない。
 * そこで値だけを自前で保持し、Honoの入口(リクエストのheaders)と出口(c.header)で
 * 橋渡しする。詳細は demoApi.ts を参照。
 *
 * 保持先はsessionStorage。タブを閉じればログアウトされ、リロードでは維持される。
 */
interface StoredCookie {
  value: string;
  /** エポックミリ秒。セッションCookie(有効期限の指定なし)はnull。 */
  expiresAt: number | null;
}

/**
 * Set-Cookieの属性から有効期限を求める。Max-AgeはExpiresより優先される(RFC 6265)。
 * 期限切れを表す場合は0を返し、呼び出し側が削除として扱う。
 */
function parseExpiry(attributes: string[]): number | null {
  let expiresAt: number | null = null;

  for (const attribute of attributes) {
    const separator = attribute.indexOf('=');
    if (separator < 0) continue;
    const name = attribute.slice(0, separator).trim().toLowerCase();
    const value = attribute.slice(separator + 1).trim();

    if (name === 'expires') {
      const parsed = Date.parse(value);
      if (!Number.isNaN(parsed)) expiresAt = parsed;
    }
    if (name === 'max-age') {
      const seconds = Number(value);
      // Max-Ageは指定されていれば常にExpiresに勝つので、ここで確定させて抜ける。
      if (Number.isFinite(seconds)) return seconds <= 0 ? 0 : Date.now() + seconds * 1000;
    }
  }

  return expiresAt;
}

export class CookieJar {
  private readonly cookies = new Map<string, StoredCookie>();

  constructor() {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Record<string, StoredCookie>;
        for (const [name, cookie] of Object.entries(parsed)) {
          if (typeof cookie?.value === 'string') {
            this.cookies.set(name, { value: cookie.value, expiresAt: cookie.expiresAt ?? null });
          }
        }
      }
    } catch {
      // プライベートブラウジング等でsessionStorageが使えない場合はメモリ上だけで動かす。
    }
  }

  private persist(): void {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(this.cookies)));
    } catch {
      // 保存できなくてもセッション自体は継続できるので黙って諦める。
    }
  }

  /** 期限切れのCookieを捨てる。ブラウザが自動でやってくれることを自前でやる必要がある。 */
  private dropExpired(): void {
    const now = Date.now();
    let removed = false;
    for (const [name, cookie] of this.cookies) {
      if (cookie.expiresAt !== null && cookie.expiresAt <= now) {
        this.cookies.delete(name);
        removed = true;
      }
    }
    if (removed) this.persist();
  }

  /** リクエストの Cookie ヘッダーに載せる値。 */
  header(): string {
    this.dropExpired();
    return [...this.cookies].map(([name, cookie]) => `${name}=${cookie.value}`).join('; ');
  }

  /** `name=value; Path=/; Expires=...; Max-Age=...` 形式の Set-Cookie を取り込む。 */
  applySetCookie(setCookieValue: string): void {
    const [pair, ...attributes] = setCookieValue.split(';');
    const separator = pair?.indexOf('=') ?? -1;
    if (!pair || separator < 0) return;

    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    const expiresAt = parseExpiry(attributes);

    // 過去日時のExpires / Max-Age=0 は削除指示(ログアウト時の deleteCookie が使う)。
    if (expiresAt !== null && expiresAt <= Date.now()) this.cookies.delete(name);
    else this.cookies.set(name, { value, expiresAt });
    this.persist();
  }

  clear(): void {
    this.cookies.clear();
    this.persist();
  }
}
