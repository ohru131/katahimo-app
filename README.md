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
| `@katahimo/db` | Drizzleスキーマ・マイグレーション・RLS・シード。`withTenant()` でテナントスコープ実行 |
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
# SESSION_SECRET を適当な値に。既存パスワードでのログイン検証には
# LEGACY_AUTH_SALT に GAS版 Script Properties の AUTH_SALT と同じ値を入れる(Phase 2以降)。
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
pnpm --filter @katahimo/api seed
# -> tenantSlug=demo, admin@example.com / admin1234 が作られる

# 3. APIとWebをそれぞれ起動
pnpm --filter @katahimo/api start   # http://localhost:8080
pnpm --filter @katahimo/web dev     # http://localhost:5173
```

`http://localhost:5173` を開き、法人ID `demo` / `admin@example.com` / `admin1234` でログインすると、GAS版
(`gas-childcare-visit-app/index.html`)と同じ見た目・タブ構成のアプリが表示される(移行時の混乱を減らすため、
Tailwind CDN・Outfitフォント・配色・ヘッダー/3タブのレイアウトをそのまま踏襲している。詳細は下記「UIをGAS版に
合わせた範囲」参照)。「🏠 訪問先一覧」タブは有効な顧客を全件取得し(氏名・電話・市区町村は復号済み)、名前欄への
入力でas-you-type絞り込み・地区セレクトで絞り込みができ、どちらも指定していない既定表示は直近保存/領収書登録した
顧客順(「最近使った顧客」)になる(GAS版のallCustomers/filterCustomers()と同じ設計)。カードをタップすると
GAS版と同じボトムシート形式のモーダルでRESERVA CSVの全項目
(カナ・メール・住所・緊急連絡先・会員情報等)と世帯構成員(子ども等)一覧を復号した状態で確認できる(Phase 4・
読み取り系)。DBの生カラムを直接見ると(`psql -U katahimo -d katahimo_dev -c "SELECT name_ciphertext FROM customers LIMIT 1"`)、
暗号文であって平文が保存されていないことを確認できる。

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
  日報/OCR用モデル選択・Google Chat Webhook URL)はテナントごとに新テーブル`app_settings`へ暗号化して
  保存し、日報AI生成/OCR/通知の実処理がこの値を優先して使う(未設定なら`.env`のデフォルトにフォールバック)。
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
(`fetchShim.ts`)。フィールド暗号化(`LocalCryptoPort`)・ブラインドインデックス
(`LocalBlindIndexPort`)・セッション認証も本番の実装がそのまま動く。

ただし「全部暗号化されている」わけではない。本番と同じ範囲、つまり上記
「PII暗号化の方針」で決めた範囲だけが対象:

- **平文**: 顧客の氏名・カナ・メール・電話・住所・市区町村・駐車場情報(本番と同じ)
- **暗号化**(`LocalCryptoPort`): 緊急連絡先・避難場所・顧客メモ・Benefit会員ID・緯度経度、
  世帯構成員の全項目、日報/事故報告の本文、領収書の金額/店舗名/申し送り、勤怠のrowData
- **ブラインドインデックス**(`LocalBlindIndexPort`): 領収書の重複判定に使う
  `receipts.dedupe_blind_index` のみ(スキーマ上、blind indexカラムはこれ1つだけ)

加えて、デモの暗号鍵は公開ビルドに含まれる固定値なので、**デモの暗号化に秘匿性はない**
(守っている対象がシードの架空データだけなので問題にならない、という整理)。
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

