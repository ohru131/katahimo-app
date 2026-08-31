# gas-childcare-visit-app（保育訪問統合アプリ）

`01_GAS/gas-childcare-report` をベースに、他のGASプロジェクトの機能を段階的に統合するスタンドアロン型Webアプリです。

## 目的

ログインしたスタッフ本人向けに、以下を1つのアプリで完結させます。

- 今日・明日の訪問予定の確認（ルートサーチ含む）
- 過去の予定の確認・修正
- 訪問先（顧客）情報の確認
- 日報・事故報告の作成

## 統合方針

- **認証**: `gas-childcare-report` のメール＋パスワード＋トークン方式を継続（Googleアカウント認証は使わない）
- **アーキテクチャ**: `gas-childcare-report` と同じスタンドアロン型Webアプリ（`executeAs: USER_DEPLOYING`, `access: ANYONE_ANONYMOUS`）
- **データ**: `gas-childcare-report` と同一のスプレッドシート（顧客DB・スタッフDB・領収書ログ）を参照する。新しいスプレッドシートは作らない。
- **PoC匿名化モードは非搭載**: `gas-childcare-report` にあった個人情報匿名化(PoCモード)機能は移植していない。顧客データは常にそのまま表示する。
- **社内向け通知はGoogle Chat Webhookに一本化**: LineWorks連携は廃止し、日報・事故報告・訪問完了通知、および領収書登録通知はそれぞれ個別のGoogle Chat Webhookへ送信する。

## Stage 1（本コミットで実装済み）

`gas-childcare-report` の以下の機能を移植し(PoC匿名化モードを除く)、ホーム画面をタブ構成に再編しました。

- ログイン／セッション管理／パスワードリセット（`コード.js`: `verifyLogin`, `checkSession` など）
- 訪問先（顧客）情報確認（`コード.js`: `getData`, 顧客詳細・履歴表示）
- 日報／事故報告作成、領収書登録（`コード.js`: `generateReportWithWarnings`, `saveReport`, 領収書処理一式）
- Google Chat Webhook通知（`GoogleChat.js`）

新規追加:

- **ホームナビゲーション**（`index.html`）: 「予定」「訪問先一覧」「過去の予定」の3タブ
- **今日／明日の予定表示**（`Schedule.js`）: 当初は `gas-root-serach` をライブラリ（`RootSearchLib`）として参照していたが、2026-08-12に本体へ統合済み(後述「`gas-root-serach` の本体統合」参照)。`getScheduleForStaffOnDate(staffName, dateString)` を呼び出して一覧表示する。予定カードをタップすると訪問先一覧タブへ遷移し、該当顧客で検索フィルタが適用されます。
- **Google Chat Webhook通知**（`GoogleChat.js`）: 日報／事故報告／訪問完了通知は `GCHAT_REPORT_WEBHOOK_URL`、領収書登録通知は `GCHAT_RECEIPT_WEBHOOK_URL`(いずれもスクリプトプロパティ)で指定したWebhook URLへそれぞれ送信する。

## Stage 2（本コミットで実装済み）

今日／明日の予定に、移動時間・ルートURLを表示する機能を追加しました。

- **`gas-root-serach`側**（`01_GAS/gas-root-serach/main.js`）: 新規関数 `getScheduleWithRouteForStaffOnDate(staffName, dateString)` を追加。既存の `calculateDetailedRoutes` / `getRouteDetails`（Google Maps Directions API）を使って出勤・訪問間・退勤の移動時間・距離・ルートURLを計算するが、既存の `refreshAttendanceForStaffOnDate` と異なり「勤怠集計」シートへの読み書きは行わない読み取り専用版。既存関数は変更していない。
- **`gas-childcare-visit-app`側**: `Schedule.js` に `getRouteForStaffOnDate` ラッパーを追加。「予定」タブに「🚗 ルート・移動時間を取得」ボタンを追加し(`index.html`)、上記関数を呼び出して各予定カードの前後に移動時間・距離・地図リンクを表示する。
  - 取得結果はブラウザの `localStorage` に日付・スタッフ単位でキャッシュ（有効期限2時間）し、キャッシュが有効な間は再度ボタンを押さなくても表示され、Maps APIも再呼び出ししない(別ブラウザ・別ユーザーでは共有されず、初回はそれぞれ再取得される)。

**予定タブを開いた時にルート・移動時間を自動取得(2026-08-12)**: 従来はボタンを押すまでルート・移動時間を取得しなかったが、「予定」タブを開いた(今日/明日切替・対象スタッフ切替を含む)時点で自動的に `getRouteForStaffOnDate` を呼び出すようにした(`index.html` の `loadSchedule`/`loadRouteInfo`)。ブラウザキャッシュ(2時間)が有効な場合はキャッシュを使い、Maps APIは呼び出さない。自動取得が失敗した場合(Maps APIエラー等)は、ルートなしの予定一覧(`getScheduleForDate`)にフォールバックして表示する(`loadPlainScheduleOnRouteFailure_`)。手動での「🔄 ルート・移動時間を再取得」ボタンは引き続き利用可能(カレンダーが当日中に変更された場合の再取得用)。

- **前夜の自動反映済みルート集計シートの再利用は見送った**: `gas-root-serach` には夜間の時限トリガーで翌日分のルートを事前計算し「ルート集計」スプレッドシートに保存した上でLINE WORKS通知を送る既存の仕組み(`main.js` の `main()`/`sendDailyScheduleToLineWorks`)があるが、(1) 「明日」タブ表示時点ではその日の夜間ジョブがまだ実行されておらずキャッシュが存在しない、(2) 当日中のカレンダー変更に追従できない、(3) 対象シートをファイル名で検索する仕組み(`DriveApp.getFilesByName`)に依存し結合度が高くなる、という理由から、既存方針(読み取り専用・副作用なしのライブラリ関数を都度呼び出す)を継続することにした。

**モバイル向けルート表示UIの見直し(2026-08-12)**: スマートフォンでの操作性を考慮し、ルート情報の「地図で見る」「現在地から」リンクを、下線付きの小さな文字リンクから、タップしやすい大きめのボタン(横並び・パディング付き)に変更した(`formatRouteLeg`)。「🚗 ルート・移動時間を取得」ボタン自体の高さも拡大した。

**ルート結果のサーバー側共有キャッシュを追加(2026-08-12)**: ブラウザの `localStorage` キャッシュは同一ブラウザ内でしか共有されないため、同じスタッフ・同じ日の予定を別のユーザー(例: 本人と管理者)や別のブラウザ・端末から見ると、Maps APIによるルート計算が毎回発生していた。`RouteSearch.js` の `getScheduleWithRouteForStaffOnDate` に、`CacheService.getScriptCache()`(全ユーザー・全実行で共有、有効期限2時間)による計算結果キャッシュを追加し、この重複計算を防ぐようにした(`routeResultCacheKey_`、キーは正規化したスタッフ名+日付)。

- スプレッドシートへの保存方式(「あればシートを読む、なければ計算して書き込む」)ではなく `CacheService` を採用したのは、(1) 書き込みAPIコストが `CacheService` より高い、(2) 有効期限の自動管理がなく失効・掃除ロジックを別途作る必要がある、(3) キャッシュ用の新しいシートを作ると「📅 この日をカレンダーから反映」による出勤簿への本番書き込みと紛れやすい、という理由から。
- **勤怠記録に書き込む `refreshAttendanceForStaffOnDate` はこのキャッシュを使わない**(常に最新のカレンダー状態を反映する必要があるため、意図的に毎回計算する)。閲覧専用の `getScheduleWithRouteForStaffOnDate` のみが対象。
- `getScheduleWithRouteForStaffOnDate`/`getRouteForStaffOnDate` に `forceRefresh` 引数を追加した。タブを開いた時の自動取得では `forceRefresh=false`(キャッシュを使う)だが、手動の「🔄 ルート・移動時間を再取得」ボタンでは `forceRefresh=true` を送り、サーバー側キャッシュが有効でも読み飛ばして必ず最新のカレンダー状態を再計算する(再計算結果はキャッシュに書き直されるため、以後の自動取得・他ユーザーの閲覧にも反映される)。
- 既知の制限: 自動取得(タブを開いた時点)は、キャッシュ有効期間中(最大2時間)にカレンダーが変更されても古い計算結果が表示され続ける(ブラウザキャッシュと同様の制限)。最新状態を見るには手動の「🔄 再取得」を押す。

**`gas-root-serach` の本体統合(2026-08-12)**: これまで `gas-root-serach` を別スクリプトIDのライブラリ(`RootSearchLib`)として参照していたが、本アプリ専用の機能になった(唯一のもう一つの利用元だった `gas-integrated-system` は本アプリのリリースをもって廃止予定)ため、実際に呼び出している関数を新規ファイル `RouteSearch.js` に直接統合した。

