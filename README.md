# katahimo-app

`gas-childcare-visit-app`(Google Apps Script版)を、本格的なWebアプリ(マルチテナントSaaS)へ移行するための新規プロジェクト。

- 移行計画の全体像は本ディレクトリで作業中の実装で表現する。設計判断の背景は `doc/07_技術構成提案書.md` / `doc/08_技術構成サマリー.md` を参照。
- **正データは PostgreSQL**。Googleスプレッドシート/Drive/カレンダーへは互換維持のための**ミラー書き込み**として反映する(将来Sheetsをやめる際は、ミラーワーカーのアダプタを止めるだけでドメインコードは無変更)。
- 既存の稼働中GAS版(`../gas-childcare-visit-app`)は**機能追加を凍結し、不具合修正のみ**。切替完了後に停止する。

## アーキテクチャ(ワンクッションの境界)

```
[ React PWA ] → [ Hono API ] → [ ドメイン/ユースケース ] → [ Drizzle / PostgreSQL ]   ← 唯一の正
                                        │
                                        ├→ (書き) outbox → [ ミラーワーカー ] → Sheets / Drive / Calendar / Chat
                                        └→ (読み)        ← [ 取込パイプライン ] ← Sheets / CSV / 外部システム
```

`packages/core` は googleapis / drizzle / hono を **import しない**。外部との接点は `packages/core/src/ports/` のインターフェースだけで、その実装は `packages/integrations`(Google連携)に閉じる。

## パッケージ構成(pnpm workspaces)

| パッケージ | 役割 |
| --- | --- |
| `@katahimo/shared` | zodスキーマ + API契約型(api/webで共有)。ブラウザでも成立するものだけ置く |
| `@katahimo/core` | ドメイン・ユースケース・ポート定義。外部SDKに非依存 |
| `@katahimo/db` | Drizzleスキーマ・マイグレーション・RLS。`withTenant()` でテナントスコープ実行、`DrizzleUnitOfWork` で複数リポジトリにまたがる書き込みを1トランザクションにまとめる |
| `@katahimo/integrations` | ポートの実装(唯一 googleapis / Maps / Gemini に依存する層) |
| `@katahimo/ingestion` | 取込パイプライン(取得→パース→マッピング→差分→レビュー→upsert) |
| `@katahimo/api` | Honoサーバー(Cloud Runのエントリ) |
| `@katahimo/worker` | outboxミラー・夜間同期・CSVポーリング |
| `@katahimo/web` | Vite + React + PWA(現場スタッフのスマホ利用が主) |
| `@katahimo/demo` | 公開デモ用。ブラウザ内PostgreSQL(PGlite)+架空データで、サーバー無しに全機能を動かす |

## セットアップ(ローカル開発)

### 1. 依存インストール

```bash
pnpm install
```

### 2. ローカルDBの用意

**Docker を使う場合**(推奨・環境非依存):

```bash
docker compose -f infra/docker-compose.yml up -d   # PostgreSQL 18 が :5433 で起動
```

この場合は `.env` の `DATABASE_URL` を `:5433` 側に切り替える。

**マシンにPostgreSQLを直接入れている場合**(このリポジトリの開発機はこちら。:5432 稼働):

```bash
# スーパーユーザーで開発用ロール/DB/拡張を作成する(1回だけ)
psql -U postgres -h localhost -f infra/initdb/00_create_database.sql
psql -U postgres -h localhost -d katahimo_dev -f infra/initdb/01_bootstrap.sql
```

### 3. 環境変数

```bash
cp .env.example .env
# LOCAL_DEV_KEK(管理者設定の資格情報を暗号化する KEK。API のみ必要、worker には不要)/
# PASSWORD_RESET_PEPPER に、それぞれ別の 32バイト(64桁hex)を入れる: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# 既存パスワードでのログイン検証には、LEGACY_AUTH_SALT に GAS版 Script Properties の
# AUTH_SALT と同じ値を入れる(Phase 2以降)。
```

### 4. 起動

```bash
pnpm --filter @katahimo/api start   # http://localhost:8080
pnpm --filter @katahimo/web dev     # http://localhost:5173 (APIへ /api をプロキシ)
```

疎通確認:

```bash
curl http://localhost:8080/api/health       # {"status":"ok"}
curl http://localhost:8080/api/health/db     # {"status":"ok","now":"..."}  ← DB接続まで確認
```

## 動作デモ(ログイン+苗字検索)

Phase 1/2の範囲で、実際にブラウザで触れるところまで実装済み。

```bash
# 1. マイグレーション適用(初回のみ。DATABASE_URLはkatahimo_app、MIGRATION_DATABASE_URLはkatahimo)
pnpm --filter @katahimo/db exec tsx src/migrate.ts

# 2. デモ用テナント・管理者・顧客データを投入(何度実行しても冪等)
pnpm db:seed   # = pnpm --filter @katahimo/api seed
# -> tenantSlug=demo, admin@example.com / admin1234 が作られる

# 3. APIとWebをそれぞれ起動
pnpm --filter @katahimo/api start   # http://localhost:8080
pnpm --filter @katahimo/web dev     # http://localhost:5173
```

マイグレーションは `packages/db/drizzle/0000_baseline_schema.sql` の1本にまとまっている
(運用方針は `doc/09_データベース構造解説.md` 第1.9節)。**このベースライン以前のスキーマを当てたことがある
ローカル開発用PostgreSQLは、`drizzle.__drizzle_migrations` に別のハッシュが記録されているため増分では当たらない。
上記「2. ローカルDBの用意」からDBを作り直してから、あらためて
`pnpm --filter @katahimo/db exec tsx src/migrate.ts` を実行する**(公開デモは
`packages/demo/src/database.ts` の `REBUILD_REQUIRED_MIGRATIONS` により自動で作り直すため、この対応は不要)。

