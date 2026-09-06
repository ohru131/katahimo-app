import { describe, expect, it } from 'vitest';
import {
  constantTimeEquals,
  generateInitialPassword,
  generateResetCode,
  isAcceptablePassword,
  MIN_PASSWORD_LENGTH,
} from './password';

/** 引き直し(modulo bias除去)の分岐まで通るよう、決められたバイト列を返す偽の乱数。 */
function bytesFrom(values: number[]): (size: number) => Uint8Array {
  let cursor = 0;
  return (size) => {
    const out = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
      out[i] = values[cursor % values.length] ?? 0;
      cursor++;
    }
    return out;
  };
}

describe('isAcceptablePassword', () => {
  it('最低文字数に満たないものを弾く', () => {
    expect(isAcceptablePassword('a'.repeat(MIN_PASSWORD_LENGTH - 1))).toBe(false);
    expect(isAcceptablePassword('a'.repeat(MIN_PASSWORD_LENGTH))).toBe(true);
  });
});

describe('generateResetCode', () => {
  it('6桁の数字を返す', () => {
    const code = generateResetCode(bytesFrom([1, 2, 3, 4, 5, 6]));
    expect(code).toBe('123456');
  });

  it('偏りの原因になる範囲外のバイトは捨てて引き直す', () => {
    // 250以上は 256 を10で割った余りの分。使うと0〜5が出やすくなるため捨てる。
    const code = generateResetCode(bytesFrom([250, 251, 7, 7, 7, 7, 7, 7]));
    expect(code).toBe('777777');
  });
});

describe('generateInitialPassword', () => {
  it('読み違えやすい文字を含まない', () => {
    const password = generateInitialPassword((size) => {
      const out = new Uint8Array(size);
      for (let i = 0; i < size; i++) out[i] = i;
      return out;
    });
    expect(password).toHaveLength(12);
    expect(password).not.toMatch(/[0O1lI]/);
  });

  it('最低文字数を満たす', () => {
    const password = generateInitialPassword(bytesFrom([3, 9, 20, 40, 5]));
    expect(isAcceptablePassword(password)).toBe(true);
  });
});

describe('constantTimeEquals', () => {
  it('同じ文字列でtrue、違えばfalse', () => {
    expect(constantTimeEquals('abc123', 'abc123')).toBe(true);
    expect(constantTimeEquals('abc123', 'abc124')).toBe(false);
    // 先頭が違う場合も末尾が違う場合も同じ結果になること(打ち切っていない)
    expect(constantTimeEquals('abc123', 'zbc123')).toBe(false);
  });

  it('長さが違えばfalse', () => {
    expect(constantTimeEquals('abc', 'abcd')).toBe(false);
    expect(constantTimeEquals('abcd', 'abc')).toBe(false);
    expect(constantTimeEquals('', '')).toBe(true);
    expect(constantTimeEquals('', 'a')).toBe(false);
  });
});
