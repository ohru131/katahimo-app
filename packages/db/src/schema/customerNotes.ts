import { CUSTOMER_NOTE_CATEGORIES, CUSTOMER_NOTE_PHOTO_MAX_BYTES } from '@katahimo/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
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
import { sqlInList, sqlNumber } from './_sqlLiteral';
import { customers } from './customers';
import { staff } from './staff';
import { tenants } from './tenants';

/**
 * 顧客カルテの記載事項。1件=1つの記載(カルテ本文/申し送り/鍵の位置/ガレージ場所/
 * 引き継ぎ事項/注意点)。区分の意味と「1テーブル+区分にした理由」は
 * @katahimo/shared の contracts/customerNotes.ts のコメント参照。
 *
 * 【顧客テーブルの列にしない理由】
 * 鍵の位置やガレージの場所は現場で変わる。customers に列として持たせると上書きになり、
 * 「いつ誰がその情報にしたか」が残らない。訪問前に読む情報が誤っていたときに
 * 経緯を辿れないのは運用上の事故につながるため、行として積む形にした。
 *
 * 【pinned の役割】
 * 注意点・鍵の位置のように「毎回必ず目を通してほしい」記載を、日付順の一覧より上に
 * 固定表示するためのフラグ。区分(category)で代用しないのは、同じ区分の中にも
 * 「今も有効な注意点」と「過去の経緯として残す注意点」が混ざるため。
 *
 * 【resolvedAt の役割】
 * 引き継ぎ事項(carry_over)は「対応が終わったら閉じる」ものなので、行を消さずに
 * 済ませた時刻を入れる。消さないのは、写真(customer_note_photos)と併せて
 * 「そのとき何を引き継いだか」が後から確認できるようにするため。
 *
 * 【本文が空でも許す理由】
 * 鍵の位置・ガレージ場所は「写真1枚だけで意味が通る」ことが多く、本文を必須にすると
 * 現場が意味のない文字を入れることになる。代わりに「本文が空なら写真が1枚以上必要」
 * という条件を課したいところだが、それは1行のCHECK制約では書けない
 * (別テーブルの件数を参照するため)。入口(usecase)で担保する。
 */
export const customerNotes = pgTable(
  'customer_notes',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    customerId: uuid().notNull(),
    /** 記載したスタッフ。取込ではなく必ず人が書くため notNull。 */
    authorStaffId: uuid().notNull(),

    /** 記載区分。@katahimo/shared の CUSTOMER_NOTE_CATEGORIES のいずれか。 */
    category: text().notNull(),
    /** 見出し(一覧に出す短い文)。空文字を許すのは、本文だけで足りる記載があるため。 */
    title: text().notNull().default(''),
    /** 本文。空文字を許す理由はこのファイル冒頭のコメント参照。 */
    body: text().notNull().default(''),

    /** 一覧の先頭に固定表示する。 */
    pinned: boolean().notNull().default(false),
    /** 引き継ぎ事項などを「済」にした時刻。nullなら未対応。 */
    resolvedAt: timestamp({ withTimezone: true }),
    /** 済にしたスタッフ。resolvedAtとセットで入る。 */
    resolvedByStaffId: uuid(),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    // 複合FK。単一列FKだとRLSがFK制約自体には効かないため、他テナントの顧客・スタッフを
    // 誤って参照してもDBが検知できない(dailyReports.tsと同じ理由)。
    foreignKey({
      name: 'customer_notes_tenant_customer_fk',
      columns: [t.tenantId, t.customerId],
      foreignColumns: [customers.tenantId, customers.id],
    }),
    foreignKey({
      name: 'customer_notes_tenant_author_fk',
      columns: [t.tenantId, t.authorStaffId],
      foreignColumns: [staff.tenantId, staff.id],
    }),
    // resolvedByStaffIdはnull許容。PostgreSQLのMATCH SIMPLE(既定)により、nullの行は
    // FK制約の対象外になる(receipts.tsのcustomerIdと同じ扱い)。
    foreignKey({
      name: 'customer_notes_tenant_resolved_by_fk',
      columns: [t.tenantId, t.resolvedByStaffId],
      foreignColumns: [staff.tenantId, staff.id],
    }),
    // customer_note_photos からの複合FK(tenant_id, note_id)の参照先。
    unique('customer_notes_tenant_id_uk').on(t.tenantId, t.id),
    check('customer_notes_category_check', sql`${t.category} IN ${sqlInList(CUSTOMER_NOTE_CATEGORIES)}`),
    // 「済にした時刻」と「済にした人」は必ず揃う。片方だけ入った行は、誰が閉じたか
    // 分からない/閉じていないのに担当者だけ入っている、という読めない状態になる。
    check(
      'customer_notes_resolved_pair_check',
      sql`(${t.resolvedAt} IS NULL AND ${t.resolvedByStaffId} IS NULL)
        OR (${t.resolvedAt} IS NOT NULL AND ${t.resolvedByStaffId} IS NOT NULL)`,
    ),
    // 顧客カルテ画面を開くたびに走る「この顧客の記載を新しい順に」を索引だけで返すため。
    index('customer_notes_tenant_customer_created_idx').on(t.tenantId, t.customerId, t.createdAt.desc()),
    // 「未対応の引き継ぎ事項」「固定表示する注意点」の抽出用。対象行が少ないので部分索引にする。
    index('customer_notes_tenant_customer_category_idx').on(t.tenantId, t.customerId, t.category),
    index('customer_notes_tenant_open_idx').on(t.tenantId, t.customerId).where(sql`${t.resolvedAt} IS NULL`),
  ],
).enableRLS();

