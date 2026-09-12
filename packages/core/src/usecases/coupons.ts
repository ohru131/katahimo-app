import type {
  CouponAudience,
  CouponBirthdaySubject,
  CouponDiscountKind,
  CouponEligibilityKind,
  CouponRecord,
  CouponRedemptionRecord,
  CouponRedemptionRepositoryPort,
  CouponRepositoryPort,
  CouponUsageLimitKind,
  CustomerCouponRecord,
  CustomerCouponRepositoryPort,
  CustomerRepositoryPort,
  FamilyMemberRepositoryPort,
  NewCouponInput,
} from '../ports/repositories';

export interface CouponDeps {
  coupons: CouponRepositoryPort;
  customerCoupons: CustomerCouponRepositoryPort;
  couponRedemptions: CouponRedemptionRepositoryPort;
  customers: CustomerRepositoryPort;
  familyMembers: FamilyMemberRepositoryPort;
}

/**
 * 管理者のクーポン管理画面用の一覧。廃止済み(active=false)も含む全件を、コード順で返す
 * (doc/14 §9。廃止しても行は消さない方針のため、一覧からも隠さず「廃止済み」として見せる)。
 */
export async function listCouponsForAdmin(deps: CouponDeps, tenantId: string): Promise<CouponRecord[]> {
  const rows = await deps.coupons.listAll(tenantId);
  return rows.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}

// ──────────────────────────────────────────────────────────────────────────
// 「この顧客が・この日に・このクーポンを使えるか」の判定(doc/14 §9)
//
// スタッフが日報を書くたびに「この世帯は今月が誕生月か」「このクーポンはもう使ったか」を
// 自分で判断せずに済むよう、判定は全てここに寄せる。画面には使えるものだけを出し、
// 上限に達したものは「使用済み」として出す(黙って消すと、付け忘れたのか使い切ったのかが
// 分からなくなる)。
// ──────────────────────────────────────────────────────────────────────────

/** 'YYYY-MM-DD' から月('01'〜'12')を取り出す。 */
function monthOf(dateStr: string): string {
  return dateStr.slice(5, 7);
}

/** 'YYYY-MM-DD' から年('2026')を取り出す。 */
function yearOf(dateStr: string): string {
  return dateStr.slice(0, 4);
}

/** そのクーポンが、指定日('YYYY-MM-DD')の時点でマスタとして有効か(active かつ有効期間内か)。 */
function isCouponValidOn(coupon: CouponRecord, dateStr: string): boolean {
  if (!coupon.active) return false;
  if (coupon.validFrom && dateStr < coupon.validFrom) return false;
  if (coupon.validTo && dateStr > coupon.validTo) return false;
  return true;
}

/**
 * 顧客への割当(customer_coupons)が指定日に有効か。割当側の期間はマスタの期間を
 * 置き換えるのではなく「重ねる」(両方を満たす日だけ使える)。配布時に短い期限を付けても、
 * マスタ側のキャンペーン終了日を超えて使えるようにはならない。
 */
function isAssignmentValidOn(assignment: CustomerCouponRecord, dateStr: string): boolean {
  if (assignment.validFrom && dateStr < assignment.validFrom) return false;
  if (assignment.validTo && dateStr > assignment.validTo) return false;
  return true;
}

/**
 * 使用上限を数える単位。'unlimited'ならnull(部分一意索引の対象外になり、何度でも使える)。
 *
 * 年を「適用した日時(applied_at)」ではなく訪問日(onDate)から決めるのは、年末の訪問を
 * 年明けに入力したときに翌年の1回分として数えられてしまわないようにするため
 * (packages/db/src/schema/coupons.ts の usageScopeKey のコメント参照)。
 */
function usageScopeKeyFor(usageLimitKind: CouponUsageLimitKind, onDate: string): string | null {
  switch (usageLimitKind) {
    case 'unlimited':
      return null;
    case 'once_per_customer':
      return 'lifetime';
    case 'once_per_customer_per_year':
      return yearOf(onDate);
    default: {
      const exhaustiveCheck: never = usageLimitKind;
      return exhaustiveCheck;
    }
  }
}

