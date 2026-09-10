import type { AttendanceRowData } from './types';

export type ScheduleEventType = 'CUSTOMER APPOINTMENT' | 'OFFICE WORK';

/**
 * どの枠のイベントかを、配列の種類と添字で表す。doc/14 B項の段階1で訪問・事務作業が
 * 固定5枠(slot1〜3, office1〜2)から配列になったことに合わせ、'slot1'のような固定キーではなく
 * { kind, index } にした(配列にすることで枠の上限が外れる、というAttendanceRowData側の変更と
 * 整合させるため。indexは0始まり)。
 */
export interface ScheduleEventSlot {
  kind: 'visit' | 'office';
  index: number;
}

export interface ScheduleEvent {
  date: string;
  slot: ScheduleEventSlot;
  title: string;
  eventType: ScheduleEventType;
  start: string;
  end: string;
}

/**
 * 出勤簿1日分のrowData(入力列)を、週間予定UI表示用のイベント配列に変換する。
 * 始業・終業が両方入力されているスロットのみイベント化する。
 *
 * 移植元: gas-childcare-visit-app/PastSchedule.js の buildScheduleEventsFromRowData_。
 * 実際のGoogleカレンダーからではなく、出勤簿(このアプリではattendance_days)の記録内容を
 * そのままカレンダー風に色分け表示しているだけ、という点がGAS版の設計のポイント
 * (「カレンダーから取得」ボタンで初めてGoogleカレンダー側の内容を取り込む、閲覧とは別の操作)。
 * そのためGoogle Calendar連携(Phase 5)が無くても、この週間表示自体は動く。
 */
export function buildScheduleEventsFromRowData(dateStr: string, rowData: AttendanceRowData): ScheduleEvent[] {
  const events: ScheduleEvent[] = [];

  (rowData.visits ?? []).forEach((visit, index) => {
    if (!visit.start || !visit.end) return;
    events.push({
      date: dateStr,
      slot: { kind: 'visit', index },
      title: visit.place || '',
      eventType: 'CUSTOMER APPOINTMENT',
      start: visit.start,
      end: visit.end,
    });
  });

  (rowData.officeWork ?? []).forEach((work, index) => {
    if (!work.start || !work.end) return;
    events.push({
      date: dateStr,
      slot: { kind: 'office', index },
      title: work.name || '',
      eventType: 'OFFICE WORK',
      start: work.start,
      end: work.end,
    });
  });

  return events;
}
