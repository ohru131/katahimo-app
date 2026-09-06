import type { Container } from '@katahimo/api';
import { createApp } from '@katahimo/api';
import type { MiddlewareHandler } from 'hono';
import { Hono } from 'hono';
import type { CookieJar } from './cookieJar';

/**
 * Honoが `c.header('Set-Cookie', ...)` に書いた値を横取りしてCookieJarへ入れる。
 *
 * そのまま通すとHonoが最後に `new Response(body, { headers })` を組み立てる時点で、
 * ブラウザがSet-Cookieを禁止ヘッダーとして削除してしまい、ログインしてもセッションが
 * 残らない。Responseになる前(=Contextに書き込まれた瞬間)に拾うのが唯一の手。
 *
 * `c.header` はクラスフィールド(インスタンスのプロパティ)なので、上書きしても
 * 他のリクエストのContextには影響しない。
 */
function captureSetCookie(jar: CookieJar): MiddlewareHandler {
  return async (c, next) => {
    const originalHeader = c.header;
    c.header = (name, value, options) => {
      if (name.toLowerCase() === 'set-cookie') {
        if (typeof value === 'string') jar.applySetCookie(value);
        return;
      }
      originalHeader(name, value, options);
    };
    await next();
  };
}

/**
 * CookieJarの中身をリクエストの Cookie ヘッダーとして見せる。
 *
 * Honoの `getCookie()` は `c.req.raw.headers.get('Cookie')` を直接読むため、
 * Requestオブジェクトそのものに載せる必要がある。ただしスクリプトが作ったRequestの
 * headersからはブラウザがCookieを削除するので、単体の `new Headers()`
 * (禁止ヘッダーの制約がかからない)を用意し、Proxyでそれを`headers`として見せる。
 */
function withCookieHeader(request: Request, cookieHeader: string): Request {
  if (!cookieHeader) return request;
  const headers = new Headers(request.headers);
  headers.set('cookie', cookieHeader);
  return new Proxy(request, {
    get(target, property) {
      if (property === 'headers') return headers;
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/**
 * ブラウザ内で動かすAPIハンドラを組み立てる。中身は本番と同じ `createApp` で、
 * その外側にCookieの橋渡しだけを足している。
 */
export function createDemoApiHandler(container: Container, jar: CookieJar) {
  const app = new Hono();
  app.use('*', captureSetCookie(jar));
  // デモにはHTTPSも外部DBも無いので、Secure属性付きCookieもDB疎通確認も無効。
  app.route('/', createApp(container, { secureCookies: false }));

  return (request: Request): Response | Promise<Response> =>
    app.fetch(withCookieHeader(request, jar.header()));
}
