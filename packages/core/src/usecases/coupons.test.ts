import { beforeEach, describe, expect, it } from 'vitest';
import type { NewCouponInput } from '../ports/repositories';
import type { CouponDeps, CouponSelectionQuery } from './coupons';
import {
  assignCouponToCustomer,
  createCoupon,
  listCouponsForAdmin,
  listCouponsForSelection,
  listCustomerCoupons,
  resolveCouponRedemptionSnapshots,
  unassignCouponFromCustomer,
  updateCoupon,
} from './coupons';
import type { CustomerDeps } from './customers';
import { createCustomer } from './customers';
import {
  FakeCouponRedemptionRepository,
  FakeCouponRepository,
  FakeCustomerCouponRepository,
  FakeCustomerRepository,
  FakeFamilyMemberRepository,
} from './testDoubles';

const tenantId = 'tenant-1';
const otherTenantId = 'tenant-2';

/** テスト用のクーポン登録の省略入力を埋めるヘルパー。 */
function amountCoupon(overrides: Partial<NewCouponInput> = {}): NewCouponInput {
  return {
    tenantId,
    code: 'INTRO500',
    name: '紹介キャンペーン 500円引き',
    discountKind: 'amount',
    discountAmountYen: 500,
    discountPercent: null,
    validFrom: null,
    validTo: null,
    audience: 'all',
    eligibilityKind: 'manual',
    birthdaySubject: null,
    usageLimitKind: 'unlimited',
    active: true,
    note: null,
    ...overrides,
  };
}

interface Harness {
  deps: CouponDeps;
  coupons: FakeCouponRepository;
  customerCoupons: FakeCustomerCouponRepository;
  couponRedemptions: FakeCouponRedemptionRepository;
  customerId: string;
  /** 既定の選択条件(この顧客・2026-06-01)。誕生月のテストは onDate を差し替える。 */
  query: CouponSelectionQuery;
}

/**
 * 世帯代表(6月生まれ)と子ども2人(3月生まれ / 生年月日不明)を持つ顧客を1件作った状態を返す。
 * 誕生月クーポンの「代表だけ」「子どもだけ」「どちらでも」を1つの世帯で試せるようにしている。
 */
async function makeHarness(): Promise<Harness> {
  const coupons = new FakeCouponRepository();
  const customerCoupons = new FakeCustomerCouponRepository();
  const couponRedemptions = new FakeCouponRedemptionRepository();
  const customers = new FakeCustomerRepository();
  const familyMembers = new FakeFamilyMemberRepository();

  const customerDeps: CustomerDeps = { customers, familyMembers };
  const customer = await createCustomer(customerDeps, {
    tenantId,
    name: '田中 一郎',
    dob: '1990/6/15',
    familyMembers: [
      { name: '田中 太郎', dob: '2020/3/3' },
      // 生年月日が「年だけ」の表記は日付として解析できずdobDateがnullになる(doc/14 §6)。
      // 誕生月の判定対象から静かに外れることを確かめるために入れている。
      { name: '田中 花子', dob: '2022' },
    ],
  });

  return {
    deps: { coupons, customerCoupons, couponRedemptions, customers, familyMembers },
    coupons,
    customerCoupons,
    couponRedemptions,
    customerId: customer.id,
    query: { customerId: customer.id, onDate: '2026-06-01' },
  };
}

