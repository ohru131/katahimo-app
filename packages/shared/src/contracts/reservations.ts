import { z } from 'zod';

/**
 * 予約の状態。RESERVA(現行の外部予約システム)からの移植版で使う。
 *
 * 状態遷移:
 *   requested →(受付)→ confirmed →(訪問実施)→ completed
 *            →(取消)→ cancelled
 *                       confirmed →(取消)→ cancelled
 *                       confirmed →(無連絡不来訪)→ no_show
 *
 * cancelled/no_show は終端。completed からは戻さない(実施済みの記録を消さないため。
 * 誤って completed にした場合は confirmed に戻すのではなく、日報側の紐付けを外す)。
 */
export const reservationStatusSchema = z.enum([
  'requested',
  'confirmed',
  'completed',
  'cancelled',
  'no_show',
]);
export const RESERVATION_STATUSES = reservationStatusSchema.options;
export type ReservationStatus = z.infer<typeof reservationStatusSchema>;

/** 予約が入ってきた経路。RESERVAからの取込と、自社受付を区別するため。 */
export const reservationSourceSchema = z.enum(['reserva', 'web', 'phone', 'admin']);
export const RESERVATION_SOURCES = reservationSourceSchema.options;
export type ReservationSource = z.infer<typeof reservationSourceSchema>;

/**
 * 予約へのスタッフ割当の役割。
 * 'primary' は主担当で1予約に1人まで(複数人が「自分が主担当」と思う状態を作らないため)。
 * 'support' は同行・応援で人数の制限は設けない。
 */
export const reservationAssignmentRoleSchema = z.enum(['primary', 'support']);
export const RESERVATION_ASSIGNMENT_ROLES = reservationAssignmentRoleSchema.options;
export type ReservationAssignmentRole = z.infer<typeof reservationAssignmentRoleSchema>;

/**
 * スタッフの受付枠の種別。
 * 'available' は「この時間帯は予約を受けられる」、'unavailable' は「受けられない」。
 *
 * 両方を1テーブルで持つのは、繰り返しの受付枠(毎週火曜9-17時)に対して、
 * 特定日だけの休み(この火曜は不可)を例外として重ねられるようにするため。
 * 判定は「その時刻を含む unavailable が1件でもあれば不可」を先に見る。
 */
export const staffAvailabilityKindSchema = z.enum(['available', 'unavailable']);
export const STAFF_AVAILABILITY_KINDS = staffAvailabilityKindSchema.options;
export type StaffAvailabilityKind = z.infer<typeof staffAvailabilityKindSchema>;
