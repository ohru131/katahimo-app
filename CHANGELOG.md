# 更新履歴 (CHANGELOG)

> 旧モノレポ `C001-cutest-internal/01_GAS/CHANGELOG.md`(全プロジェクト横断)から、katahimo-app に関するエントリ(Ver. 1.1.0〜1.1.23、Phase 0〜Phase 5継続)のみを抜粋・独立化したもの。それ以前(Ver. 1.0.x以前)は katahimo-app 誕生前の他 `gas-*` プロジェクトのエントリのため含めていない。Ver. 1.1.23 は `gas-childcare-visit-app`(GAS版、旧モノレポに残置)側の `Bridge.js` 変更も含む合同エントリだが、katahimo-app 側の変更点の文脈として必要なためそのまま残してある。今後この新リポジトリでの更新はこのファイルに追記していく。

## [Ver. 1.1.27] - 2026-09-10

### katahimo-app(マイグレーションの1本化と、将来機能のためのテーブル追加18本)

利用者から「まだ実運用前なので、過去のデータベースの互換性や履歴保存などは不要。クリーンな
コードにしてほしい」「データベースの有識者レビューを行うので、将来機能のためのデータベースも
追加してほしい」との指示を受けての対応。

- **マイグレーションを1本に統合した。** `0000`〜`0015` の16本を削除し、現行スキーマから生成した
  `0000_baseline_schema.sql` 1本に置き換えた。統合前は途中に「暗号化列を平文列に置き換える」
  「領収書の金額textを整数列に分ける」「勤怠row_dataのキーを列記号から意味のある名前に変える」
  といった破壊的変更と、そのためのバックフィル用plpgsql関数
  (`parse_receipt_amount_yen`/`attendance_column_row_to_row_data`/`parse_date_only` 等)が
  含まれていたが、移行対象のデータが存在しない以上、最終形の把握を妨げるだけなので残していない。
  - 既存のローカル開発用PostgreSQLは作り直しが必要(`drizzle.__drizzle_migrations` に古い
    ハッシュが記録されているため増分では当たらない)
  - 公開デモ(ブラウザ内PGlite)は `REBUILD_REQUIRED_MIGRATIONS = ['0000_baseline_schema']` により、
    古いタグしか持たないIndexedDBのDBを自動で作り直す。段階的なバックフィルを検証していた
    `packages/demo/src/migrationBackfill.test.ts` は、対象のSQLが無くなったため削除した
- **顧客カルテを追加した**(`customer_notes` / `customer_note_photos`)。カルテ(経過記録)・
  申し送り・鍵の位置・ガレージ場所・引き継ぎ事項・注意点を、区分を持つ1テーブルで表し、
  写真を子テーブルに持たせた。`customers` の列にしないのは、上書きになるため「いつ誰がその
  情報にしたか」が残らず、訪問前に読む情報が誤っていたときに経緯を辿れないため
- **予約(RESERVA移植版)を追加した**(`service_menus` / `reservations` /
  `reservation_assignments` / `staff_availabilities`)。予約(約束)と日報(実施記録)は
  片方だけ存在する状態が正常にあり得るため分け、`daily_reports.reservation_id` で紐付ける
  (1つの予約に日報が2件付かないよう部分一意索引を張った)。スタッフの割当は別テーブルにし、
  主担当が1予約に1人までであることを部分一意索引で保証する
- **Stripe決済を追加した**(`customer_payment_profiles` / `invoices` / `invoice_lines` /
  `payments` / `stripe_webhook_events`)。カード番号は受け取らず保存しない(Stripeが返す
  識別子と表示用のブランド名・下4桁のみ)。状態の語はStripeのInvoice status /
  PaymentIntent statusに合わせ、対応表を持たない。請求書は合計を保存しつつ
  `total = subtotal - discount + tax` をCHECK制約で強制する。Webhookは
  `(tenant_id, stripe_event_id)` の一意制約で冪等化する。`invoice_lines` は
  `coupons.ts` のコメントが「まだ無い」と書いていた請求機能に相当し、
  同じ領収書・同じクーポン適用が2つの明細に載らないよう部分一意索引を張った
- **訪問割当の最適化パラメータを追加した**(`trait_definitions` / `customer_traits` /
  `staff_traits` / `staff_customer_compatibilities` / `staff_customer_travel_estimates`)。
  何を見て最適化するかが今後のヒアリングで決まるため、特性の項目自体をデータにした。
  値はjsonbの塊にせず型ごとに列を分け(「ちょうど1つだけ非NULL」をCHECK制約で縛る)、
  SQLから絞り込めるようにしている。相性は「スコア」と「絶対に組ませない(`avoid`)」を
  別の列にした(人員が足りない日に自動割当が `avoid` を押し通す事故を防ぐため)。
  スタッフ自宅からの距離を出すため、`staff` に `home_address`/`home_lat`/`home_lng` を追加した
- **移動手段別の手当を追加した**(`transport_allowance_rules` / `travel_legs`)。
  自動車・公共交通機関・自転車・徒歩を選べるようにし、手段ごとに計算方法(距離比例/
  1移動あたり定額/1日あたり定額/実費精算)と単価を持つ。**確認したところ、金額への換算
  ロジックは本アプリにもGAS版にも存在せず**(距離合計と基準距離超過回数を出すところまで)、
  単価に相当する定数も無かったため、既存ロジックの修正ではなく新規追加になっている。
  勤怠 `row_data` を入力にした計算はGAS版との数値一致を崩さないためそのまま残し、
  `travel_legs` は手当の算定と移動実績の記録に使う(`doc/14` B項第2段階の受け皿)
- **CHECK制約に定数を埋めるときの落とし穴を1つ潰した。** drizzleの `sql` テンプレートに
  JavaScriptの値を `${}` で直接埋めるとリテラルではなくバインドパラメータになり、
  `CHECK (... <= $1)` という適用できないDDLが生成される(実際に
  「there is no parameter $1」でマイグレーションが落ちた)。`schema/_sqlLiteral.ts` に
  `sqlNumber()` を用意して必ずそこを通す形にした。区分値も同ファイルの `sqlInList()` 経由で
  `packages/shared/src/contracts/` の配列から組み立て、DDLへのベタ書きをやめている
- **有識者レビュー用の資料 `doc/15_将来機能のデータベース設計.md` を追加した。**
  各テーブルの設計理由と、まだ決めきれていない論点(予約のダブルブッキングをDBで止められて
  いないこと、`btree_gist` がPGliteで使えないため排他制約が採れないこと、EAV形式を項目確定後も
  維持すべきか、など)をまとめた
- `packages/db/src/rlsPolicies.test.ts` と `packages/db/src/updatedAtTriggers.test.ts` は
  検査対象をスキーマ定義のexportから自動で集めるため、追加した18テーブル分のRLS
  (ENABLE + FORCE + ポリシー)と `updated_at` トリガーの検査が自動で増えている
  (それぞれ101件・32件のテストが通っている)

## [Ver. 1.1.26] - 2026-09-10

### katahimo-app(`doc/14` A〜G項の実施: 金額・勤怠row_data・インデックス・CHECK制約・updated_atトリガー・日付型・緯度経度、および割引クーポン・領収書の請求区分)

`doc/14_データベース改修方針.md` に記載した「相談を要さない確定分」の改修を、`0008`〜`0013` の
6本のマイグレーションで実施した。あわせて利用者からの要望だった割引クーポンの適用記録を
`0014` で追加した。

- **直前のコミット(`2630299`)がレビューを通さず直接mainへpushされていた**ため、まずそこで
  混入していた2件の問題を修正した(katahimo-appのCIが赤のまま残っていた)。
  - `pnpm lint` のフォーマット違反でCIが落ちたままだった。`packages/worker/probeBridge.mts` の
    フォーマット違反が唯一のエラーで、加えて `biome.json` の `$schema` が `2.3.0` を指しているのに
    lockfileが解決するbiomeは `2.5.10` だったため、バージョン差による「手元では通るがCIで落ちる」
    形式差が出ていた(`$schema` を `2.5.10` に揃えた)。ついでに `packages/demo/src/index.ts` の
    未使用import、`packages/db/src/schema/appSettings.ts` の未使用引数も直した
  - `z.coerce.boolean()` は中身が `Boolean(値)` なので、空文字列以外はすべて `true` になる。
    `.env.example` が `MIRROR_ATTENDANCE_AGGREGATE=false` と勧めているとおりに書くと、オフの
    つもりの設定が**そのまま有効化されていた**。`MIRROR_ATTENDANCE_AGGREGATE` はジョブ1件ごとに
    GAS側でMapsのルート計算が走るため既定オフにしてある安全装置で、それが効かない状態だった。
    `true`/`false`/`1`/`0` のみを受け付ける `booleanEnv()` に差し替え、それ以外の表記(`yes`/`on`等)
    は黙って既定値に倒さず起動時に落とすようにした。`packages/api/src/env.test.ts` を新規追加し、
    `"false"` が `false` になることを固定した
- **A項: 領収書の金額を整数列にした**(`0011`)。`receipts.amount`(text)を `amount_yen`
  (集計・請求用の整数)と `amount_raw`(OCRの生文字列)に分割。`dedupe_key` はGAS版 `buildKey`
  と1文字も違えないよう従来どおり文字列正規化から作り、`amount_yen` を材料に使い替えていない
- **B項: 勤怠 `row_data` を意味のあるキー・数値にした**(`0012`、段階1)。スプレッドシートの
  列記号(`C`/`D`/`AG`…)を `visits`(訪問の配列)/`officeWork`(事務作業の配列)/`commuteDistanceKm`
  等の意味のあるキーに変更。計算ロジック(`attendanceCalc.ts`、GAS版との数値一致を19ケースで
  検証済み)は1行も変えず、境界に `toColumnRow()`/`fromColumnRow()` を置いて変換する。
  **`doc/14` は「配列化で訪問3件・事務2件の上限が外れる」としていたが、`attendanceCalc.ts` 自体は
  引き続き3件・2件までしか計算できないため、上限をデータ構造(jsonb・zodスキーマ)には持たせず、
  アプリの入口(API)で明示的に400として拒否する形にした**(黙って4件目以降を捨てると、給与に
  直結する値が気付かれずに失われるため)
