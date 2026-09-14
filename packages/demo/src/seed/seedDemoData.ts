import type { Container } from '@katahimo/api';
import {
  assignCouponToCustomer,
  createCoupon,
  createCustomer,
  registerStaff,
  updateFamilyMemberAllergy,
} from '@katahimo/core';
import { DEMO_FIGURES, DEMO_OFFICE, DEMO_STAFF, DEMO_TENANT } from './figures';
import {
  birthDateFromAgeMonths,
  type DemoDayContext,
  seedAttendanceForDate,
  seedReceiptsForDate,
  seedVisitsForDate,
} from './seedDays';
import { recentBusinessDates, toJstDateIso, upcomingWeekDates } from './visitPlan';

/**
 * 訪問履歴を作る期間(日)。
 *
 * 初回起動時間に直結する。1営業日あたり訪問2〜3件を本番と同じusecase経由で書くため、
 * 1日ぶん増やすたびに数百msかかる。日付を「今日」基準で毎回作り直す方針(=事前に作った
 * ダンプを配らない)を優先しているので、体感を保てる範囲で打ち止めにしている。
 * 勤怠タブが「先月ぶんも入っている」状態に見える程度は必要なので6週間。
 */
export const HISTORY_DAYS = 42;

/**
 * 期間限定クーポン(SPRING10)の有効期間を「今日」の前後何日に置くか。
 *
 * 訪問履歴はHISTORY_DAYSぶん遡って作るため、それより広く取って期間外エラーで
 * シードそのものが失敗しないようにする。日付が変わったあとの追い足し
 * (topUpDemoData.ts)も同じ幅で引き直す。
 */
export const COUPON_VALIDITY_DAYS = 60;

/** テナント内で一意なクーポンコード。追い足し側が引き直すためにここを正とする。 */
export const DEMO_COUPON_CODES = {
  welcome: 'WELCOME500',
  spring: 'SPRING10',
  birthday: 'BIRTHDAY10',
  thanks: 'THANKS1000',
} as const;

export interface SeedProgress {
  /** 画面に出す進捗メッセージ。 */
  message: string;
  ratio: number;
}

export interface SeededDemo {
  tenantId: string;
  /** 予定タブが顧客IDを引くための対応表。 */
  customerIdByName: Map<string, string>;
  /** ジオコーディングのデモ実装が使う住所→緯度経度。 */
  addressLatLng: Map<string, { lat: number; lng: number }>;
  /**
   * 訪問履歴を作り終えた最後の業務日('YYYY-MM-DD')。
   *
   * 呼び出し側が `new Date()` を取り直して記録すると、シード中にJSTの日付をまたいだ場合に
   * 「作っていない日を作り終えたことにする」ズレが生まれる(その日は追い足しからも漏れる)。
   * 実際に使った日付をそのまま返す。
   */
  generatedThrough: string;
}

/** 市区町村と番地以下を、顧客一覧の表示と同じ並びで1本の住所文字列にする。 */
function fullAddress(index: number): string {
  const figure = DEMO_FIGURES[index];
  if (!figure) throw new Error(`存在しないデモ世帯です: index=${index}`);
  return `${figure.prefecture}${figure.city}${figure.addressDetail}`;
}

/**
 * 世帯代表者の生年月日を「今月」で作る('YYYY/M/D' の手入力と同じ表記)。年は固定で構わない
 * (誕生月クーポンは年を見ず月だけで判定するため。usecases/coupons.tsのfindBirthdayPerson)。
 *
 * 月が変わったあともデモに誕生月クーポンが出るよう、追い足し(topUpDemoData.ts)が
 * 同じ関数で引き直して顧客の生年月日を更新する。
 */
export function representativeBirthdayThisMonth(today: Date): string {
  // UTCの月ではなくJSTの月を使う。月初/月末の日本時間の夜はUTCではまだ前月で、
  // そのまま使うと「今月生まれ」のつもりが先月生まれになり、誕生月クーポンがデモに出ない。
  const jstMonth = Number(toJstDateIso(today).slice(5, 7));
  return `1990/${jstMonth}/15`;
}

/** 「今日」を基準にした期間限定クーポンの有効期間。 */
export function couponValidityWindow(today: Date): { validFrom: string; validTo: string } {
  const dayMs = 24 * 60 * 60 * 1000;
  return {
    validFrom: toJstDateIso(new Date(today.getTime() - COUPON_VALIDITY_DAYS * dayMs)),
    validTo: toJstDateIso(new Date(today.getTime() + COUPON_VALIDITY_DAYS * dayMs)),
  };
}

/**
 * デモ用のデータを一式投入する。
 *
 * 重要なのは「全て本番のusecase経由で作る」こと。SQLを直接流し込むほうが速いが、
 * それだと暗号化・ブラインドインデックス・outbox登録といった本番の処理を通らず、
 * デモが本番と違う挙動をしてしまう(そして本番側が壊れても気付けない)。
 */