予約・決済・カルテ等のためのテーブルも先行して用意してある(スキーマ・制約・ドキュメントのみで、
リポジトリ実装・API・画面はまだ無い。DBの形を先に固めて有識者レビューを受けるため)。
顧客カルテ(`customer_notes`/`customer_note_photos`)、予約(`service_menus`/`reservations`/
`reservation_assignments`/`staff_availabilities`)、請求と決済(`customer_payment_profiles`/
`invoices`/`invoice_lines`/`payments`/`stripe_webhook_events`)、訪問割当の最適化
(`trait_definitions`/`customer_traits`/`staff_traits`/`staff_customer_compatibilities`/
`staff_customer_travel_estimates`)、移動手段別の手当(`transport_allowance_rules`/`travel_legs`)。
テーブル一覧とER図は `doc/09_データベース構造解説.md`、設計理由と未決の論点は
`doc/15_追加ドメインの設計とレビュー論点.md` を参照。

`http://localhost:5173` を開き、法人ID `demo` / `admin@example.com` / `admin1234` でログインすると、GAS版
(`gas-childcare-visit-app/index.html`)と同じ見た目・タブ構成のアプリが表示される(移行時の混乱を減らすため、
Tailwindの配色・Outfitフォント・ヘッダー/3タブのレイアウトをそのまま踏襲している。詳細は下記「UIをGAS版に
合わせた範囲」参照)。「🏠 訪問先一覧」タブは有効な顧客を全件取得し(顧客データは全て平文列。下記「データ保護の方針」
参照)、名前欄への入力でas-you-type絞り込み・地区セレクトで絞り込みができ、
どちらも指定していない既定表示は直近保存/領収書登録した顧客順(「最近使った顧客」)になる
(GAS版のallCustomers/filterCustomers()と同じ設計)。カードをタップすると
GAS版と同じボトムシート形式のモーダルでRESERVA CSVの全項目
(カナ・メール・住所・緊急連絡先・会員情報等)と世帯構成員(子ども等)一覧を確認できる
(業務データは全て平文列なので、表示時の復号は無い)。
DBの生カラムを直接見ると、業務データは平文で
(`psql -U katahimo -d katahimo_dev -c "SELECT input_text FROM daily_reports LIMIT 1"`)、
管理者設定の資格情報だけが暗号文で
(`psql -U katahimo -d katahimo_dev -c "SELECT gemini_api_key_ciphertext FROM app_settings LIMIT 1"`)
保存されていることを確認できる。

### UIをGAS版に合わせた範囲

- 再現した部分: アプリシェル(ヘッダー・配色・フォント)、ホームナビゲーションの3タブ(📅 予定 / 🏠 訪問先一覧 /
  🕒 勤怠、アイコン・ラベル・アクティブ状態のスタイルまで同一)、ログイン画面、顧客一覧のカードデザイン、
  顧客詳細のボトムシートモーダル。URLルーティングは使わず、GAS版と同じ「タブの表示/非表示切り替えのみで
  画面遷移する単一ページアプリ」という構造に合わせた(react-router-domは廃止)。**「🕒 勤怠」タブはGAS版と同じ
  Googleカレンダー風の週間予定表示**(週送り・今日ボタン・日タップで1日表示にドリルダウン・予定タップで
  個別編集モーダル・「移動・距離・その他」パネルでの日単位の一括編集・📊 月次集計モーダル)にした。
  **「🏠 訪問先一覧」のカードタップはGAS版の`openModal(customer)`と同じく日報/事故報告作成モーダルを開き、
  「顧客情報」「活動記録」は別ボタンからそれぞれ専用モーダル(顧客詳細/過去の活動記録タイムライン)を開く**
  という3導線構成にした。**一覧の絞り込み・並び替え(名前のas-you-type検索、地区セレクト、既定表示の
  「最近使った顧客」順)もGAS版のfilterCustomers()と同じ挙動にした**(`recentCustomers.ts`のlocalStorage
  `recent_customers`はGAS版と同じキー・配列形式)。**領収書登録は「📷カメラ撮影」(スマホのカメラアプリを
  直接起動)/「🖼️アルバム」の2ボタン構成**(GAS版のtriggerCamera/triggerGalleryと同じ)にし、1回の登録で
  最大6枚までの上限もGAS版と同じにした。**ヘッダーの⚙️ボタンから開く「設定」モーダル**(文字サイズ・
  パスワード変更・管理者設定)もGAS版のsettingsModalと同じ構成にした。管理者設定(Gemini APIキー・
  日報/OCR用モデル選択・Google Chat Webhook URL)はテナントごとに新テーブル`app_settings`へ保存し
  (APIキーとWebhook URLの資格情報3項目だけはアプリ層で暗号化。モデル名は平文。この3列がリポジトリ内で
  唯一の暗号化列)、日報AI生成/OCR/通知の実処理がこの値を優先して使う(未設定なら`.env`のデフォルトにフォールバック)。
  **保存済みのGemini APIキーは管理者設定APIも平文では返さない**(設定済みかどうかの`hasGeminiApiKey`と
  末尾4文字の`geminiApiKeyPreview`だけを返す。12文字未満のキーはプレビューもnull。`packages/core/src/usecases/settings.ts`)。
  モデル一覧の取得は保存済みキーをサーバー側で解決して行い、保存前の入力中のキーで試すこともできる。
  **「🕒 勤怠」タブは管理者だけ「対象スタッフ」セレクタで他スタッフの勤怠を閲覧/編集できる**(GAS版の
  対象スタッフセレクタと同じ、`GET /api/staff`で退職者を除く一覧を取得)。**領収書画像はGAS版
  `resizeAndAddImage`と同じロジック(長辺1200px以内・JPEG品質0.7へCanvas APIでリサイズ/圧縮)で
  クライアント側処理してからアップロードし、追加した瞬間にGAS版`runOcr`と同じくOCRを自動実行する**
  (手動の「OCRで自動入力」ボタンは廃止。OCR中はサムネイルにローディング表示、失敗/日時読み取り不可時は
  現在時刻をフォールバック表示する点もGAS版と同じ)。**管理者向け「対象スタッフ」選択は`AdminTargetStaffContext`
  で予定タブ・勤怠タブに共有し**(GAS版`sharedAdminTargetStaffName`と同じ、一覧取得はどちらのタブを
  先に開いても1回だけ)、「📅 予定」タブにもセレクタを表示する。**日報/事故報告モーダルはGAS版の実際の
  構成(日付ナビゲーション・時/分separate選択の時刻・「訪問完了」通知ボタン・🎤音声入力)に合わせて
  作り直した**(音声入力はWeb Speech API、`ja-JP`・`continuous`、GAS版`startVoiceInput`と同じ挙動)。
  **顧客詳細画面のメール/電話/住所にはmailto:/tel:/GoogleMap検索リンクのワンタップボタンを追加した**
  (GAS版`showCustomerDetail`と同じ配色・挙動、住所2は対象外というGAS版の除外ルールも踏襲)。
  **「📅 予定」タブは今日/明日トグル・予定カード一覧・「🚗 ルート・移動時間を取得」ボタンをGAS版と
  同じ見た目で実装し、予定タップで訪問先一覧タブへ切り替え検索欄に反映する(`jumpToCustomerFromSchedule`)
  動作も再現した**(Google Calendar/Maps連携は下記の通りGAS版Web Appへのブリッジ経由。ブリッジ未設定の
  環境ではNoopSchedulePort/NoopMapsPortにより「この日の予定はありません」の空状態を正直に表示する)。