- **C項: 主要な検索経路にインデックスを張った**(`0008`)。PostgreSQLは外部キーの参照する側に
  索引を自動作成しないため、`daily_reports`/`accident_reports`/`family_members` は主キーのみ、
  という状態だった。「顧客の日報履歴」を開くたびに走る `listByCustomer` 等を索引だけで返せるよう、
  `(tenant_id, customer_id, occurred_at DESC)` 等の複合インデックスを追加した
- **D項: 値域をDBのCHECK制約で縛った**(`0009`)。Drizzleの `text({ enum: [...] })` は
  TypeScript上の型付けにすぎずDBには何も生成されないため、`psql` から直接でたらめな値を
  書き込めた(`outbox_jobs.status`・`accident_reports.report_type` 等)。マイグレーションで
  CHECK制約を追加し、あわせて入口(API)側も許可された値かどうかで判定するよう直した
- **E項: `updated_at` をDBトリガーで一元管理するようにした**(`0010`)。`customers` では実際に
  アプリのコードが `updated_at` をセットし忘れており(`customerRepository.ts` の
  `update()`/`deactivate()`)、行を作った時刻のまま永久に止まっていた。ミラー書き込みの冪等キーが
  更新時刻を材料にしているため、この書き忘れが他のテーブルで再発すると編集内容がスプレッドシート
  へ永久に反映されなくなる危険があった。`set_updated_at()` トリガーを対象9テーブルに張り、
  張り忘れをCIで検出する静的検査(`updatedAtTriggers.test.ts`)を追加した
- **F項: 日付・時刻の文字列を型のある列にした**(`0013`)。`family_members.dob`/
  `accident_reports.target_dob`(text)を日付型+元表記の2列に、`daily_reports.start_time`/
  `end_time`(text、未入力は空文字)を `started_at`/`ended_at`(timestamptz、未入力はNULL)に
  変更。`occurred_at` と `started_at` は同じ情報の二重管理になるため、同じDateオブジェクトを
  共有させて構造的に食い違いを起こせないようにした
- **G項: 緯度経度を数値2列にした**(`0013`)。`customers.lat_lng`(text)はコードのどこでも
  解析されず素通りしているだけだったが、秘密保持契約(案)第4条は「座標化して仙台市へ報告する」
  と定めており矛盾していた。`lat`/`lng`(`numeric(9,6)`、範囲外はCHECKで拒否)+ `lat_lng_raw`
  に分割し、RESERVA CSVの「緯度・経度」列を分解する `parseLatLng` を追加した
- **H項(役割の重複したインデックスの削除)は `doc/14` 自身の誤りだった**。指摘していた
  `outbox_jobs_tenant_status_created_at_idx` は `0002_outbox_retry.sql` で既に `DROP` 済みで、
  `doc/14` は `0000` での作成だけを見て `0002` の `DROP INDEX` を読み落としていた。`0013` に
  `DROP INDEX` は含めず、`doc/14` 側を訂正した
- **(別枠)領収書に請求区分を持たせた**(`0011`)。「ガレージ代など、顧客に請求する分と会社が
  立て替える分を分けたい」という要望に対応し、`receipts.billing_type`
  (`customer_billable`/`company_expense`、既定は取りこぼしが安全側に転ぶ `company_expense`)を
  追加した。顧客に紐付かない領収書は顧客請求にできないことをCHECK制約でも縛った
- **(別枠)割引クーポンの適用記録を持てるようにした**(`0014`、これも利用者からの要望)。
  `coupons`(テナントごとの種別マスタ)と `coupon_redemptions`(日報1件への適用記録)の2テーブルを
  追加した。回数券(枚数を発行して減らしていくもの)は運用に無いことを確認できたため、
  `doc/12` 相談⑧として保留していた「残枚数の持ち方」の分岐は消え、判断不要になった。適用記録
  側には適用時点の割引条件をスナップショットして持たせる(マスタの書き換えで過去の記録が動かない
  ようにするため)。日報の作成/更新と適用記録の保存は同じトランザクションで行う

各マイグレーションでPGlite上の静的検査・挙動検証を追加している
(`packages/demo/src/checkConstraints.test.ts`・`updatedAtTrigger.test.ts`・`typedColumns.test.ts`、
`packages/db/src/updatedAtTriggers.test.ts`、`packages/core/src/domain/attendance/columnRow.test.ts`、
`packages/core/src/usecases/coupons.test.ts` 等)。データ形式そのものが変わる破壊的マイグレーション
(`0011`〜`0013`)は増分適用すると既存行を引き継げないため(SQLの差分は小さくても中身の表現が
変わる)、公開デモの作り直し対象(`REBUILD_REQUIRED_MIGRATIONS`)にも追加した。

`doc/09_データベース構造解説.md` を現在のスキーマに合わせて更新した(第1章にCHECK制約・
`updated_at` トリガー・インデックスの方針を追加、第2章ER図・第4章テーブル一覧・第4.1節の
`customers` 列一覧(35列→37列、`lat_lng`→`lat`/`lng`/`lat_lng_raw`)を更新)。

検証: `pnpm lint`(300ファイル、エラー無し)/ `pnpm -r --parallel typecheck`(9パッケージすべて
Done)/ `pnpm test`(54ファイル・522テストすべて成功。**`packages/demo/src/cookieJar.test.ts` は
失敗しておらず、`doc/14` にあった「先に解消する」という記述は誤りだったため訂正した**)/
`pnpm --filter @katahimo/web build` + `scripts/assertNoDemoInBuild.mjs`(デモ用コードの混入無し)/
`pnpm --filter @katahimo/web build:demo`。ローカルPostgreSQL(Docker)を通した実機確認は、この
作業環境にDockerデーモンが無いため未実施。

## [Ver. 1.1.25] - 2026-09-10

### katahimo-app / gas-childcare-visit-app(Phase 5の積み残し: 勤怠集計シートのミラーを実装、カレンダーのミラーは対象外に確定)

「Phase 5の積み残しがあれば実装してほしい」との依頼を受け、Ver. 1.1.23 で「次フェーズ」として
残していたミラー2種類(`attendance_aggregate`・`calendar_event`)を調べ直したうえで、
勤怠集計シートのミラーを実装し、カレンダーのミラーは対象外として`MirrorKind`から外した。

- **`calendar_event`を対象外にした根拠**: GAS版はGoogleカレンダーを**読むだけで一度も書き込んで
  いない**(`RouteSearch.js`の`CalendarApp`呼び出しは`getEvents`/`getMyStatus`のみ)。予定の
  作り手はRESERVAの予約連携とスタッフの手動操作であり、新システムから書き戻す先そのものが
  存在しない。ポート定義に置いていた種別が推測で先行していただけだったため、`MirrorKind`から
  削除した。`CalendarPort`(実装を持たない型だけの状態)は、カレンダーを新システム側で編集する
  要件が出たときの置き場所として残し、未使用であることをコメントに明記した。
- **`attendance_aggregate`は「値を送らない」ミラーとして実装した**: 勤怠集計シートは
  katahimo-appの入力値ではなく、カレンダーの予定とMapsのルート計算から導かれる派生データで、
  1行=予定1件(種別・顧客名・開始/終了・移動時間・距離・各ルートURLの17列。
  `ATTENDANCE_SHEET_HEADER`)という形をしており、`attendance_days`が持つ出勤簿の入力列とは
  形も出自も違う。DBの値を書き写せないため、この種別だけは対象スタッフ名と日付だけを渡して
  **GAS側に再計算をやり直させる**形にした(`AttendanceAggregateMirrorPayload`)。
- **`gas-childcare-visit-app`側**: `Bridge.js`に`writeAttendanceAggregate` actionを追加。
  `computeAttendanceRowDataForStaffOnDate_`で計算し`writeAttendanceAggregateRows_`で該当スタッフ・
  該当日の既存行を消してから書き直す(GAS版`refreshAttendanceForStaffOnDate`からセッション検証・
  管理者チェックを外したものと同じ。読み取り側の`bridgeSchedule_`と同じくkatahimo-app側の権限
  チェックに委ねる)。個別出勤簿には触らない(`writePastScheduleRowData_`まで呼ぶと、
  katahimo-appが正としている出勤簿の値をカレンダー由来の値で上書きしてしまうため)。
- **既定では積まない**(`MIRROR_ATTENDANCE_AGGREGATE=false`): ジョブ1件ごとにGAS側でMapsの
  ルート計算が走るため、勤怠の保存ごとに無条件で積むと編集の回数だけMapsを消費する。GAS版自身も
  「この日をカレンダーから反映」ボタンと夜間トリガーの2経路だけで再計算しており、勤怠の保存ごとには
  走らせていない。あわせてワーカーのブリッジ呼び出しタイムアウトを`GAS_BRIDGE_TIMEOUT_MS`
  (既定20秒)で延ばせるようにした(勤怠集計の再計算は予定件数分のMaps呼び出しを含むため
  他のactionより時間がかかる。打ち切られてもジョブは再試行待ちに戻るだけで、行を消してから
  書き直す形なので再送で二重にならない)。
- **スタッフ名が引けない場合は即デッドレター**: 勤怠集計シートの行はスタッフ名で突き合わせる
  ため、`attendance_day`のミラーのように空文字へフォールバックすると、GAS側がどのスタッフの行を
  消して書き直すか決められず他スタッフの行を巻き込みかねない。再試行しても引けるようにはならない
  ので`PermanentMirrorError`で打ち切る。
- **未知の種別の扱いを整理した**: `outbox_jobs.kind`はDBでは`text`列で`DrizzleOutboxRepository`が
  `MirrorKind`へ無検査キャストしているため、`MirrorKind`に無い値(廃止した種別の積み残し等)が
  ワーカーに届くことは実際に起こりうる。デッドレターに落とす分岐の根拠をこれに置き換え、
  回帰テストも`calendar_event`ではなく未知の種別で固定するようにした。

