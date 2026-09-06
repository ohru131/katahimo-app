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
export class CookieJar {
  private readonly cookies = new Map<string, string>();

  constructor() {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) {
        for (const [name, value] of Object.entries(JSON.parse(saved) as Record<string, unknown>)) {
          this.cookies.set(name, String(value));
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

  /** リクエストの Cookie ヘッダーに載せる値。 */
  header(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  /** `name=value; Path=/; Max-Age=...` 形式の Set-Cookie を取り込む。 */
  applySetCookie(setCookieValue: string): void {
    const [pair, ...attributes] = setCookieValue.split(';');
    const separator = pair?.indexOf('=') ?? -1;
    if (!pair || separator < 0) return;

    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    // Max-Age=0 は削除指示(ログアウト時の deleteCookie が使う)。
    const isDeletion = attributes.some((attribute) => /^\s*max-age\s*=\s*0\s*$/i.test(attribute));
    if (isDeletion) this.cookies.delete(name);
    else this.cookies.set(name, value);
    this.persist();
  }

  clear(): void {
    this.cookies.clear();
    this.persist();
  }
}