- **スタイルの配信方法だけはGAS版と違う**: TailwindはCDNではなくビルド時に生成し(`packages/web/tailwind.config.js`/
  `postcss.config.js`/`src/index.css`、Tailwind v3)、Outfitフォントも`@fontsource/outfit`で同梱している。
  見た目はGAS版と同じまま、画面表示にあたって外部ドメインへ出ていくリクエストは無い
  (顧客情報を扱う画面から第三者のCDNへアクセスが飛ばない)。
- **意図的に再現していない部分**(対応するバックエンド機能がまだ無いため、見た目だけ真似ると誤解を招く):
  AI生成(日報/事故報告の下書き・領収書OCR)は`GEMINI_API_KEY`未設定かつ管理者設定でもキー未保存の環境では
  常にフォールバック応答(GAS版が同じ状況で返すのと同じ値)になる。

## 公開デモ(GitHub Pages)

サーバーもデータベースも用意せずに全機能を触れる、紹介用の公開デモ。
main への push で自動デプロイされる(`.github/workflows/deploy-demo.yml`)。

**https://ohru131.github.io/katahimo-app/**

```bash
pnpm --filter @katahimo/web build:demo     # 静的ファイル一式を packages/web/dist に出力
pnpm --filter @katahimo/web preview:demo   # ローカルで確認
```

### 何が本物で、何が差し替えなのか

ブラウザの中で **PostgreSQL(PGlite/WASM)を起動し、本番と同じマイグレーション・同じDrizzleリポジトリ・
同じusecases・同じHonoルート**を動かしている。`packages/web` 側のコードは1行も分岐しておらず、
`/api/**` へのfetchを `packages/demo` がブラウザ内のHonoアプリへ横流ししているだけ
(`fetchShim.ts`)。資格情報のフィールド暗号化(`LocalCryptoPort`)・セッション認証も本番の実装が
そのまま動く。

暗号化の範囲も本番と同じ、つまり後述「データ保護の方針」で決めた範囲だけが対象:

- **平文**: 顧客・世帯構成員・日報・事故報告・勤怠・領収書の全項目(本番と同じ。本番で保存時の暗号化を
  担う Cloud SQL 相当の層はデモには無く、IndexedDB にそのまま入る)
- **暗号化**(`LocalCryptoPort`): 管理者設定の資格情報(Gemini APIキー・Google Chat Webhook URL)のみ。
  ただし後述のとおり、デモではこの値自体を永続化しない

加えて、デモの暗号鍵は公開ビルドに含まれる固定値なので、**デモの暗号化に秘匿性はない**
(暗号化対象が資格情報だけになり、その資格情報はデモでは永続化しないので実害はない、という整理)。
訪問者が入力した本物の秘密(Gemini APIキー・Webhook URL)は、公開鍵で暗号化して
「安全に保存した」ことにしないよう、そもそも永続化していない(`DemoAppSettingsRepository`)。

差し替えているのは、ブラウザで動かせないものと、公開デモに鍵を置けないものだけ:

| ポート | 本番 | デモ |
| --- | --- | --- |
| `PasswordHasherPort` | `@node-rs/argon2`(ネイティブ) | `@noble/hashes` のargon2id(パラメータを軽く) |
| `StoragePort` | GCS / ファイルシステム | IndexedDB |
| `MapsPort` | Google Maps(GASブリッジ経由) | 緯度経度からの概算(距離×1.35・時速24km) |
| `SchedulePort` | Googleカレンダー(GASブリッジ経由) | 日付から決定論的に生成(`seed/visitPlan.ts`) |
| `NotifierPort` | Google Chat Webhook | 画面内トースト |
| `ReportAiPort` | Gemini API | 既定は定型応答(下記) |
| `MirrorPort` | outbox → スプレッドシート | 送信先が無いのでNoop |
| `node:crypto` | Node標準 | `@noble/hashes`/`@noble/ciphers` による同期実装(`nodeCryptoShim.ts`) |

`node:crypto`シムの出力が本物と1バイトも違わないことは `nodeCryptoShim.test.ts` で検証している。