export async function seedDemoData(
  container: Container,
  onProgress: (progress: SeedProgress) => void,
): Promise<SeededDemo> {
  const today = new Date();

  onProgress({ message: 'デモ事業所を作成しています…', ratio: 0.05 });
  const tenant = await container.tenants.create({ name: DEMO_TENANT.name, slug: DEMO_TENANT.slug });

  onProgress({ message: 'スタッフを登録しています…', ratio: 0.1 });
  const staffIds: string[] = [];
  for (const staff of DEMO_STAFF) {
    const created = await registerStaff(container, {
      tenantId: tenant.id,
      name: staff.name,
      email: staff.email,
      password: staff.password,
      isAdmin: staff.isAdmin,
    });
    staffIds.push(created.id);
  }
  const adminStaffId = staffIds[0];
  if (!adminStaffId) throw new Error('デモ用スタッフの作成に失敗しました');
  const adminStaffName = DEMO_STAFF[0].name;

  // 割引クーポン(doc/db/guidelines.md §9)。デモを開いた人が「クーポン管理」画面と、日報タブの
  // クーポン選択の両方をすぐ触れるよう、金額引き/率引き・無期限/有効期間ありを1つずつ混ぜる。
  onProgress({ message: 'クーポンを登録しています…', ratio: 0.1 });
  const welcomeCoupon = await createCoupon(container, tenant.id, {
    code: DEMO_COUPON_CODES.welcome,
    name: '紹介キャンペーン 500円引き',
    discountKind: 'amount',
    discountAmountYen: 500,
    note: 'ご友人・ご家族からのご紹介で初回のご利用に適用',
  });
  if (!welcomeCoupon.ok) throw new Error(`デモ用クーポンの登録に失敗しました(${welcomeCoupon.reason})`);

  // 有効期間ありのクーポンも1件混ぜる。有効期間は履歴の範囲(HISTORY_DAYS)より広く取る。
  const validity = couponValidityWindow(today);
  const springCoupon = await createCoupon(container, tenant.id, {
    code: DEMO_COUPON_CODES.spring,
    name: '春のキャンペーン 10%引き',
    discountKind: 'percent',
    discountPercent: 10,
    validFrom: validity.validFrom,
    validTo: validity.validTo,
    note: '期間限定キャンペーン',
  });
  if (!springCoupon.ok) throw new Error(`デモ用クーポンの登録に失敗しました(${springCoupon.reason})`);

  // 誕生月クーポン(doc/db/guidelines.md §9)。日報タブのクーポン選択に「🎂 ○○さんの誕生月」として
  // 出るのは、世帯代表またはお子さまの誕生月に当たる世帯だけになる。下で1世帯目の代表者に
  // 「今月」の生年月日を入れてあるので、デモをいつ開いてもこの動きを1件は見られる。
  const birthdayCoupon = await createCoupon(container, tenant.id, {
    code: DEMO_COUPON_CODES.birthday,
    name: 'お誕生月 10%引き',
    discountKind: 'percent',
    discountPercent: 10,
    eligibilityKind: 'birthday_month',
    birthdaySubject: 'any',
    usageLimitKind: 'once_per_customer_per_year',
    note: '世帯代表またはお子さまの誕生月に、年1回ご利用いただけます',
  });
  if (!birthdayCoupon.ok) throw new Error(`デモ用クーポンの登録に失敗しました(${birthdayCoupon.reason})`);

  // 顧客ごとに配るクーポン。配っていない世帯では日報タブの選択肢に出ない
  // (顧客カルテの「クーポン」から配ると出てくる)。
  const thankYouCoupon = await createCoupon(container, tenant.id, {
    code: DEMO_COUPON_CODES.thanks,
    name: '長期ご利用のお礼 1000円引き',
    discountKind: 'amount',
    discountAmountYen: 1000,
    audience: 'assigned',
    usageLimitKind: 'once_per_customer',
    note: '対象の世帯にのみ配布。1回限り',
  });
  if (!thankYouCoupon.ok) throw new Error(`デモ用クーポンの登録に失敗しました(${thankYouCoupon.reason})`);

  const customerIdByName = new Map<string, string>();
  const addressLatLng = new Map<string, { lat: number; lng: number }>();
  addressLatLng.set(DEMO_OFFICE.address, { lat: DEMO_OFFICE.lat, lng: DEMO_OFFICE.lng });

  for (const [index, figure] of DEMO_FIGURES.entries()) {
    onProgress({
      message: `訪問先を登録しています… (${index + 1}/${DEMO_FIGURES.length})`,
      ratio: 0.1 + (0.35 * (index + 1)) / DEMO_FIGURES.length,
    });
    const name = `${figure.familyName} ${figure.givenName}`;
    const address = fullAddress(index);
    const created = await createCustomer(container, {
      tenantId: tenant.id,
      name,
      familyName: figure.familyName,
      givenName: figure.givenName,
      familyNameKana: figure.familyNameKana,
      givenNameKana: figure.givenNameKana,
      // カナをそのまま使うと `オダ@demo.example.com` のような非ASCIIのアドレスになり、
      // 顧客詳細のmailto:リンクが壊れる。ローマ字のslugを使う。
      email: `${figure.slug}@demo.example.com`,
      phone: figure.phone,
      addressDetail: figure.addressDetail,
      city: figure.city,
      parkingArea: figure.parkingArea,
      parkingDetail: figure.parkingDetail,
      memo: figure.memo,
      latLng: `${figure.lat},${figure.lng}`,
      memberType: '定期利用',
      memberStatus: '有効',
      // 1世帯目の代表者だけ「今月」生まれにして、誕生月クーポン(BIRTHDAY10)がデモを
      // いつ開いても1件は選択肢に出るようにする。他の世帯は未登録のまま残し、
      // 「生年月日が入っていない世帯では誕生月クーポンが出ない」ことも同時に見せる。
      dob: index === 0 ? representativeBirthdayThisMonth(today) : undefined,
      registeredAt: new Date(today.getTime() - 200 * 24 * 60 * 60 * 1000),
      familyMembers: figure.children.map((child) => ({
        name: `${figure.familyName} ${child.givenName}`,
        dob: birthDateFromAgeMonths(today, child.ageMonths),
        info: child.info,
      })),
    });
    customerIdByName.set(name, created.id);

    // アレルギーは createCustomer では入らない(取込で消さないよう、常に未確認から始める)。
    // デモでは「あり」「なし」「未確認」が並んで見えるよう、作成後に聞き取り済みの子だけ埋める。
    const savedChildren = await container.familyMembers.listByCustomerId(tenant.id, created.id);
    for (const child of figure.children) {
      if (!child.allergy) continue;
      const saved = savedChildren.find((m) => m.name === `${figure.familyName} ${child.givenName}`);
      if (!saved) continue;
      await updateFamilyMemberAllergy(container, tenant.id, created.id, saved.id, child.allergy);
    }
    addressLatLng.set(address, { lat: figure.lat, lng: figure.lng });

    // 配布型クーポンは1世帯目にだけ配る(顧客カルテの「クーポン」で配布状況を見られる)。
    if (index === 0) {
      const assigned = await assignCouponToCustomer(container, tenant.id, created.id, {
        couponId: thankYouCoupon.couponId,
      });
      if (!assigned.ok) throw new Error(`デモ用クーポンの配布に失敗しました(${assigned.reason})`);
    }
  }

  const dayContext: DemoDayContext = {
    tenantId: tenant.id,
    adminStaffId,
    adminStaffName,
    customerIdByName,
  };

  // 今日ぶんも入れる。「今日の訪問がまだ1件も無い」状態でデモが始まると、
  // 予定タブに出ている今日の予定と履歴が食い違って見える。
  const businessDates = [...recentBusinessDates(today, HISTORY_DAYS), toJstDateIso(today)];

  for (const [dateIndex, businessDate] of businessDates.entries()) {
    onProgress({
      message: `訪問履歴を作成しています… (${dateIndex + 1}/${businessDates.length}日)`,
      ratio: 0.45 + (0.4 * (dateIndex + 1)) / businessDates.length,
    });
    await seedVisitsForDate(container, dayContext, businessDate, {
      today,
      // 最初の1日の1件目にだけ適用しておく(doc/db/guidelines.md §9の適用記録表示が、デモでは常に空という
      // 状態にならないように)。2件とも渡すことで「1回の訪問に複数のクーポンを適用できる」
      // ことも合わせて示す。
      couponIds: dateIndex === 0 ? [welcomeCoupon.couponId, springCoupon.couponId] : undefined,
    });
  }

  // 出勤簿はスタッフ全員ぶん作る。管理者ぶんだけだと、スタッフのアカウントで
  // ログインしたときに勤怠タブが空になる。日報と違って1日1件なので安く済む。
  //
  // 未来の日付も今週の土曜まで入れる。週間表示は保存済みの出勤簿しか出せないため、
  // 過去だけだと今週が埋まらない(日曜にアクセスすると1件も出ない)。
  const attendanceDates = [...businessDates, ...upcomingWeekDates(today)];
  for (const [staffIndex, staffId] of staffIds.entries()) {
    const staffName = DEMO_STAFF[staffIndex]?.name;
    if (!staffName) continue;
    onProgress({
      message: `出勤簿を作成しています… (${staffIndex + 1}/${staffIds.length}人)`,
      ratio: 0.85 + (0.14 * (staffIndex + 1)) / staffIds.length,
    });
    for (const businessDate of attendanceDates) {
      // 予定タブと同じ純関数から引くので、出勤簿の訪問先と予定が一致する。
      await seedAttendanceForDate(container, tenant.id, { id: staffId, name: staffName }, businessDate);
    }
  }

  // 領収書(doc/db/guidelines.md §10)。勤怠タブの「🧾 領収書」を開いたときに一覧が空にならないよう、
  // 今月ぶんを何枚か入れておく。
  onProgress({ message: '領収書を登録しています…', ratio: 0.95 });
  await seedReceiptsForDate(container, dayContext, toJstDateIso(today));

  onProgress({ message: '仕上げ中…', ratio: 1 });
  return { tenantId: tenant.id, customerIdByName, addressLatLng, generatedThrough: toJstDateIso(today) };
}
