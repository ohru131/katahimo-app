/**
 * 日報/事故報告の本文(content)の中身。GAS版の「日報」「事故報告」シートの列のうち、
 * occurredAt・riskRating・esRating・reportType以外(=自由記述)をここにまとめる。
 * DB上は daily_reports/accident_reports テーブルの項目ごとの平文 text 列として保存する
 * (各フィールドが列と1:1に対応。SQLでの検索・集計・全文検索をそのまま行うため)。
 */
/**
 * doc/14 §6: 開始/終了時刻はDailyReportRecord/NewDailyReportInputの側(startedAt/endedAt。
 * riskRating/esRatingと同じ並び)に持つ。文字列'HH:mm'のまま項目別列にしていた頃はここに
 * あったが、NULLを「未入力」として使える型にするため、自由記述の本文とは別枠にした。
 */
export interface DailyReportContent {
  /** 保育日報のメモ(口語入力。AI生成前の元テキスト)。GAS版のInputText列。 */
  inputText: string;
  /** 社内向けレポート本文。GAS版のInternalReport列。 */
  internalText: string;
  /** 保護者向けレポート本文。GAS版のCustomerReport列。 */
  customerText: string;
}

export interface AccidentReportContent {
  /** 対象児(世帯構成員)の氏名。GAS版のTargetName列。 */
  targetName: string;
  /** 対象児の生年月日(parseDateOnlyで解析できた場合のみ。'YYYY-MM-DD')。doc/14 §6。 */
  targetDobDate: string | null;
  /** 対象児の生年月日の元表記('yyyy/MM/dd'。GAS版のTargetDob列)。常に保持する。 */
  targetDobRaw: string;
  occurrenceTime: string;
  location: string;
  accidentContent: string;
  situation: string;
  immediateResponse: string;
  parentCorrespondence: string;
  diagnosisTreatment: string;
  prevention: string;
  /** 元のメモ(口語入力)。GAS版のOriginalInput列。 */
  inputText: string;
}
