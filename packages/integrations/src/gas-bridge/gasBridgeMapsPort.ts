import type { LatLng, MapsPort, RouteLeg } from '@katahimo/core/ports';

export interface GasBridgeMapsPortOptions {
  /** GAS版(gas-childcare-visit-app)Web Appの/execエンドポイントURL。 */
  baseUrl: string;
  /** GAS側Bridge.jsのBRIDGE_API_SECRET(Script Properties)と同じ値。 */
  secret: string;
}

/**
 * katahimo-appはApps Script実行環境の外からMapsサービス(Maps.newGeocoder/newDirectionFinder)を
 * 直接呼べないため、既に稼働しているgas-childcare-visit-appのWeb Appデプロイ(Bridge.js)を
 * 軽量なJSON APIプロキシとして使う実装。Google Maps Platformの新規契約(APIキー・課金設定)を
 * 避けられる(GAS版のMapsサービスが無料で使えている前提を、そのまま新システムでも使う)。
 *
 * ロジックはGAS版RouteSearch.jsのgetLatLngFromAddress/getRouteDetails(自動車移動・
 * 出発時刻指定無し)と同じで、実際の計算はBridge.js側(GAS実行環境内)で行う。
 */
export class GasBridgeMapsPort implements MapsPort {
  constructor(private readonly options: GasBridgeMapsPortOptions) {}

  private buildUrl(action: string, params: Record<string, string>): string {
    const url = new URL(this.options.baseUrl);
    url.searchParams.set('api', '1');
    url.searchParams.set('secret', this.options.secret);
    url.searchParams.set('action', action);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  }

  async geocode(address: string): Promise<LatLng | null> {
    const res = await fetch(this.buildUrl('geocode', { address }));
    const body = (await res.json()) as { success: boolean; location: LatLng | null; message?: string };
    if (!body.success) throw new Error(body.message || 'ジオコーディングに失敗しました(GASブリッジ)');
    return body.location;
  }

  /** GAS版と同じく出発時刻の指定はできない(常に現在の交通状況無しのDRIVINGルート)。 */
  async route(origin: LatLng, destination: LatLng): Promise<RouteLeg | null> {
    const res = await fetch(
      this.buildUrl('route', {
        originLat: String(origin.lat),
        originLng: String(origin.lng),
        destLat: String(destination.lat),
        destLng: String(destination.lng),
      }),
    );
    const body = (await res.json()) as { success: boolean; route: RouteLeg | null; message?: string };
    if (!body.success) throw new Error(body.message || 'ルート計算に失敗しました(GASブリッジ)');
    return body.route;
  }
}

/** GAS_BRIDGE_URL/GAS_BRIDGE_SECRET未設定時のフォールバック。常に「算出不可」を返す。 */
export class NoopMapsPort implements MapsPort {
  async geocode(): Promise<LatLng | null> {
    return null;
  }
  async route(): Promise<RouteLeg | null> {
    return null;
  }
}