describe('createCoupon / updateCoupon', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await makeHarness();
  });

  it('金額引きクーポンを登録できる', async () => {
    const result = await createCoupon(h.deps, tenantId, {
      code: 'INTRO500',
      name: '紹介キャンペーン 500円引き',
      discountKind: 'amount',
      discountAmountYen: 500,
    });
    expect(result.ok).toBe(true);
  });

  it('率引きクーポンを登録できる', async () => {
    const result = await createCoupon(h.deps, tenantId, {
      code: 'SPRING10',
      name: '春の10%オフ',
      discountKind: 'percent',
      discountPercent: 10,
    });
    expect(result.ok).toBe(true);
  });

  it('種別と値の組み合わせが合わない入力は拒否される', async () => {
    const result = await createCoupon(h.deps, tenantId, {
      code: 'BAD',
      name: 'ちぐはぐ',
      discountKind: 'amount',
      discountPercent: 10,
    });
    expect(result).toEqual({ ok: false, reason: 'discount_value_mismatch' });
  });

  it('同じコードは登録できない', async () => {
    await h.coupons.create(amountCoupon({ code: 'INTRO500' }));
    const result = await createCoupon(h.deps, tenantId, {
      code: 'INTRO500',
      name: '別のクーポン',
      discountKind: 'amount',
      discountAmountYen: 100,
    });
    expect(result).toEqual({ ok: false, reason: 'code_taken' });
  });

  it('誕生月クーポンは対象者(birthdaySubject)が無いと登録できない', async () => {
    const result = await createCoupon(h.deps, tenantId, {
      code: 'BIRTHDAY',
      name: '誕生月割引',
      discountKind: 'percent',
      discountPercent: 10,
      eligibilityKind: 'birthday_month',
    });
    expect(result).toEqual({ ok: false, reason: 'birthday_subject_mismatch' });
  });

  it('誕生月クーポン以外に対象者を指定すると拒否される(使われない設定が残らないようにする)', async () => {
    const result = await createCoupon(h.deps, tenantId, {
      code: 'PLAIN',
      name: 'ふつうの割引',
      discountKind: 'amount',
      discountAmountYen: 500,
      birthdaySubject: 'customer',
    });
    expect(result).toEqual({ ok: false, reason: 'birthday_subject_mismatch' });
  });

  it('部分更新でeligibilityKindだけを誕生月に変えると、対象者が無いので拒否される', async () => {
    const created = await h.coupons.create(amountCoupon());
    const result = await updateCoupon(h.deps, tenantId, created.id, {
      eligibilityKind: 'birthday_month',
    });
    expect(result).toEqual({ ok: false, reason: 'birthday_subject_mismatch' });
  });

  it('eligibilityKindと対象者を同時に渡せば誕生月クーポンに変更できる', async () => {
    const created = await h.coupons.create(amountCoupon());
    const result = await updateCoupon(h.deps, tenantId, created.id, {
      eligibilityKind: 'birthday_month',
      birthdaySubject: 'any',
      usageLimitKind: 'once_per_customer_per_year',
    });
    expect(result).toEqual({ ok: true });
    const after = await h.coupons.findById(tenantId, created.id);
    expect(after?.birthdaySubject).toBe('any');
    expect(after?.usageLimitKind).toBe('once_per_customer_per_year');
  });

  it('廃止(active=false)にしても行は消えない', async () => {
    const created = await h.coupons.create(amountCoupon());
    await updateCoupon(h.deps, tenantId, created.id, { active: false });
    const found = await h.coupons.findById(tenantId, created.id);
    expect(found?.active).toBe(false);
  });
});

describe('listCouponsForAdmin / listCouponsForSelection', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await makeHarness();
  });

  it('管理者向け一覧は廃止済みも含めて全件返す', async () => {
    await h.coupons.create(amountCoupon({ code: 'A', active: true }));
    await h.coupons.create(amountCoupon({ code: 'B', active: false }));

    const result = await listCouponsForAdmin(h.deps, tenantId);
    expect(result.map((c) => c.code)).toEqual(['A', 'B']);
  });

  it('選択用一覧は廃止済みを除く', async () => {
    await h.coupons.create(amountCoupon({ code: 'A', active: true }));
    await h.coupons.create(amountCoupon({ code: 'B', active: false }));

    const result = await listCouponsForSelection(h.deps, tenantId, h.query);
    expect(result.map((c) => c.code)).toEqual(['A']);
  });

  it('選択用一覧は対象日が有効期間外のものを除く', async () => {
    await h.coupons.create(amountCoupon({ code: 'FUTURE', validFrom: '2027-01-01', validTo: null }));
    await h.coupons.create(amountCoupon({ code: 'PAST', validFrom: null, validTo: '2025-12-31' }));
    await h.coupons.create(amountCoupon({ code: 'CURRENT', validFrom: '2026-01-01', validTo: '2026-12-31' }));

    const result = await listCouponsForSelection(h.deps, tenantId, h.query);
    expect(result.map((c) => c.code)).toEqual(['CURRENT']);
  });
});

