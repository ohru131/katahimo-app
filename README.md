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
- [ ] Phase 1 — スキーマとテナント分離(RLS)
- [ ] Phase 2 — 認証(メール+Google、既存ハッシュ引き継ぎ)
- [ ] Phase 3 — 取込・アップサート基盤
- [ ] Phase 4 — ドメイン移植とPWA(読み取り系)
- [ ] Phase 5 — 外部連携(Sheets/Drive/Calendar/Maps/Chat/Gemini、ミラーはoutbox)
- [ ] Phase 6 — 勤怠(給与直結。GAS版との数値一致が必須ゲート)
- [ ] Phase 7 — 並行運用と照合
- [ ] Phase 8 — 切替と旧システム停止

移行前に潰すべきリスク(Routes APIの値がGAS版と一致するか、カレンダー取得方式)は Phase 1 着手前に調査する。