/** 誕生月クーポンの根拠になりうる1人(世帯代表または世帯構成員)。 */
interface BirthdayPerson {
  kind: 'customer' | 'family_member';
  name: string;
  /** 'YYYY-MM-DD'。dobDateが解析できた人だけがここに入る。 */
  dob: string;
}

/**
 * 1回の判定に必要な顧客側の情報をまとめて読んだもの。クーポン1件ごとに顧客・世帯構成員・
 * 適用記録を引き直すとN+1になるため、先に1回だけ読む。
 */
export interface CouponEligibilityContext {
  customerId: string;
  /** 訪問日('YYYY-MM-DD')。 */
  onDate: string;
  /** 誕生日が分かっている世帯の人(世帯代表が先、次に世帯構成員の並び順)。 */
  people: BirthdayPerson[];
  /** couponId -> 割当。coupons.audience='assigned' のクーポンの可否に使う。 */
  assignmentByCouponId: Map<string, CustomerCouponRecord>;
  /** この顧客の適用記録(全件)。使用済み判定に使う。 */
  redemptions: CouponRedemptionRecord[];
  /**
   * 編集中の日報。この日報が既に使っている分は「使用済み」に数えない
   * (自分が付けたクーポンのせいで自分が編集できなくなるのを防ぐ)。
   */
  excludeDailyReportId: string | null;
}

export async function loadCouponEligibilityContext(
  deps: CouponDeps,
  tenantId: string,
  customerId: string,
  onDate: string,
  excludeDailyReportId: string | null = null,
): Promise<CouponEligibilityContext> {
  const [customer, familyMembers, assignments, redemptions] = await Promise.all([
    deps.customers.findById(tenantId, customerId),
    deps.familyMembers.listByCustomerId(tenantId, customerId),
    deps.customerCoupons.listByCustomerId(tenantId, customerId),
    deps.couponRedemptions.listByCustomerId(tenantId, customerId),
  ]);

  const people: BirthdayPerson[] = [];
  // 世帯代表を先に入れる。'any'(どちらでも可)のクーポンで複数人が誕生月に当たったとき、
  // どの人を根拠として記録するかを入力順で決め打ちにするため(結果が呼び出しごとに
  // 揺れないようにする)。
  if (customer?.dobDate) people.push({ kind: 'customer', name: customer.name, dob: customer.dobDate });
  for (const member of familyMembers) {
    if (member.dobDate) people.push({ kind: 'family_member', name: member.name, dob: member.dobDate });
  }

  return {
    customerId,
    onDate,
    people,
    assignmentByCouponId: new Map(assignments.map((a) => [a.couponId, a])),
    redemptions,
    excludeDailyReportId,
  };
}

/** 誕生月クーポンの対象者として、その人がクーポンのbirthdaySubjectに当てはまるか。 */
function matchesSubject(person: BirthdayPerson, subject: CouponBirthdaySubject): boolean {
  return subject === 'any' || subject === person.kind;
}

/**
 * 誕生月クーポンの根拠になる人を1人返す。該当者がいなければnull(=そのクーポンはこの日に
 * 使えない)。年は見ず月だけを比べる(「毎年その月」が誕生月割引の意味のため)。
 */
function findBirthdayPerson(coupon: CouponRecord, context: CouponEligibilityContext): BirthdayPerson | null {
  if (coupon.eligibilityKind !== 'birthday_month') return null;
  const subject = coupon.birthdaySubject;
  // birthdaySubjectはeligibilityKind='birthday_month'なら必ず入る(coupons_birthday_subject_check)。
  // それでもnullなら条件を判定できないので、使える側に倒さず「該当なし」にする。
  if (!subject) return null;
  const targetMonth = monthOf(context.onDate);
  return context.people.find((p) => matchesSubject(p, subject) && monthOf(p.dob) === targetMonth) ?? null;
}

/** そのクーポンが、この顧客の使用上限に既に達しているか。 */
function isUsedUp(coupon: CouponRecord, context: CouponEligibilityContext): boolean {
  const scopeKey = usageScopeKeyFor(coupon.usageLimitKind, context.onDate);
  if (scopeKey === null) return false;
  return context.redemptions.some(
    (r) =>
      r.couponId === coupon.id &&
      r.usageScopeKey === scopeKey &&
      r.dailyReportId !== context.excludeDailyReportId,
  );
}