describe('誕生月クーポン(doc/14 §9)', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await makeHarness();
  });

  /** 世帯代表は6月生まれ、子ども(太郎)は3月生まれ。 */
  const june = { onDate: '2026-06-10' };
  const march = { onDate: '2026-03-10' };

  it('世帯代表の誕生月クーポンは、その月だけ選択肢に出る', async () => {
    await h.coupons.create(
      amountCoupon({ code: 'BD-C', eligibilityKind: 'birthday_month', birthdaySubject: 'customer' }),
    );

    const inJune = await listCouponsForSelection(h.deps, tenantId, { ...h.query, ...june });
    expect(inJune.map((c) => c.code)).toEqual(['BD-C']);
    expect(inJune[0]?.birthdaySubjectName).toBe('田中 一郎');

    const inMarch = await listCouponsForSelection(h.deps, tenantId, { ...h.query, ...march });
    expect(inMarch).toEqual([]);
  });

  it('世帯構成員の誕生月クーポンは、子どもの誕生月だけ選択肢に出る', async () => {
    await h.coupons.create(
      amountCoupon({ code: 'BD-F', eligibilityKind: 'birthday_month', birthdaySubject: 'family_member' }),
    );

    const inMarch = await listCouponsForSelection(h.deps, tenantId, { ...h.query, ...march });
    expect(inMarch.map((c) => c.code)).toEqual(['BD-F']);
    expect(inMarch[0]?.birthdaySubjectName).toBe('田中 太郎');

    const inJune = await listCouponsForSelection(h.deps, tenantId, { ...h.query, ...june });
    expect(inJune).toEqual([]);
  });

  it("birthdaySubject='any' は世帯代表・世帯構成員のどちらの誕生月でも使える", async () => {
    await h.coupons.create(
      amountCoupon({ code: 'BD-ANY', eligibilityKind: 'birthday_month', birthdaySubject: 'any' }),
    );

    const inJune = await listCouponsForSelection(h.deps, tenantId, { ...h.query, ...june });
    expect(inJune[0]?.birthdaySubjectName).toBe('田中 一郎');

    const inMarch = await listCouponsForSelection(h.deps, tenantId, { ...h.query, ...march });
    expect(inMarch[0]?.birthdaySubjectName).toBe('田中 太郎');
  });

  it('年は見ずに月だけで判定する(毎年その月に使える)', async () => {
    await h.coupons.create(
      amountCoupon({ code: 'BD-C', eligibilityKind: 'birthday_month', birthdaySubject: 'customer' }),
    );

    for (const onDate of ['2026-06-01', '2027-06-30', '2030-06-15']) {
      const result = await listCouponsForSelection(h.deps, tenantId, { ...h.query, onDate });
      expect(result.map((c) => c.code)).toEqual(['BD-C']);
    }
  });

  it('生年月日を解析できなかった人(dobDateがnull)は誕生月の判定対象にならない', async () => {
    // 花子は'2022'という年だけの表記でdobDateがnullになっている。仮に「今月」が何月でも、
    // 花子を根拠にクーポンが出ることはない(太郎の3月・代表の6月以外は該当者なし)。
    await h.coupons.create(
      amountCoupon({ code: 'BD-ANY', eligibilityKind: 'birthday_month', birthdaySubject: 'any' }),
    );

    const inJanuary = await listCouponsForSelection(h.deps, tenantId, {
      ...h.query,
      onDate: '2026-01-15',
    });
    expect(inJanuary).toEqual([]);
  });

  it('適用すると、根拠にした人の氏名と生年月日がスナップショットに残る', async () => {
    const coupon = await h.coupons.create(
      amountCoupon({ eligibilityKind: 'birthday_month', birthdaySubject: 'any' }),
    );

    const [snapshot] = await resolveCouponRedemptionSnapshots(h.deps, tenantId, [coupon.id], {
      ...h.query,
      ...march,
    });
    expect(snapshot?.birthdaySubjectName).toBe('田中 太郎');
    expect(snapshot?.birthdaySubjectDob).toBe('2020-03-03');
  });

  it('誕生月でない日に保存しようとすると分かりやすいエラーで弾かれる', async () => {
    const coupon = await h.coupons.create(
      amountCoupon({ eligibilityKind: 'birthday_month', birthdaySubject: 'customer' }),
    );

    await expect(
      resolveCouponRedemptionSnapshots(h.deps, tenantId, [coupon.id], { ...h.query, ...march }),
    ).rejects.toThrow(/誕生月/);
  });
});