### AI(Gemini)の扱い

静的サイトに自分のAPIキーを埋め込むと公開した瞬間に漏洩するため、**デモにキーは一切含めていない**。

1. 既定は定型応答(`CannedReportAiPort`)。断り書き付きで返し、AIが書いたように見せかけない。
   この状態では入力内容が端末の外へ出ることはない。
2. 訪問者が設定モーダルの管理者設定に**自分のGemini APIキー**を登録すると、本番と同じ経路で実際に生成される。
   キーはメモリ上にのみ保持され、どこへも送信されない。タブを閉じると消えるので再入力が必要になる。
   **ただしこの場合、日報生成・領収書OCRの入力内容(メモ本文・領収書画像)はGoogleのGemini APIへ送信される。**
   「データは端末から出ない」のは定型応答のときだけなので、画面上の説明文でもその区別を明示している
   (`DemoBanner`)。

キーを永続化しないのは意図的。デモのKEK(`packages/demo/src/container.ts` の固定値)は公開ビルドに
含まれており誰でも読めるため、この鍵で暗号化してIndexedDBに保存しても平文とほとんど変わらない。
「暗号化して保存しています」という誤った安心を与えないよう、`DemoAppSettingsRepository` が
秘密項目(APIキー・Webhook URL)だけをDBに渡さないようにしている。モデル名など秘密でない設定は
従来どおり保存され、リロード後も残る。

### データについて

利用者20世帯は関西在住の歴史上の人物の名前を借りているが、**住所の番地・連絡先・子どもの情報はすべて架空**。
訪問履歴・勤怠・予定は起動時に「今日」を基準に生成するため、いつアクセスしても日付が古びない。
データはIndexedDBに保存され、画面上部の「リセット」で完全に消去できる。

初回起動は約4〜5秒(スキーマ作成+シード投入)、2回目以降は約2秒。

### 本番ビルドへの混入防止

デモ用コード(PGliteのwasm 8MBと架空データ)が本番の配信物に紛れ込まないよう、通常ビルドでは
`vite.config.ts` の `stripDemoEntry` プラグインがデモの入口モジュールごとスタブに差し替える。
壊れたことを検知できるよう、CIで実際のビルド成果物を `scripts/assertNoDemoInBuild.mjs` が検査する。

## 動作デモ(RESERVA CSV取込)

実際のRESERVA(外部予約システム)エクスポート形式のサンプルCSV(`fixtures/Kokyaku_202601191958_1_dummy.csv`、
ダミー顧客398件)を取り込める。

```bash
cd packages/api
pnpm exec tsx src/scripts/importReservaCsv.ts demo ../../fixtures/Kokyaku_202601191958_1_dummy.csv
# 差分計画(作成/更新/消失件数)を表示したうえで適用する。2回目以降は冪等(既存顧客はupdate扱い)。
# 消失率が既存件数の20%を超える場合は最後に --force を付けない限り拒否される(安全装置)。
```

取り込んだ顧客の世帯構成員(子ども等)は`family_members`テーブルに保存され、顧客詳細画面(`/customers/:id`)で確認できる。

## 動作デモ(勤怠・出勤簿)

`/attendance` を開くと、対象日を選んで出勤簿の入力列(訪問その1〜3・事務作業・移動距離等)を入力・保存でき、
保存直後にGAS版と数値一致を検証済みの計算式(労働時間・残業・移動時間・基準距離超過回数等)がその場で表示される。
下部の月次集計では対象月を選ぶと、入力済みの日をまとめて集計した値を確認できる。

管理者以外は自分自身の勤怠にしか読み書きできない(`?staffId=`クエリは管理者のみ有効。
GAS版`PastSchedule.js`の`resolvePastScheduleTargetStaffName_`と同じアクセス制御パターン)。

## 動作デモ(GAS版パスワードのままログイン)

GAS版のパスワードハッシュ(`sha256(password + AUTH_SALT)`)を持つスタッフを、パスワード変更なしで移行できる。

```bash
# 1. .env の LEGACY_AUTH_SALT に、GAS版 Script Properties の AUTH_SALT と同じ値を設定する
# 2. GAS版のハッシュ値(Staffシート列J)を「標準入力から」渡してスタッフを移行する
#    ハッシュは認証情報なので、コマンドライン引数では受け取らない(シェル履歴や `ps` に残るため)
printf %s '<GAS版のハッシュ値>' \
  | pnpm --filter @katahimo/api import:legacy-staff demo "氏名" メールアドレス

# ハッシュをファイルに用意してある場合(末尾の改行は自動で除去される)
pnpm --filter @katahimo/api import:legacy-staff demo "氏名" メールアドレス < legacy-hash.txt

# 管理者として移行する場合は末尾に --admin を付ける
```

標準入力が空のときや端末から直接実行したときは、DBに接続せずエラーで終了する。

移行したスタッフは、既存パスワードのままログインでき、成功した瞬間にargon2idへサイレント再ハッシュされる
(`staff.password_hash`が設定され`staff.legacy_password_hash`はnullに戻る)。2回目以降はargon2idだけで検証される。

## 検証コマンド

| コマンド | 内容 |
| --- | --- |
| `pnpm typecheck` | 全パッケージの `tsc --noEmit` |
| `pnpm test` | Vitest(ドメイン/ユースケースの回帰テスト、RLSの静的検査とPGlite上での実挙動検証、公開デモの起動処理まで。勤怠計算などGAS版との数値一致検証もここ) |
| `pnpm lint` / `pnpm lint:fix` | Biome |
| `pnpm build` | 全パッケージのビルド |
| `pnpm --filter @katahimo/web build:demo` | GitHub Pages公開デモのビルド(`preview:demo`でローカル確認) |
| `node scripts/assertNoDemoInBuild.mjs` | 本番ビルドにデモ用コード/データが混入していないかの検査 |
| `pnpm db:generate` / `db:migrate` / `db:seed` | Drizzleのマイグレーション生成・適用・初期データ(`db:generate`は`FORCE ROW LEVEL SECURITY`と`set_updated_at`トリガーを生成しないため、生成後に手で追記する。`packages/db/drizzle/0000_baseline_schema.sql`冒頭のコメント参照) |

