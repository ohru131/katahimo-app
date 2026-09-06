import type { Container } from '@katahimo/api';
import {
  createCustomer,
  registerStaff,
  saveAccidentReport,
  saveAttendanceDay,
  saveDailyReport,
} from '@katahimo/core';
import { DEMO_FIGURES, DEMO_OFFICE, DEMO_STAFF, DEMO_TENANT } from './figures';
import { planVisitsForDate, recentBusinessDates, toJstDateIso, VISIT_SLOTS } from './visitPlan';

/**
 * 訪問履歴を作る期間(日)。
 *
 * 初回起動時間に直結する。1営業日あたり訪問2〜3件を本番と同じusecase経由で書くため、
 * 1日ぶん増やすたびに数百msかかる。日付を「今日」基準で毎回作り直す方針(=事前に作った
 * ダンプを配らない)を優先しているので、体感を保てる範囲で打ち止めにしている。
 * 勤怠タブが「先月ぶんも入っている」状態に見える程度は必要なので6週間。
 */
const HISTORY_DAYS = 42;

/** 何日に1回、事故報告(ヒヤリハット)を混ぜるか。 */
const ACCIDENT_EVERY_N_VISITS = 37;

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
}

function fullAddress(index: number): string {
  const figure = DEMO_FIGURES[index];
  if (!figure) throw new Error(`存在しないデモ世帯です: index=${index}`);
  return `${figure.prefecture}${figure.city}${figure.addressDetail}`;
}

/** 月齢から生年月日('YYYY-MM-DD')を作る。「今日」基準なので、いつ見ても年齢が古びない。 */
function birthDateFromAgeMonths(today: Date, ageMonths: number): string {
  const dob = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - ageMonths, 15));
  return dob.toISOString().slice(0, 10);
}

const VISIT_NOTES = [
  '室内遊びを中心に過ごしました。積み木を高く積むことに繰り返し挑戦していました。',
  '午前中は機嫌がよく、手遊び歌に合わせて体を動かしていました。',
  '食事の場面を見守りました。スプーンを自分で持とうとする様子が見られました。',
  '外気浴のため、玄関先まで一緒に出ました。風が強かったため短時間で切り上げています。',
  '絵本の読み聞かせを行いました。同じページを何度も指差して反応していました。',
  '午睡の寝つきについて保護者から相談があり、入眠前の環境づくりを一緒に確認しました。',
  '着替えの練習に取り組みました。袖を通すところまで自分でできていました。',
  '前回お伝えした遊びを継続されており、集中して取り組む時間が伸びていました。',
];

const ACCIDENT_NOTES = [
  '室内を歩行中にバランスを崩し、テーブルの角に肩をぶつけました。外傷はありません。',
  '積み木で遊んでいる際に指を挟みそうになりました。実際の受傷はありません。',
];