describe('顧客ごとの配布(customer_coupons)', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await makeHarness();
  });

  it("audience='assigned' のクーポンは、割り当てるまで選択肢に出ない", async () => {
    const coupon = await h.coupons.create(amountCoupon({ code: 'GIFT', audience: 'assigned' }));

    expect(await listCouponsForSelection(h.deps, tenantId, h.query)).toEqual([]);

    await assignCouponToCustomer(h.deps, tenantId, h.customerId, { couponId: coupon.id });
    const after = await listCouponsForSelection(h.deps, tenantId, h.query);
    expect(after.map((c) => c.code)).toEqual(['GIFT']);
  });

  it('割当を取り消すと、また選択肢から消える', async () => {
    const coupon = await h.coupons.create(amountCoupon({ code: 'GIFT', audience: 'assigned' }));
    await assignCouponToCustomer(h.deps, tenantId, h.customerId, { couponId: coupon.id });

    expect(await unassignCouponFromCustomer(h.deps, tenantId, h.customerId, coupon.id)).toBe(true);
    expect(await listCouponsForSelection(h.deps, tenantId, h.query)).toEqual([]);
  });

  it('割当側の有効期間はマスタの期間に重ねて効く(どちらも満たす日だけ使える)', async () => {
    const coupon = await h.coupons.create(
      amountCoupon({
        code: 'GIFT',
        audience: 'assigned',
        validFrom: '2026-01-01',
        validTo: '2026-12-31',
      }),
    );
    await assignCouponToCustomer(h.deps, tenantId, h.customerId, {
      couponId: coupon.id,
      validFrom: '2026-05-01',
      validTo: '2026-05-31',
    });

    const inMay = await listCouponsForSelection(h.deps, tenantId, { ...h.query, onDate: '2026-05-15' });
    expect(inMay.map((c) => c.code)).toEqual(['GIFT']);

    // マスタの期間内(6月)でも、割当側の期間を過ぎていれば使えない。
    const inJune = await listCouponsForSelection(h.deps, tenantId, { ...h.query, onDate: '2026-06-15' });
    expect(inJune).toEqual([]);
  });

  it('同じクーポンを2回割り当てても1件のままで、有効期間が上書きされる', async () => {
    const coupon = await h.coupons.create(amountCoupon({ code: 'GIFT', audience: 'assigned' }));
    await assignCouponToCustomer(h.deps, tenantId, h.customerId, {
      couponId: coupon.id,
      validTo: '2026-06-30',
    });
    await assignCouponToCustomer(h.deps, tenantId, h.customerId, {
      couponId: coupon.id,
      validTo: '2026-12-31',
    });

    const assigned = await listCustomerCoupons(h.deps, tenantId, h.customerId);
    expect(assigned).toHaveLength(1);
    expect(assigned[0]?.validTo).toBe('2026-12-31');
  });

  it('存在しないクーポンは割り当てられない', async () => {
    const result = await assignCouponToCustomer(h.deps, tenantId, h.customerId, {
      couponId: 'nonexistent',
    });
    expect(result).toEqual({ ok: false, reason: 'coupon_not_found' });
  });

  it('他テナントのクーポンは「見つからない」として拒否される', async () => {
    const coupon = await h.coupons.create(amountCoupon({ tenantId: otherTenantId }));
    const result = await assignCouponToCustomer(h.deps, tenantId, h.customerId, { couponId: coupon.id });
    expect(result).toEqual({ ok: false, reason: 'coupon_not_found' });
  });
});