検証は次の3段で行った。

1. **ワーカー側(usecase)**: `pnpm test` に勤怠集計のミラー3件を追加(積む/積まない/スタッフ名が
   引けない場合のデッドレター)。全体で336件パス。
2. **送信の実物(HTTP)**: `GasBridgeMirrorSenderPort`をBridge.jsの代わりのダミーHTTPサーバーへ
   実際にPOSTさせ、`?api=1&action=writeAttendanceAggregate&secret=...`と本文
   `{staffName, businessDate}`がBridge.js側が読むフィールド名と一致すること、GAS側の
   `success:false`と到達不能がどちらも例外になること(=成功扱いでジョブを捨てない)を確認した。
   GAS版はこのリポジトリの外にあり型で繋がらないため、回帰テストとして残した
   (`packages/integrations/src/gas-bridge/gasBridgeMirrorSenderPort.test.ts`)。
3. **Bridge.js側(GASコードをNodeで実行)**: `LockService`/`PropertiesService`/`ContentService`と
   `computeAttendanceRowDataForStaffOnDate_`/`writeAttendanceAggregateRows_`/
   `writePastScheduleRowData_`をスタブに差し替えて`Bridge.js`を`node:vm`で読み込み、
   `bridgeWriteAttendanceAggregate_`の20項目を確認(正常系で勤怠集計に1回だけ書く・
   **個別出勤簿には一度も書かない**・staffName/businessDate欠落や計算例外やロック取得失敗では
   シートに部分反映せず`success:false`を返す・いずれの経路でもロックを解放する・`doPost`の
   ルーティングとsecret検証)。全項目パス。

`pnpm -r typecheck`は9パッケージすべてDone。`pnpm lint`はこの作業機(`core.autocrlf=true`)では
作業ツリーがCRLFになりBiomeの既定(LF)と食い違って全ファイルが落ちるため、変更ファイルをLFに
正規化して`biome check`を通した(変更前後で全体のエラー件数は273件のまま同数)。
`packages/demo/src/cookieJar.test.ts`の7件の失敗は本変更前から出ている既存の失敗。

**未検証**: 実際のGoogleスプレッドシート「勤怠集計」への反映と、ローカルPostgreSQLを通した
`pending`→`done`の遷移。前者はBridge.jsの本番デプロイ承認待ち(他の書き込みactionと同じ)、
後者はこの作業機に開発DBの資格情報(`.env`)が無いため。

## [Ver. 1.1.24] - 2026-09-10

### katahimo-app(データベース暗号化の見直し: フィールド暗号化を資格情報のみに縮小)

2026-08 のレビュー(Ver. 1.1.22)で要配慮項目に絞ったアプリ層のフィールド暗号化を、さらに
`app_settings`の資格情報3項目(Gemini APIキー・Google Chat Webhook URL 2本)だけに縮小した。
背景は3つ。(1) 実証協力事業者との秘密保持契約(案)第6条が求める安全管理措置は「アクセス制限、
通信および保存時の暗号化、パスワード管理等」であり、フィールド単位の暗号化は要求されていない
(保存時の暗号化は本番配備先のCloud SQLの既定機能で満たす想定(本番は未配備のため、配備時の前提条件として整理)。第3条2/第4条の統計化・匿名化・仮名化は
出力側の要件で、DBが平文であるほうがSQLで実施しやすい)。(2) 日報・事故報告・勤怠・領収書を
SQLで絞り込み・集計・全文検索したい(検索性)。(3) 日報データのAI活用を見越すと、都度復号と
鍵の配線が分析側まで広がるのを避けたい。

- **平文化した項目**: 顧客(緊急連絡先・続柄・避難場所・メモ・Benefit会員ID・緯度経度)、世帯構成員
  (氏名・生年月日・付帯情報)、日報本文、事故報告本文、勤怠rowData、領収書(金額・店舗名・申し送り)。
  `*_ciphertext`/`*_key_version`の列ペアは`app_settings`の3ペアだけになった。
- **日報/事故報告の本文は項目ごとの`text`列に分離**(`daily_reports.start_time/end_time/input_text/
  internal_text/customer_text`、`accident_reports.target_name/target_dob/occurrence_time/location/
  accident_content/situation/immediate_response/parent_correspondence/diagnosis_treatment/prevention/
  input_text`。`DailyReportContent`/`AccidentReportContent`と1:1)。勤怠は列記号キーの動的オブジェクト
  で常に1日分をまるごと読み書きするため`attendance_days.row_data jsonb`(リポジトリ内で初のjsonb列)。
- **ブラインドインデックス(HMAC)を廃止**: `receipts.dedupe_blind_index`→`receipts.dedupe_key`。
  `buildReceiptDedupeKey()`の正規化済み文字列をそのまま保存し等値一致で重複検出する(GAS版`buildKey`
  と同じ挙動)。`BlindIndexPort`/`LocalBlindIndexPort`/`domain/pii/blindIndex.ts`と、その鍵だった
  環境変数`LOCAL_DEV_MASTER_KEY`を削除した。
- **資格情報は暗号化を維持**(個人情報ではなく検索/AI活用の対象外、DBダンプ流出時にAPIキーが平文で
  漏れるのを防ぐ)。エンベロープ暗号化・`tenant_keys`のDEK世代・`LocalKmsPort`・`AuditLogPort.recordDecrypt`
  は従来どおり。usecasesから`crypto`/`blindIndex`依存を外し、復号するのは管理者設定の読み出し・
  Gemini呼び出し・Chat通知の3経路のみ。
- **`tenant_keys.revoke()`の効果範囲が変わった**: 暗号学的削除が及ぶのは資格情報だけ。顧客等の業務
  データの返還・廃棄(NDA第7条)はテナント単位の物理DELETE+バックアップ保持期間の満了で担保する
  (README「データ保護の方針」・`doc/09`§1.3のNDA対応表に明記)。
- **ミラーワーカーは復号しなくなった**ため、`packages/worker`から`LOCAL_DEV_KEK`・KMS/暗号化まわりの
  配線を削除。APIサーバーは資格情報の復号のため引き続き`LOCAL_DEV_KEK`が必要。
- **マイグレーション`0005_drop_field_encryption`(暗号化列・blind index列の削除)/`0006_plaintext_columns`
  (平文列の追加)/`0007_receipts_dedupe_key_unique`(`(tenant_id, dedupe_key)`の部分一意インデックス。
  同時アップロードが`findExistingDedupeKeys`をすり抜けてもDB側で重複を止め、usecaseは一意制約違反を
  通常の重複として扱う。CodeRabbitの指摘で追加)**。同一テーブルでの列追加・削除を2回に分けて
  generateするのはVer. 1.1.22と同じ回避策。**既存の暗号化済みデータは引き継がない**(復号移行スクリプト
  は作らない)。`NOT NULL`列には`DEFAULT ''`/`'{}'`を付けてあるので行が残っているDBでも適用は通るが本文は
  空になるため、ローカル開発DBは`pnpm db:migrate`→`pnpm db:seed`で作り直す。公開デモは旧スキーマの
  IndexedDBを検知(`REBUILD_REQUIRED_MIGRATIONS`)して自動で作り直す。
- ドキュメント: README「PII暗号化の方針」を「データ保護の方針(2026-09 見直し)」に書き換え(NDA対応表を
  追加)、`doc/09_データベース構造解説.md`のER図・§1.3・§3・§4.1・§5、
  `doc/11_アーキテクチャ説明スライド.html`のデータ保護スライドを更新。

`pnpm lint` / `pnpm typecheck` / `pnpm test` で確認。

## [Ver. 1.1.23] - 2026-08-30

### katahimo-app / gas-childcare-visit-app(Phase 5継続: outboxミラー基盤+日報/事故報告/領収書/勤怠のGAS版スプレッドシート/Driveへのミラー書き込みを実装)

「次のフェーズを実装してほしい」との依頼を受け、Phase 5のうち未着手だったSheets/Driveミラー
書き込み(`outbox_jobs`)を、日報・事故報告・領収書・勤怠(出勤簿)の4種類に絞って実装した
(`attendance_aggregate`・`calendar_event`は次フェーズ)。

- **outbox基盤**: `MirrorPort`(積む側)に加え、ワーカー用の`OutboxRepositoryPort`
  (`claimPending`/`markDone`/`markFailed`)・`MirrorSenderPort`(送る側、GAS側の列にそのまま
  書き込める形のペイロード)を追加。`DrizzleOutboxRepository`が`FOR UPDATE SKIP LOCKED`で
  安全にジョブを取得する。`outbox_jobs`はRLS対象のため、ワーカーはテナントごとにポーリングする
  (`TenantRepositoryPort.listAll()`を追加)。
- **usecase側**: `saveDailyReport`/`saveAccidentReport`/`uploadReceipts`/`saveAttendanceDay`が
  DB保存成功後に`mirror.enqueue()`でジョブを積むようにした。`MIRROR_TO_GOOGLE_SHEETS=false`
  (既定)の間は`NoopMirrorPort`で積み込み自体を行わない。
- **ワーカー(`packages/worker`)**: 新規に環境変数検証・DIコンテナ・ポーリングループを実装
  (これまで`console.log`のみの空実装だった)。`packages/core/src/usecases/mirrorWorker.ts`が
  ジョブの種別ごとにDBの最新値を読み直し・復号し、`GasBridgeMirrorSenderPort`経由でBridge.jsへ
  送る(GAS_BRIDGE_URL/SECRET未設定時は`NoopMirrorSenderPort`)。
- **`gas-childcare-visit-app`側**: `Bridge.js`に`doPost(e)`と書き込みaction
  (`writeDailyReport`/`writeAccidentReport`/`writeReceipt`/`writeAttendanceDay`)を追加。
  日報/事故報告シートはkatahimo-app側のreportIdを追跡する`KatahimoReportId`列を追加し、
  再送(編集保存)時に該当行を上書きする。領収書はGAS版`processReceiptImages`をそのまま呼ぶ
  (重複判定もGAS版に委ねる)。勤怠(出勤簿)はPastSchedule.jsの書き込み先を直接上書きする
  (自動ミラーのため月ロック制限・セル背景色ハイライトは適用しない)。

