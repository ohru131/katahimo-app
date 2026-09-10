/**
 * カレンダー連携のポート。
 *
 * GAS版は CalendarApp.getAllCalendars() で「デプロイユーザーが見られる全カレンダー」を
 * 横断していたが、サーバー実装には等価なAPIがない。新設計では「どのカレンダーを読むか」を
 * 呼び出し側(スタッフに紐づく calendar_id)が明示する。
 *
 * **このポートには実装が無く、まだどこからも使っていない**。予定の閲覧は SchedulePort
 * (GAS版のカレンダー解析・ルート計算をBridge.js経由でそのまま使う)が担っており、書き込み
 * (createEvent/updateEvent/deleteEvent)については移行元に相当する処理が存在しない
 * ── GAS版はカレンダーを読むだけで一度も書き込んでいない(RouteSearch.js の CalendarApp
 * 呼び出しは getEvents/getMyStatus のみ)。予定の作り手はRESERVAの予約連携とスタッフの
 * 手動操作であり、新システムから書き戻す先が無いため、ミラーの種別からも外している
 * (./mirror.ts の MirrorKind 参照)。カレンダーを新システム側で編集する要件が出たときの
 * 置き場所として型だけ残してある。
 */
export interface CalendarEventInput {
  title: string;
  description: string;
  location: string;
  /** ISO8601(タイムゾーン付き) */
  startsAt: string;
  endsAt: string;
}

export interface ExternalCalendarEvent extends CalendarEventInput {
  /** カレンダー提供元のイベントID。external_ids で内部IDと対応付ける。 */
  externalEventId: string;
  /** イベントが載っていたカレンダーのID(＝どのスタッフの予定か) */
  calendarId: string;
  /** ゲストの表示名(なければメールアドレス) */
  guestNames: string[];
  /** このカレンダーの持ち主がこの予定を辞退しているか */
  declinedByOwner: boolean;
}

export interface CalendarPort {
  /** 指定カレンダーの、指定日(JST)の予定を取得する。 */
  listEventsForDate(calendarId: string, businessDate: string): Promise<ExternalCalendarEvent[]>;
  createEvent(calendarId: string, input: CalendarEventInput): Promise<string>;
  updateEvent(calendarId: string, externalEventId: string, input: CalendarEventInput): Promise<void>;
  deleteEvent(calendarId: string, externalEventId: string): Promise<void>;
}