取り込んだ顧客の世帯構成員(子ども等)は`family_members`テーブルに保存され、顧客詳細画面(`/customers/:id`)で復号して確認できる。

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
# 2. GAS版のハッシュ値(Staffシート列J)をそのまま渡してスタッフを移行する
cd packages/api
pnpm exec tsx src/scripts/importLegacyStaff.ts demo "氏名" メールアドレス <GAS版のハッシュ値>
```

移行したスタッフは、既存パスワードのままログインでき、成功した瞬間にargon2idへサイレント再ハッシュされる
(`staff.password_hash`が設定され`staff.legacy_password_hash`はnullに戻る)。2回目以降はargon2idだけで検証される。

## 検証コマンド

| コマンド | 内容 |
| --- | --- |
| `pnpm typecheck` | 全パッケージの `tsc --noEmit` |
| `pnpm test` | Vitest(純粋関数の回帰テスト。勤怠計算などGAS版との数値一致検証もここ) |
| `pnpm lint` / `pnpm lint:fix` | Biome |
| `pnpm build` | 全パッケージのビルド |
| `pnpm --filter @katahimo/web build:demo` | GitHub Pages公開デモのビルド(`preview:demo`でローカル確認) |
| `node scripts/assertNoDemoInBuild.mjs` | 本番ビルドにデモ用コード/データが混入していないかの検査 |
| `pnpm db:generate` / `db:migrate` / `db:seed` | Drizzleのマイグレーション生成・適用・初期データ |

## PII暗号化の方針

**対象範囲(2026-08 データベース構造レビューで見直し)**: 当初は氏名・メール・電話・住所等を含め個人特定につながる項目を全てフィールド暗号化していたが、有識者レビューで「DB個別の暗号化は過剰、バックアップの暗号化(TDE)+RLS+アクセス制御で十分」という指摘を受け、対象を要配慮性の高い項目に絞った(`packages/core/src/ports/crypto.ts` に契約を定義済み。詳細な設計判断は `doc/09_データベース構造解説.md` 参照)。

- **氏名・メール・電話・住所・駐車場情報は平文で保存する**。DB/バックアップの透過的暗号化(TDE)・Row Level Security・アクセス制御(IAM)で保護する、通常のSaaSと同水準の扱いにした。氏名は`familyName`/`givenName`を平文の別カラムに持ち(`domain/pii/japaneseName.ts` の `splitJapaneseFullName` で分割・`normalizeStaffName`で正規化)、「苗字だけで検索する」現場運用にはこのカラムへの通常のインデックス検索で対応する(部分一致/前方一致もSQL的には可能だが、現時点では旧方式と挙動を揃えて完全一致のみ)。`staff.email`はログインの検索キーになるため、書き込み時に`normalizeEmailForIndex`で正規化した値を保存する。
- **引き続きランダム化暗号(AES-256-GCM相当、`CryptoPort`)で保存する項目**: 緊急連絡先(第三者情報)・避難場所(通学先の特定につながりうる)・顧客メモ(自由記述で内容予測不可)・Benefit会員ID(識別子)・緯度経度(自宅の正確な位置情報)、および世帯構成員(`family_members`、児童本人の情報のため氏名・生年月日・自由記述を全て暗号化)・日報/事故報告の本文・領収書の金額/店舗名/申し送り・管理者設定のAPIキー/Webhook URL。
- 鍵(DEK)はテナントごとに`crypto.randomBytes`で独立に生成し、`KeyManagementPort`(KEK)でラップした状態のみ`tenant_keys`テーブルに保存する(エンベロープ暗号化。平文DEKは`LocalCryptoPort`のプロセス内メモリにしかない)。旧実装(環境変数のマスターキー1本からテナントIDを混ぜてSHA256で鍵を決定的に導出する方式)は「マスターキーが漏れれば全テナントの鍵を誰でも再計算できる、実質1本の鍵を共有しているのと同じ」設計だったと指摘され、この方式に置き換えた。テナント解約時は`tenant_keys`の当該行を削除(revoke)するだけで、バックアップに残った暗号文も含めて復号不能にできる(暗号学的削除)。
- ローカル開発・PoCの`KeyManagementPort`実装は`LocalKmsPort`(環境変数`LOCAL_DEV_KEK`1本でDEKをAES-256-GCMラップするだけの簡易実装)。本番はCloud KMSでラップする実装に差し替える(Phase 5、実際のGCPプロジェクト・KMSキーリングが用意でき次第。`KeyManagementPort`のインターフェース自体は変えずに済む)。KEKだけのローテーション(DEKは変えずラップし直すだけ)は`TenantKeyRepositoryPort.updateWrappedDek`で軽量に行えるが、DEKそのもののローテーション(実データの再暗号化を伴う)は未実装。
- 復号(`CryptoPort.decrypt`)のたびに`AuditLogPort`(`ConsoleAuditLogPort`)がテナントIDと時刻を構造化JSONでstdoutへ出力する。Cloud Run上はstdout/stderrがそのままCloud Loggingに取り込まれるため追加のGCP設定は不要。ただし現時点では「どのテナントが」までで、「誰が(どのスタッフが)」までは記録していない(`decrypt(tenantId, value)`のシグネチャに呼び出し元情報が無く、全呼び出し箇所への配線は影響範囲が大きいため見送った。将来必要になれば拡張する)。
- 実装は `packages/integrations` に置く。暗号化対象カラムは`ciphertext`/`key_version`のペアとして最初からスキーマに組み込んでいる。

## 進捗(フェーズ)

- [x] **Phase 0 — 基盤構築**: モノレポ・TS strict・Biome・Vitest・Docker/ローカルPostgreSQL・Hono空サーバー・Vite PWA雛形・health/DB疎通。
- [x] **Phase 1 — スキーマとテナント分離(RLS)**: tenants/staff/sessions/customers/outbox_jobsをDrizzleで定義し、tenant_idを持つ全テーブルにRLSポリシーを適用(katahimo=所有者/DDL用、katahimo_app=RLS対象のアプリ用ロールに分離。実際にRLSがブロックすることを確認済み)。**2026-08 データベース構造レビューで、RLSはSELECTしか絞り込まずFK制約自体は常にRLSをバイパスする(PostgreSQL仕様)ため単一列FKのままだとテナントを跨いだ取り違えを防げないと指摘され、`customers`/`staff`に`(tenant_id, id)`のUNIQUE制約を追加し、`daily_reports`/`accident_reports`/`receipts`/`family_members`/`attendance_days`/`sessions`のFKを全て`(tenant_id, xxx_id)`複合FKに置き換えた**(実際にPostgreSQLへ適用する際、`drizzle-kit generate`が出力するステートメント順のままだと複合FKが参照先のUNIQUE制約より先に実行されて失敗することが実機で判明したため、マイグレーションSQLの順序を手動で修正した)。あわせて`outbox_jobs`の冪等キーのUNIQUE制約もテナント跨ぎで衝突し得た点を`(tenant_id, idempotency_key)`にスコープし直した。**続けて有識者レビューで「DB個別の暗号化(氏名・住所等まで含む全面フィールド暗号化)は過剰、バックアップ暗号化(TDE)+RLSで十分」と指摘を受け、`customers`/`staff`の氏名・かな・メール・電話・住所・駐車場情報を平文カラムに戻し、ブラインドインデックス列(`*_blind_index`)を全廃した**(引き続き暗号化するのは緊急連絡先・避難場所・メモ・Benefit会員ID・緯度経度のみ。詳細は本READMEの「PII暗号化の方針」・`doc/09_データベース構造解説.md`参照)。マイグレーション生成時、同一テーブルで列の追加と削除が同時に発生すると`drizzle-kit generate`がリネームか新規かを対話的に確認しようとして自動化できない問題に遭遇したため、「削除のみ」→「追加のみ」の2回に分けてgenerateする回避策を用いた。
- [x] **Phase 2 — 認証(メール)**: argon2idパスワードハッシュ、httpOnly Cookieセッション(tenantId埋め込みでRLSのチキン&エッグ問題を回避)、`POST /api/auth/login`・`GET /api/auth/me`・`POST /api/auth/logout`。**GAS版のSHA-256+saltパスワードハッシュ(Auth.jsのcomputeHash)を、パスワード変更なしで引き継げるようにした**(`computeLegacyHash`。GAS版を実行した結果と一致することを検証済み)。ログイン成功時にargon2idへサイレント再ハッシュされ、実際にAPI経由で移行→ログイン→再ハッシュ確認→2回目ログインまで動作確認済み。Google認証(OAuth)は未着手(実GCPクライアントIDが必要なため)。
- [x] **Phase 3 — 取込・アップサート基盤(RESERVA CSV)**: `parseFamilyInfo`/`normalizeDateStr`(GAS版`CsvImport.js`から完全移植、実サンプル398行でGAS実行結果と1件残らず一致することを検証済み)・Excelシリアル日時変換を追加し、RESERVA顧客CSV(UTF-16LE・タブ区切り・30列、パスワード列を除く全項目)のデコード/パース/外部ID突合による差分計算(作成/更新/ソフトデリート)/適用を実装。世帯構成員(子ども等)は`family_members`テーブルに全件保存し、詳細取得で復号して確認できる。消失率(取込データから消えた顧客の割合)が閾値を超えると適用を拒否する安全装置つき。実データ(`fixtures/Kokyaku_202601191958_1_dummy.csv`、398件)を実際にPostgreSQLへ取り込み、冪等性(再取込で重複しないこと)も確認済み。**地区(city)はGAS版`Main.js`の住所パーサーを移植した`extractCityFromAddress`で住所文字列から自動抽出する**(当初は「信頼できるパーサーが無い」として未設定にしていたが、GAS版自身がこのパーサーを実務で使っていたと判明したため2026-08-28に追加)。
- [x] **Phase 4 — 顧客詳細画面(読み取り系の一部)+ UIをGAS版に合わせて再構築**: `GET /api/customers/:id`(セッションのtenantIdのみを使用)を追加。RESERVA CSV由来の全項目・世帯構成員一覧を復号して表示する。当初はreact-router-domでページ遷移させていたが、移行時の混乱を減らすためGAS版(`gas-childcare-visit-app/index.html`)と同じ「ヘッダー+3タブ(📅 予定/🏠 訪問先一覧/🕒 勤怠)のURLなし単一ページアプリ」構造・Tailwind配色に作り直した(react-router-domは廃止)。顧客詳細はGAS版と同じボトムシートモーダルに変更。「予定」タブは当時Calendar連携(Phase 5)が無かったため空状態を表示する枠のみだったが、後述のPhase 5進捗で実装した。
- [x] **日報/事故報告/活動記録/領収書登録**: `daily_reports`/`accident_reports`/`receipts`テーブル(自由記述はattendance_daysと同じくJSON1本にまとめて暗号化)、`POST /api/reports/daily`・`/accident`・`/daily/generate`・`/accident/generate`・`GET /api/reports/history`・`POST /api/receipts`・`/ocr`を実装。GAS版`GeminiReport.js`の`callGemini`(思考パートのスキップ・コードフェンス除去・改行アンエスケープ・HTTPステータス別エラーメッセージ)と`Main.js`の`getCustomerReports`/`saveReport`/`saveAccidentReport`/`uploadReceiptsOnly`をNode実行結果と突き合わせて移植。`GEMINI_API_KEY`未設定時はGAS版と同じフォールバック応答を返す(`NoopReportAiPort`)。領収書画像は`StoragePort`(ローカル開発は`LocalFileStoragePort`、本番はGCS想定)に保存し、Google Chat通知は`WebhookNotifierPort`(Webhook URL未設定時はスキップ)で送る。Web UIは訪問先一覧のカードタップで報告作成モーダル、「顧客情報」「活動記録」ボタンでそれぞれ専用モーダルを開く3導線構成にした(GAS版の`openModal`/`showCustomerDetail`/`showCustomerHistory`と同じ使い分け)。ローカルPostgreSQL+APIで一気通貫の動作確認済み(Gemini実API呼び出し自体はAPIキー未設定のため未検証)。
- [ ] **Phase 5 — 外部連携(Sheets/Drive/Calendar/Maps、ミラーはoutbox。Chat/Geminiは上記で先行実装済み)**: 着手中。
  Google Maps Platform(新規契約・課金設定が必要)を避けるため、**稼働中のgas-childcare-visit-app Web App
  (`Bridge.js`)を軽量なJSON APIプロキシとして再利用する方式にした**。GASのMapsサービス
  (`Maps.newGeocoder`/`newDirectionFinder`、無料)と、既に本番で動いているカレンダー解析・ルート計算
  ロジック(`RouteSearch.js`の`getScheduleForStaffOnDate`/`getScheduleWithRouteForStaffOnDate`)を
  そのまま呼び出すだけなので、複雑な分類ロジック(RESERVA予約タイトルの判定・スタッフ突合等)を
  TypeScript側で再実装せずに済み、本番との挙動ずれリスクを避けられる。`SchedulePort`/`MapsPort`
  (`GasBridgeSchedulePort`/`GasBridgeMapsPort`、`GAS_BRIDGE_URL`/`GAS_BRIDGE_SECRET`未設定時は
  `NoopSchedulePort`/`NoopMapsPort`にフォールバック)・`GET /api/schedule`・`GET /api/schedule/route`・
  「📅 予定」タブの実データ表示までコード上は実装済み。**ただしBridge.jsの本番デプロイ
  (`clasp push`/新デプロイ作成)とScript PropertiesへのBRIDGE_API_SECRET設定はユーザー承認待ちのため
  未実施**で、実際にAPIを叩いての動作検証(このリポジトリのLogic verification規約が求める検証)は
  まだ行っていない。
  **Sheets/Driveへのミラー書き込み(outbox)のうち、日報/事故報告/領収書/勤怠(出勤簿)の4種類を実装した**
  (`attendance_aggregate`・`calendar_event`は未着手)。設計はGAS版と同じくBridge.js経由(Maps
  Platform同様、書き込みも稼働中のWeb Appデプロイのアクセス権をそのまま使うことで新規のGCP
  サービスアカウント/Sheets APIの権限付与を避けた)。`saveDailyReport`/`saveAccidentReport`/
  `uploadReceipts`/`saveAttendanceDay`の各usecaseがDB保存に成功した直後、`MirrorPort.enqueue`で
  `outbox_jobs`に1件積む(`packages/core/src/usecases/mirrorWorker.ts`が種別ごとにDBの最新値を
  読み直し・復号し、GAS側の列にそのまま書き込める形に整形する)。ワーカー(`packages/worker`)は
  テナントごとに`outbox_jobs`を`FOR UPDATE SKIP LOCKED`でポーリングし(RLS対象のためテナントを
  跨いで一度に取得できない)、`GasBridgeMirrorSenderPort`経由でBridge.jsの新規action
  (`writeDailyReport`/`writeAccidentReport`/`writeReceipt`/`writeAttendanceDay`、`doPost`で追加)へ
  POSTする。日報/事故報告シートは、katahimo-app側のreportIdを追跡する`KatahimoReportId`列を
  最終列に追加し、同じreportIdの再送(編集保存)時は該当行を上書きする形にした(GAS版自身の
  `rowIndex`方式は1ブラウザセッション内でしか使えず、outboxからの非同期再送では別途追跡が必要
  だったため)。領収書はGAS版`processReceiptImages`をそのまま1枚分呼ぶだけで、重複判定も
  GAS版の既存ロジックに委ねている。`MIRROR_TO_GOOGLE_SHEETS=false`(既定)の間はAPI側が
  outboxへの積み込み自体を行わない(`NoopMirrorPort`)。ローカルAPI+ローカルワーカー+
  ダミーのHTTPサーバー(Bridge.js write actionの代わり)で4種類とも実際にpending→doneまで
  遷移すること、ペイロードの JSON構造がBridge.js側の期待する`payload.xxx`フィールド名と
  一致すること、ブリッジが到達不能な場合はジョブが例外を投げずに`failed`(`lastError`記録)へ
  遷移し次のポーリングに影響しないことを確認済み。**Bridge.js側の書き込みaction自体は
  Sheets/Drive連携の中核であるため、読み取り側と同じくデプロイ承認待ち(未デプロイ)**。
  `attendance_aggregate`(「勤怠集計」シート)・`calendar_event`(Googleカレンダー同期)は
  次のフェーズで追加する。
- [x] **Phase 6 — 勤怠計算エンジン+Googleカレンダー風週間予定UI(給与直結。合成データでGAS版との数値一致を検証済み)**: `AttendanceCalc.js`(GAS版)をNode上でそのまま実行した結果を正解として、TypeScript移植版(`packages/core/src/domain/attendance/`)を合成データ19ケース+月次集計で1件残らず突き合わせ、完全一致を確認。`attendance_days`テーブル(入力列のみをJSON化して1本の暗号文として保存、派生値は保存せず都度計算)・`GET/PUT /api/attendance/day`・`GET /api/attendance/month`を実装。**Web UIはGAS版と同じGoogleカレンダー風の週間予定表示(`GET /api/attendance/week`)に作り直した**(`buildScheduleEventsFromRowData`もGAS版と一致検証済み。表示内容は実際のGoogleカレンダーからではなく保存済みの出勤簿の記録をそのまま色分け表示しているだけなので、Phase 5のCalendar連携が無くても動く)。予定(訪問その1〜3・事務作業その1〜2)をタップして個別編集、「移動・距離・その他」パネルで日単位の項目をまとめて編集、という操作フローもGAS版と同じにした。管理者以外は自分の勤怠にしか読み書きできない(PastSchedule.jsと同じアクセス制御パターン)。**実際の出勤簿データでの数値照合はPhase 7で行う(このフェーズでは計算式の正しさのみを保証)**。
- [ ] Phase 7 — 並行運用と照合
- [ ] Phase 8 — 切替と旧システム停止

移行前に潰すべきリスク(Routes APIの値がGAS版と一致するか、カレンダー取得方式)は Phase 1 着手前に調査する。