## データ保護の方針

**方針(1行で)**: アプリ層でフィールド暗号化するのは `app_settings` の資格情報3項目(Gemini APIキー・Google Chat Webhook URL 2本)だけ。顧客・世帯構成員・日報・事故報告・勤怠・領収書の業務データは全て平文列で持ち、保存時の暗号化は本番配備先(Cloud SQL)の既定機能で満たす想定。**本番環境は未配備**のため、これは配備時に満たすべき前提条件であり、現時点でコードとして担保しているのは RLS・ロール分離・argon2id・資格情報のアプリ層暗号化まで(契約の定義は `packages/core/src/ports/crypto.ts`、設計判断の詳細と NDA 対応表の全文は `doc/09_データベース構造解説.md` §1.3・§3)。

業務データをアプリ層で暗号化しない理由は3つ。

1. **検索性**: 日報・事故報告・勤怠・領収書を SQL で絞り込み・集計・全文検索できる。暗号文のままでは「ある顧客の日報から特定の語を探す」だけでも全件復号が要る。日報・事故報告の本文は JSON 1本ではなく項目ごとの `text` 列(`daily_reports.start_time/end_time/input_text/internal_text/customer_text`、`accident_reports.target_name/target_dob/occurrence_time/location/accident_content/situation/immediate_response/parent_correspondence/diagnosis_treatment/prevention/input_text`)に分け、列単位でインデックスや集計を掛けられるようにした。勤怠だけは `attendance_days.row_data jsonb`(常に1日分をまるごと読み書きする動的なオブジェクトのため、分解する利点が無い)。
2. **日報データの AI 活用**: 傾向分析・要約などで日報を機械的に読む用途を見越すと、アプリ層暗号化は都度復号のコストと鍵の配線を分析側にまで広げることになる。
3. **契約が求める水準**: 実証協力事業者との秘密保持契約(案)第6条が求める安全管理措置は「アクセス制限、通信および保存時の暗号化、パスワード管理等」であり、フィールド単位の暗号化は要求していない。保存時の暗号化は本番配備先(Cloud SQL)の既定機能(TDE 相当、バックアップ含む)で満たす想定だが、**本番環境は未配備**のため配備時に確認すべき前提条件である。第3条2・第4条(仙台市への報告は統計化・匿名化、スタッフ氏名は仮名化、住所は座標化して分析)は分析・出力側の要件で、DB が平文であるほうが SQL で匿名化処理を実施しやすい。

| NDA条項 | 要求 | katahimo-app での対応 | 状態 |
| --- | --- | --- | --- |
| 第6条 | アクセス制限 | RLS(全テーブル FORCE)、`katahimo`(所有者/DDL)と `katahimo_app`(RLS 対象)のロール分離、管理者限定 API、セッション認証 | 実装済み(ローカル/デモで検証) |
| 第6条 | 通信時の暗号化 | HTTPS/TLS(Cloud Run。DB 接続も TLS) | 本番配備時(Cloud Run/Cloud SQL 接続設定) |
| 第6条 | 保存時の暗号化 | Cloud SQL の保存時暗号化(既定、バックアップ含む)+ 資格情報のみアプリ層 AES-256-GCM(エンベロープ暗号化) | Cloud SQL 側は本番配備時、資格情報のアプリ層暗号化は実装済み |
| 第6条 | パスワード管理 | argon2id、初期パスワードの強制変更、ログイン試行の抑制(10回で15分ロック)、再設定コードは HMAC 検証子のみ保存 | 実装済み |
| 第7条 | 返還・廃棄 | テナント単位の物理 DELETE 手順 + バックアップ保持期間の満了(資格情報は `tenant_keys` の revoke でも復号不能にできる) | 手順・保持期間は本番配備時に定める(未整備) |
| 第3条2・第4条 | 匿名化 | 分析・AI 利用・報告書では氏名・連絡先・住所列を除外し統計化する(平文列なので SQL で実施可能。スタッフ氏名は仮名化、住所は座標化) | 分析・報告書作成時のルールとして未整備、平文列により実施可能になった |

**本番配備は未着手**(Cloud Run / Cloud SQL / Cloud KMS / バックアップ運用のいずれも未構成)。上記の本番側の対策は配備時のチェックリストとして扱い、配備・検証が済むまで NDA 第6条を満たしていると主張しない。

