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
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { TENANT_RLS_USING } from './_rls';
import { customers } from './customers';
import { reservations } from './reservations';
import { staff } from './staff';
import { tenants } from './tenants';

/**
 * 保育日報。GAS版の「日報」シート(REPORT_SHEET_NAME)に対応(Main.js saveReport/getCustomerReports)。
 *
 * occurredAtは訪問日時(reportDate+startTimeから算出。GAS版のTimestamp列と同じ)で、履歴の並び替え・
 * 絞り込みに使う。PSI/ES評価は小さな数値。
 *
 * 【occurredAtとstartedAtの二重管理(doc/14 §6)】
 * startedAtはoccurredAt(=訪問日+開始時刻)と同じ情報の二重管理になっている。食い違いが
 * 起きないよう、usecases/reports.tsのsaveDailyReportは両方を同じ入力(reportDate+startTime)
 * から同じ関数(parseJstDateTime)で作り、startTimeが入力されているときはoccurredAtの
 * DateオブジェクトをそのままstartedAtにも使う(計算をやり直さない)。startTime未入力時は
 * occurredAtだけが埋まる(並べ替えキーとして機能させるため空文字時刻をmidnight扱いにする
 * 既存挙動を維持)のに対し、startedAtはnullのままにする(「未入力」をNULLで表せるようにする
 * のがこの改修の目的のため)。
 *
 * 【保存方針(2026-09 データベース暗号化の見直し)】
 * 本文(開始/終了時刻、メモ、社内向け/保護者向けレポート)は packages/core/src/domain/reports/types.ts
 * の DailyReportContent と1:1の平文 text 列に分けて保存する。以前はJSONにまとめて1本の暗号文に
 * していたが、フィールド単位の暗号化は app_settings の資格情報だけに縮小した。
 * - 項目ごとの列にするのは、SQLで直接検索・集計(将来は全文検索インデックス付与)できるようにするため。
 *   日報テキストは将来の分析・AI活用の主対象であり、平文でSQLから扱える方が匿名化・統計化も実装しやすい。
 * - 保護はDB/バックアップの保存時暗号化 + RLS + アクセス制御で行う。
 * - 各列の DEFAULT '' は、行が残っているDBでも ADD COLUMN ... NOT NULL が失敗しないようにするため
 *   (既存行の本文は空になる=既存の暗号化済みデータは引き継がない、という決定に沿う)。
 */