/** 使えない理由。呼び出し側(画面・エラーメッセージ)が理由ごとに出し分けるために返す。 */
export type CouponUnusableReason =
  | 'inactive_or_out_of_period'
  | 'not_assigned'
  | 'not_birthday_month'
  | 'already_used';

export type CouponEligibility =
  | { usable: true; birthdayPerson: BirthdayPerson | null }
  | { usable: false; reason: CouponUnusableReason; birthdayPerson: BirthdayPerson | null };

/**
 * 1件のクーポンについて、この顧客がこの日に使えるかを判定する。
 * 画面(listCouponsForSelection)と保存時の検証(resolveCouponRedemptionSnapshots)が
 * 同じ関数を通ることで、「選べたのに保存できない」組み合わせを作らない。
 */
export function evaluateCouponEligibility(
  coupon: CouponRecord,
  context: CouponEligibilityContext,
): CouponEligibility {
  if (!isCouponValidOn(coupon, context.onDate)) {
    return { usable: false, reason: 'inactive_or_out_of_period', birthdayPerson: null };
  }
  if (coupon.audience === 'assigned') {
    const assignment = context.assignmentByCouponId.get(coupon.id);
    if (!assignment || !isAssignmentValidOn(assignment, context.onDate)) {
      return { usable: false, reason: 'not_assigned', birthdayPerson: null };
    }
  }

  let birthdayPerson: BirthdayPerson | null = null;
  if (coupon.eligibilityKind === 'birthday_month') {
    birthdayPerson = findBirthdayPerson(coupon, context);
    if (!birthdayPerson) {
      return { usable: false, reason: 'not_birthday_month', birthdayPerson: null };
    }
  }

  if (isUsedUp(coupon, context)) return { usable: false, reason: 'already_used', birthdayPerson };
  return { usable: true, birthdayPerson };
}

/** 日報画面の「クーポンを選ぶ」セレクタが表示する1件。 */
export interface CouponSelectionView {
  id: string;
  code: string;
  name: string;
  discountKind: CouponDiscountKind;
  discountAmountYen: number | null;
  discountPercent: number | null;
  eligibilityKind: CouponEligibilityKind;
  usageLimitKind: CouponUsageLimitKind;
  /** 誕生月クーポンのとき、根拠になる人の氏名(「太郎さんの誕生月」と出すため)。 */
  birthdaySubjectName: string | null;
  /**
   * 使用上限に達していて今回は選べない。画面は消さずに「使用済み」として出す
   * (消すと、付け忘れたのか使い切ったのかがスタッフから見て区別できない)。
   */
  alreadyUsed: boolean;
}

function toSelectionView(coupon: CouponRecord, eligibility: CouponEligibility): CouponSelectionView {
  return {
    id: coupon.id,
    code: coupon.code,
    name: coupon.name,
    discountKind: coupon.discountKind,
    discountAmountYen: coupon.discountAmountYen,
    discountPercent: coupon.discountPercent,
    eligibilityKind: coupon.eligibilityKind,
    usageLimitKind: coupon.usageLimitKind,
    birthdaySubjectName: eligibility.birthdayPerson?.name ?? null,
    alreadyUsed: !eligibility.usable,
  };
}

export interface CouponSelectionQuery {
  customerId: string;
  /** 訪問日('YYYY-MM-DD')。 */
  onDate: string;
  /** 編集中の日報ID。その日報が既に使っている分を「使用済み」に数えないために渡す。 */
  excludeDailyReportId?: string | null;
}

/**
 * 日報画面のクーポン選択用一覧。
 *
 * この顧客が「その日に使える条件を満たしているクーポン」だけを返す。誕生月でない月の
 * 誕生月クーポン・他の顧客に配られたクーポン・廃止済み・期間外は、選択肢に出さない
 * (スタッフが1件ずつ条件を確認しなくて済むようにするのがこの関数の目的)。
 *
 * 使用上限に達しているものだけは例外で、alreadyUsed=true を立てて残す(理由は
 * CouponSelectionView.alreadyUsed のコメント参照)。
 */
