/**
 * outboxから取り出したミラージョブ1件を、実際にGoogleスプレッドシート/Driveへ反映するポート。
 *
 * MirrorPort(./mirror.ts)が「積む」側なのに対し、こちらは「送る」側。ペイロードは
 * ワーカー側のusecase(usecases/mirrorWorker.ts)がDBから最新値を読み直し・復号・
 * スタッフ/顧客名の解決まで済ませた後の、GAS側の列にそのまま書き込める形にしてある
 * (GAS側の分類・整形ロジックをこちらで再実装しないため)。
 *
 * 実装は@katahimo/integrationsに置く(GasBridgeMirrorSenderPort、gas-childcare-visit-appの
 * Bridge.jsへPOSTする)。GAS_BRIDGE_URL/SECRET未設定時はNoopMirrorSenderPort(何もしない)。
 */

export interface DailyReportMirrorPayload {
  /** GAS側「日報」シートに追加する非表示の追跡列(KatahimoReportId)。既存行があれば上書き、無ければ追記する。 */
  reportId: string;
  /** 'yyyy/MM/dd HH:mm:ss'(JST)。GAS版Timestamp列と同じ書式。 */
  timestampJst: string;
  startTime: string;
  endTime: string;
  staffName: string;
  customerId: string;
  customerName: string;
  inputText: string;
  internalText: string;
  customerText: string;
  riskRating: number | null;
  esRating: number | null;
}

export interface AccidentReportMirrorPayload {
  reportId: string;
  timestampJst: string;
  staffName: string;
  customerId: string;
  customerName: string;
  targetName: string;
  targetDob: string;
  occurrenceTime: string;
  location: string;
  accidentContent: string;
  situation: string;
  immediateResponse: string;
  parentCorrespondence: string;
  diagnosisTreatment: string;
  prevention: string;
  inputText: string;
  reportType: string;
}

export interface ReceiptMirrorPayload {
  staffName: string;
  customerId: string;
  customerName: string;
  /** 'yyyy/MM/dd HH:mm:ss'(JST)。OCR取得日時 or 登録時刻(GAS版processReceiptImagesと同じ)。 */
  receiptTimestampJst: string;
  amount: string;
  storeName: string;
  handoffText: string;
  /** data URL('data:image/jpeg;base64,...')。GAS版Driveアップロードにそのまま使う。 */
  imageDataUrl: string;
}

export interface AttendanceDayMirrorPayload {
  staffName: string;
  /** 'YYYY-MM-DD' */
  businessDate: string;
  /** PAST_SCHEDULE_INPUT_COLUMNSの列記号(C/D/E等)をキーにした入力値。 */
  values: Record<string, string>;
}

/**
 * 「勤怠集計」スプレッドシートの集約行。他の種別と違い**値を持たない**。
 *
 * 勤怠集計シートはkatahimo-appの入力値ではなく、Googleカレンダーの予定とMapsのルート計算から
 * 導かれる派生データで、1行=予定1件(種別・顧客名・開始/終了・移動時間・距離・各ルートURLの17列。
 * `RouteSearch.js` の `ATTENDANCE_SHEET_HEADER`)という形をしている。`attendance_days` が持つ
 * 出勤簿の入力列とは形も出自も違うため、DBの値を書き写すことができない。
 *
 * そのため、この種別だけは「GAS側に対象スタッフ・対象日の再計算をやり直させる」指示として送る
 * (Bridge.jsの`writeAttendanceAggregate`が`computeAttendanceRowDataForStaffOnDate_`で計算し、
 * `writeAttendanceAggregateRows_`で該当スタッフ・該当日の既存行を消してから書き直す。GAS版の
 * `refreshAttendanceForStaffOnDate`からセッション検証を除いたものと同じ)。個別出勤簿への
 * 書き込みは行わないため、`attendance_day` のミラーが書いた行を上書きすることはない。
 *
 * **1件ごとにMapsのルート計算(GASのMapsサービス)を消費する**。そのため既定では積まない
 * (`MIRROR_ATTENDANCE_AGGREGATE`。AttendanceDeps.mirrorAttendanceAggregate 参照)。
 */
export interface AttendanceAggregateMirrorPayload {
  staffName: string;
  /** 'YYYY-MM-DD' */
  businessDate: string;
}

export interface MirrorSenderPort {
  sendDailyReport(payload: DailyReportMirrorPayload): Promise<void>;
  sendAccidentReport(payload: AccidentReportMirrorPayload): Promise<void>;
  sendReceipt(payload: ReceiptMirrorPayload): Promise<void>;
  sendAttendanceDay(payload: AttendanceDayMirrorPayload): Promise<void>;
  sendAttendanceAggregate(payload: AttendanceAggregateMirrorPayload): Promise<void>;
}
