/**
 * 日付が変わったあとに、足りない日のデモデータを追い足す。
 *
 * デモデータはIndexedDBに残るため、初回に作った「今日」からしか履歴が伸びない。
 * 何日か空けてから開き直すと、今日の日報も出勤簿も無い(=過去のデータしか参照できない)
 * 状態になってしまう。そこで起動時と日付またぎのたびに、前回作り終えた日の翌日から
 * 「今日」までを、初回シードと同じ関数で埋める。
 *
 * 作るのは「デモが用意した架空データ」だけで、訪問者が入力した内容には触れない。
 * 出勤簿のように同じ日に1行しか持てないものは、既に行があれば必ず読み飛ばす。
 */

import type { Container } from '@katahimo/api';
import { normalizeEmailForIndex, updateCoupon, updateCustomerBirthday } from '@katahimo/core';
import type { DemoSeedState } from '../seedState';
import { DEMO_FIGURES, DEMO_STAFF, DEMO_TENANT } from './figures';
import { seedAttendanceForDate, seedReceiptsForDate, seedVisitsForDate } from './seedDays';
import {
  couponValidityWindow,
  DEMO_COUPON_CODES,
  HISTORY_DAYS,
  representativeBirthdayThisMonth,
  type SeedProgress,
} from './seedDemoData';
import { toJstDateIso, upcomingWeekDates } from './visitPlan';

const DAY_MS = 24 * 60 * 60 * 1000;

/** 「どこまで作ったか」の記録の読み書き。実体は packages/demo/src/seedState.ts(PGlite上のテーブル)。 */
export interface DemoSeedStateStore {
  read(): Promise<DemoSeedState | null>;
  write(state: DemoSeedState): Promise<void>;
}

export interface TopUpResult {
  /** 何かしら書き足したか(呼び出し側がIndexedDBへの書き出しを判断するために使う)。 */
  changed: boolean;
  /** 追い足した業務日('YYYY-MM-DD'、古い順)。 */
  addedDates: string[];
}

/** `from`(排他)から`to`(含む)までの日付を古い順に並べる。 */
function datesBetween(fromExclusive: string, toInclusive: string): string[] {
  const dates: string[] = [];
  const end = Date.parse(`${toInclusive}T00:00:00Z`);
  let cursor = Date.parse(`${fromExclusive}T00:00:00Z`) + DAY_MS;
  if (Number.isNaN(cursor) || Number.isNaN(end)) return dates;
  while (cursor <= end) {
    dates.push(new Date(cursor).toISOString().slice(0, 10));
    cursor += DAY_MS;
  }
  return dates;
}

/**
 * 記録テーブルが無かった時代のDB向けに、「どこまで作ったか」をデータそのものから推測する。
 *
 * 日報は顧客ごとにoccurredAt降順で引けるので、全世帯の先頭1件のうち最も新しい日を取る。
 * 1件も無ければ「昨日まで作った」ことにして、今日ぶんだけを作らせる。
 */
async function inferReportsThrough(
  container: Container,
  tenantId: string,
  customerIds: Iterable<string>,
  today: Date,
): Promise<string> {
  let newest: Date | null = null;
  for (const customerId of customerIds) {
    const [latest] = await container.dailyReports.listByCustomer(tenantId, customerId, null, 1);
    if (latest && (!newest || latest.occurredAt > newest)) newest = latest.occurredAt;
  }
  return newest ? toJstDateIso(newest) : toJstDateIso(new Date(today.getTime() - DAY_MS));
}

/** DEMO_STAFF に対応する実際のスタッフ行(メールアドレスで引く)。 */
async function loadDemoStaff(
  container: Container,
  tenantId: string,
): Promise<{ id: string; name: string }[]> {
  const staff: { id: string; name: string }[] = [];
  for (const demoStaff of DEMO_STAFF) {
    const found = await container.staff.findByEmail(tenantId, normalizeEmailForIndex(demoStaff.email));
    if (found) staff.push({ id: found.id, name: found.name });
  }
  return staff;
}

/**
 * 足りない日のデモデータを追い足す。2回目以降の起動時と、開いたまま日付をまたいだときに呼ぶ。
 *
 * @param customerIdByName 顧客名→ID(startDemoがDBから引き直したもの)
 */
