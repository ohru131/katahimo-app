import { describe, expect, it } from 'vitest';
import {
  normalizeAddressComponentForIndex,
  normalizeEmailForIndex,
  normalizePhoneForIndex,
} from './normalize';

describe('normalizeEmailForIndex', () => {
  it('大文字/小文字・前後空白を無視する', () => {
    expect(normalizeEmailForIndex('  Hanako.Sato@Example.com  ')).toBe('hanako.sato@example.com');
  });
});

describe('normalizePhoneForIndex', () => {
  it('ハイフン・空白・全角数字を半角数字だけの列に揃える', () => {
    expect(normalizePhoneForIndex('090-1234-5678')).toBe('09012345678');
    expect(normalizePhoneForIndex('０９０-１２３４-５６７８')).toBe('09012345678');
    expect(normalizePhoneForIndex('090 1234 5678')).toBe('09012345678');
  });
});

describe('normalizeAddressComponentForIndex', () => {
  it('前後の空白のみ除去する(市区町村レベルは低カーディナリティなので表記はそのまま扱う)', () => {
    expect(normalizeAddressComponentForIndex('  渋谷区  ')).toBe('渋谷区');
  });
});
