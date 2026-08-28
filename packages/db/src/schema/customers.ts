import { sql } from 'drizzle-orm';
import { integer, pgPolicy, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { TENANT_RLS_USING } from './_rls';
import { tenants } from './tenants';

/**
 * 顧客(利用世帯の代表者)。GAS版の「顧客DB_New」シートに対応。
 *
 * 氏名・電話・住所は実値をランダム化暗号(ciphertext+keyVersion)で保存し、検索が必要な
 * 項目だけ別途blindIndex(HMAC)を持つ。氏名は「苗字だけで検索する」現場運用があるため、
 * familyName/givenNameを分割してそれぞれ独立にblindIndexを持つ
 * (packages/core/src/domain/pii/japaneseName.ts の splitJapaneseFullName で分割)。
 * 市区町村は低カーディナリティだが、実装を統一するため同じ暗号化+blindIndex方式にする。
 */
export const customers = pgTable(
  'customers',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),

    nameCiphertext: text().notNull(),
    nameKeyVersion: integer().notNull(),
    familyNameBlindIndex: text().notNull(),
    givenNameBlindIndex: text().notNull(),

    phoneCiphertext: text(),
    phoneKeyVersion: integer(),
    phoneBlindIndex: text(),

    /** 番地・建物名等、市区町村より詳細な住所。検索対象外なので暗号化のみでよい。 */
    addressDetailCiphertext: text(),
    addressDetailKeyVersion: integer(),

    cityCiphertext: text(),
    cityKeyVersion: integer(),
    cityBlindIndex: text(),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  () => [pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING })],
).enableRLS();