`pnpm -r typecheck` / `pnpm test`(132件、`mirrorWorker.test.ts`5件を追加)/ `pnpm lint` で
確認済み。ローカルAPI+ローカルワーカー+ダミーのHTTPサーバー(Bridge.js write actionの代替)で
実際に4種類とも動作確認した: (1) ブリッジ到達不能時、ジョブが例外を投げず`failed`
(`lastError`にエラー内容記録)へ遷移し次のポーリングを止めないこと、(2) ダミーサーバーに
届いたペイロードのJSON構造がBridge.js側の`payload.xxx`フィールド名と一致すること、
(3) 4種類とも`pending`→`processing`→`done`まで遷移すること。**Bridge.jsの書き込みaction自体は
本番デプロイ承認待ち(未実施)のため、実際のGoogleスプレッドシートへの反映確認はまだ**。

## [Ver. 1.1.22] - 2026-08-30

### katahimo-app(2026-08 データベース構造レビュー対応: PII暗号化範囲の見直し+鍵管理をエンベロープ暗号化に変更)

有識者(セキュリティ・DB設計)レビュー用の解説資料(`doc/09_データベース構造解説.md`)を用意した
うえで、2件の指摘に対応した。

- **PII暗号化の対象を要配慮性の高い項目に絞った**: 「氏名・メール・電話・住所等まで含む全面
  フィールド暗号化はDB個別対応として過剰、バックアップ暗号化(TDE)+RLS+アクセス制御で通常の
  SaaSと同水準の保護で足りる」という指摘を受け、`customers`/`staff`の氏名・かな・メール・電話・
  住所・駐車場情報を平文カラムに戻し、ブラインドインデックス列(`*_blind_index`)を全廃した
  (「苗字だけで検索」はこの平文カラムへの通常のインデックス検索に変更)。引き続き暗号化するのは
  緊急連絡先・避難場所・顧客メモ・Benefit会員ID・緯度経度、および世帯構成員/日報/事故報告本文/
  領収書明細/管理者設定のAPIキー等(要配慮性が高い・第三者情報・自由記述・識別子)。
- **鍵管理をマスターキー1本の決定的導出からテナントごとのエンベロープ暗号化に変更**: 旧実装
  (環境変数のマスターキー1本からテナントIDを混ぜてSHA256で鍵を導出)は「マスターキーが漏れれば
  全テナントの鍵を誰でも再計算できる、実質1本の鍵を共有しているのと同じ」という指摘を受け、
  `KeyManagementPort`(KEK)/`TenantKeyRepositoryPort`を新設し、テナントごとに`crypto.randomBytes`
  で独立生成したDEKをKEKでラップした状態のみ`tenant_keys`テーブルに保存する方式に置き換えた
  (平文DEKはプロセス内メモリにしかない)。ローカル開発実装は`LocalKmsPort`(環境変数`LOCAL_DEV_KEK`
  1本でAES-256-GCMラップ)。テナント解約時は`tenant_keys`の該当行を削除するだけで暗号学的削除が
  行える。あわせて`AuditLogPort`(`ConsoleAuditLogPort`)を追加し、`CryptoPort.decrypt`のたびに
  テナントIDと時刻をstdout(Cloud Loggingに取り込まれる)へ記録するようにした(呼び出し元
  スタッフまでの記録は影響範囲が大きいため今回は見送り)。

`pnpm -r typecheck` / `pnpm test`(127件)/ `pnpm lint` で確認済み。ローカルPostgreSQLへ
マイグレーション(0007〜0009)を適用し、既存データの平文カラムへの移行・DEKの遅延生成・
暗号化済み項目(緊急連絡先等)の復号まで一気通貫で動作確認済み。

## [Ver. 1.1.21] - 2026-08-29

### katahimo-app(日報/事故報告の重複保存修正、AI生成・OCR失敗時のエラー表示改善)

利用者から「日報の保存を複数回押すと同じ内容がDBに重複登録される」「AI生成失敗時に不親切な
エラーが出る」「領収書OCR失敗時に何もエラーが出ない」という報告を受け、GAS版
(`index.html`の`savedReportsState`/`rowIndex`、`GeminiReport.js`の`generateReportWithWarnings`/
`extractAmountFromImage`)の実装を確認したうえで修正した。

- **重複保存の修正**: `ReportModal.tsx`に保存済みレポートのID+保存時点の内容スナップショットを
  保持する仕組みを追加(GAS版`savedReportsState`のrowIndex管理に相当)。保存ボタンを押した際、
  (1) 未保存なら新規作成、(2) 保存済みで内容が前回と同一なら「内容に変更がないため、保存を
  スキップしました」と表示してAPI呼び出し自体を行わない、(3) 保存済みで内容が変わっていれば
  確認ダイアログのうえ`reportId`を指定してDB側で上書き更新(アップサート)する、という3分岐に
  した。バックエンドの`saveDailyReport`/`saveAccidentReport`ユースケースは元々`reportId`指定時に
  更新するアップサート機構を持っていたが、フロントエンドが一度も`reportId`を再利用していなかった
  ため、保存のたびに新規行が作られていたのが原因だった。日報・事故報告の両方に同じ仕組みを適用。
- **AI生成失敗時のエラー表示改善**: GAS版はAPI呼び出し失敗時も`generateReportWithWarnings`が
  `warnings: ['API Error']`/`['API Key Missing']`を「不足項目」の警告と同じ形で返し、
  生のエラー文言(`internal`)をそのまま社内向けレポート欄に表示してしまうため分かりにくかった。
  katahimo-app側では生成失敗コードを検出した場合、結果欄には反映せず
  「AIによる生成でエラーが発生しました。しばらく待ってから再度お試しください。」等の分かりやすい
  文言に変換して表示するようにした(事故報告側も同様に変換)。
- **領収書OCR失敗時のエラー表示追加**: GAS版`extractAmountFromImage`はOCR失敗時も空値
  フォールバックを返すのみで、呼び出し元は完全に無言だった(「金額が入らないのに何もエラーが
  出ない」という報告の原因)。`ReceiptOcrResult`に`error`フィールドを追加し、OCR失敗時は
  領収書サムネイルの下に「自動読取に失敗しました。金額等を手入力してください。」と表示するように
  した。空値へのフォールバック自体(手入力での登録続行)はGAS版と同じく維持。

`pnpm -r typecheck` / `pnpm test`(129件)/ `pnpm lint` で確認済み。ローカルAPI
(`localhost:8080`)に対し、日報保存→同じ`reportId`で内容変更のうえ再保存→履歴上に重複行が
作られず1件のまま内容だけ更新されることを確認。OCRエンドポイントに不正な画像データを渡し、
`error`が空黙りせず返ることも確認済み。

## [Ver. 1.1.20] - 2026-08-29

### katahimo-app(Phase 5着手: 予定タブ+Google Maps連携をGAS版Web Appのブリッジ経由で実装)

「次の移行フェーズを実装してほしい」との依頼を受けてPhase 5(外部連携)に着手。Google Maps
Platformの新規契約(APIキー・課金設定)を避けるため、**稼働中のgas-childcare-visit-app Web App
(`Bridge.js`)を軽量なJSON APIプロキシとして再利用する方式**を採用した(ユーザー提案)。GASの
Mapsサービス(`Maps.newGeocoder`/`newDirectionFinder`、無料)と、既に本番で動いているカレンダー
解析・ルート計算ロジック(`RouteSearch.js`の`getScheduleForStaffOnDate`/
`getScheduleWithRouteForStaffOnDate`)をそのまま呼び出すだけなので、RESERVA予約タイトルの判定・
スタッフ突合といった複雑な分類ロジックをTypeScript側で再実装せずに済み、本番との挙動ずれリスクを
避けられる。

- `gas-childcare-visit-app`: `Bridge.js`を新規追加し、`doGet(e)`に`?api=1`分岐を追加
  (`BRIDGE_API_SECRET`による共有シークレット認証、既存のHTML表示ロジックは無変更)。
  `geocode`/`route`/`schedule`/`scheduleWithRoute`の4アクションを実装。
- `katahimo-app`: `SchedulePort`/`MapsPort`を追加し、`GasBridgeSchedulePort`/`GasBridgeMapsPort`
  (`GAS_BRIDGE_URL`/`GAS_BRIDGE_SECRET`未設定時は`NoopSchedulePort`/`NoopMapsPort`にフォールバック)
  で実装。`GET /api/schedule`・`GET /api/schedule/route`を追加し、「📅 予定」タブを実データ表示
  (今日/明日トグル・予定カード一覧・ルート/移動時間・「🚗 ルート・移動時間を取得」ボタン・
  予定タップで訪問先一覧タブへ切り替え検索欄に反映)に作り直した。管理者向け「対象スタッフ」
  切り替えにも対応(`AdminTargetStaffContext`と統合)。

**注意**: Bridge.jsの本番デプロイ(`clasp push`/新デプロイ作成)とGAS側Script Propertiesへの
`BRIDGE_API_SECRET`設定はユーザー承認待ちのため未実施。ローカルの`GAS_BRIDGE_URL`/
`GAS_BRIDGE_SECRET`も未設定のため、現時点では`NoopSchedulePort`/`NoopMapsPort`(常に空)で
動作しており、実際にAPIを叩いての動作検証(このリポジトリのLogic verification規約が求める検証)
はまだ行っていない。デプロイ・設定が完了次第、実データでの検証を行う。Sheets/Drive連携
(ミラー書き込み)は未着手。

`pnpm -r typecheck` / `pnpm test`(129件)/ `pnpm lint` で確認済み。ローカルAPIに対して
Noopフォールバック経由(`{"success":true,"appointments":[]}`)での疎通は確認済み。

## [Ver. 1.1.19] - 2026-08-29

