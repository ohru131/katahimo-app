import type {
  CouponDiscountKind,
  CouponRecord,
  CouponRedemptionRecord,
  CouponRepositoryPort,
  NewCouponInput,
} from '../ports/repositories';

export interface CouponDeps {
  coupons: CouponRepositoryPort;
}

/**
 * 管理者のクーポン管理画面用の一覧。廃止済み(active=false)も含む全件を、コード順で返す
 * (doc/14 4.1章。廃止しても行は消さない方針のため、一覧からも隠さず「廃止済み」として見せる)。
 */
export async function listCouponsForAdmin(deps: CouponDeps, tenantId: string): Promise<CouponRecord[]> {
  const rows = await deps.coupons.listAll(tenantId);
  return rows.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}

/** 日報画面の「クーポンを選ぶ」セレクタが表示する最小情報。 */
export interface CouponSelectionView {
  id: string;
  code: string;
  name: string;
  discountKind: CouponDiscountKind;
  discountAmountYen: number | null;
  discountPercent: number | null;
}

function toSelectionView(coupon: CouponRecord): CouponSelectionView {
  return {
    id: coupon.id,
    code: coupon.code,
    name: coupon.name,
    discountKind: coupon.discountKind,
    discountAmountYen: coupon.discountAmountYen,
    discountPercent: coupon.discountPercent,
  };
}

/** そのクーポンが、指定日('YYYY-MM-DD')の時点で適用可能か(active かつ有効期間内か)。 */
function isCouponValidOn(coupon: CouponRecord, dateStr: string): boolean {
  if (!coupon.active) return false;
  if (coupon.validFrom && dateStr < coupon.validFrom) return false;
  if (coupon.validTo && dateStr > coupon.validTo) return false;
  return true;
}

/**
 * 日報画面のクーポン選択用一覧。active かつ対象日('YYYY-MM-DD')に有効なものだけに絞る
 * (廃止済み・期間外のクーポンを選べてしまうと、保存時にsaveDailyReportで弾かれて
 * 使い勝手が悪いため、選択肢の時点で除いておく)。
 */
export async function listCouponsForSelection(
  deps: CouponDeps,
  tenantId: string,
  onDate: string,
): Promise<CouponSelectionView[]> {
  const rows = await deps.coupons.listAll(tenantId);
  return rows
    .filter((c) => isCouponValidOn(c, onDate))
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
    .map(toSelectionView);
}

export interface CreateCouponInput {
  code: string;
  name: string;
  discountKind: CouponDiscountKind;
  discountAmountYen?: number | null;
  discountPercent?: number | null;
  /** 'YYYY-MM-DD'。省略/nullは下限なし。 */
  validFrom?: string | null;
  /** 'YYYY-MM-DD'。省略/nullは無期限。 */
  validTo?: string | null;
  active?: boolean;
  note?: string | null;
}

export type CouponInputInvalidReason =
  | 'code_required'
  | 'name_required'
  | 'discount_value_mismatch'
  | 'discount_amount_yen_invalid'
  | 'discount_percent_invalid'
  | 'valid_period_reversed';

/**
 * discount_kind/discount_amount_yen/discount_percentの組み合わせと値域、有効期間の前後関係を
 * 検証する。DBのCHECK制約(coupons_discount_value_check等)と同じ条件をusecase側でも見て、
 * 「保存できない入力」を23514(制約違反)ではなく分かりやすい理由付きで先に弾く。
 */
function validateCouponFields(input: {
  code: string;
  name: string;
  discountKind: CouponDiscountKind;
  discountAmountYen: number | null;
  discountPercent: number | null;
  validFrom: string | null;
  validTo: string | null;
}): CouponInputInvalidReason | null {
  if (!input.code.trim()) return 'code_required';
  if (!input.name.trim()) return 'name_required';

  if (input.discountKind === 'amount') {
    if (input.discountPercent !== null) return 'discount_value_mismatch';
    if (input.discountAmountYen === null) return 'discount_value_mismatch';
    if (!Number.isInteger(input.discountAmountYen) || input.discountAmountYen < 0) {
      return 'discount_amount_yen_invalid';
    }
  } else {
    if (input.discountAmountYen !== null) return 'discount_value_mismatch';
    if (input.discountPercent === null) return 'discount_value_mismatch';
    if (
      !Number.isInteger(input.discountPercent) ||
      input.discountPercent < 1 ||
      input.discountPercent > 100
    ) {
      return 'discount_percent_invalid';
    }
  }

  if (input.validFrom && input.validTo && input.validTo < input.validFrom) return 'valid_period_reversed';
  return null;
}

