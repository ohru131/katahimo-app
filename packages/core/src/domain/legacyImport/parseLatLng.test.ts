import { describe, expect, it } from 'vitest';
import { parseLatLng } from './parseLatLng';

describe('parseLatLng', () => {
  it('doc/14 §7の例と同じ"38.26, 140.87"形式(カンマ+空白)を分解する', () => {
    expect(parseLatLng('38.26, 140.87')).toEqual({ lat: 38.26, lng: 140.87 });
  });

  it('空白無し・負数も分解できる', () => {
    expect(parseLatLng('38.263133,140.869398')).toEqual({ lat: 38.263133, lng: 140.869398 });
    expect(parseLatLng('-33.8688,151.2093')).toEqual({ lat: -33.8688, lng: 151.2093 });
  });

  it('全角カンマ区切りも許容する', () => {
    expect(parseLatLng('38.26，140.87')).toEqual({ lat: 38.26, lng: 140.87 });
  });

  it('空文字はlat/lngともnullを返す', () => {
    expect(parseLatLng('')).toEqual({ lat: null, lng: null });
    expect(parseLatLng('   ')).toEqual({ lat: null, lng: null });
  });

  it('数値として読めない・要素数が2でない表記はlat/lngともnullを返す', () => {
    expect(parseLatLng('不明')).toEqual({ lat: null, lng: null });
    expect(parseLatLng('38.26')).toEqual({ lat: null, lng: null });
    expect(parseLatLng('38.26, 140.87, 10')).toEqual({ lat: null, lng: null });
    expect(parseLatLng('38.26abc, 140.87')).toEqual({ lat: null, lng: null });
  });

  it('実在する座標の値域を外れる場合はlat/lngともnullを返す', () => {
    expect(parseLatLng('200, 140.87')).toEqual({ lat: null, lng: null });
    expect(parseLatLng('38.26, 999')).toEqual({ lat: null, lng: null });
  });
});