export async function listCouponsForSelection(
  deps: CouponDeps,
  tenantId: string,
  query: CouponSelectionQuery,
): Promise<CouponSelectionView[]> {
  const [rows, context] = await Promise.all([
    deps.coupons.listAll(tenantId),
    loadCouponEligibilityContext(
      deps,
      tenantId,
      query.customerId,
      query.onDate,
      query.excludeDailyReportId ?? null,
    ),
  ]);

  return (
    rows
      .map((coupon) => ({ coupon, eligibility: evaluateCouponEligibility(coupon, context) }))
      // 「上限に達しただけ」のものは残し、条件そのものを満たさないものは選択肢から外す。
      .filter(({ eligibility }) => eligibility.usable || eligibility.reason === 'already_used')
      .sort((a, b) => (a.coupon.code < b.coupon.code ? -1 : a.coupon.code > b.coupon.code ? 1 : 0))
      .map(({ coupon, eligibility }) => toSelectionView(coupon, eligibility))
  );
}

// ──────────────────────────────────────────────────────────────────────────
// 管理者によるクーポンマスタの登録・更新
// ──────────────────────────────────────────────────────────────────────────

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
  audience?: CouponAudience;
  eligibilityKind?: CouponEligibilityKind;
  birthdaySubject?: CouponBirthdaySubject | null;
  usageLimitKind?: CouponUsageLimitKind;
  active?: boolean;
  note?: string | null;
}

export type CouponInputInvalidReason =
  | 'code_required'
  | 'name_required'
  | 'discount_value_mismatch'
  | 'discount_amount_yen_invalid'
  | 'discount_percent_invalid'
  | 'valid_period_reversed'
  | 'birthday_subject_mismatch';

/**
 * discount_kind/discount_amount_yen/discount_percentの組み合わせと値域、有効期間の前後関係、
 * eligibility_kindとbirthday_subjectの組み合わせを検証する。DBのCHECK制約
 * (coupons_discount_value_check・coupons_birthday_subject_check等)と同じ条件をusecase側でも
 * 見て、「保存できない入力」を23514(制約違反)ではなく分かりやすい理由付きで先に弾く。
 */