describe('使用上限(usageLimitKind)', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await makeHarness();
  });

  /** 適用記録を1件作る(日報保存の代わり)。 */
  async function redeem(couponId: string, onDate: string, dailyReportId: string): Promise<void> {
    const snapshots = await resolveCouponRedemptionSnapshots(h.deps, tenantId, [couponId], {
      ...h.query,
      onDate,
    });
    await h.couponRedemptions.replaceForDailyReport(
      tenantId,
      dailyReportId,
      snapshots.map((s) => ({ tenantId, dailyReportId, ...s })),
    );
  }

  it("'once_per_customer' は1度使うと使用済みになる", async () => {
    const coupon = await h.coupons.create(
      amountCoupon({ code: 'ONCE', usageLimitKind: 'once_per_customer' }),
    );
    await redeem(coupon.id, '2026-06-01', 'report-1');

    const list = await listCouponsForSelection(h.deps, tenantId, h.query);
    // 選択肢からは消さず「使用済み」として残す(付け忘れと区別できるようにするため)。
    expect(list.map((c) => ({ code: c.code, alreadyUsed: c.alreadyUsed }))).toEqual([
      { code: 'ONCE', alreadyUsed: true },
    ]);

    await expect(resolveCouponRedemptionSnapshots(h.deps, tenantId, [coupon.id], h.query)).rejects.toThrow(
      /使用済み/,
    );
  });

  it("'once_per_customer_per_year' は年が変われば再び使える", async () => {
    const coupon = await h.coupons.create(
      amountCoupon({ code: 'YEARLY', usageLimitKind: 'once_per_customer_per_year' }),
    );
    await redeem(coupon.id, '2026-06-01', 'report-1');

    const sameYear = await listCouponsForSelection(h.deps, tenantId, { ...h.query, onDate: '2026-09-01' });
    expect(sameYear[0]?.alreadyUsed).toBe(true);

    const nextYear = await listCouponsForSelection(h.deps, tenantId, { ...h.query, onDate: '2027-06-01' });
    expect(nextYear[0]?.alreadyUsed).toBe(false);
  });

  it("'unlimited' は何度でも使える", async () => {
    const coupon = await h.coupons.create(amountCoupon({ code: 'FREE' }));
    await redeem(coupon.id, '2026-06-01', 'report-1');

    const list = await listCouponsForSelection(h.deps, tenantId, h.query);
    expect(list[0]?.alreadyUsed).toBe(false);
    // 上限なしのクーポンは部分一意索引の対象外にするため、usageScopeKeyをnullで積む。
    const [snapshot] = await resolveCouponRedemptionSnapshots(h.deps, tenantId, [coupon.id], h.query);
    expect(snapshot?.usageScopeKey).toBeNull();
  });

  it('編集中の日報が既に使っている分は「使用済み」に数えない(自分の日報を編集できなくならない)', async () => {
    const coupon = await h.coupons.create(
      amountCoupon({ code: 'ONCE', usageLimitKind: 'once_per_customer' }),
    );
    await redeem(coupon.id, '2026-06-01', 'report-1');

    const editing = await listCouponsForSelection(h.deps, tenantId, {
      ...h.query,
      excludeDailyReportId: 'report-1',
    });
    expect(editing[0]?.alreadyUsed).toBe(false);

    // 別の日報からは使えないままであること(除外が効きすぎていないことの確認)。
    const other = await listCouponsForSelection(h.deps, tenantId, {
      ...h.query,
      excludeDailyReportId: 'report-2',
    });
    expect(other[0]?.alreadyUsed).toBe(true);
  });

  it('使用上限は顧客ごとに数える(他の顧客の使用は影響しない)', async () => {
    const coupon = await h.coupons.create(
      amountCoupon({ code: 'ONCE', usageLimitKind: 'once_per_customer' }),
    );
    await redeem(coupon.id, '2026-06-01', 'report-1');

    const otherCustomer = await listCouponsForSelection(h.deps, tenantId, {
      customerId: 'other-customer',
      onDate: '2026-06-01',
    });
    expect(otherCustomer[0]?.alreadyUsed).toBe(false);
  });
});

