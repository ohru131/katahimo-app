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
): boolean {
  if (SAFE_METHODS.has(method.toUpperCase())) return false;
  if (!origin) return false;
  if (allowedOrigins.includes(origin)) return false;
  let selfOrigin: string;
  try {
    selfOrigin = new URL(requestUrl).origin;
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
    if (shouldRejectAsCrossSite(c.req.method, c.req.header('origin'), c.req.url, allowedOrigins)) {
      return c.json({ code: 'cross_site_request_blocked', message: '不正なリクエスト元です' }, 403);
    }
    return next();
  };
}