- `RouteSearch.js`: `gas-root-serach/main.js` から、本アプリが実際に呼び出す関数(`getScheduleForStaffOnDate`/`getScheduleWithRouteForStaffOnDate`/`refreshAttendanceForStaffOnDate`)とその内部依存関数(カレンダー解析・ルート計算・顧客/スタッフDBキャッシュ・勤怠集計シート書き込みなど)をロジック変更なしでそのまま移植した。夜間バッチ専用の関数(`main()`/`autoRunSaveAttendance()`/LINE WORKS通知/「ルート集計」シート書き込み)は本アプリでは使用しないため移植していない。
- `appsscript.json`: `dependencies.libraries` から `RootSearchLib` を削除。これにより、`gas-root-serach` への `clasp push` → ライブラリの新バージョンデプロイ → `appsscript.json` の `version` 更新、というライブラリ運用に伴う手動同期作業が不要になった。
- `Schedule.js`/`PastSchedule.js`: 呼び出し箇所を `RootSearchLib.xxx(...)` から `xxx(...)`(本体内の直接呼び出し)に変更。動作は変えていない。
- **残作業(コード変更ではなく運用上の後片付け)**: `gas-integrated-system` は本アプリのリリース後に廃止してよいとの確認済み。`01_GAS/gas-root-serach`・`01_GAS/gas-childcare-daily-report` プロジェクト自体は本アプリからの参照はなくなったが、それぞれに直接設定されている夜間の時限トリガー(Apps Scriptエディタ側の設定でこのリポジトリのコードには含まれていない)は本統合の影響を受けず、削除しない限りそのまま動作し続ける。このうち「当日分を各スタッフの個別出勤簿へ自動反映する」機能(`gas-root-serach`の`autoRunSaveAttendance()`＋`gas-childcare-daily-report`の`autoRunDailyTransfer()`の2段階バッチ)は、後述「毎晩全スタッフ分を自動反映するバッチを追加」で本アプリ側に同等機能(`autoSyncTodayScheduleForAllStaff`)を追加したため、リリース後はそれら2つのトリガーを削除してよい。一方、`gas-root-serach`の`main()`(翌日分のルート集計シート書き込み・LINE WORKS通知)は本アプリでは意図的に代替していないため、その通知が業務上まだ必要か確認し、不要であればそのトリガーも削除、必要であれば残すこと。

## Stage 3（本コミットで実装済み）

「過去の予定」タブで、出勤簿の閲覧・修正ができるようになりました。`gas-integrated-system`(スマホde出勤簿修正アプリ)のデータ操作ロジックを移植したものです。

- **新規ファイル `PastSchedule.js`**: `gas-integrated-system/doget.js` の `findSpreadsheetGlobal` / `findTargetRow_` / `readRowData_` / `INPUT_COLUMNS` などをそのまま移植し、Driveから対象スタッフの `<スタッフ名>_出勤簿_<年度>年度` スプレッドシートを検索して1日分のデータを読み書きする。
  - **認証方式の置き換え**: 元の実装は `Session.getActiveUser()`(Googleアカウント)でスタッフを特定していたが、本アプリはメール＋パスワードのログイン方式のため、`checkSession(token)` でスタッフ名・管理者権限を確定する`getPastScheduleAccessContext_`に置き換えた。一般スタッフは常に自分の記録のみ、管理者は `getActiveStaffNamesForAdmin` で取得したスタッフ一覧から対象を選べる(元の`ADMIN_EMAILS`方式ではなく、`コード.js`のログインで使っている管理者フラグ(スタッフDBのK列)を使用)。
  - **修正可能範囲**: 元の実装と同じく当月1日より前の記録は修正不可(閲覧のみ)。
  - `PropertiesService` でシート名を跨いで保持する元の実装をやめ、閲覧時に返した `sheetName`/`rowNumber` を保存リクエストにそのまま含める方式にした(匿名実行のため`UserProperties`がユーザーごとに分離されない点を踏まえた変更)。
- **`index.html`**: 「過去の予定」タブに日付選択(管理者は対象スタッフ選択も表示)・「表示する」ボタン・出勤簿1日分の入力フォーム(訪問先/時刻/移動時間・距離/天候/作業記録/買物代行/備考)・「保存する」ボタンを実装。

**カレンダー→出勤簿の自動反映(2026-08-09追加)**: `gas-integrated-system` の「カレンダーから最新予定を取得して反映」を追加移植した。

- `PastSchedule.js`: `syncPastScheduleFromCalendar(token, dateString, requestedStaffName)` を追加。`refreshAttendanceForStaffOnDate`(`RouteSearch.js`。2026-08-12以前は `RootSearchLib.refreshAttendanceForStaffOnDate`)を呼び、出勤簿のカレンダー由来の列(訪問先/時刻/移動時間・距離等)をクリアしてから反映する(`gas-integrated-system/doget.js` の `syncCalendarForStaffOnDate_` 相当)。手入力修正(`updatePastSchedule`)と異なり、**この機能には修正可能期限(当月のみ)の制限を設けていない**(元の仕様のまま。カレンダー内容はいつでも反映できる)。
- `index.html`: 「過去の予定」タブに「📅 この日をカレンダーから反映」ボタン(単日)を追加。管理者には「📅 期間を指定して一括反映」ボタンも表示され、開始日・終了日・対象スタッフ(チェックリスト)を指定して一括反映できるモーダルを実装した(進捗バー・失敗分のみ再実行に対応。元の `gas-integrated-system/index.html` の一括反映UXを移植)。範囲・複数スタッフのループはクライアント側で1件ずつ順次実行する設計で、これも元の実装(`runCalendarSyncQueue`)と同じ方式。

**毎晩全スタッフ分を自動反映するバッチを追加(2026-08-12)**: 手動の「カレンダーから反映」だけでは、誰も操作しない日は個別出勤簿が更新されない。これは元々 `gas-root-serach` の夜間トリガー(`autoRunSaveAttendance()`。当日分を計算して「勤怠集計」に集約保存)と `gas-childcare-daily-report` の夜間トリガー(`autoRunDailyTransfer()`。「勤怠集計」から各スタッフの個別出勤簿へ転記)の2段階のバッチで自動化されていた機能であり、同等の機能を本アプリに追加した。

- `PastSchedule.js`: 単日反映の中核処理を `syncCalendarForStaffOnDate_(staffName, dateString)` として切り出し(`syncPastScheduleFromCalendar` はこれを呼ぶだけに変更、動作は変えていない)。新規関数 `autoSyncTodayScheduleForAllStaff()` を追加し、当日分について現在有効な全スタッフ(`getActiveStaffNames_()`、退職者は除外)に対して `syncCalendarForStaffOnDate_` を順に実行する。1スタッフの失敗(出勤簿シートが見つからない等)が他スタッフの処理を止めないよう、スタッフごとにtry/catchしログに記録する。`refreshAttendanceForStaffOnDate` は内部で「勤怠集計」への集約保存も行うため、`gas-root-serach`側の夜間ジョブと`gas-childcare-daily-report`側の夜間ジョブ、どちらの出力(集約シート・個別出勤簿の両方)も1段階の処理で置き換えている。
- **トリガー設定**: 一度だけ Apps Script エディタで `setupAutoSyncTrigger()` を手動実行し、`autoSyncTodayScheduleForAllStaff` の毎日実行トリガー(22時台。変更したい場合はコード内の `atHour(22)` を編集してから再実行する)を作成する。既存の同名トリガーがあれば削除してから作成するため、再実行しても重複しない。
- **これにより** `gas-root-serach`(`main()`/`autoRunSaveAttendance()`)と `gas-childcare-daily-report`(`autoRunDailyTransfer()`)に設定されている既存の夜間トリガーは、本アプリのリリース後は不要になる。Apps Scriptエディタ側でそれぞれのトリガーを削除してよい(前述「`gas-root-serach` の本体統合」の残作業を解消)。ただし `main()`(翌日分のルート集計・LINE WORKS通知)は本アプリでは意図的に代替していない機能のため、その通知自体が業務上必要であれば `main()` のトリガーだけは残すこと。

**効率化(2026-08-09)**: `PastSchedule.js` の `findPastScheduleTargetRow_` は、出勤簿の全シート・全行を線形スキャンする実装から、「N月」シート・4行目起点で1日1行連続配置される前提に基づく直接計算に変更した(前提が崩れている場合は従来の線形スキャンにフォールバック)。`gas-integrated-system/doget.js` の `findTargetRow_` にも同じ変更を行った。合わせて `gas-root-serach` 側の顧客/スタッフDBキャッシュ・ジオコーディング/ルート検索のメモ化・勤怠集計シートの行削除バッチ化も実施(詳細は `01_GAS/gas-root-serach/CHANGELOG.md` Ver.1.0.3、`01_GAS/gas-integrated-system/CHANGELOG.md` Ver.1.0.2 を参照)。いずれも入出力仕様は変更していない。

