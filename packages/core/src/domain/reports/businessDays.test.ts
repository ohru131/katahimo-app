import { describe, expect, it } from 'vitest';
import { addBusinessDays } from './businessDays';

describe('addBusinessDays', () => {
  it('平日は素直に進む(2026-09-14は月曜)', () => {
    expect(addBusinessDays('2026-09-14', 2)).toBe('2026-09-16');
  });

  it('週末をまたぐと土日を飛ばす(木曜+2営業日は翌月曜)', () => {
    // 2026-09-17は木曜。金(18)・月(21)と数えて月曜になる。
    expect(addBusinessDays('2026-09-17', 2)).toBe('2026-09-21');
  });

  it('起点が土曜でも、翌月曜から数え始める', () => {
    // 2026-09-19は土曜。月(21)・火(22)と数える。
    expect(addBusinessDays('2026-09-19', 2)).toBe('2026-09-22');
  });

  it('起点が日曜でも同じ', () => {
    expect(addBusinessDays('2026-09-20', 2)).toBe('2026-09-22');
  });

  it('月またぎでも正しく進む', () => {
    // 2026-09-30は水曜。木(10/1)・金(10/2)。
    expect(addBusinessDays('2026-09-30', 2)).toBe('2026-10-02');
  });

  it('0日なら起点をそのまま返す', () => {
    expect(addBusinessDays('2026-09-19', 0)).toBe('2026-09-19');
  });
});
