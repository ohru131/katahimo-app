// ==========================================
// 環境依存の設定値(スプレッドシートID/GID・DriveフォルダID)を1箇所に集約したファイル。
// 別のGoogle Workspace環境へ移行する際は、このファイルのIDだけを書き換えれば良い
// (シート名・タブ名などデータ構造に紐づく定数は、これまで通り各機能ファイル側に置く。
// ここに集約するのは環境をまたぐと必ず作り直しが必要になるIDのみ。2026-08-18集約)。
//
// 以前は6ファイルにIDが分散しており(Auth.js/CsvImport.js/Logging.js/Main.js/
// PastSchedule.js/RouteSearch.js)、CUSTOMER_CSV_FOLDER_IDは
// AUTO_CSV_FOLDER_ID(CsvImport.js)/ROUTE_SEARCH_CUSTOMER_FOLDER_ID(RouteSearch.js)
// という別名で同じフォルダIDが2箇所に重複定義されていた。ここで1本化した。
// ==========================================

// --- スプレッドシート ---
const SPREADSHEET_ID = '1Y0ciyR4LHwCPwIkcuqwhQnD9k_-WBHn0nnwNRzFaacM'; // 本アプリのメインDB(顧客DB・日報・事故報告等)。Main.js
const STAFF_SS_ID = "1exqD69qZqACm9KOUPpa0fVWRYD2qEZfce7I6TOs_VDk"; // スタッフ台帳(ログイン認証にも使用)。Auth.js/PastSchedule.js/RouteSearch.js
const STAFF_GID = 2002628493; // スタッフ台帳シートのGID。同上
const TARGET_GID = 1224762512; // 現状未使用
const IMAGE_LOG_SS_ID = '18tkd37ck6fmhPMc_Ep1YEs4FXjB2HqXgMRfm0oJlkWI'; // 領収書ログ。Main.js/PastSchedule.js

// --- Driveフォルダ ---
const RECEIPT_FOLDER_ID = '1fruKZdH4gigbUB54VOrvYDa31cotVSdD'; // 領収書画像の保存先。Main.js
const CUSTOMER_CSV_FOLDER_ID = '1wLjR6iZ447tbUa3ff59bejoM5aXh8clC'; // 顧客CSVの自動取込元。CsvImport.js/RouteSearch.js(住所取得用に同じCSVを読む)
const PAST_SCHEDULE_ATTENDANCE_ROOT_FOLDER_ID = '1oj-bY5E0COF6KzeU38ka2gcZNBAUejUe'; // 個別出勤簿スプレッドシート群の親フォルダ。PastSchedule.js
const ROUTE_SEARCH_ATTENDANCE_FOLDER_ID = '1FA2aSBddgBakETEbzJhJIx1vWG06P46J'; // 「勤怠集計」ファイルの保存先(gas-childcare-daily-reportと共通)。RouteSearch.js
const LOG_FOLDER_ID = "1XyxzS8PMlOBIPU6NUbJbytZP0-_Kfx4-"; // ログCSVの保存先(gas-childcare-reportと共通)。Logging.js
