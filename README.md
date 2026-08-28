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

`http://localhost:5173` を開き、法人ID `demo` / `admin@example.com` / `admin1234` でログイン後、「佐藤」で検索すると
ブラインドインデックス経由で該当顧客(氏名・電話・市区町村は復号済み)が一覧表示される。検索結果の氏名をクリックすると
`/customers/:id`(顧客詳細画面、react-router)に遷移し、RESERVA CSVの全項目(カナ・メール・住所・緊急連絡先・
会員情報等)と世帯構成員(子ども等)一覧を復号した状態で確認できる(Phase 4・読み取り系)。DBの生カラムを直接見ると
(`psql -U katahimo -d katahimo_dev -c "SELECT name_ciphertext FROM customers LIMIT 1"`)、暗号文であって
平文が保存されていないことを確認できる。

## 動作デモ(RESERVA CSV取込)

実際のRESERVA(外部予約システム)エクスポート形式のサンプルCSV(`01_GAS/Kokyaku_202601191958_1_dummy.csv`、
ダミー顧客398件)を取り込める。

```bash
cd packages/api
pnpm exec tsx src/scripts/importReservaCsv.ts demo ../../Kokyaku_202601191958_1_dummy.csv
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
| `pnpm db:generate` / `db:migrate` / `db:seed` | Drizzleのマイグレーション生成・適用・初期データ |

## PII暗号化の方針

氏名・メールアドレス・電話番号・市区町村レベルの住所など、漏洩時に個人特定につながる項目は次の方針で扱う(`packages/core/src/ports/crypto.ts` に契約を定義済み)。

- **実値は常にランダム化暗号(AES-256-GCM相当、`CryptoPort`)で保存する**。決定的暗号化(同じ平文→同じ暗号文)は等値検索できる代わりに、鍵を持たない攻撃者でも暗号文の出現頻度から平文を統計的に推測できてしまう(日本の姓は偏りが大きく、この逆引きが現実的なリスクになる)ため、実値には使わない。
- **等値検索が必要な項目だけ、`BlindIndexPort`(HMAC-SHA256)で計算した値を別カラムに持たせて検索する**。氏名は「苗字だけで検索する」現場運用があるため、`domain/pii/japaneseName.ts` の `splitJapaneseFullName` で姓・名に分割し、それぞれ独立にブラインドインデックス化する(部分一致・前方一致は非対応、トークン単位の完全一致のみ)。
- 鍵(DEK)はテナントごとに発行し、Cloud KMSでラップして保存する(エンベロープ暗号化)。テナント解約時はDEKを破棄するだけで暗号学的削除ができる。`CryptoPort`と`BlindIndexPort`は鍵を分け、一方の鍵漏洩だけでは実値の復号もインデックスからの平文復元もできないようにする。
- 実装(KMS呼び出しを含む)は `packages/integrations` に置く。実際のGCPプロジェクト・KMSキーリングが用意でき次第、Phase 5で着手する。Phase 1では、暗号化対象カラムを`ciphertext`/`key_version`のペア、検索対象カラムを`*_blind_index`として最初からスキーマに組み込む。

## 進捗(フェーズ)

- [x] **Phase 0 — 基盤構築**: モノレポ・TS strict・Biome・Vitest・Docker/ローカルPostgreSQL・Hono空サーバー・Vite PWA雛形・health/DB疎通。
- [x] **Phase 1 — スキーマとテナント分離(RLS)**: tenants/staff/sessions/customers/outbox_jobsをDrizzleで定義し、tenant_idを持つ全テーブルにRLSポリシーを適用(katahimo=所有者/DDL用、katahimo_app=RLS対象のアプリ用ロールに分離。実際にRLSがブロックすることを確認済み)。
- [x] **Phase 2 — 認証(メール)**: argon2idパスワードハッシュ、httpOnly Cookieセッション(tenantId埋め込みでRLSのチキン&エッグ問題を回避)、`POST /api/auth/login`・`GET /api/auth/me`・`POST /api/auth/logout`。**GAS版のSHA-256+saltパスワードハッシュ(Auth.jsのcomputeHash)を、パスワード変更なしで引き継げるようにした**(`computeLegacyHash`。GAS版を実行した結果と一致することを検証済み)。ログイン成功時にargon2idへサイレント再ハッシュされ、実際にAPI経由で移行→ログイン→再ハッシュ確認→2回目ログインまで動作確認済み。Google認証(OAuth)は未着手(実GCPクライアントIDが必要なため)。
- [x] **Phase 3 — 取込・アップサート基盤(RESERVA CSV)**: `parseFamilyInfo`/`normalizeDateStr`(GAS版`CsvImport.js`から完全移植、実サンプル398行でGAS実行結果と1件残らず一致することを検証済み)・Excelシリアル日時変換を追加し、RESERVA顧客CSV(UTF-16LE・タブ区切り・30列、パスワード列を除く全項目)のデコード/パース/外部ID突合による差分計算(作成/更新/ソフトデリート)/適用を実装。世帯構成員(子ども等)は`family_members`テーブルに全件保存し、詳細取得で復号して確認できる。消失率(取込データから消えた顧客の割合)が閾値を超えると適用を拒否する安全装置つき。実データ(`01_GAS/Kokyaku_202601191958_1_dummy.csv`、398件)を実際にPostgreSQLへ取り込み、冪等性(再取込で重複しないこと)も確認済み。
- [x] **Phase 4 — 顧客詳細画面(読み取り系の一部)**: `GET /api/customers/:id`(セッションのtenantIdのみを使用)と、react-router-domによる`/customers/:id`詳細画面を追加。RESERVA CSV由来の全項目・世帯構成員一覧を復号して表示する。今後の詳細画面は「予定/訪問先一覧/勤怠」の3タブ(Phase 5のCalendar/Maps連携が前提)の実装で続きを進める。
- [ ] Phase 5 — 外部連携(Sheets/Drive/Calendar/Maps/Chat/Gemini、ミラーはoutbox)
- [x] **Phase 6 — 勤怠計算エンジン(給与直結。合成データでGAS版との数値一致を検証済み)**: `AttendanceCalc.js`(GAS版)をNode上でそのまま実行した結果を正解として、TypeScript移植版(`packages/core/src/domain/attendance/`)を合成データ19ケース+月次集計で1件残らず突き合わせ、完全一致を確認。`attendance_days`テーブル(入力列のみをJSON化して1本の暗号文として保存、派生値は保存せず都度計算)・`GET/PUT /api/attendance/day`・`GET /api/attendance/month`・Web側の入力フォーム+月次集計画面を実装した。管理者以外は自分の勤怠にしか読み書きできない(PastSchedule.jsと同じアクセス制御パターン)。**実際の出勤簿データでの数値照合はPhase 7で行う(このフェーズでは計算式の正しさのみを保証)**。
- [ ] Phase 7 — 並行運用と照合
- [ ] Phase 8 — 切替と旧システム停止

移行前に潰すべきリスク(Routes APIの値がGAS版と一致するか、カレンダー取得方式)は Phase 1 着手前に調査する。
