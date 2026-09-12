# GAS版連携の制約と方針

本アプリは本番稼働中の Apps Script アプリ `gas-childcare-visit-app` の移植先で、移行期間中は
GAS 版と併存する。ここには、その併存から来る**現在も有効な制約と方針**をまとめる。

## GAS版のソースの参照先

GAS版本体のスナップショットを `reference/gas-childcare-visit-app/` に同梱してある(詳細は
`reference/README.md`)。ただしこれは**その場限りのコピーで以後のGAS側修正には追従しない**ため、
最新の実装を確認する場合は本番稼働中のリポジトリ
(`C001-cutest-internal/01_GAS/gas-childcare-visit-app`)を参照すること。
README・ドキュメント中の `../gas-childcare-visit-app` という相対パス表記は、GAS版が兄弟ディレクトリに
存在する構成を前提にしたもので、本リポジトリ単体ではそのパスは存在しない。

## Bridge.js は未デプロイ(重要)

`01_GAS/gas-childcare-visit-app/Bridge.js`(読み取り側: Maps geocode/route + schedule/scheduleWithRoute JSON API を `doGet` で提供。書き込み側: `doPost` + writeDailyReport/writeAccidentReport/writeReceipt/writeAttendanceDay のミラー書き込みアクション、`BRIDGE_API_SECRET` で保護)と、それを呼ぶ katahimo-app 側(`GasBridgeMapsPort`/`GasBridgeSchedulePort`/`GasBridgeMirrorSenderPort`、`packages/worker` のoutboxポーラーが駆動)は書かれてコミット済みだが、**一度もデプロイされていない**。katahimo-app側の `GAS_BRIDGE_URL`/`GAS_BRIDGE_SECRET` は未設定のため、現状は `NoopMapsPort`/`NoopSchedulePort`/`NoopMirrorSenderPort` で動作する(安全確認済み)。`MIRROR_TO_GOOGLE_SHEETS` もデフォルト `false` でoutboxジョブすら積まれない。

**Why**: `gas-childcare-visit-app` は実際の保育スタッフが毎日使う本番稼働中のApps Script Webアプリ。壊せば現場の業務が止まる。

**How to apply**: `gas-childcare-visit-app`(または他の `01_GAS/gas-*` プロジェクト)に対して `clasp push`・新規デプロイ作成・Script Property設定を行う前には、**その都度リポジトリ所有者の承認を取る**。以前に見送られた経緯があっても、それが解除されたと推測しない。「このコミットをgit pushして」という指示は、GASデプロイの承認ではない(GitHubへの `git push` と本番Apps Scriptへの `clasp push`/デプロイはリスクレベルが異なる別の操作)。

## Bridge.js に `sendEmail` アクションの追加が必要

パスワード再設定コードと初期パスワードの通知メールは `MailerPort` 経由で送る。既定の実装
`GasBridgeMailerPort` は Bridge.js の `sendEmail` アクション(`doPost`、`{to, subject, body}` を
受け取って `MailApp.sendEmail` へ渡し `{success: boolean, message?: string}` を返す)を呼ぶが、
**このアクションはまだ Bridge.js に存在せず、Bridge.js 自体も未デプロイ**(下記)。

`GAS_BRIDGE_URL`/`GAS_BRIDGE_SECRET` が未設定の間は `LoggingMailerPort` にフォールバックし、
送るはずだった本文をサーバーログへ出すだけになる(再設定コードや初期パスワードが本文に
含まれるため、本番でこの状態になっているのは設定漏れとして扱うこと)。ローカル開発では
この挙動のままログからコードを拾って動作確認できる。

## 新規GCP APIより既存GASブリッジを優先

katahimo-appの機能で、`gas-childcare-visit-app` が既に無料枠内で使っているGoogleサービス(Maps geocoding/directions, Calendar)が必要になった場合、新規にGCP課金・認証情報(Google Maps Platform、Calendarサービスアカウント等)を用意するのではなく、**既にデプロイ・認証済みのGAS Webアプリに小さな共有シークレット認証つきJSON APIエンドポイントを足して、katahimo-appからそれを呼ぶ**。これが `Bridge.js` として実装されている(上記参照)。

**Why**: 新規のGCP課金・認証情報セットアップを増やさないため。またCalendar由来データについては、GAS側の本番実証済みのビジネスロジック(イベント分類、RESERVAタイトルタグ解析、スタッフ名マッチング)をそのまま使えるため、TypeScript側で再実装して挙動が微妙にズレるリスクを減らせる。

**How to apply**: katahimo-appで新しい外部Google連携ポートを設計する前に、稼働中の `gas-childcare-visit-app` が既に同等の機能を無料で提供していないか確認し、具体的な理由(GAS自体の実行時間/クォータ制限、GAS側に相当機能が存在しない等)がない限りGASブリッジ方式をデフォルトにする。

## エラーメッセージはGASとの完全一致より分かりやすさを優先

katahimo-appの基本方針は移行時の混乱を減らすためGASのUI/挙動に忠実に合わせることだが、**エラーハンドリングはその例外**で、GASの粗さをそのまま再現せず改善する。GAS側の例: 日報AI生成の失敗時は生の `"API Error"` 文字列がほぼそのままUIに表示される(`generateReportWithWarnings` が `{warnings:['API Error'], internal: <raw detail>}` を返す)。領収書OCRの失敗(`extractAmountFromImage`)は完全に無言で、空の値を返すだけでエラー通知が一切ない。どちらも移植先では再現しない。

**Why**: パリティは移行時の混乱を減らすための手段であって目的ではない。GASのソースを読んで、元の挙動自体がUXバグ(無言の失敗、生の技術的エラー文字列、ユーザーへのフィードバックなし)だと分かった場合、それを忠実に再現することはそのバグを引き継ぐだけ。

**How to apply**: GAS機能を移植する際、GASのソースに無言の失敗パスや生/不親切なエラー文字列のようなバグが見つかったら、その箇所について明示的な指示がなくても、パリティ対象ではなく修正対象として扱う(katahimo-app側では分かりやすい・翻訳された・区別可能なエラーメッセージにする)。それ以外(文言・レイアウト・ビジネスロジック・エッジケース挙動)については引き続きパリティをデフォルトとする。
