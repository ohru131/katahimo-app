import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  integer,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { TENANT_RLS_USING } from './_rls';
import { tenants } from './tenants';

/**
 * スタッフ(社員)。認証情報(パスワードハッシュ)を兼ねる。
 *
 * 氏名・メール・電話は平文で保持する(2026-08のデータベース構造レビューを踏まえ、要配慮性の
 * 低い通常の個人情報はフィールド暗号化の対象から外し、DB/バックアップの透過的暗号化(TDE)+
 * Row Level Security+アクセス制御に委ねる方針へ変更。doc/09参照)。emailはログイン時の検索キー
 * になるため、書き込み時に`normalizeEmailForIndex`で正規化した値を保存する(表記ゆれで
 * ログインできなくなることを防ぐため)。
 */
export const staff = pgTable(
  'staff',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),

    name: text().notNull(),
    email: text().notNull(),
    phone: text(),

    /**
     * argon2id。GAS版から移行したスタッフは初回ログインまでnull(legacyPasswordHashのみ持つ)。
     * ログイン成功時にサイレント再ハッシュしてここへ設定する(packages/core/src/usecases/auth.ts)。
     */
    passwordHash: text(),
    /**
     * GAS版のSHA-256+salt方式のハッシュ(sha256(password + AUTH_SALT))。移行直後の
     * スタッフのみ持ち、argon2idへの再ハッシュが完了したらnullに戻す。新規登録スタッフは
     * 最初からargon2idのみでこの列は使わない。
     */
    legacyPasswordHash: text(),

    isAdmin: boolean().notNull().default(false),
    retirementDate: date(),

    /**
     * 初期パスワードのまま(または管理者にリセットされた直後)であることを示す。
     * trueの間はログインできるが、パスワードを変更するまで他の操作をさせない
     * (packages/web が初回パスワード変更の画面を強制表示する)。
     * 本人がパスワードを変更した時点でfalseに戻る。
     */
    mustChangePassword: boolean().notNull().default(false),
    /**
     * 連続でのログイン失敗回数。上限に達するとlockedUntilを立てて一時的に受け付けなくする
     * (packages/core/src/domain/auth/loginThrottle.ts)。成功したら0に戻す。
     */
    failedLoginAttempts: integer().notNull().default(0),
    /** この時刻まではログインを受け付けない。恒久ロックにはしない(締め出しによる業務停止を避けるため)。 */
    lockedUntil: timestamp({ withTimezone: true }),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    uniqueIndex('staff_tenant_email_idx').on(t.tenantId, t.email),
    // attendance_days/daily_reports等からの複合外部キー(tenant_id, staff_id)の参照先。
    // customers.ts の customers_tenant_id_uk と同じ理由(RLSはFK制約をバイパスするため)。
    unique('staff_tenant_id_uk').on(t.tenantId, t.id),
    // 負の失敗回数はloginThrottleのロジックが想定していない(doc/14 D項)。
    check('staff_failed_login_attempts_check', sql`${t.failedLoginAttempts} >= 0`),
  ],
).enableRLS();
