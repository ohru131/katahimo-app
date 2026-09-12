import { z } from 'zod';
import { businessDateSchema, idSchema } from './common';

/**
 * 割引クーポンの割引種別。'amount'=金額引き、'percent'=率引き(doc/14 §9)。
 *
 * DB(coupons_discount_kind_check/coupon_redemptions_discount_kind_check)・core(usecases/coupons.ts)・
 * web(クーポン管理画面)の全てがこの配列を参照することで、許可値がズレることを防ぐ
 * (attendance.tsのMAX_VISITS/MAX_OFFICE_WORKと同じ狙い)。
 */
export const couponDiscountKindSchema = z.enum(['amount', 'percent']);
export const COUPON_DISCOUNT_KINDS = couponDiscountKindSchema.options;
export type CouponDiscountKind = z.infer<typeof couponDiscountKindSchema>;

/** 運用上の識別子。コードは空文字を許さない(coupons_tenant_code_uidxの実質的な入力側)。 */
export const couponCodeSchema = z.string().trim().min(1, 'コードを入力してください');
export const couponNameSchema = z.string().trim().min(1, '名前を入力してください');

/** discountKind='amount'のときの値(coupons_discount_amount_yen_check: 0以上の整数)。 */
export const couponDiscountAmountYenSchema = z.number().int().nonnegative();
/** discountKind='percent'のときの値(coupons_discount_percent_check: 1〜100の整数)。 */
export const couponDiscountPercentSchema = z.number().int().min(1).max(100);

/**
 * discount_kind/discount_amount_yen/discount_percentの組み合わせが、DBのCHECK制約
 * (coupons_discount_value_check)と同じ条件を満たしているかを見る。
 * ここで拒否すれば、DBまで届かせて23514で失敗させずに済む。
 */
function refineDiscountValueCombo<
  T extends {
    discountKind: CouponDiscountKind;
    discountAmountYen?: number | null;
    discountPercent?: number | null;
  },
>(value: T, ctx: z.RefinementCtx): void {
  if (value.discountKind === 'amount') {
    if (value.discountAmountYen == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['discountAmountYen'],
        message: 'discountKindがamountの場合はdiscountAmountYenが必要です',
      });
    }
    if (value.discountPercent != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['discountPercent'],
        message: 'discountKindがamountの場合はdiscountPercentを指定できません',
      });
    }
  } else {
    if (value.discountPercent == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['discountPercent'],
        message: 'discountKindがpercentの場合はdiscountPercentが必要です',
      });
    }
    if (value.discountAmountYen != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['discountAmountYen'],
        message: 'discountKindがpercentの場合はdiscountAmountYenを指定できません',
      });
    }
  }
}

/**
 * 有効期間の前後関係(coupons_valid_period_check)。片方だけ、または両方ともnullは許容する。
 */
function refineValidPeriodOrder<T extends { validFrom?: string | null; validTo?: string | null }>(
  value: T,
  ctx: z.RefinementCtx,
): void {
  if (value.validFrom && value.validTo && value.validTo < value.validFrom) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['validTo'],
      message: 'validToはvalidFrom以降にしてください',
    });
  }
}

/**
 * クーポン登録のリクエスト。新規登録は毎回全項目が揃うため、種別と値の組み合わせ・
 * 有効期間の前後関係までここで検証する(部分更新のcouponUpdateRequestSchemaと違い、
 * 「現在値とマージしてから検証する」余地が無いため)。
 */
export const couponCreateRequestSchema = z
  .object({
    code: couponCodeSchema,
    name: couponNameSchema,
    discountKind: couponDiscountKindSchema,
    discountAmountYen: couponDiscountAmountYenSchema.nullish(),
    discountPercent: couponDiscountPercentSchema.nullish(),
    validFrom: businessDateSchema.nullish(),
    validTo: businessDateSchema.nullish(),
    active: z.boolean().optional(),
    note: z.string().nullish(),
  })
  .superRefine((value, ctx) => {
    refineDiscountValueCombo(value, ctx);
    refineValidPeriodOrder(value, ctx);
  });
export type CouponCreateRequest = z.infer<typeof couponCreateRequestSchema>;

/**
 * クーポン更新のリクエスト(部分更新/PATCH)。渡された項目だけの型・値域を見る。
 * discount_kindと値の組み合わせ・有効期間の前後関係は、渡されなかった項目に現在値を
 * 補ってから見る必要があるため、ここでは検証せずusecase(updateCoupon)に委ねる。
 */
export const couponUpdateRequestSchema = z.object({
  code: couponCodeSchema.optional(),
  name: couponNameSchema.optional(),
  discountKind: couponDiscountKindSchema.optional(),
  discountAmountYen: couponDiscountAmountYenSchema.nullish(),
  discountPercent: couponDiscountPercentSchema.nullish(),
  validFrom: businessDateSchema.nullish(),
  validTo: businessDateSchema.nullish(),
  active: z.boolean().optional(),
  note: z.string().nullish(),
});
export type CouponUpdateRequest = z.infer<typeof couponUpdateRequestSchema>;

/**
 * 日報に適用するクーポンIDの配列(doc/14 §9)。POST /api/reports/daily のリクエストに
 * 含める。空配列は「クーポン無し」。
 */
export const couponIdsSchema = z.array(idSchema);
