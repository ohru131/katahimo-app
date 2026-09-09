import type { MiddlewareHandler } from 'hono';

/**
 * クロスサイトからの書き込みを弾く。
 *
 * セッションはCookieで持っているので、他所のサイトに置かれたフォームやスクリプトから
 * 状態を変える要求を出されると、利用者のログイン状態のまま実行されてしまう。
 * Cookieの `SameSite=Lax` だけでも大半は防げるが、それはブラウザの実装と設定に全面的に
 * 依存する防御なので、サーバー側にも1枚置く。
 *
 * 判定はOriginヘッダの照合だけにしている。ブラウザはこのヘッダを書き換えられないため、
 * 「別オリジンから来た書き込みかどうか」はこれで判別できる。トークン方式にしないのは、
 * 発行・保管・失効の仕組みを増やす割に、この構成(同一オリジンのSPA + Cookie)で
 * 得られる保証がOrigin照合と変わらないため。
 */

/** 状態を変えない安全なメソッド(RFC 9110)。これらは照合しない。 */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * リクエストURLから、ブラウザが見ているのと同じオリジンを組み立てる。
 *
 * TLSを手前(Cloud Run等)で終端する構成では、アプリに届くのは平文HTTPなので
 * `c.req.url` は `http://…` になる。一方ブラウザが送る Origin は `https://…` で、
 * そのまま比べると同一オリジンの書き込みまで弾いてしまう。@hono/node-server は
 * X-Forwarded-Proto を自動では見ないため、ここで反映する。
 *
 * このヘッダを信用しても照合は緩まない。偽装できるのは「自分側のスキーム」だけで、
 * 攻撃者のページから送られる Origin が一致するようになるわけではない(食い違えば
 * 弾かれる方向にしか動かない)。プロキシを重ねた場合は先頭が最も外側になる。
 */
function resolveSelfOrigin(requestUrl: string, forwardedProto: string | null | undefined): string {
  const url = new URL(requestUrl);
  const proto = forwardedProto?.split(',')[0]?.trim();
  if (proto) url.protocol = `${proto}:`;
  return url.origin;
}

/**
 * この要求を「別オリジンからの書き込み」として拒否すべきか。
 *
 * Originが無い場合は拒否しない。curlやサーバー間の呼び出しにはそもそも付かないうえ、
 * 付かない要求はブラウザ発でもないため、CSRFの経路にならない。
 */
export function shouldRejectAsCrossSite(
  method: string,
  origin: string | null | undefined,
  requestUrl: string,
  allowedOrigins: readonly string[] = [],
  forwardedProto?: string | null,
): boolean {
  if (SAFE_METHODS.has(method.toUpperCase())) return false;
  if (!origin) return false;
  if (allowedOrigins.includes(origin)) return false;
  let selfOrigin: string;
  try {
    selfOrigin = resolveSelfOrigin(requestUrl, forwardedProto);
  } catch {
    // URLとして解釈できない要求は、照合できない以上、通さない。
    return true;
  }
  return origin !== selfOrigin;
}

/**
 * 書き込み系メソッドで、別オリジンからのCookie付き要求を403で止めるミドルウェア。
 * `allowedOrigins` には、正当に別オリジンから叩く必要がある場合だけを明示的に列挙する。
 */
export function createCrossSiteWriteGuard(allowedOrigins: readonly string[] = []): MiddlewareHandler {
  return async (c, next) => {
    const rejected = shouldRejectAsCrossSite(
      c.req.method,
      c.req.header('origin'),
      c.req.url,
      allowedOrigins,
      c.req.header('x-forwarded-proto'),
    );
    if (rejected) {
      return c.json({ code: 'cross_site_request_blocked', message: '不正なリクエスト元です' }, 403);
    }
    return next();
  };
}
