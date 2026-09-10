import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

/** 必須項目だけを埋めた最小の環境変数。真偽値の解釈だけを見たいので、他は固定にする。 */
const REQUIRED = {
  DATABASE_URL: 'postgres://localhost:5432/katahimo',
  LOCAL_DEV_KEK: 'a'.repeat(64),
  PASSWORD_RESET_PEPPER: 'b'.repeat(64),
} satisfies NodeJS.ProcessEnv;

describe('真偽値の環境変数', () => {
  // z.coerce.boolean() を使っていた頃は Boolean('false') === true なので、
  // .env.example の通りに MIRROR_ATTENDANCE_AGGREGATE=false と書くと有効化されていた。
  // ミラーが1件走るごとにGAS側でMapsのルート計算が動くため、これは実害のある向きの誤りだった。
  it("文字列の 'false' を false として読む", () => {
    const env = loadEnv({
      ...REQUIRED,
      MIRROR_TO_GOOGLE_SHEETS: 'false',
      MIRROR_ATTENDANCE_AGGREGATE: 'false',
    });
    expect(env.MIRROR_TO_GOOGLE_SHEETS).toBe(false);
    expect(env.MIRROR_ATTENDANCE_AGGREGATE).toBe(false);
  });

  it("'true' / '1' は true、'0' は false", () => {
    expect(loadEnv({ ...REQUIRED, MIRROR_TO_GOOGLE_SHEETS: 'true' }).MIRROR_TO_GOOGLE_SHEETS).toBe(true);
    expect(loadEnv({ ...REQUIRED, MIRROR_TO_GOOGLE_SHEETS: '1' }).MIRROR_TO_GOOGLE_SHEETS).toBe(true);
    expect(loadEnv({ ...REQUIRED, MIRROR_TO_GOOGLE_SHEETS: '0' }).MIRROR_TO_GOOGLE_SHEETS).toBe(false);
  });

  it('大文字・前後の空白は無視する', () => {
    expect(loadEnv({ ...REQUIRED, MIRROR_TO_GOOGLE_SHEETS: ' TRUE ' }).MIRROR_TO_GOOGLE_SHEETS).toBe(true);
    expect(loadEnv({ ...REQUIRED, MIRROR_TO_GOOGLE_SHEETS: 'False' }).MIRROR_TO_GOOGLE_SHEETS).toBe(false);
  });

  it('未設定と空文字列は既定値(false)', () => {
    expect(loadEnv({ ...REQUIRED }).MIRROR_TO_GOOGLE_SHEETS).toBe(false);
    expect(loadEnv({ ...REQUIRED, MIRROR_TO_GOOGLE_SHEETS: '' }).MIRROR_TO_GOOGLE_SHEETS).toBe(false);
  });

  // 黙って既定値に落とすと「オンにしたつもりがオフ」に気付けないため、起動を止める。
  it('解釈できない表記は起動時に落とす', () => {
    expect(() => loadEnv({ ...REQUIRED, MIRROR_TO_GOOGLE_SHEETS: 'yes' })).toThrow(/MIRROR_TO_GOOGLE_SHEETS/);
  });
});