export type CreateCouponResult =
  | { ok: true; couponId: string }
  | { ok: false; reason: CouponInputInvalidReason | 'code_taken' };

/**
 * 管理者がクーポンを登録する。コードの重複はDBのUNIQUE制約(coupons_tenant_code_uidx)でも
 * 守られているが、23505をそのままエラーにすると分かりにくいため、事前にlistAllで確認する
 * (createStaffWithInitialPasswordのemail_taken判定と同じ流儀)。
 */
export async function createCoupon(
  deps: CouponDeps,
  tenantId: string,
  input: CreateCouponInput,
): Promise<CreateCouponResult> {
  const code = input.code.trim();
  const name = input.name.trim();
  const discountAmountYen = input.discountAmountYen ?? null;
  const discountPercent = input.discountPercent ?? null;
  const validFrom = input.validFrom ?? null;
  const validTo = input.validTo ?? null;

  const invalidReason = validateCouponFields({
    code,
    name,
    discountKind: input.discountKind,
    discountAmountYen,
    discountPercent,
    validFrom,
    validTo,
  });
  if (invalidReason) return { ok: false, reason: invalidReason };

  const existing = await deps.coupons.listAll(tenantId);
  if (existing.some((c) => c.code === code)) return { ok: false, reason: 'code_taken' };

  const newInput: NewCouponInput = {
    tenantId,
    code,
    name,
    discountKind: input.discountKind,
    discountAmountYen,
    discountPercent,
    validFrom,
    validTo,
    active: input.active ?? true,
    note: input.note ?? null,
  };
  const created = await deps.coupons.create(newInput);
  return { ok: true, couponId: created.id };
}

/** 管理者によるクーポンの更新は「渡された項目だけ上書きする」部分更新(PATCH)方式。 */
export interface UpdateCouponInput {
  code?: string;
  name?: string;
  discountKind?: CouponDiscountKind;
  discountAmountYen?: number | null;
  discountPercent?: number | null;
  validFrom?: string | null;
  validTo?: string | null;
  active?: boolean;
  note?: string | null;
}

export type UpdateCouponResult =
  | { ok: true }
  | { ok: false; reason: CouponInputInvalidReason | 'code_taken' | 'not_found' };

export async function updateCoupon(
  deps: CouponDeps,
  tenantId: string,
  couponId: string,
  input: UpdateCouponInput,
): Promise<UpdateCouponResult> {
  const current = await deps.coupons.findById(tenantId, couponId);
  if (!current) return { ok: false, reason: 'not_found' };

  // 渡されなかった項目は現在値のまま検証する(部分更新でも、更新後の行全体が
  // 制約を満たすことを保証するため)。
  const merged = {
    code: (input.code ?? current.code).trim(),
    name: (input.name ?? current.name).trim(),
    discountKind: input.discountKind ?? current.discountKind,
    discountAmountYen:
      input.discountAmountYen !== undefined ? input.discountAmountYen : current.discountAmountYen,
    discountPercent: input.discountPercent !== undefined ? input.discountPercent : current.discountPercent,
    validFrom: input.validFrom !== undefined ? input.validFrom : current.validFrom,
    validTo: input.validTo !== undefined ? input.validTo : current.validTo,
  };

  const invalidReason = validateCouponFields(merged);
  if (invalidReason) return { ok: false, reason: invalidReason };

  if (merged.code !== current.code) {
    const existing = await deps.coupons.listAll(tenantId);
    if (existing.some((c) => c.id !== couponId && c.code === merged.code)) {
      return { ok: false, reason: 'code_taken' };
    }
  }

  const updated = await deps.coupons.update(tenantId, couponId, {
    code: merged.code,
    name: merged.name,
    discountKind: merged.discountKind,
    discountAmountYen: merged.discountAmountYen,
    discountPercent: merged.discountPercent,
    validFrom: merged.validFrom,
    validTo: merged.validTo,
    active: input.active,
    note: input.note,
  });
  if (!updated) return { ok: false, reason: 'not_found' };
  return { ok: true };
}

