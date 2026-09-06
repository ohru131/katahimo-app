import type { LatLng, MapsPort, RouteLeg } from '@katahimo/core/ports';

/**
 * 直線距離に対する実際の道路距離の比。関西の市街地はおおむね1.3〜1.4倍になる。
 * デモの数字が「それっぽく」見えるかどうかはここで決まる。
 */
const ROAD_DISTANCE_FACTOR = 1.35;

/** 市街地の平均車速(km/h)。信号待ちを含む実効値。 */
const AVERAGE_SPEED_KMH = 24;

/** 発着地が同じでも0分にはならないので下限を置く。 */
const MIN_DURATION_MIN = 5;

const EARTH_RADIUS_KM = 6371;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** 2地点間の大圏距離(km)。 */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/**
 * MapsPortのデモ実装。
 *
 * 本番はGAS Bridge経由でGoogle MapsのGeocoding/Routes APIを呼ぶが、公開デモには
 * APIキーを置けない(静的サイトに埋め込んだ時点で漏洩する)。そこで、シードで用意した
 * 住所→緯度経度の対応表と、直線距離からの概算で代用する。数値は実測ではないので、
 * 画面には「デモ用の概算値」であることを明示すること。
 */
export class DemoMapsPort implements MapsPort {
  constructor(private readonly knownAddresses: ReadonlyMap<string, LatLng>) {}

  async geocode(address: string): Promise<LatLng | null> {
    const normalized = address.trim();
    const exact = this.knownAddresses.get(normalized);
    if (exact) return exact;
    // 「大阪府大阪市中央区○○1-2-3」のように番地まで一致しない場合があるため、前方一致でも探す。
    for (const [known, latLng] of this.knownAddresses) {
      if (normalized.startsWith(known) || known.startsWith(normalized)) return latLng;
    }
    return null;
  }

  async route(origin: LatLng, destination: LatLng): Promise<RouteLeg | null> {
    const distanceKm = haversineKm(origin, destination) * ROAD_DISTANCE_FACTOR;
    const durationMin = Math.max(MIN_DURATION_MIN, Math.round((distanceKm / AVERAGE_SPEED_KMH) * 60));
    return { durationMin, distanceKm: Math.round(distanceKm * 10) / 10 };
  }
}
