import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  integer,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { TENANT_RLS_USING } from './_rls';
import { tenants } from './tenants';

/**
 * スタッフ(社員)。認証情報(パスワードハッシュ)を兼ねる。
 *
 * PII(氏名・メール・電話)は実値をランダム化暗号(ciphertext+keyVersion)で保存し、
 * 検索が必要な項目だけ別途blindIndex(HMAC)を持つ(packages/core/src/ports/crypto.ts参照)。
 * メールは「ログイン時にメールアドレスで引き当てる」ため必ずblindIndexを持つ。
 */
export const staff = pgTable(
  'staff',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),

    nameCiphertext: text().notNull(),
    nameKeyVersion: integer().notNull(),
    familyNameBlindIndex: text().notNull(),
    givenNameBlindIndex: text().notNull(),

    emailCiphertext: text().notNull(),
    emailKeyVersion: integer().notNull(),
    emailBlindIndex: text().notNull(),

    phoneCiphertext: text(),
    phoneKeyVersion: integer(),
    phoneBlindIndex: text(),

    /** argon2id。GAS版のSHA-256+salt方式からの移行はPhase 2で別途扱う(legacy_password_hash等)。 */
    passwordHash: text().notNull(),

    isAdmin: boolean().notNull().default(false),
    retirementDate: date(),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    uniqueIndex('staff_tenant_email_blind_idx').on(t.tenantId, t.emailBlindIndex),
  ],
).enableRLS();
