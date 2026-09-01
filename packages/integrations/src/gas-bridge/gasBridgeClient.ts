export interface GasBridgeOptions {
  /** GAS版(gas-childcare-visit-app)Web Appの/execエンドポイントURL。 */
  baseUrl: string;
  /** GAS側Bridge.jsのBRIDGE_API_SECRET(Script Properties)と同じ値。 */
  secret: string;
  /** リクエストのタイムアウト(ms)。GAS実行がハングした場合に呼び出し元を無期限にブロックしないため。 */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 20_000;

/** GAS Web Appからのレスポンスがエラー/非JSONだった場合に投げるエラー。 */
export class GasBridgeError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'GasBridgeError';
  }
}

/** Bridge.js(GAS版Web Appの?api=1エンドポイント)への共通クライアント。 */
export class GasBridgeClient {
  constructor(private readonly options: GasBridgeOptions) {}

  private buildUrl(action: string, params: Record<string, string>): string {
    const url = new URL(this.options.baseUrl);
    url.searchParams.set('api', '1');
    // secret/actionはURLクエリに載せる(GAS Web AppのdoGet/doPost(e).parameterで読む仕様のため。
    // e.headersのような形でカスタムヘッダーを読む手段がGAS側に無く、ヘッダー化はできない)。
    url.searchParams.set('secret', this.options.secret);
    url.searchParams.set('action', action);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  }

  private async parseJsonResponse<T>(res: Response, action: string): Promise<T> {
    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      throw new GasBridgeError(
        `GASブリッジへの呼び出しに失敗しました(action=${action}, status=${res.status}): ${bodyText.slice(0, 200)}`,
        res.status,
      );
    }
    try {
      return (await res.json()) as T;
    } catch {
      throw new GasBridgeError(
        `GASブリッジからのレスポンスがJSONではありません(action=${action}, status=${res.status})`,
        res.status,
      );
    }
  }

  async fetchJson<T>(action: string, params: Record<string, string>): Promise<T> {
    const res = await fetch(this.buildUrl(action, params), {
      signal: AbortSignal.timeout(this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    return this.parseJsonResponse<T>(res, action);
  }

  /**
   * ミラー書き込み(daily_report/accident_report/receipt/attendance_day)用。領収書画像の
   * base64データ等、URLクエリに載せるには大きすぎる/不向きなペイロードをJSON POST本体で送る。
   * secret/actionはGET側と同じくURLクエリに載せる(Bridge.js側のdoPost(e).parameterで読む)。
   */
  async postJson<T>(action: string, body: unknown): Promise<T> {
    const res = await fetch(this.buildUrl(action, {}), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    return this.parseJsonResponse<T>(res, action);
  }
}
