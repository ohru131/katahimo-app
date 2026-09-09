import { describe, expect, it } from 'vitest';
import { buildMirrorIdempotencyKey } from './idempotencyKey';

describe('buildMirrorIdempotencyKey', () => {
  it('同じレコードの同じ版なら同じキーになる', () => {
    const at = new Date('2026-09-01T10:00:00.000Z');
    expect(buildMirrorIdempotencyKey('daily_report', 'r1', at)).toBe(
      buildMirrorIdempotencyKey('daily_report', 'r1', at),
    );
  });

  it('編集して版が進んだら別のキーになる(再ミラーが必要なため)', () => {
    const before = buildMirrorIdempotencyKey('daily_report', 'r1', new Date('2026-09-01T10:00:00.000Z'));
    const after = buildMirrorIdempotencyKey('daily_report', 'r1', new Date('2026-09-01T10:05:00.000Z'));
    expect(after).not.toBe(before);
  });

  it('レコードが違えば別のキーになる', () => {
    const at = new Date('2026-09-01T10:00:00.000Z');
    expect(buildMirrorIdempotencyKey('daily_report', 'r1', at)).not.toBe(
      buildMirrorIdempotencyKey('daily_report', 'r2', at),
    );
  });

  it('種別が違えば別のキーになる', () => {
    const at = new Date('2026-09-01T10:00:00.000Z');
    expect(buildMirrorIdempotencyKey('daily_report', 'r1', at)).not.toBe(
      buildMirrorIdempotencyKey('accident_report', 'r1', at),
    );
  });
});