**正確性の修正(2026-08-09)**: `PastSchedule.js` の `getPastScheduleForDate`/`updatePastSchedule` に、修正可能期限の上限チェック(当月末日より後は不可)を追加した。`gas-root-serach`側では、出勤/退勤距離が特定条件で欠落するバグ・移動時間0分が空欄になるバグ・スタッフID衝突リスク・事務作業のグルーピング不整合・顧客ID未発行customerが名前マッチング対象外になる問題を修正し、「15分=事務作業」判定ロジックを公開ライブラリ関数(`isOfficeWorkAppointment`/`calcDurationMinForAttendance`)として一本化した(詳細は `01_GAS/gas-root-serach/CHANGELOG.md` Ver.1.0.4、`01_GAS/gas-integrated-system/CHANGELOG.md` Ver.1.0.3 を参照)。`gas-childcare-daily-report` は今後使用しない前提のため変更していない。

**「過去の予定」タブのUI刷新(2026-08-17)**: `01_GAS/webapp-poc`(sqlite/Node.jsのプロトタイプ)の勤怠タブと同等の見た目・機能に刷新した。ただし webapp-poc では日次手入力・一括反映UIを廃止しGoogleカレンダーのイベントCRUDに一本化しているのに対し、本アプリでは既存の「期間を指定して一括反映」等の一括反映機能はそのまま維持し(手入力修正の方法は後述のとおり再設計した)、UIのみ同等化した(カレンダーの新規作成・編集・削除は行わない)。管理者向けExcelエクスポート機能は移植対象外。