export async function topUpDemoData(
  container: Container,
  store: DemoSeedStateStore,
  customerIdByName: ReadonlyMap<string, string>,
  onProgress: (progress: SeedProgress) => void = () => {},
): Promise<TopUpResult> {
  const today = new Date();
  const todayIso = toJstDateIso(today);
  const todayMonth = todayIso.slice(0, 7);

  const tenant = await container.tenants.findBySlug(DEMO_TENANT.slug);
  if (!tenant) throw new Error('デモ事業所が見つかりません。データをリセットしてください。');

  const staff = await loadDemoStaff(container, tenant.id);
  const admin = staff[0];
  if (!admin) throw new Error('デモ用スタッフが見つかりません。データをリセットしてください。');

  const stored = await store.read();
  const state: DemoSeedState = stored ?? {
    reportsThrough: await inferReportsThrough(container, tenant.id, customerIdByName.values(), today),
    // 記録が無いDBは、初回シードを流した日(=推測した最終日)の月に領収書と誕生月を
    // 合わせてあるはず。下でその月と「今月」を比べて、変わっていれば作り直す。
    receiptsMonth: '',
    birthdayMonth: '',
  };
  if (!stored) {
    state.receiptsMonth = state.reportsThrough.slice(0, 7);
    state.birthdayMonth = state.reportsThrough.slice(0, 7);
  }

  // 何か月も空けてから開き直された場合に、間の全日を作り直すと初回シードより長く待たせる。
  // 履歴の見え方に必要なのは直近ぶんなので、初回シードと同じ日数で頭を切る。
  const allMissing = datesBetween(state.reportsThrough, todayIso);
  const missingDates = allMissing.slice(-HISTORY_DAYS);

  const dayContext = {
    tenantId: tenant.id,
    adminStaffId: admin.id,
    adminStaffName: admin.name,
    customerIdByName,
  };

  for (const [index, businessDate] of missingDates.entries()) {
    onProgress({
      message: `${missingDates.length}日ぶんのデモデータを追加しています… (${index + 1}/${missingDates.length})`,
      ratio: 0.8 + (0.15 * (index + 1)) / missingDates.length,
    });
    await seedVisitsForDate(container, dayContext, businessDate, { today });
    for (const member of staff) {
      // 前回の起動で「今週ぶん」として先に作ってある日がある。訪問者が手を入れている
      // 可能性もあるため、行があれば必ずそのまま残す。
      await seedAttendanceForDate(container, tenant.id, member, businessDate, { skipExisting: true });
    }
  }

  // 週間表示は保存済みの出勤簿しか出せないので、今週の土曜までは先に埋めておく
  // (日付が変わって週をまたいだ場合、ここで新しい週のぶんが入る)。
  for (const businessDate of upcomingWeekDates(today)) {
    for (const member of staff) {
      await seedAttendanceForDate(container, tenant.id, member, businessDate, { skipExisting: true });
    }
  }

  // 領収書一覧は月単位。月が変わると空になってしまうので、その月ぶんを入れ直す。
  const receiptsAdded = state.receiptsMonth !== todayMonth;
  if (receiptsAdded) {
    onProgress({ message: '今月の領収書を追加しています…', ratio: 0.96 });
    await seedReceiptsForDate(container, dayContext, todayIso);
  }

  // 誕生月クーポンは「今月生まれ」の世帯にしか出ない。月が変わったら1世帯目の代表者の
  // 生年月日を今月に付け替えて、いつ開いても1件は選択肢に出る状態を保つ。
  const birthdayUpdated = state.birthdayMonth !== todayMonth;
  if (birthdayUpdated) {
    const firstFigure = DEMO_FIGURES[0];
    const firstCustomerId = firstFigure
      ? customerIdByName.get(`${firstFigure.familyName} ${firstFigure.givenName}`)
      : undefined;
    if (firstCustomerId) {
      await updateCustomerBirthday(
        container,
        tenant.id,
        firstCustomerId,
        representativeBirthdayThisMonth(today),
      );
    }
  }

  // 期間限定クーポンが切れたままだと「期限切れの campaign しか無いデモ」になる。
  const springExtended = await extendSpringCouponIfExpired(container, tenant.id, today, todayIso);

  await store.write({ reportsThrough: todayIso, receiptsMonth: todayMonth, birthdayMonth: todayMonth });

  return {
    changed: missingDates.length > 0 || receiptsAdded || birthdayUpdated || springExtended,
    addedDates: missingDates,
  };
}

/** 有効期限が切れている期間限定クーポン(SPRING10)の有効期間を、今日基準で引き直す。 */
async function extendSpringCouponIfExpired(
  container: Container,
  tenantId: string,
  today: Date,
  todayIso: string,
): Promise<boolean> {
  const coupons = await container.coupons.listAll(tenantId);
  const spring = coupons.find((coupon) => coupon.code === DEMO_COUPON_CODES.spring);
  if (!spring?.validTo || spring.validTo >= todayIso) return false;
  const validity = couponValidityWindow(today);
  const result = await updateCoupon(container, tenantId, spring.id, validity);
  return result.ok;
}