### katahimo-app(訪問先一覧カードのボタンデザインをGAS版に合わせて修正)

領収書ボタンと同じ「絵文字ボタンより先にGAS版の実デザインを確認すべき」という反省を踏まえ、
訪問先一覧カードの「顧客情報」「活動記録」ボタンもGAS版`renderCustomers`と見比べた。従来は
カード下部に絵文字(👤/📋)付きの横並びボタンを配置していたが、GAS版は右上に縦並びの
色分けボタン(顧客情報=青枠、活動記録=オレンジ枠)+矢印アイコンという構成だったため、
同じレイアウトに変更した。カード本体のクリック(日報/事故報告モーダルを開く)と2つのボタンの
クリックが競合しないよう、GAS版と同じくカード全体を`<div role="button">`(ネストしたボタンを
持てるよう`<button>`ではなくこの形にしている)+ボタン側`stopPropagation`で実装した。

`pnpm -r typecheck` / `pnpm test`(129件)/ `pnpm lint` で確認済み。

## [Ver. 1.1.18] - 2026-08-29

### katahimo-app(日報モーダルの残りの細部をGAS版に合わせて修正)

「最後までやりきってください」との指示を受け、`gas-childcare-visit-app/index.html`/`Main.js`/
`GeminiReport.js`を再度通しで確認し、見つかった残りの差分を修正した。

- **活動記録タイムラインのPSI/ES表示を修正**: 「PSI: ★★★☆☆ 満足度: ★★☆☆☆」という1行の
  文言表示から、GAS版`showCustomerHistory`と同じ、色分けされた独立バッジ
  (`PSI:★★★☆☆`黄色/`ES:★★★☆☆`インディゴ)に変更。
- **訪問メモ/状況メモのプレースホルダーをGAS版の実際の文言に修正**(`promptDefaults.ts`に
  `GeminiReport.js`の`DEFAULT_PROMPTS`のPlaceholderDaily/PlaceholderAccidentをそのまま移植。
  従来は独自の短縮版で、かつ`\n`がエスケープされず改行されていなかった不具合も修正)。
- **事故報告タブに「💡書き方のヒント」ボタンを追加**(GAS版`toggleHint`と同じ、種別が
  ヒヤリハットかどうかで表示内容を切り替え。`HintAccident`/`PlaceholderHiyari`のデフォルト値を
  `promptDefaults.ts`に移植)。
- **「対象者(ご家族)」セレクタを事故報告タブのみに限定**(GAS版`familySelectorContainer`は
  日報タブでは非表示。これまでは両タブで表示していた)。
- **領収書の重複警告をGAS版と同じ専用ボックス表示に変更**(`showReceiptDuplicateWarning`と同じ、
  黄色背景・重複した領収書ごとに「N. 日時 / 顧客名:X / 金額:Y / 名称:Z」の一覧を表示。画像追加時に
  警告をクリアする点も含めて移植)。

`pnpm -r typecheck` / `pnpm test`(129件)/ `pnpm lint` で確認済み。

## [Ver. 1.1.17] - 2026-08-29

### katahimo-app(PSI/従業員満足度(ES)評価をGAS版と同じ仕様に修正)

「PSI/従業員満足度(ES)にして、★ごとの文言や?(評価基準アイコン)が消えている」との指摘を受け、
`gas-childcare-visit-app/Main.js`の`ASSESSMENT_DEFINITIONS`/`showAssessmentHint`をそのまま移植した。

- ラベルを「PSI」「従業員満足度(ES)」に変更(旧「満足度」から修正)。
- 各ラベル右に情報アイコン(?)を追加し、押すと評価基準一覧(評価/定義/判断基準の表、
  GAS版`ASSESSMENT_DEFINITIONS`を`assessmentDefinitions.ts`として移植)をモーダル表示する。
- 選択した★の右に、その評価に対応する定義文言(例: 「要観察」)を表示する
  (GAS版`label-risk`/`label-es`と同じ、未評価時は空表示)。
- ★を押した時の解除ルールをGAS版と完全に一致させた: 左端(1番目)の★が既に選択済みの状態で
  もう一度押した時だけ全て☆(未評価)に戻る。他の★を再度押しても解除はされない(これまでは
  どの★でも「同じ星を再度押すと解除」という簡略化したロジックになっていた)。星の色も
  GAS版と同じ`text-yellow-400`に統一。

`pnpm -r typecheck` / `pnpm test`(129件)/ `pnpm lint` で確認済み。

## [Ver. 1.1.16] - 2026-08-29

### katahimo-app(領収書登録セクションの位置・デザインをGAS版に合わせて修正)

「日報の領収書登録の場所は訪問完了の下」「カメラ/アルバムのアイコンやボタンデザインもGAS版の
ほうがよい」との指摘を受け、`gas-childcare-visit-app/index.html`の`imageUploadSection`を
再確認して合わせた。

- **位置**: 「日報を保存」ボタンの下(独立した`<hr>`区切り)から、共有の「訪問完了」ボタンの
  直後(GAS版と同じ、PSI/ES評価や訪問メモより前)へ移動。
- **見出し行**: 「領収書 (最大6枚)」ラベルの右に「領収書登録」ボタン(amber色)を配置
  (これまでセクション最下部にあった専用ボタンは廃止、GAS版は1箇所だけのため)。
- **カメラ撮影/アルバムボタン**: 絵文字(📷/🖼️)から、GAS版と同じSVGアイコン
  (カメラ・画像のline icon)+破線ボーダーのデザインに変更。
- **サムネイル一覧**: 横並びのカードギャラリー(幅40・サムネイル24角丸・×削除ボタン重ね表示・
  日時/金額/店舗名を縦に並べた入力欄)に変更し、カメラ/アルバムボタンと同じflex-wrap行に
  並べる(GAS版`renderImagePreviews`と同じレイアウト)。

`pnpm -r typecheck` / `pnpm test`(129件)/ `pnpm lint` で確認済み。

## [Ver. 1.1.15] - 2026-08-29

### katahimo-app(日報モーダルの細部をGAS版に合わせて追加)

Ver.1.1.14の日報モーダル再構築時に見落としていたGAS版の細部を追加。

- 社内向け/保護者向けレポートに文字数表示、保護者向けレポートに📋コピーボタン
  (`navigator.clipboard.writeText`。GAS版`copyToClipboard`と同じ役割)を追加。
- 事故報告の結果エリアに「対象者氏名」「生年月日」の編集可能な入力欄を追加
  (GAS版`accTargetName`/`accTargetDob`と同じ。対象者(ご家族)セレクタ変更時に自動入力され、
  保存前に手動修正もできる。これまでは`selectedFamily`から保存時に直接参照するのみで、
  ユーザーからは見えない/編集できない状態だった)。

`pnpm -r typecheck` / `pnpm test`(129件)/ `pnpm lint` で確認済み。

## [Ver. 1.1.14] - 2026-08-29

### katahimo-app(予定タブの対象スタッフ共有・日報モーダルをGAS版に合わせて再構築・音声入力・顧客詳細の連絡先操作を実装)

「管理者は予定も全スタッフの情報が見れる(スタッフ名は勤怠と連動)」「GAS版の日報の設定に合わせて」
「音声入力が抜けている」「顧客詳細のメール/電話/GoogleMap表示機能が抜けている」との指摘を受け、
GAS版`gas-childcare-visit-app/index.html`を再確認して実装した。

- **管理者向け「対象スタッフ」選択を予定タブ・勤怠タブで共有**: 新設の`AdminTargetStaffContext`
  (React Context)が、GAS版の`sharedAdminTargetStaffName`/`loadSharedAdminStaffList_`/
  `onAdminTargetStaffChange_`と同じ役割を果たす(スタッフ一覧取得はどちらのタブを先に開いても
  1回だけ、選択もタブをまたいで保持される)。「📅 予定」タブにも同じセレクタを表示するが、
  Googleカレンダー連携(Phase 5)がまだ無いため表示内容自体は変わらない(空状態のまま)。
- **日報/事故報告モーダルをGAS版の実際の構成に合わせて再構築**:
  - 日付は保育日報/事故報告で共有の「‹ 2026年8月28日(金) ›」ナビゲーション(未来日は選べない)。
  - 開始/終了時刻はGAS版と同じ時・分separate選択式(時00〜23、分00/15/30/45、開始変更時に
    終了を+2時間へ自動追従)。事故報告では終了時間セレクトを隠し、開始時間セレクトの値を
    「発生時間」の入力として使う(AI生成後は編集可能な「発生日時」欄に結果が入る、GAS版の
    `accOccurrenceTime`と同じ)。
  - 「訪問完了」ボタンを追加(GAS版`sendVisitComplete`と同じ、DBには書き込まず、担当者名・
    顧客名をサーバー側で解決した上でGoogle Chatの報告用チャンネルへ通知するのみ)。
  - 訪問メモ・状況メモに🎤音声入力ボタンを追加(Web Speech API、`ja-JP`・`continuous`、
    確定した発話を改行区切りで追記。GAS版`startVoiceInput`と同じトグル動作・エラーメッセージ)。
- **顧客詳細画面にメール/電話/GoogleMapのワンタップ操作ボタンを追加**(GAS版`showCustomerDetail`
  の`mailto:`/`tel:`/Google Map検索リンクと同じ配色・挙動。住所は緯度経度がわかっていれば
  そちらを優先してMapクエリに使う。「住所2」は対象外、というGAS版の除外ルールも踏襲)。

`pnpm -r typecheck` / `pnpm test`(129件、`sendVisitCompleteNotification`のテストを追加)/
`pnpm lint` で確認済み。ローカルAPIに対して実際にログイン→訪問完了通知送信まで確認済み。

## [Ver. 1.1.13] - 2026-08-28

### katahimo-app(ホームタブを下部固定ボタンバーに変更、領収書画像のリサイズ/圧縮・OCR自動実行を実装)

