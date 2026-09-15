# 資料一覧

この `doc/` には、設計の背景・データベースの詳細・説明用スライドが入っている。
ファイル名は英語だが中身はすべて日本語。各ファイルの先頭に日本語のタイトルがある。

コードの中から参照するときは、このディレクトリからの相対ではなく
リポジトリルートからのパス(`doc/db/guidelines.md §10` のような形)で書く。

## どれから読むか

| 立場 | 読む順 |
|---|---|
| 開発に入る人 | `proposal/tech-stack.md` → `db/overview.md` → `db/guidelines.md` |
| データベースをレビューする人 | `slides/db-review.pptx` → `db/overview.md` → `db/new-domains.md` → `db/reference.md` |
| アプリ構成をレビューする人 | `slides/architecture.pptx` → `proposal/tech-stack.md` → `proposal/gas-bridge.md` |
| 業務側で内容を確認する人 | `slides/db-for-business.pptx` だけで完結する(データベースの知識は要らない) |

## proposal/ — 何を作るか

| ファイル | 内容 |
|---|---|
| `tech-stack.md` | 技術構成提案書(2026年8月)。PostgreSQL・Cloud Run を選んだ理由と比較検討。**提案時点の記録**なので、そこから変えた判断がある(認証は Firebase Auth ではなく自前実装など。変更点は `slides/architecture.pptx` に一覧がある) |
| `gas-bridge.md` | 現行のGoogle Apps Script版とどう連携するか。制約と、その中で採った方針 |

## db/ — データベース設計

| ファイル | 内容 | 更新 |
|---|---|---|
| `overview.md` | 構造解説。テナント分離・データ保護・暗号化の方針と、テーブルの役割一覧 | 手書き |
| `guidelines.md` | 設計の指針と、実際に踏んだ落とし穴。金額の持ち方・値域の縛り方・クーポン・領収書の設計判断 | 手書き |
| `new-domains.md` | 予約・請求・カルテ・訪問割当・移動手当・日報AIのプロンプト調整の設計理由と、まだ決めきれていない論点 | 手書き |
| `reference.md` | ER図と全44テーブルの全列一覧 | **自動生成** |

`reference.md` は `packages/db/src/schema/*.ts` から機械的に書き出している。
手で編集しても次の生成で消える。スキーマを変えたら `pnpm db:docs` で作り直す
(古いまま放置するとCIが落ちる)。

## report-ai-import.md — 日報AIの設定ファイル取込

`report-ai-import.md` は、法人のキーワード表・年齢帯表・判定基準・言い回し集・プロンプト文面
(xlsx/xls/csv)を設定モーダルの「取込」タブから読み込む機能の、シートごとの期待列・別名表・
値の解釈・マージの規則をまとめたもの。手書き。

## slides/ — 説明・レビュー用スライド

| ファイル | 対象読者 | 内容 | 生成元 |
|---|---|---|---|
| `db-review.pptx` | データベースの有識者 | 44テーブルの構成・設計上の問題点・相談事項(全30枚) | `scripts/slides/build_db_review.py` |
| `db-for-business.pptx` | パートナー企業の実務担当・責任者 | 記録する項目を業務の言葉で並べ、抜けが無いかを確認いただくもの(全55枚) | `scripts/slides/build_db_for_business.py` |
| `architecture.pptx` | 技術の有識者 | アプリ構成・外部連携・品質の現状(全21枚) | `scripts/slides/build_architecture.py` |

`.pptx` はすべてスクリプトが組み立てている。PowerPointで直接編集しても
次の生成で消えるので、直すときはスクリプト側を直す。

```sh
pip install python-pptx
python3 scripts/slides/build_db_review.py        # → doc/slides/db-review.pptx
python3 scripts/slides/build_db_for_business.py  # → doc/slides/db-for-business.pptx
python3 scripts/slides/build_architecture.py     # → doc/slides/architecture.pptx
```

図形・文字・表はすべてネイティブの図形として出力しているので、
生成したあとPowerPoint側で自由に手直しできる(画像の貼り込みではない)。