describe('resolveCouponRedemptionSnapshots', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await makeHarness();
  });

  it('active かつ有効期間内のクーポンはスナップショットに変換される', async () => {
    const created = await h.coupons.create(amountCoupon({ validFrom: '2026-01-01', validTo: '2026-12-31' }));

    const result = await resolveCouponRedemptionSnapshots(h.deps, tenantId, [created.id], h.query);
    expect(result).toEqual([
      {
        couponId: created.id,
        customerId: h.customerId,
        discountKind: 'amount',
        discountAmountYen: 500,
        discountPercent: null,
        usageLimitKind: 'unlimited',
        usageScopeKey: null,
        birthdaySubjectName: null,
        birthdaySubjectDob: null,
      },
    ]);
  });

  it('存在しないクーポンIDは拒否される', async () => {
    await expect(
      resolveCouponRedemptionSnapshots(h.deps, tenantId, ['nonexistent'], h.query),
    ).rejects.toThrow(/見つかりません/);
  });

  it('他テナントのクーポンIDは「見つからない」として拒否される(テナント越えを許さない)', async () => {
    const created = await h.coupons.create(amountCoupon({ tenantId: otherTenantId }));

    await expect(resolveCouponRedemptionSnapshots(h.deps, tenantId, [created.id], h.query)).rejects.toThrow(
      /見つかりません/,
    );
  });

  it('active=falseのクーポンは拒否される', async () => {
    const created = await h.coupons.create(amountCoupon({ active: false }));

    await expect(resolveCouponRedemptionSnapshots(h.deps, tenantId, [created.id], h.query)).rejects.toThrow(
      /廃止/,
    );
  });

  it('有効期間より前の対象日は拒否される', async () => {
    const created = await h.coupons.create(amountCoupon({ validFrom: '2026-07-01', validTo: null }));

    await expect(resolveCouponRedemptionSnapshots(h.deps, tenantId, [created.id], h.query)).rejects.toThrow(
      /有効期間/,
    );
  });

  it('有効期間より後の対象日は拒否される', async () => {
    const created = await h.coupons.create(amountCoupon({ validFrom: null, validTo: '2026-01-31' }));

    await expect(resolveCouponRedemptionSnapshots(h.deps, tenantId, [created.id], h.query)).rejects.toThrow(
      /有効期間/,
    );
  });

  it('配布されていないクーポンは分かりやすいエラーで弾かれる(画面を通さず叩かれた場合)', async () => {
    const created = await h.coupons.create(amountCoupon({ audience: 'assigned' }));

    await expect(resolveCouponRedemptionSnapshots(h.deps, tenantId, [created.id], h.query)).rejects.toThrow(
      /配布されていません/,
    );
  });

  it('同じクーポンIDが重複していても1件に畳まれる', async () => {
    const created = await h.coupons.create(amountCoupon());

    const result = await resolveCouponRedemptionSnapshots(
      h.deps,
      tenantId,
      [created.id, created.id],
      h.query,
    );
    expect(result).toHaveLength(1);
  });

  it('あとでマスタの割引額を変えても、既に作ったスナップショットは変わらない(スナップショットの目的そのもの)', async () => {
    const created = await h.coupons.create(amountCoupon());
    const [snapshot] = await resolveCouponRedemptionSnapshots(h.deps, tenantId, [created.id], h.query);

    // マスタを書き換える(管理者がクーポンの割引額を修正した想定)。
    await updateCoupon(h.deps, tenantId, created.id, { discountAmountYen: 1000 });

    // 既に取得済みのスナップショット自体は、その場でコピーした値なので当然動かない。
    expect(snapshot?.discountAmountYen).toBe(500);
    // 新しく解決すれば、新しい値が使われる(=過去の適用記録には波及しない設計であることの裏付け)。
    const [after] = await resolveCouponRedemptionSnapshots(h.deps, tenantId, [created.id], h.query);
    expect(after?.discountAmountYen).toBe(1000);
  });
});
