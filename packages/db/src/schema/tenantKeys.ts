import { sql } from 'drizzle-orm';
import { check, integer, pgPolicy, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { TENANT_RLS_USING } from './_rls';
import { tenants } from './tenants';

/**
 * テナントごとのデータ暗号化鍵(DEK)。エンベロープ暗号化の要。
 *
 * 2026-09 の見直しで、アプリ層のフィールド暗号化は app_settings の資格情報(Gemini APIキー・
 * Google Chat Webhook URL)だけに縮小した。顧客・日報等の業務データは平文列なので、
 * このDEKが守るのは資格情報の暗号文のみ。
 *
 * 暗号化列(app_settings の *_ciphertext)を直接暗号化する鍵は、マスターキーからの決定的導出(旧実装、
 * 2026-08 データベース構造レビューで指摘)ではなく、テナントごとにランダム生成した
 * DEKそのものを使う。DEKは平文のままでは保存せず、KEK(Key Encryption Key。ローカル開発は
 * 環境変数、本番はCloud KMS想定)でラップ(暗号化)した状態でのみ永続化する
 * (packages/core/src/ports/kms.ts のKeyManagementPort参照)。
 *
 * こうする理由: 旧実装(SHA256(masterKey + tenantId))は「masterKeyが割れれば任意テナントの鍵を
 * 誰でも計算できる」という、キー1本を共有しているのと実質的に変わらない設計だった。
 * DEKをテナントごとに独立して生成・保管することで、
 * - KEKが漏洩しても、攻撃者は「ラップされたDEKの実体」まで別途盗む必要がある(単一の
 *   決定的関数だけでは全テナントの鍵を再現できない)
 * - テナント解約時は本レコードを削除するだけで、そのテナントの暗号文(app_settings の資格情報)
 *   はバックアップに残っていても二度と復号できなくなる(暗号学的削除。revoke()参照)。
 *   ただしこれが及ぶのは暗号化された資格情報だけで、顧客・日報等の業務データは平文列のため、
 *   テナント削除はテナント単位の物理 DELETE(+バックアップ保持期間の経過)で行う
 * - 本番のCloud KMS移行時は、KeyManagementPortの実装を差し替えるだけで済む(wrappedDek列の
 *   形式(base64)自体は変えずに済む)
 * が実現できる。
 *
 * dekVersion: DEKそのものをローテーションした回数。各暗号化列の`*_key_version`はこの値を指す。
 * kekVersion: DEKを再ラップした回数(KEKだけを差し替える、軽い操作。データの再暗号化は不要)。
 *
 * 主キーが (tenantId, dekVersion) の複合になっているのは、**世代を並存させる**ため。
 * 1テナント1行にすると、DEKをローテーションした瞬間に古い世代で暗号化された既存の
 * 暗号文がすべて読めなくなる(=ローテーションが実質不可能になる)。世代を残しておけば、
 * 新しい書き込みは最新世代で暗号化しつつ、既存の値は記録された世代の鍵で復号できる。
 * 再暗号化のバッチは、その状態のまま後から流せばよい。
 */
export const tenantKeys = pgTable(
  'tenant_keys',
  {
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    dekVersion: integer().notNull().default(1),
    wrappedDek: text().notNull(),
    kekVersion: integer().notNull().default(1),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /**
     * 暗号学的削除の実行日時。設定後はunwrapできない(=そのテナントの app_settings の暗号化済み
     * 資格情報が永久に復号不能)。平文列の業務データには及ばない(テナント単位の物理 DELETE で消す)。
     */
    revokedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.dekVersion] }),
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    // 0未満/0の版は「ローテーションしていない初期状態」と区別できず、KeyManagementPortの
    // 前提(世代は1始まり)を壊す(doc/14 §4)。
    check('tenant_keys_version_check', sql`${t.dekVersion} >= 1 AND ${t.kekVersion} >= 1`),
  ],
).enableRLS();
