import { z } from 'zod';

/**
 * 訪問先までの移動手段。
 *
 * 従来は自動車のみを前提にしていた(MapsPortのroute()もGASブリッジ側で
 * Maps.DirectionFinder.Mode.DRIVING固定)。公共交通機関・自転車も選べるようにし、
 * 手段ごとに手当の計算方法が変わるようにするため、許可値をここで一元管理する。
 *
 * DB(transport_allowance_rules / travel_legs / staff_customer_travel_estimates の
 * CHECK制約)・core・web が全てこの配列を参照することで、許可値がズレることを防ぐ
 * (coupons.tsのCOUPON_DISCOUNT_KINDSと同じ狙い)。
 *
 * 'walk'(徒歩)を含める理由: 手当が付かない移動でも「自動車で行かなかった」ことは記録
 * しなければならない(自動車前提の距離手当が誤って付くのを防ぐため)。手当が0円になるのは
 * 単価マスタ(transport_allowance_rules)に行が無い/0円の行がある結果であって、
 * 移動手段の列挙から外す理由にはならない。
 */
export const transportModeSchema = z.enum(['car', 'public_transit', 'bicycle', 'walk']);
export const TRANSPORT_MODES = transportModeSchema.options;
export type TransportMode = z.infer<typeof transportModeSchema>;

/** 画面表示用の日本語名。DBには入れない(表示の都合でDBを書き換えることになるため)。 */
export const TRANSPORT_MODE_LABELS: Record<TransportMode, string> = {
  car: '自動車',
  public_transit: '公共交通機関',
  bicycle: '自転車',
  walk: '徒歩',
};

/**
 * 手当の計算方法。移動手段ごとに「何を根拠にいくら払うか」が違うため、単価マスタ側で
 * 計算方法自体を持つ。
 *
 * - 'per_km'     : 距離比例(自動車。距離1kmあたりunit_amount_yen)
 * - 'per_trip'   : 1移動あたりの定額(自転車など。距離を測らない運用)
 * - 'per_day'    : 1日あたりの定額(移動回数によらない手当)
 * - 'actual_cost': 実費精算(公共交通機関の運賃。unit_amount_yenは使わず、
 *                  travel_legs.fare_yen に入力された実費をそのまま手当額にする)
 */
export const transportAllowanceCalcKindSchema = z.enum(['per_km', 'per_trip', 'per_day', 'actual_cost']);
export const TRANSPORT_ALLOWANCE_CALC_KINDS = transportAllowanceCalcKindSchema.options;
export type TransportAllowanceCalcKind = z.infer<typeof transportAllowanceCalcKindSchema>;

/**
 * 移動区間の種別。勤怠(attendance_days.row_data)が持っている
 * commuteDistanceKm / returnDistanceKm / visits[].distanceKm の区別に対応する。
 *
 * - 'commute'        : 自宅 → 最初の訪問先(または事業所)
 * - 'to_visit'       : 事業所 → 訪問先
 * - 'between_visits' : 訪問先 → 次の訪問先
 * - 'return'         : 最後の訪問先 → 自宅
 */
export const travelLegKindSchema = z.enum(['commute', 'to_visit', 'between_visits', 'return']);
export const TRAVEL_LEG_KINDS = travelLegKindSchema.options;
export type TravelLegKind = z.infer<typeof travelLegKindSchema>;
