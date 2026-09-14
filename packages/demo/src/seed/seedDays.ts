/**
 * 「1日ぶんのデモデータ」を作る部品。
 *
 * 初回シード(seedDemoData.ts)と、日付が変わったあとの追い足し(topUpDemoData.ts)の
 * 両方から呼ぶ。同じ関数を通すことで、初回に作られた履歴と後から足された履歴が
 * 見た目も中身も食い違わない。
 *
 * ここに置く関数は「実行順に依存しない」こと。初回シードは通し番号(何件目の訪問か)で
 * 内容を振り分けていたが、追い足しでは通し番号を引き継げない(前回どこまで作ったかを
 * 覚えておく必要が出る)。そのため、振り分けの種は必ず業務日そのものから導出する。
 */

import type { Container } from '@katahimo/api';
import { saveAccidentReport, saveAttendanceDay, saveDailyReport, uploadReceipts } from '@katahimo/core';
import type { AttendanceRowData } from '@katahimo/shared';
import { MAX_MOVE_LEGS } from '@katahimo/shared';
import { DEMO_FIGURES } from './figures';
import { planVisitsForDate, toJstDateIso, VISIT_SLOTS } from './visitPlan';

/**
 * 何日に1回、事故報告(ヒヤリハット)を混ぜるか。
 *
 * 訪問の通し番号ではなく日数で判定する。土曜2件・日曜1件と枠数が日によって違うため、
 * 通し番号で判定すると「該当した番号がその日には存在しない枠だった」ことが起こり、
 * 履歴6週間ぶんを作っても事故報告が1件も入らない日並びが生まれうる。
 */
const ACCIDENT_EVERY_N_DAYS = 12;

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
 * デモ用の領収書画像(1x1の透明PNG)。実物の写真を同梱せずに「画像を見る」の導線まで
 * 確かめられるようにするための最小データ。
 */
const DEMO_RECEIPT_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/**
 * デモ用の領収書。金額が'よみとれず'の行は、OCRが数値にできなかった場合(amount_yenがnull)を
 * 再現する。一覧の合計は読めた分だけなので、その枚数が警告として出ることまで見せられる。
 */
export const DEMO_RECEIPTS: {
  time: string;
  amount: string;
  storeName: string;
  billingType: 'customer_billable' | 'company_expense';
  handoffText: string;
}[] = [
  {
    time: '10:30',
    amount: '1280',
    storeName: 'スーパーみどり',
    billingType: 'customer_billable',
    handoffText: 'おやつと飲み物を購入しました',
  },
  {
    time: '12:15',
    amount: '600',
    storeName: 'コインパーキング仙台駅前',
    billingType: 'company_expense',
    handoffText: '訪問先の駐車場代',
  },
  {
    time: '15:40',
    amount: '2450',
    storeName: 'ドラッグストアあおば',
    billingType: 'customer_billable',
    handoffText: 'おむつを買い足しました',
  },
  {
    time: '17:05',
    amount: 'よみとれず',
    storeName: '',
    billingType: 'company_expense',
    handoffText: 'レシートが薄く、金額を読み取れませんでした',
  },
];

/**
 * 1日ぶんのデータを書くのに必要な、日付に依らない情報。初回シードは自分で作った値を、
 * 追い足しはDBから引き直した値を渡す。
 */
export interface DemoDayContext {
  tenantId: string;
  adminStaffId: string;
  adminStaffName: string;
  /** 顧客名(「姓 名」)→ID。DEMO_FIGURESの並びと対応する。 */
  customerIdByName: ReadonlyMap<string, string>;
}

/** 'YYYY-MM-DD' をUTC基準の通し日数にする。日付から決定論的な種を作るための基準値。 */
export function dayNumber(dateIso: string): number {
  return Math.floor(Date.parse(`${dateIso}T00:00:00Z`) / 86_400_000);
}

/**
 * 訪問1件ごとの通し番号。業務日と訪問枠だけから決まるので、初回シードで作っても
 * 追い足しで作っても同じ日の同じ枠には同じ内容(記録文・評価・事故報告の有無)が入る。
 */