const WEATHER = ['晴れ', '曇り', '雨', '晴れ'];

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
      email: `${figure.familyNameKana.toLowerCase()}@demo.example.com`,
      phone: figure.phone,
      addressDetail: figure.addressDetail,
      city: figure.city,
      parkingArea: figure.parkingArea,
      parkingDetail: figure.parkingDetail,
      memo: figure.memo,
      latLng: `${figure.lat},${figure.lng}`,
      memberType: '定期利用',
      memberStatus: '有効',
      registeredAt: new Date(today.getTime() - 200 * 24 * 60 * 60 * 1000),
      familyMembers: figure.children.map((child) => ({
        name: `${figure.familyName} ${child.givenName}`,
        dob: birthDateFromAgeMonths(today, child.ageMonths),
        info: child.info,
      })),
    });
    customerIdByName.set(name, created.id);
    addressLatLng.set(address, { lat: figure.lat, lng: figure.lng });
  }

  const businessDates = recentBusinessDates(today, HISTORY_DAYS);
  let visitCounter = 0;

  for (const [dateIndex, businessDate] of businessDates.entries()) {
    onProgress({
      message: `訪問履歴を作成しています… (${dateIndex + 1}/${businessDates.length}日)`,
      ratio: 0.45 + (0.5 * (dateIndex + 1)) / businessDates.length,
    });

    const visits = planVisitsForDate(businessDate, adminStaffName, DEMO_FIGURES.length);
    if (visits.length === 0) continue;

    for (const visit of visits) {
      const figure = DEMO_FIGURES[visit.figureIndex];
      if (!figure) continue;
      const customerId = customerIdByName.get(`${figure.familyName} ${figure.givenName}`);
      if (!customerId) continue;

      visitCounter++;
      const note = VISIT_NOTES[visitCounter % VISIT_NOTES.length] ?? VISIT_NOTES[0] ?? '';

      await saveDailyReport(container, tenant.id, {
        staffId: adminStaffId,
        customerId,
        reportDate: businessDate,
        startTime: visit.start,
        endTime: visit.end,
        inputText: note,
        internalText: `【訪問時間】${visit.start}〜${visit.end}\n【記録】${note}`,
        customerText: `本日は${visit.start}〜${visit.end}でご訪問しました。${note}`,
        riskRating: (visitCounter % 5) + 1,
        esRating: (visitCounter % 4) + 2,
      });

      if (visitCounter % ACCIDENT_EVERY_N_VISITS === 0) {
        const child = figure.children[0];
        const accidentNote = ACCIDENT_NOTES[visitCounter % ACCIDENT_NOTES.length] ?? ACCIDENT_NOTES[0] ?? '';
        await saveAccidentReport(container, tenant.id, {
          staffId: adminStaffId,
          customerId,
          reportType: 'ヒヤリハット',
          targetName: child ? `${figure.familyName} ${child.givenName}` : `${figure.familyName} 様`,
          targetDob: child ? birthDateFromAgeMonths(today, child.ageMonths) : '',
          occurrenceTime: `${businessDate} ${visit.start}`,
          location: '訪問先ご自宅内',
          accidentContent: accidentNote,
          situation: '室内で遊んでいる最中に発生しました。',
          immediateResponse: '直ちに状態を確認し、痛みや腫れがないことを保護者と一緒に確認しました。',
          parentCorrespondence: 'その場で状況をご説明し、ご了承をいただいています。',
          diagnosisTreatment: '外傷なし。受診は不要と判断しました。',
          prevention: '遊び始める前に動線上の家具の位置を確認します。',
          inputText: accidentNote,
        });
      }
    }

    await saveAttendanceDay(
      container,
      tenant.id,
      adminStaffId,
      businessDate,
      buildAttendanceRow(visits, dateIndex),
    );
  }

  onProgress({ message: '仕上げ中…', ratio: 1 });
  return { tenantId: tenant.id, customerIdByName, addressLatLng };
}

/** 出勤簿1日分の入力列。列記号の意味は AttendanceRowData のコメント参照。 */
function buildAttendanceRow(
  visits: ReturnType<typeof planVisitsForDate>,
  dateIndex: number,
): Record<string, string> {
  const nameOf = (i: number): string => {
    const visit = visits[i];
    if (!visit) return '';
    const figure = DEMO_FIGURES[visit.figureIndex];
    return figure ? `${figure.familyName} ${figure.givenName}` : '';
  };
  const slot = (i: number): { start: string; end: string } => visits[i] ?? VISIT_SLOTS[0];
  const weather = (i: number): string => WEATHER[(dateIndex + i) % WEATHER.length] ?? '晴れ';

  return {
    C: nameOf(0),
    D: slot(0).start,
    E: slot(0).end,
    H: '35',
    I: weather(0),
    L: nameOf(1),
    M: slot(1).start,
    N: slot(1).end,
    Q: '30',
    R: weather(1),
    U: nameOf(2),
    V: slot(2).start,
    W: slot(2).end,
    X: '記録作成',
    Y: '17:15',
    Z: '17:45',
    AG: '12.4',
    AH: '9.8',
    AI: '7.2',
    AJ: '15.1',
    AO: dateIndex % 9 === 0 ? '道路工事による渋滞あり' : '',
  };
}

/** 今日の日付(JST)。デモ画面の初期表示に使う。 */
export function todayIso(): string {
  return toJstDateIso(new Date());
}
