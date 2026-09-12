export interface ParsedLatLng {
  lat: number | null;
  lng: number | null;
}

/** 座標として実在しうる値域(customers_lat_range/customers_lng_rangeと同じ範囲)。 */
const LAT_RANGE = { min: -90, max: 90 };
const LNG_RANGE = { min: -180, max: 180 };

const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;

/**
 * RESERVA CSVの「緯度・経度」列(例: "38.26, 140.87")を緯度・経度の数値に分解する。
 *
 * doc/14 §7: この値はどこでも解析されず文字列のまま素通りしていたため、距離計算・
 * ジオフェンス・座標化しての報告(doc/07・秘密保持契約第4条)に使える数値へ変換する。
 * 区切りは半角/全角カンマを許容し、前後の空白は無視する。数値として読めない、要素数が
 * 2でない、または実在する座標の値域を外れる場合はlat/lngともnullを返す(呼び出し側は
 * lat_lng_rawに元の表記だけを残し、DBのcustomers_lat_range/customers_lng_range制約に
 * 違反しうる値を渡さない)。
 */
export function parseLatLng(value: string): ParsedLatLng {
  const trimmed = value.trim();
  if (!trimmed) return { lat: null, lng: null };

  const parts = trimmed.split(/[,，]/).map((p) => p.trim());
  if (parts.length !== 2) return { lat: null, lng: null };

  const [latStr, lngStr] = parts as [string, string];
  if (!DECIMAL_PATTERN.test(latStr) || !DECIMAL_PATTERN.test(lngStr)) {
    return { lat: null, lng: null };
  }

  const lat = Number(latStr);
  const lng = Number(lngStr);
  if (lat < LAT_RANGE.min || lat > LAT_RANGE.max || lng < LNG_RANGE.min || lng > LNG_RANGE.max) {
    return { lat: null, lng: null };
  }

  return { lat, lng };
}