- **資格情報の鍵管理**。DEK はテナントごとに `crypto.randomBytes` で独立生成し、`KeyManagementPort`(KEK)でラップした状態のみ `tenant_keys` に保存する(エンベロープ暗号化。平文 DEK は `LocalCryptoPort` のプロセス内メモリにしかない)。DEK は世代を並存させ(`tenant_keys` の主キーは `(tenant_id, dek_version)`)、暗号化は常に最新世代、復号は暗号文に記録された世代(`*_key_version`)の鍵で行う。`LocalCryptoPort.rotate()` は世代を1つ足すだけなので既存の暗号文が読めなくなることはないが、**既存データを新世代へ移す再暗号化バッチは未実装**(対象は資格情報3列だけになった)。ローカル開発の KEK は環境変数 `LOCAL_DEV_KEK` 1本(`LocalKmsPort`)。**本番の KEK(Cloud KMS)は未実装**で、`KeyManagementPort` の実装差し替えで対応する設計(KEK だけのローテーションは `TenantKeyRepositoryPort.updateWrappedDek`)。
- **revoke の効果範囲**: テナント解約時に `tenant_keys` の該当行を revoke するとバックアップに残った暗号文も復号不能になる(暗号学的削除)が、これが及ぶのは資格情報だけ。顧客等の業務データは平文なので、NDA 第7条の返還・廃棄はテナント単位の物理 DELETE とバックアップ保持期間の満了で担保する。
- **ブラインドインデックスは廃止**。領収書の重複検出は `receipts.dedupe_key` に `buildReceiptDedupeKey()` の正規化済み文字列をそのまま保存して等値一致で行う(GAS 版 `buildKey` と同じ挙動)。HMAC 用の別鍵と `BlindIndexPort` は削除した。
- **暗号化済みデータの移行経路は持たない**。復号→再保存のスクリプトは無く、実運用前で移行対象が存在しないため用意しない。ローカル開発 DB は `pnpm db:migrate` → `pnpm db:seed` で作る。公開デモはベースライン以前のスキーマが残った IndexedDB を検知して自動で作り直す(`packages/demo/src/database.ts` の `REBUILD_REQUIRED_MIGRATIONS`)。
- **ミラーワーカーは復号しない**。`packages/worker` は平文列をそのまま読んで Bridge.js に送るため、`LOCAL_DEV_KEK` は不要(API サーバーは資格情報の復号のため必要)。
- 監査ログ(`AuditLogPort`、実装は `ConsoleAuditLogPort`)は構造化 JSON を1行ずつ stdout へ出力する(Cloud Run 上は stdout/stderr がそのまま Cloud Logging に取り込まれるため追加の GCP 設定は不要)。記録するのは2種類。復号(`recordDecrypt`)は資格情報の復号(管理者設定の読み出し・Gemini 呼び出し・Chat 通知)だけが対象で、「どのテナントのデータをいつ復号したか」まで(`decrypt(tenantId, value)` のシグネチャに呼び出し元情報が無いため「誰が」は残らない)。認証・権限まわりのイベント(`record`)は `actorStaffId`(誰が)・`targetStaffId`(誰を)付きで残す(ログイン失敗だけ severity=WARNING。種別は `login_succeeded`/`login_failed`/`password_changed`/`password_reset_completed`/`staff_created`/`staff_updated`/`staff_password_reset_by_admin`。`AuditEventType` には `logout`/`password_reset_requested` も定義してあるが、記録の呼び出しはまだ置いていない)。**業務データは全て平文列なので、その参照は復号を経由せずこの網には入らない**。データアクセス監査が必要になれば DB 側の監査(pgaudit 等)が本命。
- 実装は `packages/integrations`(`local-crypto`/`local-kms`)に置く。暗号化対象カラムは `*_ciphertext`/`*_key_version` のペアで、現在は `app_settings` の3ペアのみ。

## 実装状況

GAS版(`reference/gas-childcare-visit-app`)からの移植。**本番環境はまだ配備していない。**

### 動いているもの

- **基盤**: pnpm workspaces のモノレポ、TypeScript strict、Biome、Vitest、ローカルPostgreSQL、Hono、Vite + PWA。
- **スキーマとテナント分離**: `tenant_id` を持つ全テーブルに RLS(`tenant_isolation` + `FORCE`)。
  DDL 用の `katahimo` とアプリ用の `katahimo_app` にロールを分ける。FK 制約は RLS をバイパスする
  (PostgreSQL の仕様)ため、テーブル間の参照はすべて `(tenant_id, xxx_id)` の複合FKにしている。
  網羅性は `packages/db/src/rlsPolicies.test.ts`(スキーマ定義から対象を動的に集めて静的検査)と
  `packages/demo/src/rlsEnforcement.test.ts`(PGlite 上の非特権ロールで実際に止まることを確認)で担保。
  詳細は `doc/09_データベース構造解説.md`。
- **認証**: argon2id、httpOnly Cookie セッション(tenantId を埋め込んで RLS のチキン&エッグを回避)、
  `POST /api/auth/login`・`GET /api/auth/me`・`POST /api/auth/logout`。GAS版の SHA-256+salt ハッシュは
  `computeLegacyHash` でそのまま引き継げ、ログイン成功時に argon2id へサイレント再ハッシュされる。
- **パスワード再設定 + 初期パスワード方式**: メールの6桁コード(有効期限30分)による再設定と、
  管理者がスタッフを登録したときの初期パスワード自動生成。本人が変更するまで
  **サーバー側が他のAPIを403で拒否する**(`staff.must_change_password` + `requirePasswordChangeGuard`)。
  画面だけで促してもAPIを直接叩けば通ってしまうため、強制はサーバー側で行う。
  メール送信は `MailerPort`、既定の実装は GAS版と同じ `MailApp.sendEmail` を使う `GasBridgeMailerPort`
  (`doc/10`「新規GCP APIより既存GASブリッジを優先」)。GAS版から意図的に変えた点が4つある。
  (1) 宛先が登録済みかどうかで応答を出し分けない(メールアドレスの登録有無を確かめられないため)、
  (2) コードは平文ではなく、DBに置かないペッパー(`PASSWORD_RESET_PEPPER`)を鍵にした HMAC-SHA256 の
  検証子として保存する(6桁=100万通りしかないため、単純なハッシュでは DB ダンプからオフラインで復元できる)、
  (3) 誤入力5回でコードを無効化する、(4) 再設定の完了時にそのスタッフの全セッションを破棄する
  (パスワードを忘れる状況には乗っ取られている場合も含まれるため)。パスワードは8文字以上。
