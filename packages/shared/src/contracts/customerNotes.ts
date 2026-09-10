import { z } from 'zod';

/**
 * 顧客カルテの記載区分。
 *
 * 「カルテ」「申し送り」「鍵の位置」「ガレージ場所」「引き継ぎ事項」「注意点」を、
 * 別々のテーブル(または顧客テーブルの別々の列)にはせず、1テーブル+区分で表す。
 *
 * 【1テーブル+区分にする理由】
 * - どの区分も「本文 + 写真 + 誰がいつ書いたか」という同じ形をしている。テーブルを分けると
 *   写真テーブルもポリシーも索引も区分ごとに複製することになり、区分が増えるたびに
 *   マイグレーションが必要になる。
 * - 顧客テーブルの列(customers.key_location等)にすると、履歴が残らず「いつ誰が更新したか」が
 *   追えない。鍵の位置やガレージの場所は現場で更新されるため、更新者と更新時刻が要る。
 * - 一覧画面は区分を横断して新しい順に出す(index(tenant_id, customer_id, ...)が1本で足りる)。
 *
 * 【区分をここで持つ理由】
 * DB(customer_notes_category_check)・core・web が同じ配列を参照し、許可値のズレを
 * コンパイル時に検知できるようにするため(coupons.tsのCOUPON_DISCOUNT_KINDSと同じ狙い)。
 *
 * - 'chart'      : カルテ(経過記録。訪問のたびに積み上がる本文)
 * - 'handover'   : 申し送り(次に入るスタッフへ伝えること)
 * - 'key_location': 鍵の位置(写真が主。玄関のどこに鍵があるか)
 * - 'garage'     : ガレージ・駐車場所(写真が主。どこに停めるか)
 * - 'carry_over' : 引き継ぎ事項(対応が終わるまで残す。resolved_atで「済」にする)
 * - 'caution'    : 注意点(アレルギー・持病・接し方など、毎回目を通してほしいこと)
 * - 'other'      : 上記に当てはまらないもの
 */
export const customerNoteCategorySchema = z.enum([
  'chart',
  'handover',
  'key_location',
  'garage',
  'carry_over',
  'caution',
  'other',
]);
export const CUSTOMER_NOTE_CATEGORIES = customerNoteCategorySchema.options;
export type CustomerNoteCategory = z.infer<typeof customerNoteCategorySchema>;

/** 画面表示用の日本語名。DBには入れない(表示の都合でDBを書き換えることになるため)。 */
export const CUSTOMER_NOTE_CATEGORY_LABELS: Record<CustomerNoteCategory, string> = {
  chart: 'カルテ',
  handover: '申し送り',
  key_location: '鍵の位置',
  garage: 'ガレージ・駐車場所',
  carry_over: '引き継ぎ事項',
  caution: '注意点',
  other: 'その他',
};

/**
 * 写真1枚あたりの上限バイト数(10MiB)。
 *
 * DBのCHECK制約(customer_note_photos_byte_size_check)とAPIの入口の両方でこの値を使う。
 * 上限を設ける理由は、スマートフォンの原寸写真をそのまま何十枚も添付されると
 * オブジェクトストレージの費用と一覧画面の読み込み時間が現場で問題になるため。
 */
export const CUSTOMER_NOTE_PHOTO_MAX_BYTES = 10 * 1024 * 1024;

/** 1つの記載に添付できる写真の枚数上限。 */
export const CUSTOMER_NOTE_PHOTO_MAX_COUNT = 10;