「GAS版のホームタブをスマホ向けに下部固定ボタンにしてほしい」との指摘を受け、`App.tsx`の
ホームタブ(📅予定/🏠訪問先一覧/🕒勤怠)を、ヘッダー直下のsticky行から`</main>`の後の
`position: fixed; bottom: 0`固定バー(アイコン+ラベル、アクティブ時は上ボーダー)に変更した
(ルート要素が`overflow-hidden`のため`sticky`だと本文が長い時に画面外へクリップされる。
GAS版`gas-childcare-visit-app/index.html`で同じ問題への対処として先に実装済みだった
`fixed`+中央寄せの手法をそのまま踏襲)。

あわせて、`01_GAS/katahimo-app/README.md`に「未実装」として残していたGAS版の2つの領収書
仕様も実装した:
- 画像追加時のクライアント側リサイズ/圧縮(GAS版`resizeAndAddImage`と同じ、Canvas APIで
  長辺1200px以内・JPEG品質0.7へ変換)。
- 画像追加時のOCR自動実行(GAS版`runOcr`と同じ、手動の「OCRで自動入力」ボタンは廃止。
  OCR中はサムネイルにローディングオーバーレイ、失敗/日時読み取り不可時は現在時刻を
  フォールバック表示)。

`pnpm -r typecheck` / `pnpm test`(128件)/ `pnpm lint` で確認済み。

## [Ver. 1.1.12] - 2026-08-28

### katahimo-app(設定画面を新規実装、管理者による他スタッフの勤怠閲覧/編集に対応)

「GASにあった設定画面が無い」「管理者は他スタッフの予定/勤怠を見られたはず」との指摘を受けて実装。

- **設定画面**(GAS版index.htmlのsettingsModalに対応、ヘッダーの⚙️ボタンから開く):
  - 文字サイズ設定(小/中/大)。GAS版と同じ`data-text-size`属性+`!important`のCSSルール、
    `localStorage`のキー(`app_text_size`)もそのまま。
  - パスワード変更。新usecase`changePassword`(現在のパスワードをargon2id優先、GAS版から
    未移行のスタッフはレガシーハッシュでも検証し、成功時はargon2idへ保存)。
  - 管理者設定(Gemini APIキー・日報/OCR用モデル選択・モデル一覧の取得・Google Chat
    Webhook URL)。**GAS版はScript Properties(全体で1系統)だったが、本アプリは
    マルチテナントSaaSのため、テナントごとに保存できる新テーブル`app_settings`を追加し、
    暗号化(CryptoPort)して保存する。**日報/事故報告のAI生成・領収書OCR
    (`packages/core/src/usecases/reportAi.ts`)、Google Chat通知
    (`packages/integrations/src/google-chat/webhookNotifierPort.ts`)は、テナントがここで
    独自の値を保存していればそれを優先し、未設定なら従来通り`.env`のデフォルトにフォールバック
    する(`saveGeminiApiKeyForAdmin`等の「空文字での保存は拒否する」ガードも含め、GAS版の
    挙動をそのまま踏襲)。
- **管理者による「対象スタッフ」切り替え**(勤怠タブ): 退職者を除く全スタッフ一覧を返す
  `GET /api/staff`(GAS版`getActiveStaffNamesForAdmin`相当)と、勤怠APIが元々持っていた
  `resolveAttendanceTargetStaffId`(管理者以外の指定は常に本人に強制)を使い、セレクタ経由で
  他スタッフの勤怠(週間予定・1日表示・月次集計)を閲覧/編集できるようにした。
  **予定タブは対象外**: Googleカレンダー連携(Phase 5)がまだ無くタブ自体が実データを
  持たないダミー表示のため、対象スタッフを切り替えても表示できるものが無い。カレンダー連携の
  実装時にあわせて追加する。
- ローカルPostgreSQLに対してマイグレーションを適用し、実際にログイン→管理者設定の保存/取得
  (Gemini APIキー・Webhook URL)→対象スタッフ一覧取得→パスワード変更(現在のパスワード誤り時の
  拒否)までAPIを実際に叩いて確認済み。回帰テストを追加(計128件)。

## [Ver. 1.1.11] - 2026-08-28

### katahimo-app(RESERVA CSV取込で地区(city)が未設定になっていた不具合を修正)

ローカル動作確認で「Ver. 1.1.10で地区絞り込みを追加したのに、シード顧客(佐藤)以外の
RESERVA CSV取込顧客には地区が表示されない」との指摘を受けて調査した結果、CSV取込の
マッピング(`packages/ingestion/src/reservaCsv/mapToCustomerInput.ts`)が「住所文字列からの
市区町村自動抽出は信頼できるパーサーが無いため対象外」として`city`を意図的に未設定のまま
にしていたことが原因と判明した。GAS版(`gas-childcare-visit-app/Main.js`
`fetchDataFromSheet`)は実際にはこの目的の住所パーサー(都道府県を除去→「〇〇市〇〇区」を
優先抽出→無ければ「市/区/町/村」単位にフォールバック)を実務で使っており、地区絞り込みの
粒度としては十分機能していたため、これをそのまま移植した。

- `extractCityFromAddress`(`packages/core/src/domain/legacyImport/`)を新規追加し、GAS版の
  住所パーサーとNode上での実行結果を突き合わせて一致を確認(政令指定都市の「市+区」、
  「東京都渋谷区」のような区のみ、郡+町村、都道府県無し、抽出不能な住所、の各パターン)。
- `mapReservaRowToCustomerInput`にこれを組み込み、RESERVA CSV取込時に`city`を自動設定する
  ようにした。
- 既存インポート済みデータ(ローカル開発DBの398件)に対して同じCSVを再取込し(外部IDによる
  upsertのため冪等、398件すべて更新・作成/消失は0件)、地区絞り込みの選択肢が2種類→35種類に
  増え、シード顧客以外の顧客カードにも地区バッジが表示されることを確認済み。回帰テストを
  追加(計115件)。

## [Ver. 1.1.10] - 2026-08-28

### katahimo-app(訪問先一覧: 最近使った顧客順の既定表示・地区絞り込み、領収書登録: カメラ起動)

ローカル動作確認で「GAS版は訪問先一覧が最近使った顧客順に出て地区でも絞り込めた」「領収書はスマホで
カメラが起動できた」との指摘を受け、GAS版(`gas-childcare-visit-app/index.html`)の
`fetchDataFromSheet`/`filterCustomers()`/`cameraInput`と同じ挙動に合わせた。

- **顧客一覧をGAS版と同じ「全件取得→ブラウザ側で絞り込み」方式に変更**: `CustomerRepositoryPort.listActive`
  (有効な顧客を全件返す)と、これを使う新usecase`listCustomers`(復号済み一覧+地区の重複無し・
  五十音順一覧)を追加。`GET /api/customers`は`familyName`クエリを省略すると全件+地区一覧を返す
  (指定時は従来通りブラインドインデックスの苗字完全一致検索)。
- **Web UIの訪問先一覧を検索欄のas-you-type絞り込み+地区セレクトに作り直した**(送信ボタン式の
  苗字完全一致検索は廃止。ブラインドインデックス方式でも、顧客名は復号済みで一覧取得しているため、
  部分一致のブラウザ内フィルタがそのまま使える)。
- **「最近使った顧客」順の既定表示を追加**: `recentCustomers.ts`(localStorage `recent_customers`。
  GAS版と同じキー・配列形式で先頭が最新・上限50件)を新設し、日報/事故報告の保存・領収書登録の
  成功時に記録する(GAS版のsaveReport/saveAccidentReport/uploadReceiptsOnly成功時の更新ロジックと
  同じ)。検索・地区絞り込みのどちらも指定していない場合のみ、この記録順で並び替える
  (GAS版`filterCustomers()`の`if (!search && !city)`分岐と同じ)。
- **領収書登録にカメラ撮影ボタンを追加**: 「📷カメラ撮影」(`capture="environment"`でスマホの
  カメラアプリを直接起動、1枚ずつ撮影)と「🖼️アルバム」(複数選択可)の2ボタン構成にした
  (GAS版のtriggerCamera/triggerGalleryと同じ使い分け)。あわせて1回の登録で最大6枚までの上限
  (GAS版と同じ)を追加。**未着手のGAS版仕様として残っているもの**: 追加画像のクライアント側
  リサイズ/圧縮(GAS版resizeAndAddImage、1200px・JPEG品質0.7)と、画像追加時のOCR自動実行
  (GAS版runOcr、現状は手動の「OCRで自動入力」ボタン)。
- ローカルPostgreSQL(顧客401件、うち地区が判明しているのは2件)に対して全件取得APIを実際に叩き、
  復号済み一覧・地区一覧・既存の苗字完全一致検索(後方互換)がいずれも正しく返ることを確認済み。
  回帰テストを追加(計110件)。

## [Ver. 1.1.9] - 2026-08-28

### katahimo-app(日報登録・事故報告・活動記録・領収書登録を新規実装)

「訪問先一覧のカードをタップすると顧客情報しか出てこない」との指摘を受け、GAS版
(`gas-childcare-visit-app`)のカードタップ→報告作成モーダルという導線を含め、日報/事故報告/
活動記録(過去の日報履歴)/領収書登録の全機能を新規実装した。

- **DBスキーマ追加**: `daily_reports`/`accident_reports`/`receipts`(いずれも`tenant_id`+RLS)。
  自由記述項目(メモ・レポート本文・事故状況等)は`attendance_days`のrowDataと同じ考え方で
  JSON1本にまとめて暗号化し、フィールド単位の検索が不要な点を明示している。領収書の重複検出
  (スタッフ・顧客・日時・金額・店舗名が一致するものをブロック)は、GAS版
  `processReceiptImages`のキー組み立てをそのままBlindIndexPortの入力に使うことで、
  全件復号せずに判定できるようにした。
- **新規ポート**: `ReportAiPort`(Gemini生成/OCR)・既存`NotifierPort`の実装
  (`WebhookNotifierPort`)・`StoragePort`の実装(`LocalFileStoragePort`、ローカル開発用の
  ファイルシステム実装)を`packages/integrations`に追加。`GEMINI_API_KEY`未設定時は
  `NoopReportAiPort`にフォールバックし、GAS版が同じ状況で返していたのと同じ値
  (`{warnings:["API Key Missing"], ...}`等)を返す。
