# katahimo-app

訪問保育(ベビーシッター)法人向けの業務SaaS。稼働中のGoogle Apps Script版
(`reference/gas-childcare-visit-app`)をマルチテナントSaaSへ移行するプロジェクト。
**本番未配備・運用開始前**のため、破壊的な作り直しができる段階にある。

全体像と実装状況は `README.md`、資料の一覧は `doc/README.md`。

## コマンド

| 目的 | コマンド |
|---|---|
| テスト | `pnpm test` |
| 型検査 | `pnpm typecheck` |
| lint・整形の検査 | `pnpm lint`(直すときは `pnpm lint:fix`) |
| マイグレーション生成 | `pnpm db:generate` |
| DBリファレンス再生成 | `pnpm db:docs` |

コミット前に `pnpm lint` / `pnpm typecheck` / `pnpm test` を通す。

## スキーマを触るとき

- 区分値は `packages/shared/src/contracts/` に zod の enum で置き、DBのCHECK制約は
  そこから組み立てる(DDLに値をベタ書きしない)
- 参照は `(tenant_id, xxx_id) → (tenant_id, id)` の複合外部キーにする。
  FK制約はRLSを常にバイパスするため、単一列FKだとテナント跨ぎを検知できない
- 金額は円の整数。日付・時刻は型のある列で持つ
- 記録は消さず、取り消しの印を立てる(領収書・請求書・予約)
- 派生値(残業時間・月次集計など)は保存せず、都度計算する
- スキーマを変えたら `pnpm db:generate` と `pnpm db:docs` を実行する
  (リファレンスが古いままだとCIが落ちる)

決めごとの理由は `doc/db/guidelines.md`、全テーブルの列は `doc/db/reference.md`(自動生成)。

## GAS版との関係

GAS版は**現に稼働中**で、移行にあたって機能を落とさないことが前提。
移植や仕様の確認では `reference/gas-childcare-visit-app` の該当箇所を必ず見る。
給与計算(勤怠)はGAS版と1円も違ってはいけない。

## 資料(doc/)

- 構成・読む順・再生成コマンドは `doc/README.md`
- `doc/slides/*.pptx` は `scripts/slides/*.py` が生成する。PowerPointで直接編集しても
  次の生成で消えるので、直すときはスクリプト側を直して再生成する
- **資料には現時点の仕様だけを書く。**「今回こう直した」「前はこうだった」という
  差分・経緯は残さない(リリース前で変更履歴を追う必要がなく、相談資料も
  まだ社外に出していないため)

## PR

- マージは **Squash and merge**
- CodeRabbit のレビューを受け、指摘に対応してからマージする