- **新規ファイル `AttendanceCalc.js`**: `webapp-poc/server/attendanceCalc.js` から、出勤簿テンプレートの数式列(移動時間・待機時間・労働時間・残業時間・距離集計・基準距離超過回数)を再現する純粋計算関数群を移植した。スプレッドシート/DBに一切依存しないため、`webapp-poc`・本アプリの両方で使い回せる形のまま持ってきている。
- `PastSchedule.js`:
  - `getWeeklyScheduleForStaff(token, startDateString, endDateString, requestedStaffName)` を追加。出勤簿シートから対象期間分をまとめて読み取り、`buildScheduleEventsFromRowData_`(始業・終業が両方入力済みの訪問#1〜#3・事務作業#1〜#2のみイベント化)で週間ビュー用のイベント配列に変換する読み取り専用エンドポイント。1リクエストあたり最大31日までの上限を設けている(`ANYONE_ANONYMOUS`公開のため)。
  - `getAttendanceMonth(token, yearMonth, requestedStaffName)` を追加。対象月の出勤簿シートを1回の`getValues`でまとめて読み取り(日毎に`getValue`を呼ぶAPI往復を避けるため)、`AttendanceCalc.js`で日次・月次の派生値を計算して返す。出勤簿シート自体が見つからない場合も、閲覧専用画面のため空集計で返す。
  - `getReceiptsForMonth_(staffName, yearMonth)` を追加。既存の領収書ログ(`IMAGE_LOG_SS_ID`、`コード.js`の`processReceiptImages`が書き込む)をスタッフ・月で集計する内部関数。
  - いずれも既存の`getPastScheduleAccessContext_`/`resolvePastScheduleTargetStaffName_`によるアクセス制御パターンをそのまま踏襲。
- `index.html`: 「過去の予定」タブに、Googleカレンダーの週間表示風の週間予定ビュー(週送り・「今日」ボタン・日をタップして1日表示にドリルダウン)と「📊 月次集計(勤怠・領収書)」モーダル(対象月の労働・残業・移動時間・距離・超過回数・領収書集計を表示)を追加した。日をタップすると、下の一覧(訪問・事務作業の編集用スロット一覧)にも同じ日付を読み込む(手入力修正の詳細は後述)。

**過去の予定の編集方法を「予定を1件ずつタップして編集」に再設計(2026-08-17)**: 上記のUI刷新と合わせて、これまでA〜AO列相当の全項目を1つの平坦なフォームに並べて表示していた手入力修正の方法を、webapp-poc同様「カレンダー上の予定をタップしてその予定だけを編集する」方式に変更した。全項目が一度に見える一覧はどの項目が何を指すか分かりにくいという指摘を受けての再設計。

- `PastSchedule.js`: `buildScheduleEventsFromRowData_` が返すイベントに `slotKey`(`slot1`/`slot2`/`slot3`/`office1`/`office2`)を追加し、週間予定ビュー上のどの予定をタップしたか(=どのスロットを編集すべきか)をクライアント側で判別できるようにした。保存自体は既存の `updatePastSchedule` をそのまま使うため、サーバー側の変更はこれだけ。
- `index.html`:
  - `PAST_SCHEDULE_FORM_GROUPS`/`renderPastSchedule`/`savePastSchedule`(従来の全項目1フォーム)を削除し、`PAST_SCHEDULE_SLOT_DEFS`(訪問その1〜3・事務作業その1〜2、5つのスロットごとの列定義)・`renderPastScheduleDay`(スロット一覧描画。埋まっていれば名称・時刻、空なら「＋追加」)・`openPastScheduleSlotModal`/`savePastScheduleSlot`/`clearPastScheduleSlot`(スロット単位の編集・保存・削除)に置き換えた。
  - 1日表示のタイムライン上の予定ブロックをタップ(`handleCalDayEventClick_`)しても、下のスロット一覧をタップしても同じ編集モーダルが開く(狭いタイムラインのブロックが正確にタップしづらい場合の代替導線として、一覧の方も残している)。日の詳細読み込みが対象日とまだ一致していない間にタイムラインをタップした場合は、モーダルを開かず案内のみ表示する。
  - 移動時間・移動距離・天候(雪か否か)・出退勤距離は、当初は該当する訪問の編集モーダルに同居させていたが(#2は#1→#2分、#3は#2→#3分の移動を「ここまでの移動」欄として、出勤距離は#1、退勤距離は#3に配置)、#1に天候欄が無い・退勤距離が#3にあるのが不自然、という指摘を受けて再検討し、各予定のモーダルからは外して「移動・距離」という常時表示の別パネルにまとめた(`PAST_SCHEDULE_MOVE_FIELDS`/`savePastScheduleMove`)。各予定の編集モーダルは名称・開始・終了のみになった。
  - 買物代行・備考はどの予定にも属さない日単位の項目のため、同じく常時表示の「その他(買物代行・備考)」パネルを設けた(`savePastScheduleMisc`)。買物代行(回数)は0以上の整数のみ許可し、それ以外の入力は保存前にエラー表示して弾く。
  - 各スロットの編集モーダルに「削除」ボタンを追加し、その予定の内容(該当する列すべて)をまとめて空にできるようにした(確認ダイアログあり)。当月内かどうかの編集可否判定・保存時の変更セルハイライトは、共通処理(`updatePastSchedule`)に委ねているため従来のまま。

**週間予定ビューの読み込み中表示とキャッシュ追加(2026-08-17)**: 出勤簿シートの読み取りが絡むため週間予定の表示に時間がかかることがあり、読み込み中であることが分かるようスピナー表示を追加した。また表示専用データのため`localStorage`にキャッシュ(2時間TTL、`pastSchedWeek_`プレフィックス)し、同じ週を週送りで行き来した際の再取得を避けるようにした。

- `index.html`: `loadWeekEvents(forceRefresh)` にキャッシュ読み書き(`readPastScheduleWeekCache_`/`writePastScheduleWeekCache_`)とスピナー表示を追加。予定の保存・カレンダー反映(単日・一括とも)の完了後は `invalidatePastScheduleWeekCache_` で全キャッシュを破棄してから `loadWeekEvents(true)` で強制再取得する(一括反映は複数日・複数スタッフにまたがるため、対象週だけに絞らず全キャッシュを破棄する設計)。週送りボタンを連打した場合など、古いリクエストの応答が後から届いて新しい状態を上書きしないよう、世代カウンタ(`calWeekRequestSeq`)で古い応答を無視するようにしている。

**カレンダー→出勤簿の反映ロジックを非破壊マージ化(2026-08-17)**: 上記のUI刷新と合わせて、反映ロジック自体も変更した。従来の`syncCalendarForStaffOnDate_`は毎回、カレンダー由来の列(訪問先/時刻/移動距離等)を全てクリアしてからカレンダー内容を書き込んでおり、出勤簿側にのみ手入力していた内容(カレンダーに対応する予定が無いもの)も反映のたびに消えてしまっていた。

- `PastSchedule.js`: `PAST_SCHEDULE_SYNC_SLOTS`(訪問#1〜#3・事務作業#1〜#2の5グループの列定義)・`buildCalendarSyncPlan_`(現在の出勤簿内容とカレンダー由来内容を比較し、実際に書き込む列だけを抽出する)・`computeCalendarSyncPlanForStaffOnDate_`を追加し、`syncCalendarForStaffOnDate_`(単日反映・「期間を指定して一括反映」・毎晩の自動反映バッチ`autoSyncTodayScheduleForAllStaff`が共通で使う中核処理)をこの非破壊マージ経由に置き換えた。カレンダー側にその時間帯の予定がある場合のみ上書きし、対応する予定が無い出勤簿側の入力は、時間帯がカレンダー由来の予定と重ならない限りそのまま保持する(重なる場合のみ、置き換えられたものとみなしてクリアする)。
- 新規エンドポイント`previewCalendarSyncForStaffOnDate(token, dateString, requestedStaffName)`(書き込みを行わず、列ごとの変更点(旧値→新値)だけを返す)と`applyCalendarSyncForStaffOnDate(token, dateString, requestedStaffName)`(確認後に書き込む。クライアントから送られた差分は信用せず、書き込み時にサーバー側で同じ計算をやり直す)を追加。
- `index.html`: 単日の「📅 この日をカレンダーから反映」ボタンを、即時反映から「変更点のプレビュー(列ごとの旧値→新値の一覧)→取り込む/キャンセル」の確認フローに変更した(`calendarSyncDiffModal`)。変更が無い場合は確認なしでその旨のみ通知する。「期間を指定して一括反映」のUI・進捗表示・失敗分のみ再実行の挙動は変更していない(書き込みロジックのみ上記の非破壊マージに置き換わっている)。

**「予定」タブ: 事務作業に挟まれた訪問の地図ボタン欠落を修正、種別ラベルを住所+地図リンクに変更(2026-08-17)**: 「予定」タブでルート・移動時間を表示すると、事務作業(位置情報なし)に挟まれた顧客訪問について、出勤・退勤いずれの地図ボタンも表示されない不具合があった。原因は、クライアント側が「配列の先頭=出勤レグ、末尾=退勤レグ、それ以外=前の予定からの移動レグ」と生の並び順だけで判定していたため、間に事務作業を挟むとその訪問が実質的にその日唯一の実在訪問先であっても出勤・退勤のレグ(サーバー側では両方とも既に正しく計算済み)が表示されず、さらに隣接する事務作業側の見た目調整ロジックがDOM上の兄弟要素探索でその訪問のレグの地図ボタンまで誤って削除していたため。

- `index.html`: `renderScheduleWithRoute`の出勤/移動/退勤レグの出し分けを、配列位置ではなく`app.attendanceMin/Km/Url`・`app.leavingMin/Km/Url`が実際に値を持っているかどうかで判定するように変更(`calculateDetailedRoutes`は、その日の実在訪問先だけを対象に、最初の1件には出勤レグ、以降は前の実在訪問先からの移動レグ、最後の1件には退勤レグを計算しており、事務作業を挟んでいても正しく計算されている)。`formatRouteLeg`の各レグ要素に`data-leg-idx`(そのレグがどの予定自身のものかを示す)を付与し、`applyEventTypeStyling_`の地図ボタン削除処理を、DOM上の兄弟要素探索から`data-leg-idx`による直接指定に変更した。
- あわせて、「顧客訪問(CUSTOMER APPOINTMENT)」という種別名をそのまま表示していた行を、顧客の住所と、顧客詳細ダイアログの住所欄と同じスタイルの地図リンクボタン(Google Maps検索、住所未登録なら「住所未登録」)に変更した(`scheduleSubtitleHtml_`)。事務作業・イベントは引き続き日本語の種別ラベル(事務作業/イベント)を表示する。各予定カードには種別ごとのアイコン(📍顧客訪問/📝事務作業/📅イベント)と左枠線の色を追加し、見た目にメリハリを付けた(`scheduleCardIconHtml_`/`SCHEDULE_EVENT_TYPE_BORDER_`)。「予定」タブの通常表示(`renderSchedule`)・ルート表示(`renderScheduleWithRoute`)の両方に適用している。
- `RouteSearch.js`: `getScheduleForStaffOnDate`・`getScheduleWithRouteForStaffOnDate`が返す予定オブジェクトに`address`(顧客住所)を追加した。後者は、勤怠集計シートへの書き込みにそのまま使われる行配列(`calculateDetailedRoutes`の戻り値。列数がシートのヘッダー列数と厳密に一致している必要があるため、この関数自体には手を加えていない)とは別に、同じ並び順の元の`appointments`(`groupedEvents[staff.id].appointments`)から住所だけを別途引き当てて付与している。

**「勤怠」タブ(旧「過去の予定」)のUIを再整理(2026-08-17)**: タブ名を「勤怠」に変更し、実際に使ってみての指摘(タブが長い・不要なUI要素が残っている・入力欄が無秩序・保存ボタンが2つある・週間表示から直接編集できない等)を踏まえてUIを見直した。

- 日付入力欄・「表示する」ボタンを廃止。`calSelectedDate`(週間予定カレンダーで選択中の日)を唯一の状態源とし、タブを開いた時点で今日の詳細を自動表示、日をタップすると即座にその日の詳細に切り替わるようにした(`initWeekView`/`jumpToTodayWeek`/`drillToDay`から`loadPastSchedule()`を呼ぶ形に統一)。
- 「移動・距離」パネルと「その他(買物代行・備考)」パネル、それぞれにあった保存ボタンを1つの「移動・距離・その他」パネル・1つの保存ボタン(`savePastScheduleDetail`)に統合した。
- 「移動・距離」の入力欄が無秩序に並んでいた点を解消するため、出勤(自宅→#1)/#1→#2移動/#2→#3移動/退勤(#3→自宅)の4グループに整理した(`PAST_SCHEDULE_MOVE_GROUPS`/`renderPastScheduleMoveFieldsHtml_`)。天候はプルダウン(`<select>`)から❄️アイコン付きのON/OFFトグルボタン(`pastScheduleWeatherToggleHtml_`/`setPastScheduleWeather_`。値は隠しinputに保持し、既存の保存処理とはdata-col経由で互換)に変更し、各移動グループの中に表示することで見つけやすくした。I列は「出勤(自宅→#1)」、R列は「#1→#2移動」のグループに割り当てている(`gas-integrated-system`の「業務#1」「業務#2」セクションでの表示に対応関係を合わせた指摘を受けて修正。#2→#3移動・退勤の区間には天候の記録欄が元々無いため、新しい列は追加していない)。
- 訪問その1〜3・事務作業その1〜2の5件を常時列挙していた一覧を廃止。埋まっている予定はカレンダーのタイムラインを直接タップして編集し、空いている予定は1日表示のヘッダーに新設した「＋ 追加」ボタン(空きスロットのみ列挙するメニュー、`updateAddSlotButtonState_`/`toggleAddSlotMenu_`)から追加する形にした。
- 週間予定の7日グリッド表示でも、予定を直接タップすると1日表示にドリルダウンしたうえで編集モーダルが開くようにした(従来は日をタップして1日表示に切り替えるだけで、予定自体はタップできなかった)。
- 予定タップ時にその日の詳細がまだ読み込まれていない場合、従来は「少し待って再度タップしてください」という案内を出すだけで再タップが必要だったが、その場で`getPastScheduleForDate`を取得してからモーダルを開くように変更した(`fetchPastScheduleForDate_`/`openScheduleSlotForDate_`。`handleCalDayEventClick_`を置き換え)。
- 「📅 この日をカレンダーから反映」ボタンを1日表示のヘッダー(「＋追加」の隣)に移動し、「📅 期間を指定して一括反映(管理者用)」ボタンをタブ上部の「📊 月次集計」の隣に移動した(従来、日付/表示ボタンと同居していた中途半端な位置を解消)。

**管理者用「対象スタッフ」を「予定」「勤怠」タブで共有(2026-08-18)**: 従来、両タブがそれぞれ独立に`getActiveStaffNamesForAdmin`を呼び、別々のセレクタ状態を持っていた(同じ管理者が両タブを行き来するたびに対象スタッフを選び直す必要があった)。

- `index.html`: `sharedAdminTargetStaffName`/`sharedAdminActiveStaffNames`/`sharedAdminStaffListLoaded`を導入し、一覧取得(`loadSharedAdminStaffList_`)を1回に統合した。どちらのセレクタも`onchange="onAdminTargetStaffChange_(this.value)"`を呼ぶようにし、この関数がもう一方のセレクタの表示を揃えたうえで、読み込み済みのタブのデータ(予定タブ・勤怠タブとも)をその場で更新する。`loadSchedule(offsetDays)`(タブ切り替えを伴う)から、タブ切り替えなしでデータだけ更新する`loadScheduleForOffset_(offsetDays)`を分離し、勤怠タブ側からの変更でも予定タブへ強制的に切り替わらないようにしている。`getScheduleTargetStaffName_`/`getPastScheduleTargetStaffName_`はいずれも共有状態を返すだけの薄いラッパーにした。

**カレンダーが反映されていないことが分かる注意書きを追加(2026-08-18)**: Googleカレンダー側の予定を変更しても、この画面(出勤簿の記録を表示)には自動的には反映されず、「📅 反映」を押す(または当日分は毎晩の自動反映バッチを待つ)まで反映されない。「編集したのに反映されていない」という誤解を避けるため、週間予定カレンダーの上に常時表示の注意書き(⚠️ Googleカレンダー側の変更はすぐには反映されません、等)を追加した。

- 動的にその日の変更有無を都度チェックする方式は採用していない。`previewCalendarSyncForStaffOnDate`(下記のバグ修正参照)は1回の呼び出しで Geocoding/Maps Directions API を呼ぶコストの高い処理のため、週間表示の7日分すべてに対して自動チェックすることは現実的でないと判断し、常時表示の静的な注意書きのみとした。

**単日の「📅 反映」プレビューが「勤怠集計」シートを誤って書き換えていた不具合を修正(2026-08-18)**: 上記の対応を検討する過程で発見した既存の不具合。単日の「📅 反映」ボタンは、押した時点でまず`previewCalendarSyncForStaffOnDate`(差分プレビュー、書き込みなしのはず)を呼ぶが、実際には差分計算の内部で`refreshAttendanceForStaffOnDate`(本来「勤怠集計」への集約保存も兼ねる関数)を呼んでいたため、プレビューを開いただけで(「取り込む」を押さず閉じた場合も含め)共有の「勤怠集計」シートが書き換わってしまっていた。さらに「取り込む」を押すと同じ計算・書き込みがもう一度実行され、Maps API呼び出し・書き込みが二重に発生していた。

- `RouteSearch.js`: `refreshAttendanceForStaffOnDate`を、書き込みを一切行わない純粋計算の`computeAttendanceRowDataForStaffOnDate_`と、「勤怠集計」シートへの書き込みだけを行う`writeAttendanceAggregateRows_`に分離した。`refreshAttendanceForStaffOnDate`自体は両者を呼ぶ薄いラッパーとして残し、外部からの呼び出し方(引数・戻り値)は変えていない。
- `PastSchedule.js`: `computeCalendarSyncPlanForStaffOnDate_`(プレビュー・反映どちらからも呼ばれる差分計算)を`computeAttendanceRowDataForStaffOnDate_`のみを呼ぶように変更し、書き込みを一切行わないようにした。実際に反映する`syncCalendarForStaffOnDate_`(単日確定・一括反映・夜間バッチ共通)と`applyCalendarSyncForStaffOnDate`(単日確定)では、出勤簿への書き込みに加えて`writeAttendanceAggregateRows_`を明示的に呼び、「勤怠集計」への集約保存という従来の実効果は維持した。

**スプレッドシート再読込ボタンの追加、単日カレンダー反映ボタンのレイアウト調整(2026-08-18)**: 出勤簿スプレッドシートは他の端末での編集や毎晩の自動反映バッチによって、このブラウザが最後に読み込んだ時点より新しくなっている可能性があるため、それをすぐ確認できるボタンを追加した。

- `index.html`: 「🔄 勤怠シートから読込」ボタンを1日表示のヘッダーに追加した。`reloadPastScheduleFromSpreadsheet_`は、週間予定の`localStorage`キャッシュ(`invalidatePastScheduleWeekCache_`)を破棄したうえで、週間予定(`loadWeekEvents(true)`)・選択中の日の詳細(`fetchPastScheduleForDate_`)の両方をGoogleスプレッドシートから強制的に読み直す。カレンダーへは問い合わせないため、Maps API等のコストは発生しない。
- `gas-integrated-system`(旧・出勤簿修正アプリ)風の緑色全幅バナーボタンへの変更も一度試したが、大げさすぎるとの指摘を受けて元の小さいピルボタンに戻した。かわりに、「📅 カレンダーから取得」「🔄 勤怠シートから読込」「＋ 勤怠を追加」の3つを同じ小さいピルボタンのスタイルで横並びに揃え(`flex-wrap`で狭い画面でも折り返す)、「← 週間表示に戻る」はその上の行に分けて配置し直した(横一列に詰め込むとスペースが足りなくなるため)。ボタン名称は分かりやすさのため、「📅 反映」→「📅 カレンダーから取得」、「＋ 追加」→「＋ 勤怠を追加」に変更した。
- 「📅 反映」「🔄 勤怠シートから読込」のどちらも、押すと`confirm()`で簡単な説明(何を行うか、カレンダーに問い合わせるかどうか)とOK/キャンセルを表示してから実行するようにした。
- 週間予定の表示ラベルの下に「更新: HH:MM」として、現在表示中のデータの取得時刻(`localStorage`キャッシュの保存時刻、または再取得した時刻)を表示するようにした(`calWeekUpdatedAt`/`formatCalWeekUpdatedAt_`)。`readPastScheduleWeekCache_`がキャッシュの`ts`も返すように変更している。
- あわせて週間予定カレンダー上部の常時表示の注意書きの文言も、「更新ボタンを押してください」という簡潔な表現に整理した。

**天候トグルボタンの選択直後の表示不具合を修正(2026-08-19)**: 天候ボタンをタップした瞬間、白背景に白文字で選択状態が見えなくなり、フォーカスが外れると正しい青ボタンに戻るという不具合があった。原因は`setPastScheduleWeather_`が選択(青)クラスを付ける際、非選択時専用の`hover:bg-gray-50`クラスを外し忘れていたこと。タップ直後はブラウザがそのボタンをホバー状態として扱うため、この薄いグレーのホバー背景が本来の`bg-blue-600`を上書きし、白文字と重なって読めなくなっていた。選択状態のトグルからは`hover:bg-gray-50`を外すように修正した。

**「移動・距離・その他」パネルのグループ表示を、実際の訪問件数に応じた動的表示に変更(2026-08-19)**: 従来は訪問が1〜2件しか無い日でも、常に「出勤」「#1→#2移動」「#2→#3移動」「退勤」の4グループを表示していたため、訪問先が存在しない区間の空欄ボックス(例: 訪問2件の日の「#2→#3移動」)が不要に表示されてしまっていた。

- `index.html`: `PAST_SCHEDULE_MOVE_GROUPS`(固定4グループの静的定義)を削除し、`buildPastScheduleMoveGroups_(rowData)`(訪問その1〜3のうち名称・開始・終了が入っているものの数に応じて、表示するグループと見出しを動的に組み立てる)に置き換えた。訪問1件の日は「出勤」「退勤」の2グループのみ、2件なら「出勤」「#1→#2移動」「退勤」の3グループ、3件なら全4グループを表示する。見出しも「#1」「#2」等のプレースホルダーではなく、実際の訪問先名(`rowData.C`/`L`/`U`。空なら`#1`等にフォールバック)を使うようにした(`gas-integrated-system`のように、訪問先名や自宅を使う表示に近づけた)。
- 保存対象の列(`PAST_SCHEDULE_MOVE_COLS`、AI/I/H/AG/R/Q/AH/AJの固定8列)自体は変更していない。表示されないグループの列は`savePastScheduleDetail`側で(対応するDOM要素が存在しないため)空文字として送られるが、これは元々その区間にデータが無い場合のみに限られる(表示条件がその時点の実データそのものに基づいているため、データがあれば必ずグループも表示される)。出勤簿スプレッドシートへの書き込み方法・整合性は従来どおり。

**「移動・距離・その他」パネルを週間表示の間は非表示に(2026-08-19)**: 週間表示(7日グリッド)の状態では、このパネルがどの日を指しているのか分かりにくく、そもそも不要という指摘を受けて対応した。

- `index.html`: `renderCalMain`で、`calViewMode`が`'day'`でない間は`pastScheduleResult`(記録一覧・警告バナー)・`pastScheduleDetailPanel`(移動・距離・その他)を即座に隠すようにした。`renderPastScheduleDay`側の表示条件にも同じ`calViewMode === 'day'`のチェックを追加し、どちらが後から実行されても結果が食い違わないようにしている(ビュー切替は同期的だが、データ取得は非同期のため、切替直後は`renderCalMain`側の非表示が先に効き、データ取得完了後に1日表示のままであれば`renderPastScheduleDay`側が表示する)。

**週間予定タップ時、データ取得完了までダイアログを先に開いて読み込み中の状態を見せるように変更(2026-08-19)**: 従来、その日の詳細(`pastScheduleCurrent`)が未取得の場合、取得完了(`fetchPastScheduleForDate_`)を待ってから初めて編集モーダルを開いていた。取得中もページの他の操作ができてしまい、しばらくしてから唐突にダイアログが開くため分かりにくいという指摘を受けた。

- `index.html`: `showPastScheduleSlotModalLoading_(slotKey)`を追加し、`openScheduleSlotForDate_`がタップされた瞬間にこれを呼んでモーダルを読み込み中の状態(スピナー、保存/削除ボタンは隠す)で先に開くようにした。取得が完了したら`openPastScheduleSlotModal(slotKey)`で同じモーダルの内容を実データに差し替える。取得中に別の日へ移動していた場合(`calSelectedDate`が変わっていた場合)は、開いていたモーダルを`closePastScheduleSlotModal()`で自動的に閉じる。

**ログイン画面表示中に日報の未保存ドラフトダイアログが裏で開いてしまう不具合を修正(2026-08-19)**: 日報の未保存入力を次回起動時に自動復元する機能(`restoreReportDraftIfAny`、`onDataLoaded`から一度だけ呼ばれる)が、ログイン完了前に発動してしまうことがあった。原因は`window.onload`から無条件に走る`startVersionPolling`(CSV自動取込チェック・データバージョンの定期チェック)が、ログイン完了を待たずに`reloadData`→`onDataLoaded`を実行させる場合があり、その1回限りの復元判定がそこで消費されてしまうため。ログイン画面が表示されたまま、その裏で顧客の日報ダイアログが開き、閉じるとログイン画面のまま(実際にはまだログインが完了していない)になっていた。

- `index.html`: `onDataLoaded`内の一度きりガード(`window.pendingDraftRestoreAttempted`)に、ログイン完了済み(`currentStaffName`が設定されている)という条件を追加した。ログイン完了前に`onDataLoaded`が実行された場合はフラグを立てずに見送り、ログイン完了後に実行される次回の`onDataLoaded`で改めて判定されるようにした。

**管理者設定にGemini APIキー設定を追加(2026-08-11)**: 設定画面(⚙️)に管理者専用の「Gemini APIキー」欄を追加した。

- `コード.js`: `getGeminiApiKeyForAdmin(token)`/`saveGeminiApiKeyForAdmin(token, apiKey)` を追加。いずれも `checkSession` で管理者権限を確認する。保存時、送信された値が空文字の場合は**保存を拒否**する(既存キーが意図せず消えるのを防ぐガード)。
- `index.html`: 設定モーダルを開いた時点でフィールドを `disabled`+「読み込み中...」にし、サーバーから現在値を取得できてから初めて入力・保存を許可する(`geminiKeyLoadState.loaded` フラグ)。読み込み中または読み込みに失敗した状態では保存ボタンを押しても書き込まれない。読み込んだ値と入力値が同じ場合はAPIキーを送信しない(不要な書き込みを避ける)。マスク表示(表示/隠すボタン付き)。

**日報・OCR用モデルの選択機能を追加(2026-08-11)**: Gemini側でモデルが使えなくなる事態(例: 2.5系の提供終了)に備え、使用モデルをコードの変更なしに管理者設定から切り替えられるようにした。

- `コード.js`: スクリプトプロパティ `GEMINI_MODEL_REPORT`(日報・事故報告生成用、未設定時デフォルト `gemini-2.5-flash`)と `GEMINI_MODEL_OCR`(領収書OCR用、未設定時デフォルト `gemini-2.5-flash-lite`)を追加。`generateReportWithWarnings`/`generateAccidentReport`/`extractAmountFromImage` は全て `getGeminiModelForReport_()`/`getGeminiModelForOcr_()` 経由でモデル名を解決するように変更(ハードコードを廃止)。
  - `getGeminiModelSettingsForAdmin`/`saveGeminiModelSettingsForAdmin`: 管理者用の取得・保存。Gemini APIキーと同様、空文字での保存は拒否する。
  - `listAvailableGeminiModelsForAdmin(token, apiKeyOverride)`: Gemini の `ListModels` API(`GET https://generativelanguage.googleapis.com/v1beta/models`)を呼び、`generateContent` に対応するモデルのみを返す。`apiKeyOverride` を渡せば、保存前の入力中のキーでも一覧取得を試せる。
- `index.html`: 管理者設定にモデル選択の `<select>` を2つ(日報用/OCR用)追加。Gemini APIキーと同じ「読み込み完了前は保存不可」のガードを適用(`geminiModelLoadState.loaded`)。加えて「🔄 最新モデル一覧を取得」ボタンで `ListModels` を呼び、選択肢を最新化できる(取得前でも現在の設定値は選択肢として必ず残るため、一覧未更新でも既存設定が失われることはない)。保存はAPIキー・モデル設定それぞれ変更があった分のみ送信する。

**管理者設定にGoogle Chat Webhook URL設定を追加、設定モーダルにキャンセルボタンを追加(2026-08-14)**: これまでスクリプトプロパティを直接編集する必要があった `GCHAT_REPORT_WEBHOOK_URL`/`GCHAT_RECEIPT_WEBHOOK_URL` を、Gemini APIキーと同じ流儀で管理者設定画面から設定できるようにした。

- `GoogleChat.js`: `getGoogleChatWebhookSettingsForAdmin(token)`/`saveGoogleChatWebhookSettingsForAdmin(token, reportWebhookUrl, receiptWebhookUrl)` を追加。`checkSession` で管理者権限を確認し、どちらか一方でも空文字での保存は拒否する(既存URLが意図せず消えるのを防ぐガード。Gemini APIキー・モデル設定と同じ方針)。Webhook URLはそれ自体に投稿用のトークンを含みAPIキーに近い機微情報のため、Gemini APIキーと同様、閲覧時・保存時それぞれに`SECURITY`ログ(`GoogleChatWebhookSettingsViewed`/`GoogleChatWebhookSettingsChanged`)を残す。
- `index.html`: 設定モーダルの管理者設定エリアに、日報用/領収書用それぞれのWebhook URL入力欄(マスク表示、表示/隠すボタン付き)を追加。Gemini APIキー・モデル設定と同じ「読み込み完了前は保存不可」のガード(`gchatWebhookLoadState.loaded`)を適用し、変更があった分のみ送信する。
- `index.html`: 設定モーダルのフッターに「保存して閉じる」ボタンと並べて「キャンセル」ボタンを追加した。入力中の変更を保存せずに `closeSettings()`(読み込み中でない限りモーダルを閉じるだけの既存関数)を呼ぶことで、単純に変更を破棄して閉じる。

**各種操作ログの記録を強化(2026-08-11)**: 管理者・利用者が複数いる運用を前提に、これまで記録されていなかった失敗時・権限拒否時のログを追加した。詳細は「ログについて」セクションを参照。

**【セキュリティ修正】未認証での訪問予定・顧客位置情報の取得を防止(2026-08-11)**: セキュリティ診断により、`Schedule.js` の `getScheduleForDate`/`getRouteForStaffOnDate` がログイントークンを検証せず、クライアントから渡された`staffName`をそのまま信用していたことが判明した。本アプリは `access: ANYONE_ANONYMOUS` で公開されているため、ログインせずにブラウザから直接この関数を呼び出せば、任意のスタッフの訪問予定(顧客名・訪問先の緯度経度を含む)を第三者が取得できる状態だった(High重大度)。

- `Schedule.js`: 両関数の第一引数を `staffName` から `token` に変更。`checkSession(token)` でログインを検証し、対象スタッフ名は必ずセッションから解決した本人名を使うようにした(クライアントが指定した名前は使わない)。無効なセッションでの呼び出しはログに記録する(`GetScheduleAccessDenied`/`GetRouteAccessDenied`)。
- `index.html`: 呼び出し箇所を `localStorage.getItem('GAS_AUTH_TOKEN')` を渡す形に変更。

**【セキュリティ修正】Driveの検索クエリインジェクションを修正(2026-08-11)**: `PastSchedule.js` の `findPastScheduleSpreadsheet_` が、`staffName` をエスケープせず `DriveApp.searchFiles` のクエリ文字列に結合していた。`staffName` に `'` を含む値を渡すとクエリの条件を書き換えられ、本アプリが `executeAs: USER_DEPLOYING` で動く(検索がデプロイ者=サービス管理アカウントの全Drive権限で実行される)ため、出勤簿以外のファイルの存在・内容を探索できてしまう可能性があった(Medium重大度、管理者権限が奪取された場合に到達可能な経路)。

- `escapeForDriveQuery_(value)` を追加し、`staffName` 中の `'` を `\'` にエスケープしてからクエリに埋め込むよう修正。日本語の氏名など `'` を含まない通常の値には影響しない(no-op)。

**管理者による全スタッフの予定確認・編集(2026-08-11)**: 「予定」タブでも「過去の予定」タブと同様、管理者が自分以外のスタッフの予定を確認できるようにした。

- `Schedule.js`: `getScheduleAccessContext_(token)`/`resolveScheduleTargetStaffName_(context, requestedStaffName)` を追加し(`PastSchedule.js` の `resolvePastScheduleTargetStaffName_` と同じパターン)、`getScheduleForDate`/`getRouteForStaffOnDate` に第三引数 `requestedStaffName` を追加した。管理者以外は `requestedStaffName` を渡しても無視され、常に本人の予定のみが返る。管理者が他スタッフの予定を取得した場合はログの `details` に操作者名も残す。
- `index.html`: 「予定」タブに管理者専用の「対象スタッフ」セレクタ(`getActiveStaffNamesForAdmin` で取得した在籍スタッフ一覧、デフォルト選択値はログイン中の管理者自身の名前)を追加した。選択を変更すると即座に選択スタッフの予定を再取得する。ルート・移動時間のブラウザキャッシュ(`localStorage`)も選択中の対象スタッフ名単位で分離される。

**`コード.js`を関心事ごとに分割(2026-08-18)**: 認証・Gemini連携・CSV取込・ログ基盤・顧客/日報保存が1ファイルに同居し肥大化していたため、`RouteSearch.js`/`PastSchedule.js`等と同様に関心事ごとのファイルへ分割した(ロジック変更なし、GASは全ファイルを1つのグローバル名前空間にまとめるため機能的な差異はない)。旧`コード.js`のうち何がどのファイルへ移ったかはCLAUDE.mdのファイル一覧を参照。

- `Main.js`(旧`コード.js`を改名): `doGet`・顧客DB読み取り(`getData`)・日報/事故報告保存・領収書アップロードなど、他の分割先に当てはまらない部分が残る。
- `Auth.js`: `verifyLogin`/`checkSession`・パスワードリセット/変更。
- `GeminiReport.js`: 日報/事故報告生成・領収書OCR・Gemini APIキー/モデルの管理者設定。
- `CsvImport.js`: 顧客CSVの自動取込・DB反映(`checkAndImportLatestCsv`/`updateDatabaseFromLinesV2`)。
- `Logging.js`: `logToBuffer`/`flushLogsToDrive` のログ基盤。

**環境依存ID(スプレッドシートID/GID・DriveフォルダID)を`Config.js`に集約(2026-08-18)**: `STAFF_SS_ID`/`SPREADSHEET_ID`/`RECEIPT_FOLDER_ID`等のIDがAuth.js/CsvImport.js/Logging.js/Main.js/PastSchedule.js/RouteSearch.jsの6ファイルに分散しており、別環境(別のGoogle Workspace)へ移行する際にどこを書き換えればよいか把握しづらかった。全てのIDを新規`Config.js`に1本化した。

- 移動する過程で、実は同じDriveフォルダIDが`AUTO_CSV_FOLDER_ID`(CsvImport.js、顧客CSV自動取込元)と`ROUTE_SEARCH_CUSTOMER_FOLDER_ID`(RouteSearch.js、住所取得用に同じCSVを読む)という別名で2箇所に重複定義されていたことが判明したため、`CUSTOMER_CSV_FOLDER_ID`という1つの定数に統合した。
- シート名・タブ名(`REPORT_SHEET_NAME`、`CUSTOMER_DB_NAME`等、データ構造に紐づく定数)は環境設定ではないため`Config.js`には集約せず、これまで通り各機能ファイル側に残している。

## PoC匿名化モードについて

`gas-childcare-report` にあった「個人情報を匿名化する(PoCモード)」機能(顧客名・住所・連絡先のランダム置換、`historicalNames.js` の人物名辞書、設定画面のトグル)は、本プロジェクトでは不要のため移植していない。顧客データは常に実データのまま表示・出力される。

## Google Chat Webhook通知について

LineWorks Bot API連携は廃止し、`GoogleChat.js` から素のWebhook POSTで通知する方式に変更した。

| 通知内容 | 送信元(`コード.js`) | 使用するスクリプトプロパティ |
| --- | --- | --- |
| 日報提出・事故報告・訪問完了(社内向け) | `saveReport`, `saveAccidentReport`, `sendVisitCompleteNotification` | `GCHAT_REPORT_WEBHOOK_URL` |
| 領収書登録 | `uploadReceiptsOnly` | `GCHAT_RECEIPT_WEBHOOK_URL` |

設定手順:

1. Google Chat で通知を送りたいスペースに「Webhook を管理」からWebhookを作成し、URLをコピーする(日報用・領収書用で2つ作成する)。
2. Apps Script エディタの「プロジェクトの設定」→「スクリプトプロパティ」に以下を追加する。
   - `GCHAT_REPORT_WEBHOOK_URL`: 日報用Webhook URL
   - `GCHAT_RECEIPT_WEBHOOK_URL`: 領収書用Webhook URL
   - (任意) `TEST_MODE`: `true` にすると、Webhook送信をスキップしてログ出力のみ行う(テスト時に通知が実際に飛ばないようにするためのフラグ)。

## ログについて

`gas-childcare-report` から移植した `logToBuffer(level, action, user, details)` が全体の記録機構。呼び出し内容はいったんスクリプトプロパティにバッファされ、`flushLogsToDrive`(10分おきの時限トリガー)がまとめてDrive上の月次CSV(`visitapp_log_YYYY-MM.csv`)に書き出す。

**⚠️ デプロイ後に必須の作業**: `setupLogTrigger()` をApps Scriptエディタから一度手動実行し、`flushLogsToDrive` の時限トリガーを作成すること。これを行わないと、`logToBuffer` の内容はスクリプトプロパティに溜まるだけでDriveには書き出されない。デプロイ手順にも記載している。

### 記録される操作(このプロジェクトで追加した機能)

複数の管理者・利用者が同じアプリを使う運用のため、権限拒否(WARN)と失敗(ERROR)は基本的に全て記録する。高頻度な単純閲覧(今日/明日の予定表示、過去の予定の閲覧そのもの)は成功時は記録しない(ログの肥大化を避けるため)。

| 機能 | ファイル | 成功時 | 失敗・権限拒否時 |
| --- | --- | --- | --- |
| 過去の予定の閲覧 | `PastSchedule.js` (`getPastScheduleForDate`) | 記録なし | 記録あり(未検出・エラー・無効セッション) |
| 過去の予定の修正保存 | `PastSchedule.js` (`updatePastSchedule`) | 記録あり | 記録あり |
| カレンダー→出勤簿の自動反映(手動) | `PastSchedule.js` (`syncPastScheduleFromCalendar`) | 記録あり | 記録あり |
| カレンダー→出勤簿の自動反映(毎晩の全スタッフバッチ) | `PastSchedule.js` (`autoSyncTodayScheduleForAllStaff`) | スタッフ単位で記録あり、完了時に対象数・成功数・失敗数を要約記録 | スタッフ単位で記録あり(他スタッフの処理は継続) |
| 管理者向けスタッフ一覧取得 | `PastSchedule.js` (`getActiveStaffNamesForAdmin`) | 記録なし | 記録あり(権限拒否・エラー) |
| 今日/明日の予定表示(管理者は他スタッフ指定可) | `Schedule.js` (`getScheduleForDate`) | 記録なし(高頻度閲覧) | 記録あり |
| ルート・移動時間取得(Maps API利用、管理者は他スタッフ指定可) | `Schedule.js` (`getRouteForStaffOnDate`) | 記録あり(コスト発生操作のため。他スタッフ分の場合は操作者名も記録) | 記録あり |
| Google Chat Webhook通知 | `GoogleChat.js` | 記録なし | 記録あり(未設定・HTTPエラー・例外) |
| Gemini APIキーの閲覧/変更 | `GeminiReport.js` (`getGeminiApiKeyForAdmin`/`saveGeminiApiKeyForAdmin`) | 記録あり(閲覧・変更ともにSECURITYレベル) | 記録あり(権限拒否・空文字拒否) |
| Geminiモデル設定の閲覧/変更 | `GeminiReport.js` (`getGeminiModelSettingsForAdmin`/`saveGeminiModelSettingsForAdmin`) | 記録あり(変更のみ) | 記録あり(権限拒否・未選択拒否) |
| Geminiモデル一覧取得 | `GeminiReport.js` (`listAvailableGeminiModelsForAdmin`) | 記録あり | 記録あり(権限拒否・APIエラー) |

上記以外(ログイン・日報/事故報告作成・領収書登録・パスワード変更など)は `gas-childcare-report` 由来の既存ログがそのまま機能している。

### 注意点

- ログ保存先のDriveフォルダ(`LOG_FOLDER_ID`)は `gas-childcare-report` と共通のものを使っている。**ファイル名は`visitapp_log_YYYY-MM.csv`で本アプリ専用**(`gas-childcare-report`側は`app_log_YYYY-MM.csv`のまま)。以前はファイル名プレフィックスも共通だったため両アプリのログが同じ月次CSVに混在していたが、2026-08-18に分離した(`LockService`はスクリプトプロジェクト単位のロックのため、共通ファイルへの同時書き込みでは互いのロックが効かず、取りこぼしのリスクもあった)。
- Gemini APIキーは設定画面を開くたびに(閲覧目的でなくても)`GeminiApiKeyViewed` が記録される。これは実際にキーの平文値がサーバーからブラウザへ送信されるタイミングを追跡するためで、管理者が「表示」ボタンを押したかどうかとは無関係。

## デプロイ手順（新規GASプロジェクトとして作成する場合）

1. このディレクトリで `clasp create --type webapp --title "保育訪問統合アプリ"` を実行し、新しいスクリプトIDを発行する（既存の `.clasp.json` は作成されないため、コマンド実行後に生成されたものを使う）。`RouteSearch.js` にカレンダー解析・ルート計算ロジックを統合済みのため、別プロジェクト(`gas-root-serach`)へのライブラリ追加・バージョン管理は不要。
2. `clasp push` でファイルを反映する。
3. スクリプトプロパティに既存の `gas-childcare-report` と同じ値（`GEMINI_API_KEY`, `AUTH_SALT` など）を設定する。
4. スクリプトプロパティに `GCHAT_REPORT_WEBHOOK_URL` と `GCHAT_RECEIPT_WEBHOOK_URL`（Google Chat Webhook通知について参照）を設定する。
5. Webアプリとしてデプロイし、Googleアカウントで初回アクセス時にカレンダー閲覧・Maps利用などのOAuthスコープを承認する。
6. Apps Script エディタで `setupLogTrigger` 関数を一度手動実行し、`flushLogsToDrive` の時限トリガー(10分おき)を作成する。**これを忘れるとログがDriveに書き出されない**(「ログについて」参照)。
7. Apps Script エディタで `setupAutoSyncTrigger` 関数を一度手動実行し、`autoSyncTodayScheduleForAllStaff` の毎日実行トリガー(22時台)を作成する。**これを忘れると、誰も手動で「カレンダーから反映」を押さない日の出勤簿が自動更新されない**(「毎晩全スタッフ分を自動反映するバッチを追加」参照)。
8. スタッフ用アカウントでログインし、「予定」タブを開いた時点で今日／明日の予定とルート・移動時間・地図リンクが自動的に表示されることを確認する(手動で「🚗」ボタンを押す必要がないことを確認)。顧客訪問の行に住所と地図リンクボタンが表示されること、事務作業に挟まれた顧客訪問(例: 事務作業→訪問→事務作業)でも、その訪問の出勤・退勤(または移動)の地図ボタンがどちらも欠けずに表示されることを確認する。
9. 「勤怠」タブを開いた時点で今日の詳細(移動・距離・その他パネル)が自動表示されることを確認する。週間予定カレンダーで別の日をタップすると、その日の詳細に自動的に切り替わることを確認する(日付入力・表示ボタンは廃止済み)。当月内の日で内容を修正し「保存する」を押して、出勤簿スプレッドシートに反映されることを確認する。
10. カレンダー予定と出勤簿の手入力内容が両方ある日で、1日表示ヘッダーの「📅 カレンダーから取得」を押すと確認ダイアログが表示され、OKを押すと変更点プレビュー(列ごとの旧値→新値)が表示されること、「取り込む」を押すとその内容だけが書き込まれ、カレンダーに対応する予定が無い手入力欄(時間帯が重ならないもの)は消えずに残ることを確認する。変更が無い場合は確認ダイアログなしで「変更なし」の通知のみになることも確認する。プレビューを表示しただけ(「取り込む」を押さずキャンセル/画面遷移した場合を含む)では「勤怠集計」シートが書き換わらないことも確認する(過去の不具合の再発防止)。管理者アカウントではタブ上部の「📅 一括反映(管理者用)」から日付範囲・スタッフを選び、進捗バー・完了後のメッセージ・失敗時の「失敗分のみ再実行」が機能することを確認する(書き込みロジックは非破壊マージに置き換わっているが、UI・操作フローは従来どおり)。別の端末でスプレッドシートを直接編集したうえで「🔄 勤怠シートから読込」を押すと確認ダイアログが表示され、OKを押すとカレンダーへは問い合わせずにその変更がすぐ画面に反映されることを確認する。週間予定の表示ラベル下に「更新: HH:MM」が表示され、週送りでキャッシュから表示した場合はキャッシュ保存時刻のまま、再読込・強制更新した場合は現在時刻に更新されることを確認する。
11. Apps Script エディタで `autoSyncTodayScheduleForAllStaff` を一度手動実行し、有効な全スタッフの当日分が個別出勤簿・「勤怠集計」の両方に反映されることを確認する(本番トリガー任せにせず、デプロイ時に一度動作確認しておく)。
12. 「勤怠」タブの週間予定カレンダーで、週送り(‹/›)・「今日」ボタン・日をタップした際の1日表示ドリルダウンが正しく動作し、出勤簿の実際の記録が表示されることを確認する。週間グリッド・1日表示のどちらでも、予定を直接タップすると(1日表示への切り替えを経て)編集モーダルが直接開くこと、その日の詳細がまだ読み込まれていないタイミングでタップした場合はモーダルが読み込み中の状態(スピナー)でまずすぐ開き、取得完了後に内容が実データへ差し替わることを確認する(取得中に他の日をタップして移動した場合、開いていたモーダルが自動的に閉じることも確認する)。埋まっている予定はタイムラインのタップで、空いている予定は1日表示ヘッダーの「＋ 勤怠を追加」から編集モーダルを開き、名称・時刻を修正して保存できること、「削除」で該当予定だけがクリアされることを確認する。週間表示(7日グリッド)の間は「移動・距離・その他」パネル・記録一覧が表示されず、1日表示に切り替えた瞬間に表示されることも確認する。「移動・距離・その他」パネル(1つの保存ボタンに統合済み)で、その日の実際の訪問件数に応じたグループ(訪問1件なら出勤・退勤の2グループ、2件なら出勤・移動・退勤の3グループ、3件なら4グループ全て)が実際の訪問先名を見出しにして表示され、訪問件数が少ない日に無関係な空欄グループが出ないことを確認する。天候トグルはタップした瞬間から選択(青)の見た目になり、フォーカスが外れるまで白背景になるようなことがないことも確認する(選択解除も含む)。買物代行・備考も同じパネルで編集・保存できること(買物代行に整数以外や負の値を入れると保存を拒否すること)を確認する(Googleカレンダー自体は変更されないことも確認)。週を素早く連続で送っても表示が乱れないこと、一度表示した週を再訪した際に読み込みスピナーが出ずすぐ表示されること(キャッシュ)、保存直後は最新内容に更新されること(キャッシュ破棄)も確認する。「📊 月次集計(勤怠・領収書)」モーダルで対象月を選び、出勤簿・領収書の実データに基づいた集計値が表示されることを確認する。
13. 管理者アカウントで「予定」タブの対象スタッフを切り替え、「勤怠」タブに移動しても同じスタッフが選択されていること(逆方向: 勤怠タブで切り替えて予定タブを確認する場合も同様)を確認する。切り替え時にタブが強制的に切り替わらないこと(裏のタブのデータだけが更新されること)も確認する。単日の「📅 反映」を押してプレビューを表示した後、「取り込む」を押さずにキャンセルした場合、「勤怠集計」シート(Driveの勤怠集計スプレッドシート)にその日・そのスタッフの行が(意図せず)追加・更新されていないことを確認する。実際に「取り込む」を押した場合は、個別出勤簿と「勤怠集計」の両方が正しく更新されることを確認する。
14. 日報を保存せずにアプリを閉じ(または×ボタンで閉じ)、再度アプリを開いてログインする。ログイン画面が表示されている間に未保存の日報ダイアログが開かないこと、ログインが完了してから初めて自動で復元ダイアログが表示されることを確認する(意図的に長時間待ってから開き、その間に自動データ更新([新しいデータが見つかりました]のトースト)が起きるパターンでも同様に確認できると良い)。
15. Drive上のログフォルダに `app_log_YYYY-MM.csv` が生成され、上記の操作(特に失敗させた操作)が記録されていることを確認する(トリガー実行後、最大10分程度のずれがある)。
16. 本アプリのリリース後、`gas-integrated-system` のWebアプリ公開を停止する(廃止確認済み)。`gas-root-serach` の `autoRunSaveAttendance()` と `gas-childcare-daily-report` の `autoRunDailyTransfer()` の夜間トリガーは、本アプリの `autoSyncTodayScheduleForAllStaff` で代替済みのため削除してよい。`gas-root-serach` の `main()`(翌日分のルート集計・LINE WORKS通知)が業務上不要であれば、そのトリガーも削除しプロジェクトを廃止する(詳細は「`gas-root-serach` の本体統合」参照)。
