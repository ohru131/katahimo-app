type FetchHandler = (request: Request) => Response | Promise<Response>;

export interface FetchShim {
  /** window.fetchを元に戻す。 */
  uninstall(): void;
}

/**
 * `/api/**` 宛てのfetchを、ブラウザ内で動いているHonoアプリに横流しする。
 *
 * Service Workerではなくfetchの差し替えにしているのは、GitHub Pagesのサブパス配信
 * (/katahimo-app/)でSWのスコープに悩まされないため、そして初回アクセスでSWの
 * 登録完了を待たずに済むため。packages/web の呼び出し側は1行も変えずに動く。
 */
export function installFetchShim(handler: FetchHandler): FetchShim {
  const originalFetch = globalThis.fetch.bind(globalThis);

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url, location.href);
    // 同一オリジンの /api/ 以外(TailwindのCDN、訪問者が設定したGemini API等)は素通し。
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) {
      return originalFetch(input as RequestInfo, init);
    }
    return handler(request);
  };

  return {
    uninstall() {
      globalThis.fetch = originalFetch;
    },
  };
}
