import { z } from 'zod';

/**
 * 特性項目(trait)の対象。顧客の特性とスタッフの特性を、同じ項目マスタで管理する。
 *
 * 【同じマスタにする理由】
 * 相性判定では「顧客側の特性」と「スタッフ側の特性」を突き合わせる(例: 顧客側の
 * 「犬がいる」とスタッフ側の「犬が苦手」)。項目マスタを分けると、突き合わせる相手を
 * 指すのに別テーブルへの参照が必要になり、対応関係の管理が二重になる。
 *
 * 一方で「値」の側(customer_traits / staff_traits)はテーブルを分ける。1テーブルにして
 * subject_id を顧客IDとスタッフIDの兼用にすると、外部キーを張れなくなり
 * (どちらのテーブルを指すか行ごとに違うため)、テナント越えの取り違えをDBで検知できなくなる。
 *
 * 【値テーブルが「反対側の項目」を参照できないようにする方法】
 * テーブルを分けただけでは、customer_traits の行が subject_kind='staff' の項目を
 * 指すことを止められない(参照先が (tenant_id, id) だけだと区別子がFKに入らない)。
 * そこで値テーブル側に固定値の区別子列(definition_subject_kind)を持たせ、
 * (tenant_id, definition_subject_kind, definition_id) で
 * trait_definitions(tenant_id, subject_kind, id) を参照する。
 * 固定値であることはCHECK制約で縛る。tenant_id の取り違えを複合FKで防いでいるのと同じ手。
 */
export const traitSubjectKindSchema = z.enum(['customer', 'staff']);
export const TRAIT_SUBJECT_KINDS = traitSubjectKindSchema.options;
export type TraitSubjectKind = z.infer<typeof traitSubjectKindSchema>;

/**
 * 特性項目の値の型。
 *
 * 今後のヒアリングで項目自体が増減する前提のため、項目を列として足す(スキーマ変更)のでは
 * なく、項目マスタ + 値テーブルの形にする。ただし値をjsonbの塊にはせず、型ごとに列を分ける
 * (value_bool / value_int / value_text)。集計・絞り込みをSQLで素直に書けるようにするためで、
 * 「どの列に入れるか」は value_type とのCHECK制約で1つに縛る。
 *
 * - 'bool'   : はい/いいえ(例: 「ペットがいる」)
 * - 'scale'  : 段階評価(例: 1〜5。scale_min/scale_max で範囲を持つ)
 * - 'int'    : 個数・年齢などの整数(範囲を決めない)
 * - 'choice' : 選択肢から1つ(choices に候補を持つ)
 * - 'text'   : 自由記述(絞り込みには使わない補足)
 */
export const traitValueTypeSchema = z.enum(['bool', 'scale', 'int', 'choice', 'text']);
export const TRAIT_VALUE_TYPES = traitValueTypeSchema.options;
export type TraitValueType = z.infer<typeof traitValueTypeSchema>;

/**
 * 相性スコアの範囲(1=組ませたくない 〜 5=積極的に組ませたい、3=どちらでもない)。
 *
 * 「絶対に組ませない」は score=1 では表さず、専用のbool列(avoid)で持つ。スコアは
 * 最適化の重み付けに使う連続的な値で、avoid は候補から除外する二値の判断であり、
 * 意味が違うものを1つの数値に混ぜると「スコアが低いだけ」と「絶対不可」を
 * 区別できなくなるため。
 */
export const COMPATIBILITY_SCORE_MIN = 1;
export const COMPATIBILITY_SCORE_MAX = 5;

/** 相性の記録の出どころ。'manual'=人が入力、'derived'=実績(日報の評価等)から算出。 */
export const compatibilitySourceSchema = z.enum(['manual', 'derived']);
export const COMPATIBILITY_SOURCES = compatibilitySourceSchema.options;
export type CompatibilitySource = z.infer<typeof compatibilitySourceSchema>;

/**
 * スタッフ自宅↔顧客宅の所要時間・距離の算出元。
 *
 * - 'google_maps'   : Maps APIの経路検索(移動手段ごとに引く)
 * - 'straight_line' : 緯度経度からの直線距離に道路距離係数を掛けた概算(APIを使えない場合)
 * - 'manual'        : 人が実測して入力した値。再計算で上書きしない
 */
export const travelEstimateSourceSchema = z.enum(['google_maps', 'straight_line', 'manual']);
export const TRAVEL_ESTIMATE_SOURCES = travelEstimateSourceSchema.options;
export type TravelEstimateSource = z.infer<typeof travelEstimateSourceSchema>;
