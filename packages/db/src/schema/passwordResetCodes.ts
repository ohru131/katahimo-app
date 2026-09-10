import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { TENANT_RLS_USING } from './_rls';
import { staff } from './staff';
import { tenants } from './tenants';

/**
 * パスワード再設定の認証コード。GAS版 Auth.js の `PasswordResets` シートに対応。
 *
 * GAS版はコードを平文でシートに書いていたが、ここではサーバー側のペッパーを鍵にした
 * HMACの検証子だけを保存する(DBダンプが漏れても、そこから有効なコードを復元できない
 * ようにするため)。6桁しかないので総当たりは現実的な脅威で、`failedAttempts` で
 * 試行回数を数えて上限で無効化する。
 */
export const passwordResetCodes = pgTable(
  'password_reset_codes',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    staffId: uuid().notNull(),
    /**
     * 6桁コードの検証子。サーバー側のペッパー(DBには置かない)を鍵にした
     * HMAC-SHA256(hex)。生のコードはメール本文にしか存在しない。
     *
     * 単純なSHA-256にしないのは、6桁=100万通りしかなく、DBが漏れた時点で
     * オフラインで全パターンを試せば有効なコードを復元できてしまうため。
     * ペッパーが無いと計算できない形にしておく。
     */
    codeVerifier: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    /** 使用済みになった時刻。一度使ったコードは再利用できない。 */
    consumedAt: timestamp({ withTimezone: true }),
    /** 誤ったコードでの試行回数。上限に達したコードは期限内でも無効として扱う。 */
    failedAttempts: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    // 「このスタッフの有効なコード」を新しい順に引くための索引。
    index('password_reset_codes_staff_idx').on(t.tenantId, t.staffId, t.createdAt),
    // sessions.tsと同じ理由。他テナントのstaffId宛にコードが発行される事態を防ぐ。
    foreignKey({
      name: 'password_reset_codes_tenant_staff_fk',
      columns: [t.tenantId, t.staffId],
      foreignColumns: [staff.tenantId, staff.id],
    }),
    // staff.tsと同じ理由(負の試行回数は想定していない)。
    check('password_reset_codes_failed_attempts_check', sql`${t.failedAttempts} >= 0`),
  ],
).enableRLS();
