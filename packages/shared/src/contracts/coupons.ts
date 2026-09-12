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

/**
 * クーポンの対象者の決め方。'all'=全顧客が使える、'assigned'=`customer_coupons` で
 * 割り当てた顧客だけが使える。
 *
 * 「この顧客にだけ配ったクーポン」を表すのに、クーポン行を顧客ごとに複製しなくて済むよう
 * 割当を別テーブルに分けている(doc/14 §9)。
 */
export const couponAudienceSchema = z.enum(['all', 'assigned']);
export const COUPON_AUDIENCES = couponAudienceSchema.options;
export type CouponAudience = z.infer<typeof couponAudienceSchema>;

/**
 * クーポンの適用条件。'manual'=条件なし(スタッフが自分で選ぶ)、
 * 'birthday_month'=対象者の誕生月に当たる訪問にだけ使える。
 *
 * 条件式をJSONで持つ汎用のルールエンジンにしないのは、DBが中身を検証できない列を
 * 増やすだけになるため(doc/14 §2と同じ理由)。条件が増えたらこの enum を増やす。
 */
export const couponEligibilityKindSchema = z.enum(['manual', 'birthday_month']);
export const COUPON_ELIGIBILITY_KINDS = couponEligibilityKindSchema.options;
export type CouponEligibilityKind = z.infer<typeof couponEligibilityKindSchema>;

/**
 * 誕生月クーポンが「誰の誕生日」を見るか。'customer'=世帯代表(`customers.dob_date`)、
 * 'family_member'=世帯構成員(`family_members.dob_date`)、'any'=どちらか一方でも
 * 誕生月に当たれば使える。
 */
export const couponBirthdaySubjectSchema = z.enum(['customer', 'family_member', 'any']);
export const COUPON_BIRTHDAY_SUBJECTS = couponBirthdaySubjectSchema.options;
export type CouponBirthdaySubject = z.infer<typeof couponBirthdaySubjectSchema>;

/**
 * 同じ顧客が同じクーポンを何回使えるか。'unlimited'=制限なし、
 * 'once_per_customer'=その顧客につき1回きり、'once_per_customer_per_year'=年1回
 * (誕生月割引の既定)。
 *
 * 上限はusecaseだけでなくDB側の部分一意索引でも守る。請求金額に直結するため、
 * 二重送信や同時リクエストでもすり抜けないようにする(doc/14 §8.4)。
 */
export const couponUsageLimitKindSchema = z.enum([
  'unlimited',
  'once_per_customer',
  'once_per_customer_per_year',
]);
export const COUPON_USAGE_LIMIT_KINDS = couponUsageLimitKindSchema.options;
export type CouponUsageLimitKind = z.infer<typeof couponUsageLimitKindSchema>;

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
 * eligibilityKind と birthdaySubject の組み合わせ(coupons_birthday_subject_check)。
 * 誕生月クーポンは「誰の誕生日を見るか」が必須で、それ以外は指定できない
 * (指定させると、条件を使わないクーポンに死んだ設定が残る)。
 */
function refineBirthdaySubjectCombo<
  T extends { eligibilityKind?: CouponEligibilityKind; birthdaySubject?: CouponBirthdaySubject | null },
>(value: T, ctx: z.RefinementCtx): void {
  // eligibilityKind未指定は 'manual'(createCouponの既定)として見る。
  if (value.eligibilityKind === 'birthday_month') {
    if (value.birthdaySubject == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['birthdaySubject'],
        message: '誕生月クーポンは対象者(世帯代表/世帯構成員)を選んでください',
      });
    }
  } else if (value.birthdaySubject != null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['birthdaySubject'],
      message: '誕生月クーポン以外では対象者を指定できません',
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
    // 既定値(all / manual / unlimited)はusecase(createCoupon)側で埋める。ここで .default() を
    // 使うとzodの入力型では省略可・出力型では必須という食い違いが出て、同じスキーマを
    // 参照するweb側が「省略したいのに渡さないと型が合わない」状態になる。
    audience: couponAudienceSchema.optional(),
    eligibilityKind: couponEligibilityKindSchema.optional(),
    birthdaySubject: couponBirthdaySubjectSchema.nullish(),
    usageLimitKind: couponUsageLimitKindSchema.optional(),
    active: z.boolean().optional(),
    note: z.string().nullish(),
  })
  .superRefine((value, ctx) => {
    refineDiscountValueCombo(value, ctx);
    refineValidPeriodOrder(value, ctx);
    refineBirthdaySubjectCombo(value, ctx);
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
  audience: couponAudienceSchema.optional(),
  eligibilityKind: couponEligibilityKindSchema.optional(),
  birthdaySubject: couponBirthdaySubjectSchema.nullish(),
  usageLimitKind: couponUsageLimitKindSchema.optional(),
  active: z.boolean().optional(),
  note: z.string().nullish(),
});
export type CouponUpdateRequest = z.infer<typeof couponUpdateRequestSchema>;

/**
 * 日報に適用するクーポンIDの配列(doc/14 §9)。POST /api/reports/daily のリクエストに
 * 含める。空配列は「クーポン無し」。
 */
export const couponIdsSchema = z.array(idSchema);

/**
 * 顧客へのクーポン割当(`customer_coupons`)の登録・更新リクエスト。
 * validFrom/validTo は「この顧客に限った有効期間」で、null はクーポンマスタ側の期間に従う。
 * 実際に使えるのは両方の期間が重なっている日だけ(usecases/coupons.ts の isAssignmentValidOn)。
 */
export const customerCouponUpsertRequestSchema = z
  .object({
    couponId: idSchema,
    validFrom: businessDateSchema.nullish(),
    validTo: businessDateSchema.nullish(),
    note: z.string().nullish(),
  })
  .superRefine(refineValidPeriodOrder);
export type CustomerCouponUpsertRequest = z.infer<typeof customerCouponUpsertRequestSchema>;