/**
 * カルテ記載に添付する写真。
 *
 * 【実体を持たずキーだけ持つ理由】
 * 画像そのものはオブジェクトストレージ(StoragePort。ローカル開発はファイルシステム、
 * 本番はGCS想定)に置き、DBは保存キーだけを持つ。領収書画像(receipts.fileKey)と
 * 同じ方式で、キーの命名も `{tenantId}/customer-notes/{uuid}.{ext}` と揃える。
 * DBにbyteaで入れないのは、バックアップ・レプリケーションの容量とコストが
 * 画像の枚数に比例して膨らむため。
 *
 * 【1記載に複数枚を許す理由】
 * 鍵の位置は「玄関全体の写真」と「鍵の隠し場所の寄り」の2枚で初めて伝わる、という
 * 使い方になる。sortOrderで並び順を持たせ、撮った順ではなく説明したい順に並べられるようにする。
 */
export const customerNotePhotos = pgTable(
  'customer_note_photos',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    noteId: uuid().notNull(),
    /** アップロードしたスタッフ。 */
    uploadedByStaffId: uuid().notNull(),

    /** StoragePortの保存キー。 */
    fileKey: text().notNull(),
    contentType: text().notNull(),
    /** バイト数。上限は @katahimo/shared の CUSTOMER_NOTE_PHOTO_MAX_BYTES。 */
    byteSize: integer().notNull(),
    /** 写真の説明(「玄関右手の物置の中」など)。 */
    caption: text().notNull().default(''),
    /** 表示順。小さいほど先。 */
    sortOrder: integer().notNull().default(0),
    /** 撮影時刻(Exifが読めた場合)。読めなければnull。 */
    capturedAt: timestamp({ withTimezone: true }),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    foreignKey({
      name: 'customer_note_photos_tenant_note_fk',
      columns: [t.tenantId, t.noteId],
      foreignColumns: [customerNotes.tenantId, customerNotes.id],
    }),
    foreignKey({
      name: 'customer_note_photos_tenant_uploaded_by_fk',
      columns: [t.tenantId, t.uploadedByStaffId],
      foreignColumns: [staff.tenantId, staff.id],
    }),
    // 同じ保存キーを2行が指す状態(片方を消すともう片方から画像が消える)を防ぐ。
    uniqueIndex('customer_note_photos_tenant_file_key_uidx').on(t.tenantId, t.fileKey),
    // sortOrderに一意制約は付けない。人が画面で写真を並べ替える(2枚のsortOrderを入れ替える)
    // 操作を1本のUPDATEで書くと、PostgreSQLは一意制約を行ごとに即時検査するため
    // 入れ替えの途中で必ず衝突して失敗する。回避するにはDEFERRABLEな制約が必要だが、
    // drizzleのスキーマ定義では表現できない。並び順の決定性は
    // 「ORDER BY sort_order, id」(同じsortOrderならid順)で担保する。
    check('customer_note_photos_sort_order_check', sql`${t.sortOrder} >= 0`),
    // 0バイトの画像は壊れており、上限超過はストレージ費用と一覧の読み込み時間の問題になる
    // (入口でも弾くが、APIを経由しない経路から入っても止まるようにDB側にも置く)。
    check(
      'customer_note_photos_byte_size_check',
      sql`${t.byteSize} > 0 AND ${t.byteSize} <= ${sqlNumber(CUSTOMER_NOTE_PHOTO_MAX_BYTES)}`,
    ),
    index('customer_note_photos_tenant_note_idx').on(t.tenantId, t.noteId, t.sortOrder),
  ],
).enableRLS();