function validateCouponFields(input: {
  code: string;
  name: string;
  discountKind: CouponDiscountKind;
  discountAmountYen: number | null;
  discountPercent: number | null;
  validFrom: string | null;
  validTo: string | null;
  eligibilityKind: CouponEligibilityKind;
  birthdaySubject: CouponBirthdaySubject | null;
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

  // 誕生月クーポンは対象者が必須、それ以外は指定できない(coupons_birthday_subject_check)。
  const wantsSubject = input.eligibilityKind === 'birthday_month';
  if (wantsSubject !== (input.birthdaySubject !== null)) return 'birthday_subject_mismatch';

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
  const eligibilityKind = input.eligibilityKind ?? 'manual';
  const birthdaySubject = input.birthdaySubject ?? null;

  const invalidReason = validateCouponFields({
    code,
    name,
    discountKind: input.discountKind,
    discountAmountYen,
    discountPercent,
    validFrom,
    validTo,
    eligibilityKind,
    birthdaySubject,
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
    audience: input.audience ?? 'all',
    eligibilityKind,
    birthdaySubject,
    usageLimitKind: input.usageLimitKind ?? 'unlimited',
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
  audience?: CouponAudience;
  eligibilityKind?: CouponEligibilityKind;
  birthdaySubject?: CouponBirthdaySubject | null;
  usageLimitKind?: CouponUsageLimitKind;
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
    eligibilityKind: input.eligibilityKind ?? current.eligibilityKind,
    birthdaySubject: input.birthdaySubject !== undefined ? input.birthdaySubject : current.birthdaySubject,
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
    audience: input.audience,
    eligibilityKind: merged.eligibilityKind,
    birthdaySubject: merged.birthdaySubject,
    usageLimitKind: input.usageLimitKind,
    active: input.active,
    note: input.note,
  });
  if (!updated) return { ok: false, reason: 'not_found' };
  return { ok: true };
}

// ──────────────────────────────────────────────────────────────────────────
// 顧客へのクーポン割当(customer_coupons)
// ──────────────────────────────────────────────────────────────────────────

/** 顧客詳細画面の「この顧客が使えるクーポン」一覧の1件。 */
export interface CustomerCouponView {
  couponId: string;
  code: string;
  name: string;
  discountKind: CouponDiscountKind;
  discountAmountYen: number | null;
  discountPercent: number | null;
  /** この顧客に限った有効期間。nullはクーポンマスタの期間に従う。 */
  validFrom: string | null;
  validTo: string | null;
  note: string | null;
  /** クーポンマスタ側が廃止済み(active=false)。割当が残っていても使えない。 */
  couponInactive: boolean;
}

/**
 * 顧客に割り当てられているクーポンの一覧(管理画面用)。使えるかどうかの日付判定はせず、
 * 「何を配ってあるか」をそのまま見せる(配布状況の管理が目的のため)。
 */
export async function listCustomerCoupons(
  deps: CouponDeps,
  tenantId: string,
  customerId: string,
): Promise<CustomerCouponView[]> {
  const [assignments, coupons] = await Promise.all([
    deps.customerCoupons.listByCustomerId(tenantId, customerId),
    deps.coupons.listAll(tenantId),
  ]);
  const couponById = new Map(coupons.map((c) => [c.id, c]));

  return assignments
    .flatMap((assignment) => {
      const coupon = couponById.get(assignment.couponId);
      // 割当はクーポンへの複合FKで守られているため、ここが見つからないのは理屈上起きない。
      // それでも1件の不整合で画面全体を落とさないよう、その行だけ落として続ける。
      if (!coupon) return [];
      return [
        {
          couponId: coupon.id,
          code: coupon.code,
          name: coupon.name,
          discountKind: coupon.discountKind,
          discountAmountYen: coupon.discountAmountYen,
          discountPercent: coupon.discountPercent,
          validFrom: assignment.validFrom,
          validTo: assignment.validTo,
          note: assignment.note,
          couponInactive: !coupon.active,
        },
      ];
    })
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}

export interface AssignCouponInput {
  couponId: string;
  validFrom?: string | null;
  validTo?: string | null;
  note?: string | null;
}

export type AssignCouponResult =
  | { ok: true }
  | { ok: false; reason: 'coupon_not_found' | 'valid_period_reversed' };

/**
 * 顧客にクーポンを割り当てる(既に割り当て済みなら有効期間・メモを上書きする)。
 *
 * クーポンの存在確認をここでするのは、DBの複合FK違反(23503)をそのまま画面に出すと
 * 何が悪いのか伝わらないため。findByIdはテナントスコープ(RLS)で引くので、他テナントの
 * クーポンIDは「見つからない」扱いになる。
 */
export async function assignCouponToCustomer(
  deps: CouponDeps,
  tenantId: string,
  customerId: string,
  input: AssignCouponInput,
): Promise<AssignCouponResult> {
  const validFrom = input.validFrom ?? null;
  const validTo = input.validTo ?? null;
  if (validFrom && validTo && validTo < validFrom) return { ok: false, reason: 'valid_period_reversed' };

  const coupon = await deps.coupons.findById(tenantId, input.couponId);
  if (!coupon) return { ok: false, reason: 'coupon_not_found' };

  await deps.customerCoupons.upsert({
    tenantId,
    customerId,
    couponId: input.couponId,
    validFrom,
    validTo,
    note: input.note ?? null,
  });
  return { ok: true };
}

/** 顧客へのクーポン割当を取り消す。過去の適用記録は coupon_redemptions 側に残る。 */
export async function unassignCouponFromCustomer(
  deps: CouponDeps,
  tenantId: string,
  customerId: string,
  couponId: string,
): Promise<boolean> {
  return deps.customerCoupons.remove(tenantId, customerId, couponId);
}

// ──────────────────────────────────────────────────────────────────────────
// 日報保存時の適用記録づくり
// ──────────────────────────────────────────────────────────────────────────

/** 日報1件に紐づく適用済みクーポン1件の表示用の形(クーポン名・コード+適用時点の割引条件)。 */
export interface DailyReportCouponView {
  couponId: string;
  code: string;
  name: string;
  discountKind: CouponDiscountKind;
  discountAmountYen: number | null;
  discountPercent: number | null;
  /** 誕生月クーポンのとき、根拠にした人の氏名(適用時点の値)。 */
  birthdaySubjectName: string | null;
}

/**
 * 割引条件を適用した瞬間のマスタ(coupons)から複製したスナップショット。
 * coupon_redemptionsへ保存する直前の形(dailyReportIdはまだ決まっていない=作成前の
 * 日報にも使えるようにこの型には含めない。呼び出し側がNewCouponRedemptionInputに組み立てる)。
 */
export interface CouponRedemptionSnapshot {
  couponId: string;
  customerId: string;
  discountKind: CouponDiscountKind;
  discountAmountYen: number | null;
  discountPercent: number | null;
  usageLimitKind: CouponUsageLimitKind;
  usageScopeKey: string | null;
  birthdaySubjectName: string | null;
  birthdaySubjectDob: string | null;
}

/** evaluateCouponEligibilityのreasonを、スタッフに見せるメッセージに変換する。 */
function unusableMessage(couponName: string, reason: CouponUnusableReason): string {
  switch (reason) {
    case 'inactive_or_out_of_period':
      return `クーポン「${couponName}」は今は使えません(廃止済みか有効期間外です)`;
    case 'not_assigned':
      return `クーポン「${couponName}」はこの顧客には配布されていません`;
    case 'not_birthday_month':
      return `クーポン「${couponName}」は対象者の誕生月にだけ使えます`;
    case 'already_used':
      return `クーポン「${couponName}」はこの顧客で使用済みです`;
    default: {
      const exhaustiveCheck: never = reason;
      return exhaustiveCheck;
    }
  }
}

/**
 * 日報保存時に指定されたクーポンID配列を検証し、適用時点のスナップショットに変換する。
 *
 * 検証は画面の選択肢を作るのと同じ evaluateCouponEligibility を通す(「選べたのに保存
 * できない」「画面を経由せず叩けば条件を無視できる」のどちらも起きないようにするため)。
 * DBのCHECK制約や一意索引に落として23514/23505で失敗させると、どのクーポンの何が悪いのか
 * 呼び出し側に伝わらないので、先にここで分かりやすいエラーにする。
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
  query: CouponSelectionQuery,
): Promise<CouponRedemptionSnapshot[]> {
  const uniqueIds = Array.from(new Set(couponIds));
  if (uniqueIds.length === 0) return [];

  const context = await loadCouponEligibilityContext(
    deps,
    tenantId,
    query.customerId,
    query.onDate,
    query.excludeDailyReportId ?? null,
  );

  return Promise.all(
    uniqueIds.map(async (couponId): Promise<CouponRedemptionSnapshot> => {
      const coupon = await deps.coupons.findById(tenantId, couponId);
      if (!coupon) throw new Error(`クーポンが見つかりません(id=${couponId})`);

      const eligibility = evaluateCouponEligibility(coupon, context);
      if (!eligibility.usable) throw new Error(unusableMessage(coupon.name, eligibility.reason));

      return {
        couponId: coupon.id,
        customerId: query.customerId,
        discountKind: coupon.discountKind,
        discountAmountYen: coupon.discountAmountYen,
        discountPercent: coupon.discountPercent,
        usageLimitKind: coupon.usageLimitKind,
        usageScopeKey: usageScopeKeyFor(coupon.usageLimitKind, query.onDate),
        birthdaySubjectName: eligibility.birthdayPerson?.name ?? null,
        birthdaySubjectDob: eligibility.birthdayPerson?.dob ?? null,
      };
    }),
  );
}

/**
 * 日報の適用記録(coupon_redemptions)を、画面表示用のDailyReportCouponView[]に組み立てる。
 * クーポン名・コードは、適用記録には複製していない(doc/14 §9。割引条件だけを
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
      birthdaySubjectName: r.birthdaySubjectName,
    };
  });
}
