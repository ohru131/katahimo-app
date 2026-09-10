import { beforeEach, describe, expect, it } from 'vitest';
import type { NewCouponInput } from '../ports/repositories';
import type { CouponDeps } from './coupons';
import {
  createCoupon,
  listCouponsForAdmin,
  listCouponsForSelection,
  resolveCouponRedemptionSnapshots,
  updateCoupon,
} from './coupons';
import { FakeCouponRepository } from './testDoubles';

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
    active: true,
    note: null,
    ...overrides,
  };
}

describe('createCoupon / updateCoupon', () => {
  let deps: CouponDeps;
  let coupons: FakeCouponRepository;

  beforeEach(() => {
    coupons = new FakeCouponRepository();
    deps = { coupons };
  });

  it('金額引きクーポンを登録できる', async () => {
    const result = await createCoupon(deps, tenantId, {
      code: 'INTRO500',
      name: '紹介キャンペーン 500円引き',
      discountKind: 'amount',
      discountAmountYen: 500,
    });
    expect(result.ok).toBe(true);
  });

  it('率引きクーポンを登録できる', async () => {
    const result = await createCoupon(deps, tenantId, {
      code: 'SPRING10',
      name: '春の10%オフ',
      discountKind: 'percent',
      discountPercent: 10,
    });
    expect(result.ok).toBe(true);
  });

  it('discountKind=amountなのにdiscountPercentが入っていると拒否される', async () => {
    const result = await createCoupon(deps, tenantId, {
      code: 'BAD1',
      name: '不正な組み合わせ',
      discountKind: 'amount',
      discountAmountYen: 500,
      discountPercent: 10,
    });
    expect(result).toEqual({ ok: false, reason: 'discount_value_mismatch' });
  });

  it('discountKind=percentなのにdiscountAmountYenが入っていると拒否される', async () => {
    const result = await createCoupon(deps, tenantId, {
      code: 'BAD2',
      name: '不正な組み合わせ',
      discountKind: 'percent',
      discountPercent: 10,
      discountAmountYen: 500,
    });
    expect(result).toEqual({ ok: false, reason: 'discount_value_mismatch' });
  });

  it('有効期間が逆転していると拒否される', async () => {
    const result = await createCoupon(deps, tenantId, {
      code: 'BAD3',
      name: '期間逆転',
      discountKind: 'amount',
      discountAmountYen: 100,
      validFrom: '2026-12-31',
      validTo: '2026-01-01',
    });
    expect(result).toEqual({ ok: false, reason: 'valid_period_reversed' });
  });

  it('同一テナント内でコードが重複していると拒否される', async () => {
    await coupons.create(amountCoupon());
    const result = await createCoupon(deps, tenantId, {
      code: 'INTRO500',
      name: '別の名前',
      discountKind: 'amount',
      discountAmountYen: 100,
    });
    expect(result).toEqual({ ok: false, reason: 'code_taken' });
  });

  it('別テナントに同じコードがあっても登録できる(テナントごとに一意)', async () => {
    await coupons.create(amountCoupon({ tenantId: otherTenantId }));
    const result = await createCoupon(deps, tenantId, {
      code: 'INTRO500',
      name: '紹介キャンペーン',
      discountKind: 'amount',
      discountAmountYen: 500,
    });
    expect(result.ok).toBe(true);
  });

  it('存在しないクーポンの更新はnot_foundになる', async () => {
    const result = await updateCoupon(deps, tenantId, 'nonexistent', { name: '更新' });
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('部分更新: nameだけ変えても、discountKind/値の整合性は現在値のまま検証される', async () => {
    const created = await coupons.create(amountCoupon());
    const result = await updateCoupon(deps, tenantId, created.id, { name: '新しい名前' });
    expect(result).toEqual({ ok: true });
    const updated = await coupons.findById(tenantId, created.id);
    expect(updated?.name).toBe('新しい名前');
    expect(updated?.discountAmountYen).toBe(500);
  });

  it('廃止(active=false)にしても行は消えない', async () => {
    const created = await coupons.create(amountCoupon());
    await updateCoupon(deps, tenantId, created.id, { active: false });
    const found = await coupons.findById(tenantId, created.id);
    expect(found?.active).toBe(false);
  });
});

describe('listCouponsForAdmin / listCouponsForSelection', () => {
  let deps: CouponDeps;
  let coupons: FakeCouponRepository;

  beforeEach(() => {
    coupons = new FakeCouponRepository();
    deps = { coupons };
  });

  it('管理者向け一覧は廃止済みも含めて全件返す', async () => {
    await coupons.create(amountCoupon({ code: 'A', active: true }));
    await coupons.create(amountCoupon({ code: 'B', active: false }));

    const result = await listCouponsForAdmin(deps, tenantId);
    expect(result.map((c) => c.code)).toEqual(['A', 'B']);
  });

  it('選択用一覧は廃止済みを除く', async () => {
    await coupons.create(amountCoupon({ code: 'A', active: true }));
    await coupons.create(amountCoupon({ code: 'B', active: false }));

    const result = await listCouponsForSelection(deps, tenantId, '2026-06-01');
    expect(result.map((c) => c.code)).toEqual(['A']);
  });

  it('選択用一覧は対象日が有効期間外のものを除く', async () => {
    await coupons.create(amountCoupon({ code: 'FUTURE', validFrom: '2027-01-01', validTo: null }));
    await coupons.create(amountCoupon({ code: 'PAST', validFrom: null, validTo: '2025-12-31' }));
    await coupons.create(amountCoupon({ code: 'CURRENT', validFrom: '2026-01-01', validTo: '2026-12-31' }));

    const result = await listCouponsForSelection(deps, tenantId, '2026-06-01');
    expect(result.map((c) => c.code)).toEqual(['CURRENT']);
  });
});

describe('resolveCouponRedemptionSnapshots', () => {
  let deps: CouponDeps;
  let coupons: FakeCouponRepository;

  beforeEach(() => {
    coupons = new FakeCouponRepository();
    deps = { coupons };
  });

  it('active かつ有効期間内のクーポンはスナップショットに変換される', async () => {
    const created = await coupons.create(amountCoupon({ validFrom: '2026-01-01', validTo: '2026-12-31' }));

    const result = await resolveCouponRedemptionSnapshots(deps, tenantId, [created.id], '2026-06-01');
    expect(result).toEqual([
      { couponId: created.id, discountKind: 'amount', discountAmountYen: 500, discountPercent: null },
    ]);
  });

  it('存在しないクーポンIDは拒否される', async () => {
    await expect(
      resolveCouponRedemptionSnapshots(deps, tenantId, ['nonexistent'], '2026-06-01'),
    ).rejects.toThrow(/見つかりません/);
  });

  it('他テナントのクーポンIDは「見つからない」として拒否される(テナント越えを許さない)', async () => {
    const created = await coupons.create(amountCoupon({ tenantId: otherTenantId }));

    await expect(
      resolveCouponRedemptionSnapshots(deps, tenantId, [created.id], '2026-06-01'),
    ).rejects.toThrow(/見つかりません/);
  });

  it('active=falseのクーポンは拒否される', async () => {
    const created = await coupons.create(amountCoupon({ active: false }));

    await expect(
      resolveCouponRedemptionSnapshots(deps, tenantId, [created.id], '2026-06-01'),
    ).rejects.toThrow(/廃止/);
  });

  it('有効期間より前の対象日は拒否される', async () => {
    const created = await coupons.create(amountCoupon({ validFrom: '2026-07-01', validTo: null }));

    await expect(
      resolveCouponRedemptionSnapshots(deps, tenantId, [created.id], '2026-06-01'),
    ).rejects.toThrow(/有効期間/);
  });

  it('有効期間より後の対象日は拒否される', async () => {
    const created = await coupons.create(amountCoupon({ validFrom: null, validTo: '2026-01-31' }));

    await expect(
      resolveCouponRedemptionSnapshots(deps, tenantId, [created.id], '2026-06-01'),
    ).rejects.toThrow(/有効期間/);
  });

  it('同じクーポンIDが重複していても1件に畳まれる', async () => {
    const created = await coupons.create(amountCoupon());

    const result = await resolveCouponRedemptionSnapshots(
      deps,
      tenantId,
      [created.id, created.id],
      '2026-06-01',
    );
    expect(result).toHaveLength(1);
  });

  it('あとでマスタの割引額を変えても、既に作ったスナップショットは変わらない(スナップショットの目的そのもの)', async () => {
    const created = await coupons.create(amountCoupon());
    const [snapshot] = await resolveCouponRedemptionSnapshots(deps, tenantId, [created.id], '2026-06-01');

    // マスタを書き換える(管理者がクーポンの割引額を修正した想定)。
    await updateCoupon(deps, tenantId, created.id, { discountAmountYen: 1000 });

    // 既に取得済みのスナップショット自体は、その場でコピーした値なので当然動かない。
    expect(snapshot?.discountAmountYen).toBe(500);
    // 新しく解決すれば、新しい値が使われる(=過去の適用記録には波及しない設計であることの裏付け)。
    const [after] = await resolveCouponRedemptionSnapshots(deps, tenantId, [created.id], '2026-06-01');
    expect(after?.discountAmountYen).toBe(1000);
  });
});