- **GAS版ロジックの移植**: `callGemini`(思考パートのスキップ・マークダウンのコードフェンス
  除去・改行アンエスケープ・HTTPステータスコード別の日本語エラーメッセージ)、
  `getCustomerReports`の事故報告internalText組み立て、`saveReport`/`saveAccidentReport`/
  `uploadReceiptsOnly`のGoogle Chat通知文言を、実際のGAS関数をNode上で実行した結果と
  突き合わせて一致を確認してから移植した(本リポジトリの「ロジック検証」の慣習を踏襲)。
- **API追加**: `POST /api/reports/daily`・`/accident`・`/daily/generate`・`/accident/generate`、
  `GET /api/reports/history`(カーソルページネーション)、`POST /api/receipts`・`/ocr`。
  いずれもCLAUDE.mdのセキュリティパターン(非管理者は自分のstaffIdに強制)に沿う。
- **Web UI追加**: 訪問先一覧のカードは、本体タップで日報/事故報告作成モーダル(`ReportModal`)、
  「顧客情報」ボタンで既存の詳細モーダル、新設の「活動記録」ボタンでタイムライン+
  「もっと見る」ページネーションの`HistoryModal`を開く3導線構成にし、GAS版の
  `openModal`/`showCustomerDetail`/`showCustomerHistory`の使い分けと一致させた。
- ローカルPostgreSQL+APIサーバーを実際に起動し、日報保存・事故報告保存・活動記録の
  カーソルページネーション・領収書アップロード(重複検出込み)を curl/Node fetch で
  一気通貫に確認済み。回帰テストを追加(計109件)。`GEMINI_API_KEY`が未設定のため、
  AI生成・OCRは常にフォールバック応答となる経路のみ確認できている(実際のGemini API
  呼び出しは未検証)。

## [Ver. 1.1.8] - 2026-08-28

### katahimo-app(勤怠タブをGAS版と同じGoogleカレンダー風週間表示に作り直し)

ローカル動作確認で「GAS版は勤怠タブがGoogleカレンダーのような週間表示だが、新アプリは平坦な入力フォームに
なっている」との指摘を受け、GAS版(`gas-childcare-visit-app/index.html`の週間予定タブ)と同じ見た目・
操作感に作り直した。

- **`buildScheduleEventsFromRowData`を新規移植**: GAS版`PastSchedule.js`の`buildScheduleEventsFromRowData_`
  (出勤簿の入力列を、始業・終業が両方入力されているスロットだけカレンダーイベント化する関数)をNode上で
  そのまま実行した結果と一致することを確認してから移植。**表示している予定は実際のGoogleカレンダーからでは
  なく、保存済みの出勤簿(attendance_days)の記録をそのまま色分け表示しているだけ**というGAS版の設計を
  踏襲しており、Googleカレンダー連携(Phase 5)が無くても週間表示自体は動く。
- `attendance_days`リポジトリに任意期間取得(`listByStaffAndDateRange`)を追加し、`GET /api/attendance/week`
  を新設。
- Web UIに週間予定グリッド(週送り・今日ボタン・日タップで1日表示にドリルダウン)、時間軸付きの色分け
  イベント表示、予定タップでの個別編集モーダル(名称・始業・終業)、「移動・距離・その他」パネルでの
  日単位の一括編集(移動時間・距離・天候・買物代行・備考)、「📊 月次集計」モーダルを実装し、GAS版の
  操作フローに合わせた(従来の全項目が一度に見える平坦なフォームは廃止)。
- 実際にAPI経由で予定を保存し、週間表示APIが正しくイベント化して返すことを確認済み。回帰テストを追加
  (計95件)。

## [Ver. 1.1.7] - 2026-08-28

### katahimo-app(Web UIをGAS版と同等の見た目・操作感に作り直し)

利用者(現場スタッフ)からのローカル動作確認結果を受け、移行時の混乱を減らすためWeb UIをGAS版
(`gas-childcare-visit-app/index.html`)と同じ見た目・構造に作り直した。

- **CSSフレームワーク・フォントをGAS版と統一**: Tailwind CSS(CDN)・Googleフォント「Outfit」・配色(blue-600基調)を
  そのまま採用。
- **アプリ構造をGAS版と同じ単一ページ構成に変更**: GAS版はURLルーティングを一切使わず、ヘッダー+3タブ
  (📅 予定/🏠 訪問先一覧/🕒 勤怠、アイコン・ラベル・アクティブ状態のスタイルまで同一)の表示/非表示切り替えだけで
  画面遷移する。react-router-domによるページ遷移(`/customers/:id`等)をやめ、同じ構造に作り直した(react-router-dom
  は依存関係から削除)。
- **顧客詳細をGAS版と同じボトムシートモーダルに変更**(従来は別ページ)。GAS版にあった日報/事故報告作成タブは、
  対応するバックエンド機能(Gemini連携、Phase 5)がまだ無いため含めていない。
- **ログイン画面・顧客一覧・勤怠入力フォームをGAS版と同じカードデザインに変更**。
- 「📅 予定」タブはGoogleカレンダー連携(Phase 5)が無いため、GAS版と同じ今日/明日トグルの見た目のみ再現し、
  存在しない予定をでっち上げず空状態であることを正直に表示する。
- 型チェック・テスト(計91件)・ビルドとも変更なしで通過することを確認済み(バックエンドは無変更のUIのみの
  作り直しのため)。

## [Ver. 1.1.6] - 2026-08-28

### katahimo-app(Phase 2完了: GAS版パスワードハッシュの引き継ぎ)

Phase 2の残りだった「既存スタッフがパスワード変更なしでログインできる」移行経路を実装した。

- **GAS版`Auth.js`の`computeHash`(sha256(password + AUTH_SALT))をNode上でそのまま実行した結果と一致することを検証**したうえで`computeLegacyHash`として移植(`packages/core/src/domain/legacyAuth/`)。
- `staff`テーブルに`legacy_password_hash`列を追加し、`password_hash`(argon2id)をnullable化。GAS版から移行したスタッフは初回ログインまでargon2idハッシュを持たない状態で存在できるようにした。
- ログイン処理を拡張: argon2id照合に失敗した場合、レガシーハッシュ(`LEGACY_AUTH_SALT`環境変数、GAS版のScript Properties AUTH_SALTと同じ値)で検証し、一致すれば**その場でargon2idへサイレント再ハッシュ**する(`login()`。パスワード変更を利用者に求めない)。`legacyAuthSalt`未設定時はレガシー経路そのものを無効化する安全側デフォルト。
- スタッフ移行用の操作スクリプト`packages/api/src/scripts/importLegacyStaff.ts`を追加。実際にローカルDBに対して「移行→ログイン(旧パスワードのまま成功)→DBでargon2id化とレガシーハッシュ消去を確認→2回目ログイン」まで動作確認済み。
- 回帰テストを追加(計91件)。

## [Ver. 1.1.5] - 2026-08-28

### katahimo-app(Phase 6: 勤怠計算エンジンを実装、GAS版と数値一致を検証)

給与計算に直結する勤怠(出勤簿)の計算ロジックを、GAS版`AttendanceCalc.js`から本格Webアプリ側へ移植した。

- **GAS版との数値一致を検証してから移植**: `AttendanceCalc.js`(webapp-poc版とバイト単位で同一)をNode上でそのまま実行し、所定内/所定外の境界・mtg特例・積雪補正・基準距離超過の5km刻み・訪問回数判定・不正な時刻文字列など計算式の全分岐を網羅する合成データ19ケース+月次集計で、TypeScript移植版(`packages/core/src/domain/attendance/`)の出力と1件残らず突き合わせ、完全一致を確認したうえでVitestの回帰テストとして固定した。実際の出勤簿データが無いため、実データでの照合はPhase 7で行う(このフェーズでは計算式そのものの正しさのみを保証する)。
- **`attendance_days`テーブルを追加**: 出勤簿の入力列(訪問先・始業/終業・移動時間・天候・距離等)のみをJSON化し、1本の暗号文として保存する。個々のフィールドを検索する必要が無いため、customersのようなフィールド単位の暗号化はせず1日分をまとめて扱う。労働時間・残業・移動距離・基準距離超過回数などの派生値は一切保存せず、常に`computeDayDerived`/`computeMonthlyTotals`で都度計算する(GAS版・webapp-poc版と同じ「入力列だけ保持し数式は都度計算」という設計を踏襲)。
- **アクセス制御**: 管理者以外は自分自身の勤怠にしか読み書きできないようにした(`GET/PUT /api/attendance/day`・`GET /api/attendance/month`の`staffId`クエリは管理者のみ有効)。GAS版`PastSchedule.js`の`resolvePastScheduleTargetStaffName_`と同じ「非管理者は常に自分のIDに強制、管理者だけ明示的に指定できる」パターンを`resolveAttendanceTargetStaffId`として集約した。
- **Web UI**: `/attendance`に出勤簿入力フォーム(訪問その1〜3・事務作業・移動距離等)と月次集計画面を追加。保存すると計算結果(労働時間・残業・移動時間・基準距離超過回数等)がその場で表示される。
- 実際にAPI経由で保存→取得→月次集計まで動作確認済み(手計算での検算含む)。回帰テストを追加(計81件)。

## [Ver. 1.1.4] - 2026-08-28

### katahimo-app(Phase 4: 顧客詳細画面を追加)

顧客検索(苗字)の結果から、RESERVA CSV由来の全項目・世帯構成員(子ども等)を確認できる詳細画面を追加した。

