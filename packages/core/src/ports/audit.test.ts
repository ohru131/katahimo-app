import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { AuditEventType } from './audit';

/**
 * `AuditEventType` に並んでいる種別が、実際にどこかから記録されていることを固定する。
 *
 * 型にだけ載っていて誰も呼ばないイベントがあると、監査ログを見る側が
 * 「この操作は記録されているはずだ」と誤解する。記録されていない方が危ないので、
 * 型と実装のずれをテストで気づけるようにしておく。
 */

const USECASES_DIR = fileURLToPath(new URL('../usecases/', import.meta.url));
const ROUTES_DIR = fileURLToPath(new URL('../../../api/src/routes/', import.meta.url));

const EVENT_TYPES: AuditEventType[] = [
  'login_succeeded',
  'login_failed',
  'logout',
  'password_changed',
  'password_reset_requested',
  'password_reset_completed',
  'staff_created',
  'staff_updated',
  'staff_password_reset_by_admin',
];

const SOURCES = [
  `${USECASES_DIR}auth.ts`,
  `${USECASES_DIR}passwordReset.ts`,
  `${USECASES_DIR}staff.ts`,
  `${ROUTES_DIR}auth.ts`,
].map((path) => readFileSync(path, 'utf8'));

describe('監査イベントの型と実装', () => {
  it.each(EVENT_TYPES)('%s は実際に記録されている', (type) => {
    const emitted = SOURCES.some((src) => src.includes(`type: '${type}'`));
    expect(emitted).toBe(true);
  });
});
