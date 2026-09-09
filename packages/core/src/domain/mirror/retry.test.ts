import { describe, expect, it } from 'vitest';
import { MAX_OUTBOX_ATTEMPTS, nextOutboxRetryDelayMs } from './retry';

describe('nextOutboxRetryDelayMs', () => {
  it('初回の失敗は最短の待ち時間で再試行する', () => {
    expect(nextOutboxRetryDelayMs(1)).toBe(5_000);
  });

  it('失敗を重ねるほど待ち時間が倍になる', () => {
    expect(nextOutboxRetryDelayMs(2)).toBe(10_000);
    expect(nextOutboxRetryDelayMs(3)).toBe(20_000);
    expect(nextOutboxRetryDelayMs(4)).toBe(40_000);
  });

  it('待ち時間は1時間で頭打ちになる', () => {
    expect(nextOutboxRetryDelayMs(MAX_OUTBOX_ATTEMPTS - 1)).toBeLessThanOrEqual(60 * 60 * 1000);
  });

  it('上限に達したらnullを返す(デッドレターに落とす)', () => {
    expect(nextOutboxRetryDelayMs(MAX_OUTBOX_ATTEMPTS)).toBeNull();
    expect(nextOutboxRetryDelayMs(MAX_OUTBOX_ATTEMPTS + 1)).toBeNull();
  });
});