- **認証まわりの堅牢化**: ログイン試行は連続10回の失敗で15分ロックし、成功でカウンタを0に戻す
  (`packages/core/src/domain/auth/loginThrottle.ts`)。恒久ロックにしないのは、特定のアカウントを狙って
  失敗させ続ければその人を締め出せてしまうため。時間で自動的に解け、攻撃の速度だけが落ちる。
  **ロック中かどうかで応答は変えない**。argon2id のコストは
  `memoryCost: 19456, timeCost: 2, parallelism: 1` と明示する(ライブラリ既定値に任せると
  バージョン更新で黙って変わり、どのコストで運用しているかがコードから読めない)。書き込み系のAPIは
  Origin ヘッダを照合するミドルウェア(`packages/api/src/csrf.ts`)で別オリジンからの要求を403で止める
  (Cookie の `SameSite=Lax` に加えるサーバー側の防御。`ALLOWED_ORIGINS` が空なら同一オリジンのみ)。
  セッション Cookie に署名鍵は使わない(入るのは32バイトの乱数トークンで、検証はDB側の SHA-256 ハッシュとの照合)。
- **RESERVA 顧客CSVの取込**: UTF-16LE・タブ区切り・30列のデコード/パース/外部ID突合による差分計算
  (作成/更新/ソフトデリート)/適用。`parseFamilyInfo`/`normalizeDateStr` は GAS版 `CsvImport.js` からの移植で、
  実サンプル398行で GAS の実行結果と1件残らず一致することを検証済み。世帯構成員は `family_members` に全件保存。
  地区(city)は `extractCityFromAddress`(GAS版 `Main.js` の住所パーサーの移植)で住所から自動抽出する。
  消失率(取込データから消えた顧客の割合)が閾値を超えると適用を拒否する安全装置つき。
- **顧客詳細と報告系の画面**: ヘッダー + 3タブ(📅 予定 / 🏠 訪問先一覧 / 🕒 勤怠)の URL なし単一ページ構成で、
  GAS版 `index.html` と同じ構造・配色にしてある(移行時の混乱を減らすため)。顧客詳細はボトムシートモーダル。
- **日報 / 事故報告 / 活動記録 / 領収書登録**: `POST /api/reports/daily`・`/accident`・`/daily/generate`・
  `/accident/generate`・`GET /api/reports/history`・`POST /api/receipts`・`/ocr`。GAS版 `GeminiReport.js` の
  `callGemini`(思考パートのスキップ・コードフェンス除去・改行アンエスケープ・HTTPステータス別エラーメッセージ)と
  `Main.js` の `getCustomerReports`/`saveReport`/`saveAccidentReport`/`uploadReceiptsOnly` を
  Node 実行結果と突き合わせて移植した。`GEMINI_API_KEY` 未設定時は GAS版と同じフォールバック応答を返す
  (`NoopReportAiPort`)。領収書画像は `StoragePort`(ローカルは `LocalFileStoragePort`、本番はGCS想定)に保存し、
  Google Chat 通知は `WebhookNotifierPort`(URL 未設定時はスキップ)で送る。
- **割引クーポン**: 種別マスタ(`coupons`)・顧客への配布(`customer_coupons`)・適用記録
  (`coupon_redemptions`)の3テーブル。管理画面で「使える日(いつでも/対象者の誕生月のみ)」
  「使える人(全顧客/配布した顧客のみ)」「使用回数の上限(制限なし/顧客ごと1回/顧客ごと年1回)」を
  組み合わせて登録する。日報画面のクーポン選択には**その顧客がその日に使えるものだけ**が出る
  (誕生月でない月の誕生月クーポンや、配っていない顧客のクーポンは出ない)ので、スタッフが
  条件を1件ずつ確かめる必要がない。使用上限に達したものは「使用済み」として残す(消すと
  付け忘れと区別できないため)。誕生日は世帯代表(`customers.dob_date`)と世帯構成員
  (`family_members.dob_date`)の両方に対応し、適用時には根拠にした人の氏名と生年月日を
  記録に残す。判定は `evaluateCouponEligibility` 1箇所に寄せ、画面の選択肢づくりと保存時の
  検証が同じ関数を通る。上限は DB の部分一意索引でも守る。設計理由は `doc/14` §9。
- **勤怠計算エンジンと週間予定UI**: `AttendanceCalc.js`(GAS版)を Node 上でそのまま実行した結果を正解として、
  TypeScript 移植版(`packages/core/src/domain/attendance/`)を合成データ19ケース+月次集計で突き合わせ、
  完全一致を確認済み。`attendance_days`(入力値のみを `row_data jsonb` で保存し、派生値は保存せず都度計算)・
  `GET/PUT /api/attendance/day`・`GET /api/attendance/month`・`GET /api/attendance/week`。
  画面は GAS版と同じ Google カレンダー風の週間予定表示で、予定をタップして個別編集、
  「移動・距離・その他」パネルで日単位の項目をまとめて編集する。管理者以外は自分の勤怠にしか読み書きできない。
- **書き込みの原子性**: 日報/事故報告/勤怠/領収書の保存と `outbox_jobs` への enqueue、
  パスワード再設定コードの消費と新しいパスワードの書き込みは、それぞれ同一トランザクションで行う
  (`UnitOfWorkPort` と `DrizzleUnitOfWork`。リポジトリのメソッドは省略可能な `scope?: TransactionScope` を
  最後に取り、渡されたときは新しいトランザクションを開かず既存のものに相乗りする)。
  「保存はされたがスプレッドシートへ永久に反映されない」「コードだけ焼かれてパスワードが変わらない」
  という中途半端な状態が残らない。

### 外部連携(Sheets/Drive/Calendar/Maps)— コードは実装済み、GAS側のデプロイ待ち

Google Maps Platform の新規契約・課金設定を避けるため、**稼働中の gas-childcare-visit-app Web App
(`Bridge.js`)を軽量な JSON API プロキシとして再利用する**方式を採っている(`doc/10`)。GAS の Maps サービスと、
既に本番で動いているカレンダー解析・ルート計算ロジック(`RouteSearch.js`)をそのまま呼ぶだけなので、
複雑な分類ロジック(RESERVA 予約タイトルの判定・スタッフ突合等)を TypeScript 側で再実装せずに済む。