/** 日報1件に紐づく適用済みクーポン1件の表示用の形(クーポン名・コード+適用時点の割引条件)。 */
export interface DailyReportCouponView {
  couponId: string;
  code: string;
  name: string;
  discountKind: CouponDiscountKind;
  discountAmountYen: number | null;
  discountPercent: number | null;
}

/**
 * 割引条件を適用した瞬間のマスタ(coupons)から複製したスナップショット。
 * coupon_redemptionsへ保存する直前の形(dailyReportIdはまだ決まっていない=作成前の
 * 日報にも使えるようにこの型には含めない。呼び出し側がNewCouponRedemptionInputに組み立てる)。
 */
export interface CouponRedemptionSnapshot {
  couponId: string;
  discountKind: CouponDiscountKind;
  discountAmountYen: number | null;
  discountPercent: number | null;
}

/**
 * 日報保存時に指定されたクーポンID配列を検証し、適用時点のスナップショットに変換する。
 *
 * 保存前に「そのクーポンがテナントのものか」「activeか」「対象日(onDate)に有効期間内か」を
 * 確かめ、満たさないものは分かりやすいエラーで弾く(DBのCHECK制約に落として23514で
 * 失敗させると、どのクーポンの何が悪いのか呼び出し側に伝わらないため)。
 *
 * findByIdはテナントスコープ(RLS)で引くため、他テナントのクーポンIDは「見つからない」
 * 扱いになる(他テナントのIDが存在するかどうか自体を漏らさない)。
 *
 * 同じクーポンIDが重複して渡された場合は1件に畳む(coupon_redemptions_report_coupon_uidxの
 * UNIQUE制約に、同一バッチ内の重複INSERTとしてそのまま突き当たるのを避けるため)。
 */
export async function resolveCouponRedemptionSnapshots(
  deps: CouponDeps,
  tenantId: string,
  couponIds: readonly string[],
  onDate: string,
): Promise<CouponRedemptionSnapshot[]> {
  const uniqueIds = Array.from(new Set(couponIds));
  return Promise.all(
    uniqueIds.map(async (couponId): Promise<CouponRedemptionSnapshot> => {
      const coupon = await deps.coupons.findById(tenantId, couponId);
      if (!coupon) throw new Error(`クーポンが見つかりません(id=${couponId})`);
      if (!coupon.active) throw new Error(`クーポン「${coupon.name}」は廃止されています`);
      if (coupon.validFrom && onDate < coupon.validFrom) {
        throw new Error(`クーポン「${coupon.name}」はまだ有効期間(${coupon.validFrom}〜)前です`);
      }
      if (coupon.validTo && onDate > coupon.validTo) {
        throw new Error(`クーポン「${coupon.name}」は有効期間(〜${coupon.validTo})を過ぎています`);
      }
      return {
        couponId: coupon.id,
        discountKind: coupon.discountKind,
        discountAmountYen: coupon.discountAmountYen,
        discountPercent: coupon.discountPercent,
      };
    }),
  );
}

/**
 * 日報の適用記録(coupon_redemptions)を、画面表示用のDailyReportCouponView[]に組み立てる。
 * クーポン名・コードは、適用記録には複製していない(doc/14 4.1章。割引条件だけを
 * スナップショットする設計のため)ので、現在のcouponsマスタから引き直す。クーポンが
 * 廃止されていても行は残るため、廃止後もここで解決できる。
 */
export async function buildDailyReportCouponViews(
  deps: CouponDeps,
  tenantId: string,
  redemptions: readonly CouponRedemptionRecord[],
): Promise<DailyReportCouponView[]> {
  const couponIds = Array.from(new Set(redemptions.map((r) => r.couponId)));
  const couponById = new Map<string, CouponRecord>();
  await Promise.all(
    couponIds.map(async (couponId) => {
      const coupon = await deps.coupons.findById(tenantId, couponId);
      if (coupon) couponById.set(couponId, coupon);
    }),
  );

  return redemptions.map((r) => {
    const coupon = couponById.get(r.couponId);
    return {
      couponId: r.couponId,
      // クーポン行が(理屈上)見つからない場合でも、割引条件のスナップショットは
      // 失わずに表示できるよう、名称だけ空にフォールバックする。
      code: coupon?.code ?? '',
      name: coupon?.name ?? '',
      discountKind: r.discountKind,
      discountAmountYen: r.discountAmountYen,
      discountPercent: r.discountPercent,
    };
  });
}