export const dailyReports = pgTable(
  'daily_reports',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    staffId: uuid().notNull(),
    customerId: uuid().notNull(),
    /**
     * この日報が実施記録になっている予約。予約を伴わない訪問(緊急対応・当日依頼)は null。
     *
     * 予約(約束)と日報(実際に行ったことの記録)を1テーブルにまとめない理由は
     * reservations.ts のコメント参照。紐付けを日報側に持たせるのは、1つの予約から
     * 日報が2件できることが無い(1回の訪問=1件)一方で、予約の無い日報はあるため。
     */
    reservationId: uuid(),

    occurredAt: timestamp({ withTimezone: true }).notNull(),
    /** PSI評価(1〜5)。未評価はnull(2026-08-28のGAS版仕様変更で未評価に戻せるようにしたのを踏襲)。 */
    riskRating: integer(),
    /** 満足度(ES)評価(1〜5)。未評価はnull。 */
    esRating: integer(),

    // doc/14 §6: 'HH:mm'文字列(未入力は空文字)をtimestamptzに変える。NULLを「未入力」に
    // 使えるようにし、滞在時間の集計や日跨ぎ勤務(22:00〜01:00等)の計算をSQLでできるようにする。
    // "HH:mm"表記が必要な場面(GASミラー・画面表示)は、保存時ではなくその場で整形し直す
    // (usecases/mirrorWorker.ts、domain/reports/jstTime.tsのformatJstTimeOnly参照)。
    /** 開始時刻。未入力はnull。occurredAtとの関係はこのファイル冒頭のコメント参照。 */
    startedAt: timestamp({ withTimezone: true }),
    /** 終了時刻。未入力はnull。日跨ぎ勤務はstartedAtより後(翌日)の値になる。 */
    endedAt: timestamp({ withTimezone: true }),
    /** 保育日報のメモ(口語入力。AI生成前の元テキスト)。GAS版のInputText列。 */
    inputText: text().notNull().default(''),
    /** 社内向けレポート本文。GAS版のInternalReport列。 */
    internalText: text().notNull().default(''),
    /** 保護者向けレポート本文。GAS版のCustomerReport列。 */
    customerText: text().notNull().default(''),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    // (tenant_id, staff_id)/(tenant_id, customer_id)の複合FK。RLSはSELECTしか絞り込まず、
    // FK制約自体はRLSをバイパスするため、単一列FKのままだとテナントAのstaffId/customerIdに
    // 別テナントの行が混入してもDBが検知できない(データベース構造レビューで発見)。
    foreignKey({
      name: 'daily_reports_tenant_staff_fk',
      columns: [t.tenantId, t.staffId],
      foreignColumns: [staff.tenantId, staff.id],
    }),
    foreignKey({
      name: 'daily_reports_tenant_customer_fk',
      columns: [t.tenantId, t.customerId],
      foreignColumns: [customers.tenantId, customers.id],
    }),
    // reservationIdはnull許容。nullの行はMATCH SIMPLE(既定)によりFK制約の対象外になる
    // (予約を伴わない訪問を許容する仕様と両立する)。
    foreignKey({
      name: 'daily_reports_tenant_reservation_fk',
      columns: [t.tenantId, t.reservationId],
      foreignColumns: [reservations.tenantId, reservations.id],
    }),
    // 1つの予約に日報が2件付くのを止める(二重登録で実施記録が重複すると、
    // サービス提供分の請求も二重になる)。nullの行同士は重複とみなさない。
    uniqueIndex('daily_reports_tenant_reservation_uidx')
      .on(t.tenantId, t.reservationId)
      .where(sql`${t.reservationId} IS NOT NULL`),
    // doc/14 §9: coupon_redemptions.daily_report_id からの複合外部キー
    // (tenant_id, daily_report_id)の参照先。customers.ts の customers_tenant_id_uk と同じ理由
    // (RLSはFK制約をバイパスするため、単一列PKだけでは他テナントのdaily_report_idを誤って
    // 参照してもDBが検知できない)。PostgreSQL的にも、複合FKの参照先には参照する列の組と
    // 完全に一致するUNIQUE制約が必要(idだけのPKでは(tenant_id, id)を参照できない)。
    unique('daily_reports_tenant_id_uk').on(t.tenantId, t.id),
    // doc/14 §9: coupon_redemptions.(tenant_id, daily_report_id, customer_id) からの複合FKの
    // 参照先。適用記録側に顧客IDを持たせる(年1回などの使用上限をDBで縛るために必要)一方で、
    // 「日報の顧客と食い違う顧客IDを書けてしまう」二重管理にしないため、顧客IDまで含めた
    // この組をFKで縛る。PostgreSQLは複合FKの参照先に、参照する列の組と完全に一致する
    // UNIQUE制約を要求するため、(tenant_id, id)とは別にこの3列の組も持つ。
    unique('daily_reports_tenant_id_customer_uk').on(t.tenantId, t.id, t.customerId),
    // 「顧客の日報履歴」を開くたびに走る listByCustomer
    // (WHERE customer_id=? ORDER BY occurred_at DESC LIMIT n)を索引だけで返すための複合索引。
    // occurredAt を DESC で含めるのは、ORDER BY と向きを揃えて並べ替えを省くため(doc/14 §3)。
    index('daily_reports_tenant_customer_occurred_idx').on(t.tenantId, t.customerId, t.occurredAt.desc()),
    // risk_rating/es_ratingは「1〜5」という前提でUIやミラー送信のコードが書かれており、
    // 範囲外の値が混入すると気付かないままスプレッドシートにも書き出される(doc/14 §4)。
    check('daily_reports_risk_rating_check', sql`${t.riskRating} IS NULL OR ${t.riskRating} BETWEEN 1 AND 5`),
    check('daily_reports_es_rating_check', sql`${t.esRating} IS NULL OR ${t.esRating} BETWEEN 1 AND 5`),
    // 日跨ぎ勤務(22:00〜01:00等)はendedAtがstartedAtの翌日になるのを許すため、単純な
    // ">="ではなく「どちらかがNULL(未入力)ならスキップ」を先に見る(doc/14 §6)。
    // endedAt/startedAtを組み立てる側(usecases/reports.ts)が、end<startのときendedAtを
    // 翌日にずらす責任を持つ。
    check(
      'daily_reports_time_order',
      sql`${t.endedAt} IS NULL OR ${t.startedAt} IS NULL OR ${t.endedAt} >= ${t.startedAt}`,
    ),
  ],
).enableRLS();