- 読み取り: `SchedulePort`/`MapsPort`(`GasBridgeSchedulePort`/`GasBridgeMapsPort`。
  `GAS_BRIDGE_URL`/`GAS_BRIDGE_SECRET` 未設定時は `NoopSchedulePort`/`NoopMapsPort` にフォールバック)、
  `GET /api/schedule`・`GET /api/schedule/route`、「📅 予定」タブの実データ表示。
- 書き込み(ミラー): 日報 / 事故報告 / 領収書 / 勤怠(出勤簿)/ 勤怠集計の5種類。各 usecase が DB 保存に成功した
  直後に `MirrorPort.enqueue` で `outbox_jobs` へ1件積み、`packages/worker` が種別ごとに DB の最新値を読み直して
  GAS 側の列に書き込める形に整形する。ワーカーはテナントごとに `FOR UPDATE SKIP LOCKED` でポーリングする
  (RLS 対象のためテナントを跨いで一度に取得できない)。日報/事故報告シートには katahimo-app 側の reportId を
  追跡する `KatahimoReportId` 列を最終列に持たせ、同じ reportId の再送(編集保存)では該当行を上書きする
  (GAS版自身の `rowIndex` 方式は1ブラウザセッション内でしか使えず、outbox からの非同期再送では追跡できないため)。
  `MIRROR_TO_GOOGLE_SHEETS=false`(既定)の間は API 側が積み込み自体を行わない(`NoopMirrorPort`)。
- **`attendance_aggregate`(「勤怠集計」シート)だけは作りが違う。** このシートは katahimo-app の入力値ではなく
  Google カレンダーの予定と Maps のルート計算から導かれる派生データで、1行=予定1件(17列。
  `RouteSearch.js` の `ATTENDANCE_SHEET_HEADER`)という形をしており、`attendance_days` が持つ出勤簿の入力列とは
  形も出自も違うため DB の値を書き写せない。そのためこの種別だけは値を送らず、対象スタッフ名と日付だけを渡して
  **GAS 側に再計算をやり直させる**。ジョブ1件ごとに GAS 側で Maps のルート計算が走るため
  **既定では積まない**(`MIRROR_ATTENDANCE_AGGREGATE=false`)。スタッフ名が引けない勤怠行のジョブは、
  空文字で送ると GAS 側がどのスタッフの行を消して書き直すか決められないため、再試行せず即デッドレターに落とす。
  ブリッジ呼び出しのタイムアウトは `GAS_BRIDGE_TIMEOUT_MS`(既定20秒)で延ばせる。
- **Google カレンダーへの書き戻しは対象外。** GAS版はカレンダーを読むだけで一度も書き込んでいない
  (`RouteSearch.js` の `CalendarApp` 呼び出しは `getEvents`/`getMyStatus` のみ)ため、書き戻し先そのものが存在しない。
  `CalendarPort` は実装を持たない型だけの状態で、将来カレンダーを新システム側で編集する要件が出たときの置き場所。
  `outbox_jobs.kind` は DB では `text` 列でリポジトリが `MirrorKind` へ無検査キャストするため、`MirrorKind` に無い値が
  ワーカーに届くことは起こりうる。その場合は再試行せず即デッドレターに落とす(`PermanentMirrorError`)。
- **ジョブの失敗は終端ではなく指数バックオフで再試行する**: 5秒から倍々に伸ばし、上限1時間、最大8回まで
  (`packages/core/src/domain/mirror/retry.ts`)。上限に達したものだけを `failed`(デッドレター)に落とす。
  `processing` のまま `updated_at` が5分を過ぎた行は再び claim の対象になるため、ワーカーが異常終了しても取り残されない。
  デッドレターが発生した回は通常のログとは別に `console.error` で出す(Cloud Logging の severity で拾える)。
  ミラーの冪等キーはランダムUUIDではなく「種別:レコードID:版(更新時刻)」から組み立てるため
  (`packages/core/src/domain/mirror/idempotencyKey.ts`)、同じ保存操作が二度 enqueue されても
  `UNIQUE(tenant_id, idempotency_key)` が実際に効く(編集して保存し直した場合は版が進むので別ジョブとして積まれる)。

**`Bridge.js` は読み取り側・書き込み側ともに本番デプロイされていない。** `clasp push` / 新デプロイ作成 /
Script Properties への `BRIDGE_API_SECRET` 設定はユーザー承認待ちで、実際に API を叩いての動作検証も行っていない
(理由と手順は `doc/10_GAS版連携の制約と方針.md`)。ローカルでは API + ワーカー + ダミーHTTPサーバーで
pending→done の遷移、ペイロードの JSON 構造が Bridge.js 側の期待するフィールド名と一致すること、
ブリッジが到達不能な場合に `lastError` を記録して再試行待ちへ戻ることを確認済み。

### まだ無いもの

- 予約 / 請求・決済 / 顧客カルテ / 訪問割当の最適化 / 移動手当 — **DBのスキーマと制約のみ**。
  リポジトリ実装・API・画面は無い(`doc/15_追加ドメインの設計とレビュー論点.md`)。
- 本番アダプタ: GCS(`StoragePort`)と Cloud KMS(`CloudKmsPort`)は差し替え口だけ用意してある。
- Google 認証(OAuth)。実 GCP クライアントIDが必要なため未着手。
- 実際の出勤簿データを使った GAS版との数値照合(並行運用)。計算式の正しさは合成データで確認済みだが、
  実データでの突き合わせは未実施。勤怠 `row_data` の正規化(`doc/14` §2 の段階2)はこの照合の後に行う。
- 旧システムの停止・切替。