export function visitSequence(businessDate: string, slotIndex: number): number {
  return dayNumber(businessDate) * VISIT_SLOTS.length + slotIndex + 1;
}

/** 月齢から生年月日('YYYY-MM-DD')を作る。「今日」基準なので、いつ見ても年齢が古びない。 */
export function birthDateFromAgeMonths(today: Date, ageMonths: number): string {
  const dob = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - ageMonths, 15));
  return dob.toISOString().slice(0, 10);
}

/**
 * 1日ぶんの訪問(日報と、周期的に事故報告)を書く。
 *
 * @param couponIds その日の1件目に適用するクーポン。初回シードが「適用記録の表示が
 *   常に空にならないように」1日だけ渡す。
 */
export async function seedVisitsForDate(
  container: Container,
  ctx: DemoDayContext,
  businessDate: string,
  options: { couponIds?: string[]; today: Date } = { today: new Date() },
): Promise<void> {
  const visits = planVisitsForDate(businessDate, ctx.adminStaffName, DEMO_FIGURES.length);

  for (const [slotIndex, visit] of visits.entries()) {
    const figure = DEMO_FIGURES[visit.figureIndex];
    if (!figure) continue;
    const customerId = ctx.customerIdByName.get(`${figure.familyName} ${figure.givenName}`);
    if (!customerId) continue;

    const seq = visitSequence(businessDate, slotIndex);
    const note = VISIT_NOTES[seq % VISIT_NOTES.length] ?? VISIT_NOTES[0] ?? '';

    await saveDailyReport(container, ctx.tenantId, {
      staffId: ctx.adminStaffId,
      customerId,
      reportDate: businessDate,
      startTime: visit.start,
      endTime: visit.end,
      inputText: note,
      internalText: `【訪問時間】${visit.start}〜${visit.end}\n【記録】${note}`,
      customerText: `本日は${visit.start}〜${visit.end}でご訪問しました。${note}`,
      riskRating: (seq % 5) + 1,
      esRating: (seq % 4) + 2,
      couponIds: slotIndex === 0 ? options.couponIds : undefined,
    });

    // 必ず存在する1件目の枠に付ける(上のコメント参照)。
    if (slotIndex === 0 && dayNumber(businessDate) % ACCIDENT_EVERY_N_DAYS === 0) {
      const child = figure.children[0];
      const accidentNote = ACCIDENT_NOTES[seq % ACCIDENT_NOTES.length] ?? ACCIDENT_NOTES[0] ?? '';
      await saveAccidentReport(container, ctx.tenantId, {
        staffId: ctx.adminStaffId,
        customerId,
        reportType: 'ヒヤリハット',
        targetName: child ? `${figure.familyName} ${child.givenName}` : `${figure.familyName} 様`,
        targetDob: child ? birthDateFromAgeMonths(options.today, child.ageMonths) : '',
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
}

/**
 * 指定スタッフの出勤簿を1日ぶん書く。
 *
 * `skipExisting` を渡した場合、既に行がある日は触らない。追い足しは未来の日(今週ぶん)も
 * 対象にするため、これが無いと訪問者が編集した出勤簿を上書きしてしまう。
 */
export async function seedAttendanceForDate(
  container: Container,
  tenantId: string,
  staff: { id: string; name: string },
  businessDate: string,
  options: { skipExisting?: boolean } = {},
): Promise<void> {
  const visits = planVisitsForDate(businessDate, staff.name, DEMO_FIGURES.length);
  if (visits.length === 0) return;
  if (options.skipExisting) {
    const existing = await container.attendanceDays.findByStaffAndDate(tenantId, staff.id, businessDate);
    if (existing) return;
  }
  await saveAttendanceDay(
    container,
    tenantId,
    staff.id,
    businessDate,
    buildAttendanceRow(visits, businessDate),
  );
}

/**
 * 指定日の領収書を投入する(勤怠タブの「🧾 領収書」が月替わりで空にならないように)。
 * 請求区分の両方・顧客に紐付かない経費・OCRが金額を読めなかった場合の3つを混ぜる。
 */
export async function seedReceiptsForDate(
  container: Container,
  ctx: DemoDayContext,
  dateIso: string,
): Promise<void> {
  const firstFigure = DEMO_FIGURES[0];
  if (!firstFigure) return;
  const receiptCustomerId = ctx.customerIdByName.get(`${firstFigure.familyName} ${firstFigure.givenName}`);
  if (!receiptCustomerId) return;

  for (const receipt of DEMO_RECEIPTS) {
    await uploadReceipts(container, ctx.tenantId, {
      staffId: ctx.adminStaffId,
      // 駐車場代のような会社経費は顧客に紐付かない(customer_billableにはできない)。
      customerId: receipt.billingType === 'customer_billable' ? receiptCustomerId : null,
      images: [
        {
          data: DEMO_RECEIPT_IMAGE,
          amount: receipt.amount,
          storeName: receipt.storeName,
          billingType: receipt.billingType,
        },
      ],
      fallbackTimestamp: `${dateIso.replaceAll('-', '/')} ${receipt.time}:00`,
      handoffText: receipt.handoffText,
    });
  }
}

/** 今日の日付(JST)。デモ画面の初期表示に使う。 */
export function todayIso(): string {
  return toJstDateIso(new Date());
}

/** #1・#2訪問の「あとの移動」項目(MAX_MOVE_LEGS件目まで)。日ごとに値を変えて、月次の集計に多少の幅を持たせている。 */
const MOVE_AFTER_VISIT: ReadonlyArray<{ plannedMoveMin: number; distanceKm: number }> = [
  { plannedMoveMin: 35, distanceKm: 12.4 },
  { plannedMoveMin: 30, distanceKm: 9.8 },
];

/**
 * 出勤簿1日分。doc/14 §2の段階1で永続形式(row_data)が意味のあるキーの配列(visits/officeWork)
 * になったのに合わせている(以前は列記号C/D/E…をキーにしたオブジェクトだった)。
 *
 * visitsは「計画された件数ぶんだけ」作る。visitPlan.tsのvisitCountForDateは土曜2件・日曜1件を
 * 返すため、ここで常に3件分の枠を作ってしまうと、予定の無い枠にVISIT_SLOTS[0]の時刻だけが
 * 入った「幻の訪問」ができる(placeが空なのにstart/endだけ埋まり、
 * buildScheduleEventsFromRowDataが先頭訪問の時刻でイベントを出してしまう)。
 *
 * MAX_MOVE_LEGS件目より後の訪問(3件目)にはweatherAfter/plannedMoveMin/distanceKmを付けない
 * (attendanceRowDataSchema/columnRow.tsのコメント参照。元のスプレッドシートにも#3訪問の
 * 「あとの移動」を書く列は無く、付けるとtoColumnRowが例外を投げる)。
 */
export function buildAttendanceRow(
  visits: ReturnType<typeof planVisitsForDate>,
  businessDate: string,
): AttendanceRowData {
  // 天候・備考は業務日そのものから決める(初回シードでも追い足しでも同じ日は同じ内容になる)。
  const dayIndex = dayNumber(businessDate);
  const nameOf = (i: number): string => {
    const visit = visits[i];
    if (!visit) return '';
    const figure = DEMO_FIGURES[visit.figureIndex];
    return figure ? `${figure.familyName} ${figure.givenName}` : '';
  };
  const weather = (i: number): string => WEATHER[(dayIndex + i) % WEATHER.length] ?? '晴れ';
  const note = dayIndex % 9 === 0 ? '道路工事による渋滞あり' : undefined;

  return {
    visits: visits.map((visit, i) => {
      const move = i < MAX_MOVE_LEGS ? MOVE_AFTER_VISIT[i] : undefined;
      return {
        place: nameOf(i),
        start: visit.start,
        end: visit.end,
        ...(move
          ? { weatherAfter: weather(i), plannedMoveMin: move.plannedMoveMin, distanceKm: move.distanceKm }
          : {}),
      };
    }),
    officeWork: [{ name: '記録作成', start: '17:15', end: '17:45' }],
    commuteDistanceKm: 7.2,
    returnDistanceKm: 15.1,
    ...(note ? { note } : {}),
  };
}