- `GET /api/customers/:id`: セッションから解決したtenantIdのみを使い(クライアント指定のtenantIdは信用しない)、顧客1件の全項目を復号して返す`getCustomerDetail`ユースケースを公開した。
- `packages/web`にreact-router-domによるルーティングを導入(`/` 検索画面、`/customers/:id` 詳細画面)。検索結果の氏名リンクから遷移でき、姓名カナ・メール・住所・駐車場・緊急連絡先・避難場所・会員情報・世帯構成員一覧を表示する。
- Vite dev server経由(`:5173`→`:8080`プロキシ)で、ログイン→検索→詳細画面遷移までの一連の流れが実際に動作することを確認済み。

## [Ver. 1.1.3] - 2026-08-28

### katahimo-app(Phase 3: RESERVA CSV取込・アップサート基盤を実装、子ども等の世帯情報も完全移植)

GAS版`CsvImport.js`のCSV取込ロジックを、データ・ロジックともに一切省略せず本格Webアプリ側へ移植した。

- **`parseFamilyInfo`/`normalizeDateStr`の完全移植**: GAS版のソースをNode上でそのまま実行し、実際のRESERVA CSVサンプル(`01_GAS/Kokyaku_202601191958_1_dummy.csv`、ダミー顧客398件)全行に対してTypeScript移植版と突き合わせ、**出力が1件残らず完全一致すること**を確認したうえでVitestの回帰テストとして固定した(`packages/core/src/domain/legacyImport/`)。和暦・元号略記・8桁西暦など多数の日付表記、氏名/生年月日/職業/アレルギー情報が混在する自由記述からの構造化パースを、書き直さずそのまま踏襲している。
- **Excelシリアル日時変換を新規追加**: RESERVA CSVの「登録日時」「最終更新日時」列がGoogle Sheets/Excelのシリアル日時形式の数値文字列になっている(CSVレベルで既にこの形式)ことを発見し、`excelSerialDateToIso`で正しい日時に変換するようにした。見落とすと日時情報が数値のまま無意味に保存されるところだった。
- **顧客プロファイルをCSVの全項目(パスワード列を除く)に拡張**: `customers`テーブルに姓名カナ・メール・住所2・駐車場・緊急連絡先・避難場所・会員種別/状況・支払方法/状況・性別・年代・Benefit会員ID・緯度経度等、RESERVA CSVの30列相当を追加(個人特定につながる項目は暗号化、分類情報は平文)。CSVの「パスワード」列(RESERVA側のログインパスワード)のみ、本アプリの認証に無関係で他システムの認証情報を不必要に複製する理由がないため意図的に取り込まない。
- **世帯構成員(子ども等)の永続化**: 新規`family_members`テーブルを追加し、`parseFamilyInfo`で構造化した世帯情報(氏名・生年月日・職業/アレルギー等)を1件も省略せず保存する。顧客詳細取得(`getCustomerDetail`)で復号して確認できる。
- **外部ID(RESERVA顧客ID)による差分取込**: 氏名の文字列一致ではなく外部IDで顧客を突き合わせ、作成/更新/ソフトデリート(取込データから消失)を判定する`planReservaImport`/`applyReservaImportPlan`を実装。取込元に存在しなくなった顧客の割合が既存件数の20%を超える場合は、明示的に`force`を指定しない限り適用を拒否する安全装置つき(旧GAS版の「毎回全置換」という危険な挙動は踏襲しない)。
- **実データでの動作確認**: 実際のサンプルCSV398件を`packages/api/src/scripts/importReservaCsv.ts`でPostgreSQLへ実際に取り込み、顧客398件・世帯構成員1001件が正しく暗号化保存され、`getCustomerDetail`経由で全項目(子どもの生年月日・アレルギー情報を含む)が正しく復号されることを確認。再取込しても重複しない(冪等)ことも確認済み。
- usecase層に回帰テストを追加(計56件。CSVパーサーは実サンプルファイルをfixtureとして使用)。

## [Ver. 1.1.2] - 2026-08-28

### katahimo-app(Phase 1: スキーマ+RLS、Phase 2: 認証の一部を実装、ブラウザで動作確認可能に)

前バージョンで決定したPII暗号化方針を実装に落とし込み、実際にログイン→苗字での顧客検索がブラウザで動く状態まで進めた。

- **スキーマ+RLS(Phase 1)**: `tenants`/`staff`/`sessions`/`customers`/`outbox_jobs` をDrizzleで定義。`tenant_id`を持つ全テーブルにRow Level Securityを適用し、DB接続ロールをDDL用の所有者(`katahimo`)とRLS対象のアプリ用(`katahimo_app`)に分離した。`app.tenant_id`を設定しない接続では実際に0件しか見えないこと、RLSポリシー違反でINSERTが拒否されることを実機で確認済み。
- **PII暗号化の実装**: `CryptoPort`/`BlindIndexPort`のローカル開発用実装(`LocalCryptoPort`=AES-256-GCM、`LocalBlindIndexPort`=HMAC-SHA256、いずれもテナントごとに鍵を導出)を`packages/integrations`に追加。本番のCloud KMS実装に差し替えるまでの繋ぎとして位置づけ、データ形式(`keyVersion`)は変えずに済むようにした。
- **認証(Phase 2の一部)**: argon2idによるパスワードハッシュ、httpOnly Cookieセッション(`POST /api/auth/login`・`GET /api/auth/me`・`POST /api/auth/logout`)。セッションCookieに`tenantId`を埋め込むことで、「セッション検索にはテナントIDが先に要る」というRLS特有のチキン&エッグ問題を回避した。Google認証・GAS版レガシーパスワードハッシュの引き継ぎは未着手。
- **顧客検索の実装**: 氏名を姓・名に分割してブラインドインデックス化し、`GET /api/customers?familyName=`で苗字の完全一致検索ができるようにした。セッションから解決した`tenantId`のみを使い、クライアント指定のテナントIDは信用しない(CLAUDE.mdのセキュリティパターンを踏襲)。
- **動作確認**: `packages/api/src/scripts/seed.ts`でデモテナント・管理者・顧客3件を投入し、実際にVite dev server(`:5173`)→Hono API(`:8080`、プロキシ経由)→PostgreSQLの経路でログイン・検索が動くことを確認。DBの生カラムが暗号文であること、`app.tenant_id`未設定では他ロールからも顧客データが見えないことも実機で確認した。
- usecase層(`login`/`registerStaff`/`resolveSession`/`createCustomer`/`searchCustomersByFamilyName`)にインメモリのフェイク実装を使った回帰テストを追加(計25件)。特に「登録時と検索時でブラインドインデックスの正規化がずれる」という、実装中に実際に踏んだバグ(タイポでなく設計ミス)を固定するテストを含む。

## [Ver. 1.1.1] - 2026-08-28

### katahimo-app(PII暗号化方針の決定)

ベビーシッター業向けSaaSとしてデータ漏洩リスクが高いため、氏名・メール・電話・市区町村レベルの住所等のPII(個人情報)の保存方式を検討し、`packages/core` にポート定義(`CryptoPort`/`BlindIndexPort`)と関連ドメインロジックを追加した。

- **決定的暗号化は不採用**。同じ平文→同じ暗号文になるため等値検索はできるが、鍵を持たない攻撃者でも暗号文の出現頻度から平文を統計的に推測できてしまう(日本の姓は偏りが大きく、この逆引きが現実的なリスクになるため)。
- 代わりに、**実値は常にランダム化暗号(AES-256-GCM相当)で保存**し、等値検索が必要な項目だけ**HMAC-SHA256によるブラインドインデックス**を別カラムに持たせる方式を採用。同じ検索能力を、実値の統計的漏洩リスクなしで実現できる。
- 現場スタッフが「苗字だけで検索する」運用があるため、`packages/core/src/domain/pii/japaneseName.ts` の `splitJapaneseFullName` で氏名を姓・名に分割し、それぞれ独立にブラインドインデックス化する設計にした(現行データは「姓 名」間の空白が保証されないため、分割不能な行は移行時に要レビューとしてフラグを立てる)。
- `packages/core/src/domain/pii/normalize.ts`(メール・電話・住所の正規化)、`blindIndex.ts`(HMAC計算)、`japaneseName.ts` を純粋関数として実装し、回帰テストを追加(計14件)。鍵管理(Cloud KMSによるエンベロープ暗号化、テナントごとのDEK)を伴う実装は `packages/integrations` にPhase 5以降で追加する。

## [Ver. 1.1.0] - 2026-08-28

### katahimo-app(新規・本格Webアプリ移行の基盤構築 Phase 0)

`gas-childcare-visit-app`(GAS版)を、マルチテナントSaaSの本格Webアプリへ移行するための新規プロジェクト `01_GAS/katahimo-app/` を追加した。設計判断の背景は同ディレクトリの `doc/07_技術構成提案書.md` / `doc/08_技術構成サマリー.md`。

- **方針**: 正データは PostgreSQL とし、Googleスプレッドシート/Drive/カレンダーへは互換維持のミラー書き込み(outbox方式)で反映する。将来Sheetsをやめる際はミラーアダプタを止めるだけでドメインコードは無変更、という「ワンクッション」の境界を、ドメイン層(`packages/core`)が外部SDKを一切importしない構造で担保する。認証はメール+Google認証の自前実装(既存のSHA-256+saltハッシュを引き継ぐ)。GAS版は機能追加を凍結し不具合修正のみとし、切替完了後に停止する。
- **Phase 0(このリリース)**: pnpm workspaces モノレポ、TypeScript strict、Biome、Vitest、Docker/ローカルPostgreSQL 18(`btree_gist` 拡張・RLS用アプリロール分離)、Hono の空サーバー(`/api/health`・`/api/health/db` の疎通確認まで)、Vite + React + PWA の雛形を用意した。`packages/` は shared / core(domain・ports) / db / integrations / ingestion / api / worker / web の8構成。移植第一号として `RouteSearch.js` の `normalizeStaffName_` を純粋関数化し回帰テストを付けた。
- **リポジトリ運用への影響**: `katahimo-app` は既存 `gas-*` と異なり独自ビルド系統(TypeScript/Vite/Vitest/Biome)を持つため、`README.md`・両 `CLAUDE.md` にその旨を追記した。既存GASプロジェクトの静的検証(`node --check` + `clasp push`)の運用は変更なし。


