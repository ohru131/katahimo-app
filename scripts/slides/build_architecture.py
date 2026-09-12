# -*- coding: utf-8 -*-
"""doc/13_アーキテクチャ説明資料.pptx を生成する。

doc/12(DB構造レビュー資料)の対になる、アプリ構成の説明資料。
一次情報は packages/*/package.json、packages/core/src/ports/、doc/07・doc/10・doc/11。
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import PP_ALIGN

from pptx_kit import (ACCENT, ACCENT_L, AMBER, AMBER_L, CARD, CARD2, CW, GREEN, GREEN_L, INK, LINE,
                      ML, MONO, MUTED, NAVY, ORANGE, ORANGE_L, PINK, PINK_L, RED, RED_L, SLIDE_W,
                      TEAL, TEAL_L, VIOLET, VIOLET_L, WHITE, arrow, badge, box, bullets, card,
                      chip_row, fill_text, hline, new_deck, note, rect, section_slide, slide,
                      table, text, title_slide, vline)

OUT = Path(__file__).resolve().parents[2] / "doc" / "13_アーキテクチャ説明資料.pptx"
prs = new_deck()
PAGE = {"n": 0}


def sl_(title, small="", source="", accent=ACCENT):
    PAGE["n"] += 1
    return slide(prs, title, small, page=PAGE["n"], source=source, accent=accent)


def sec_(no, title, sub=""):
    PAGE["n"] += 1
    return section_slide(prs, no, title, sub)


# ══════════════════════════════════════════════════════════════
# 1. 表紙
# ══════════════════════════════════════════════════════════════
PAGE["n"] += 1
title_slide(
    prs,
    "ARCHITECTURE OVERVIEW",
    "katahimo-app\nアーキテクチャ説明資料",
    "訪問保育(ベビーシッター法人)向け業務SaaS — TypeScript / 9パッケージ",
    "アプリ全体の構成 ・ 判断の理由 ・ いまできていないこと\n"
    "データベース設計は doc/12_データベース構造レビュー資料.pptx を参照",
)

# ══════════════════════════════════════════════════════════════
# 2. この資料の目的と、先に押さえる4語
# ══════════════════════════════════════════════════════════════
s = sl_("この資料の目的と、先に押さえる4語", "はじめに",
        source="用語は本資料での説明を優先し、正確な定義はコードに委ねます")
card(s, ML, 1.25, 6.0, 1.45, "この資料でお伝えしたいこと", accent=ACCENT, items=[
    {"t": "「どこに何が書いてあるか」と「なぜその置き方にしたか」"},
    {"t": "現行のGoogle Apps Script版と、どう共存させているか"},
    {"t": [("実装済み / コードはあるが未検証 / 未着手", {"bold": True}), (" の区別", {})]},
], body_size=11.5)
card(s, ML + 6.33, 1.25, 6.0, 1.45, "この資料で扱わないこと", accent=MUTED, items=[
    {"t": "テーブル設計の詳細(doc/12 のデータベース構造レビュー資料が担当)"},
    {"t": "画面のデザイン・操作手順(実物は公開デモで確認できます)"},
], body_size=11.5)

text(s, ML, 2.9, CW, 0.3, "先に押さえておきたい4語", size=13, color=INK, bold=True)
terms = [
    ("モノレポ", "1つのリポジトリに複数の部品を入れる作り",
     "9つの部品(パッケージ)が同じリポジトリに入っている。共通の型やロジックを、"
     "コピーせずに共有できる", ACCENT, ACCENT_L),
    ("ポート / アダプタ", "「窓口」と「実際に外とつなぐ部品」",
     "業務ロジックは「メールを送る窓口」だけを知る。SendGridなのかGmailなのかは知らない。"
     "差し替えとテストがしやすくなる", VIOLET, VIOLET_L),
    ("ヘキサゴナル", "業務ロジックを中心に置き、外側を全部「差し替え可能」にする設計",
     "データベースも外部APIも画面も、すべて中心から見れば「外側」。"
     "依存の矢印が中心へ向かって一方通行になる", GREEN, GREEN_L),
    ("Outbox", "「送る予定」をデータベースに書いておき、後で送る方式",
     "スプレッドシートへの書き戻しに使っている。送信が失敗しても、業務データの保存は"
     "確実に完了させられる", ORANGE, ORANGE_L),
]
cx = ML
for nm, short, body, col, fl in terms:
    w = 2.98
    rect(s, cx, 3.25, w, 2.6, fill=WHITE, border=col, border_w=1.3)
    fill_text(rect(s, cx, 3.25, w, 0.45, fill=col, border=None, shape=MSO_SHAPE.RECTANGLE),
              nm, size=12.5, color=WHITE, bold=True)
    text(s, cx + 0.18, 3.8, w - 0.36, 0.55, short, size=11, color=col, bold=True, line=1.3)
    hline(s, cx + 0.18, 4.42, cx + w - 0.18, color=LINE)
    text(s, cx + 0.18, 4.52, w - 0.36, 1.2, body, size=10.5, color=INK, line=1.35)
    cx += w + 0.14
note(s, ML, 6.1, CW, 0.8, "この4語だけで、以降の図はだいたい読めます",
     "特に「ポート / アダプタ」は本資料の中心です。この作りにした最大の理由は、"
     "同じ業務ロジックを本番(Node.js + PostgreSQL)とブラウザ内デモ(ブラウザ内DB)で"
     "そのまま動かせるようにするためでした(P16)。",
     accent=ACCENT, fill=ACCENT_L, size=11)

# ══════════════════════════════════════════════════════════════
# 3. §1
# ══════════════════════════════════════════════════════════════
sec_("第 1 章", "全体像", "何を作っているのか、いま何が動いているのか")

# ══════════════════════════════════════════════════════════════
# 4. 何を、なぜ作り直しているか
# ══════════════════════════════════════════════════════════════
s = sl_("何を、なぜ作り直しているか", "背景と現在地",
        source="doc/07_技術構成提案書.md / doc/10_GAS版連携の制約と方針.md / README「実装状況」")
card(s, ML, 1.25, 4.0, 2.5, "現行:Google Apps Script 版", accent=MUTED, items=[
    {"t": "データはすべてスプレッドシート / Drive / カレンダー"},
    {"t": [("1法人・1Googleアカウント", {"bold": True}), ("に強く依存", {})]},
    {"t": "認証は共有ソルトのSHA-256。セッショントークンをシートに直書き"},
    {"t": "顧客CSVの取り込みが全置換(欠損時に丸ごと消えるリスク)"},
    {"t": "現場で本番稼働中。機能追加は凍結し、不具合修正のみ"},
], body_size=10.5)
card(s, ML + 4.15, 1.25, 4.0, 2.5, "目指す先", accent=ACCENT, items=[
    {"t": [("マルチテナントSaaS化", {"bold": True}), ("。複数法人を1つの基盤に収容する", {})]},
    {"t": [("PostgreSQLを唯一の正データ", {"bold": True}),
           ("にし、スプレッドシートは互換維持のための「写し」として残す", {})]},
    {"t": "将来の訪問看護事業への展開(カルテ・保存年限の管理)"},
    {"t": [("一斉切り替えを避ける", {"bold": True}), (":GAS版と併存しながら段階的に移す", {})]},
], body_size=10.5)
card(s, ML + 8.3, 1.25, 4.03, 2.5, "規模", accent=GREEN, items=[
    {"t": [("9パッケージ", {"bold": True}), ("(pnpm workspace)", {})]},
    {"t": [("TypeScript 228ファイル / 約25,900行", {"bold": True}), ("(テストを除く)", {})]},
    {"t": [("テスト 55ファイル / 692件", {"bold": True}), ("。CIで毎回実行", {})]},
    {"t": [("データベース 33テーブル", {"bold": True}), (" / マイグレーション1本", {})]},
], body_size=10.5)

text(s, ML, 3.95, CW, 0.3, "いまどこにいるか", size=13, color=INK, bold=True)
phases = [
    ("実装済み", GREEN, GREEN_L,
     "認証 / 顧客 / 日報・事故報告 / 領収書 / 勤怠 / スタッフ管理 / RESERVA取込 / 公開デモ"),
    ("コードはあるが未検証", AMBER, AMBER_L,
     "スプレッドシートへの書き戻し、メール送信(GASブリッジが未デプロイのため一度も動いていない)"),
    ("スキーマのみ", VIOLET, VIOLET_L,
     "予約 / 請求・決済 / 顧客カルテ / 訪問割当の最適化 / 移動手当(表と制約はあるが、実装・API・画面は無い)"),
    ("未着手", RED, RED_L,
     "本番デプロイ(Cloud Run) / Cloud KMS / 再暗号化バッチ / 実データでの並行運用の照合"),
]
cy = 4.25
for nm, col, fl, body in phases:
    rect(s, ML, cy, CW, 0.58, fill=fl, border=None)
    rect(s, ML, cy, 0.075, 0.58, fill=col, border=None, shape=MSO_SHAPE.RECTANGLE)
    text(s, ML + 0.22, cy + 0.15, 2.5, 0.3, nm, size=12, color=col, bold=True)
    text(s, ML + 2.9, cy + 0.07, CW - 3.2, 0.48, body, size=11, color=INK, line=1.3)
    cy += 0.64
text(s, ML, 6.78, CW, 0.3,
     "「未検証」「未着手」と書いたものは、提案書では実現済みのように読めてしまう部分です。先に区別をお伝えします。",
     size=10.5, color=MUTED)

# ══════════════════════════════════════════════════════════════
# 5. 実行時トポロジ
# ══════════════════════════════
s = sl_("実行時の全体像", "本番想定の配置。実線=リクエストを待つ呼び出し、破線=待たない処理",
        source="本番(Cloud Run + Cloud SQL)は未配備。現在はローカル開発と公開デモのみ稼働")
box(s, 0.5, 1.3, 2.5, 1.0,
    [("ブラウザ", {"size": 12.5, "bold": True}), ("\n", {}),
     ("React + Vite / PWA", {"size": 10, "color": MUTED}), ("\n", {}),
     ("スマホ主体 / HTTPS", {"size": 10, "color": MUTED})],
    fill=WHITE, border=ACCENT, border_w=1.5, size=11)
box(s, 3.4, 1.3, 2.9, 1.0,
    [("API サーバー", {"size": 12.5, "bold": True}), ("\n", {}),
     ("Hono / Node.js 22", {"size": 10, "color": MUTED}), ("\n", {}),
     ("Cloud Run(未配備)", {"size": 10, "color": RED})],
    fill=ACCENT_L, border=ACCENT, border_w=1.5, size=11)
box(s, 6.7, 1.3, 2.8, 1.0,
    [("PostgreSQL", {"size": 12.5, "bold": True}), ("\n", {}),
     ("唯一の正データ", {"size": 10, "color": GREEN, "bold": True}), ("\n", {}),
     ("Cloud SQL(未配備)", {"size": 10, "color": RED})],
    fill=GREEN_L, border=GREEN, border_w=1.5, size=11)
box(s, 9.9, 1.3, 2.93, 1.0,
    [("Gemini API", {"size": 12, "bold": True}), ("\n", {}),
     ("日報の文章生成 / 領収書のOCR", {"size": 10, "color": MUTED})],
    fill=VIOLET_L, border=VIOLET, border_w=1.5, size=11)

box(s, 3.4, 2.6, 2.9, 1.0,
    [("ミラーワーカー", {"size": 12, "bold": True}), ("\n", {}),
     ("outbox_jobs を定期的に処理", {"size": 10, "color": MUTED}), ("\n", {}),
     ("Cloud Run Job 想定(未配備)", {"size": 9.5, "color": RED})],
    fill=ORANGE_L, border=ORANGE, border_w=1.5, size=11)
box(s, 6.7, 2.6, 2.8, 1.0,
    [("GAS ブリッジ", {"size": 12, "bold": True}), ("\n", {}),
     ("既存のGAS Web App 1本", {"size": 10, "color": MUTED}), ("\n", {}),
     ("まだ一度もデプロイしていない", {"size": 9.5, "color": RED})],
    fill=WHITE, border=AMBER, border_w=1.5, size=11)
box(s, 9.9, 2.6, 2.93, 1.0,
    [("スプレッドシート", {"size": 12, "bold": True}), ("\n", {}),
     ("Drive / カレンダー / Gmail", {"size": 10, "color": MUTED})],
    fill=CARD, border=LINE, size=11)
box(s, 6.7, 3.9, 2.8, 0.62, "Google Chat(通知)", fill=CARD, border=LINE, size=11)

# ブラウザ ↔ API ↔ PostgreSQL
arrow(s, (3.05, 1.8), (3.35, 1.8), color=ACCENT, width=2, tail="triangle")
arrow(s, (6.35, 1.8), (6.65, 1.8), color=GREEN, width=2, tail="triangle")
# API → Gemini(上を回す)
vline(s, 4.85, 1.28, 1.12, color=VIOLET, width=1.5)
hline(s, 4.85, 1.12, 11.35, color=VIOLET, width=1.5)
arrow(s, (11.35, 1.12), (11.35, 1.26), color=VIOLET, width=1.5)
# PostgreSQL → ミラーワーカー(送信予定の取得)
vline(s, 8.1, 2.34, 2.46, color=ORANGE, width=1.5, dash=True)
hline(s, 4.85, 2.46, 8.1, color=ORANGE, width=1.5, dash=True)
arrow(s, (4.85, 2.46), (4.85, 2.56), color=ORANGE, width=1.5, dash=True)
# ミラーワーカー → GAS ブリッジ → スプレッドシート
arrow(s, (6.35, 3.1), (6.65, 3.1), color=AMBER, width=1.6, dash=True)
arrow(s, (9.55, 3.1), (9.85, 3.1), color=AMBER, width=1.6, dash=True)
# API → Google Chat
vline(s, 6.15, 2.32, 4.21, color=MUTED, width=1.4, dash=True)
arrow(s, (6.15, 4.21), (6.65, 4.21), color=MUTED, width=1.4, dash=True)
text(s, 3.4, 4.05, 2.65, 0.4, "APIから直接通知\n(トランザクションの外)", size=9.5, color=MUTED,
     line=1.3, align=PP_ALIGN.RIGHT)

card(s, ML, 4.85, 6.0, 1.35, "この配置で守りたかったこと", accent=GREEN, items=[
    {"t": [("PostgreSQLが唯一の正データ", {"bold": True}),
           (". スプレッドシートは「写し」であり、止めるときはミラーの部品を外すだけ", {})]},
    {"t": "Google系の外部連携は既存のGASブリッジ1本に集約した(新規の課金・認証情報の準備を避けるため)"},
], body_size=10.5)
note(s, ML + 6.33, 4.85, 6.0, 1.35, "この配置の弱点(第4章の判断事項①)",
     "メール・地図・予定・スプレッドシートの4系統がGASブリッジ1本に集中しています。"
     "実行時間制限とクォータがあり、SLAはなく、単一障害点です。しかもまだ一度もデプロイしていません。",
     accent=RED, fill=RED_L, size=10.5)
rect(s, ML, 6.35, CW, 0.5, fill=CARD, border=None)
text(s, ML + 0.2, 6.44, CW - 0.4, 0.3,
     "読み方:赤い注記は「まだ存在しないもの」。破線は、リクエストの完了を待たずに後から動く処理。"
     "オレンジの破線がスプレッドシートへの書き戻し経路です。",
     size=10.5, color=INK)

# ══════════════════════════════
# 6. 技術スタック
# ══════════════════════════════════════════════════════════════
s = sl_("採用した技術と、その理由", "提案書から変更した点も併記",
        source="packages/*/package.json / doc/07 第2〜3章")
rows = [
    ["言語", "TypeScript 5.7 / Node.js 22", "画面もサーバーも同じ言語。型定義を共有できる", ""],
    ["データベース", "PostgreSQL", "行レベルセキュリティ・排他制約など、必要な制約をDB自身で強制できる", ""],
    ["ORM", "Drizzle ORM 0.38", "テーブル定義をTypeScriptで書き、SQLとの型の食い違いを防ぐ", ""],
    ["APIフレームワーク", "Hono 4", "軽量。Node.jsでもブラウザ内でも同じアプリを動かせる(デモで活用)", ""],
    ["画面", "React 19 + Vite + Tailwind CSS + PWA", "スマホでの現場利用が主。ホーム画面に追加して使える", ""],
    ["認証", "自前実装(argon2id + Cookie)", "GAS版の既存パスワードを移行できるようにするため",
     "提案書のFirebase Authから変更"],
    ["AI", "Gemini API", "日報の文章生成・領収書のOCR。GAS版から継続", ""],
    ["外部連携", "既存のGAS Web App 経由", "新規のGCP課金・認証情報を避け、実証済みロジックを再利用",
     "本来はGoogle APIを直接呼ぶ想定だった"],
    ["公開デモ", "PGlite(ブラウザ内PostgreSQL)", "本番と同一のスキーマ・業務ロジックをブラウザだけで動かす",
     ""],
    ["実行基盤", "Google Cloud(Cloud Run + Cloud SQL)", "既存連携先がGoogle系のため単一クラウドに統合",
     "未配備"],
    ["検証", "Vitest / Biome / GitHub Actions", "毎pushで静的検査・型検査・テスト・本番ビルドまで実行", ""],
]
table(s, ML, 1.28, CW, ["領域", "採用したもの", "選んだ理由", "備考"], rows,
      col_w=[1.8, 3.3, 5.3, 2.1], size=10, hsize=10.5, row_h=0.44, header_h=0.33,
      first_bold=True,
      cell_colors={(5, 3): AMBER, (7, 3): AMBER, (9, 3): RED})
note(s, ML, 6.35, CW, 0.6, "備考欄について",
     "提案書に書いた方針から変更した箇所と、未配備のものだけを記載しています。変更の理由は各章で説明します。",
     accent=AMBER, fill=AMBER_L, size=10.5)

# ══════════════════════════════════════════════════════════════
# 7. §2
# ══════════════════════════════════════════════════════════════
sec_("第 2 章", "コードの構造",
     "9つの部品と、その間の依存の向き。業務ロジックをどこに閉じ込めたか")

# ══════════════════════════════════════════════════════════════
# 8. パッケージ構成
# ══════════════════════════════
s = sl_("9つの部品と依存の向き", "矢印は「依存する方向」。逆流は1本もない",
        source="packages/*/package.json で確認。pnpm workspace")
box(s, 0.9, 1.3, 2.6, 0.6, "web  画面(React)", fill=ACCENT_L, border=ACCENT, color=ACCENT,
    size=11.5, bold=True)
box(s, 8.9, 1.3, 3.0, 0.6, "demo  ブラウザ内で全部動かす", fill=ORANGE_L, border=ORANGE,
    color=ORANGE, size=11, bold=True)
box(s, 0.9, 2.25, 2.6, 0.6, "api  HTTPの入口(Hono)", fill=VIOLET_L, border=VIOLET, color=VIOLET,
    size=11.5, bold=True)
box(s, 3.9, 2.25, 2.6, 0.6, "worker  非同期処理", fill=VIOLET_L, border=VIOLET, color=VIOLET,
    size=11.5, bold=True)
box(s, 6.9, 2.25, 2.6, 0.6, "ingestion  CSV取込", fill=VIOLET_L, border=VIOLET, color=VIOLET,
    size=11.5, bold=True)
box(s, 3.6, 3.3, 4.6, 0.95,
    [("core  業務ロジック", {"size": 13, "bold": True}), ("\n", {}),
     ("usecases / domain / ports。外部SDKを一切知らない", {"size": 10})],
    fill=GREEN_L, border=GREEN, border_w=2.0, color=GREEN, size=11.5)
box(s, 0.9, 4.65, 2.6, 0.72, "db  PostgreSQL実装\n(Drizzle)", fill=CARD, border=LINE, size=11)
box(s, 3.9, 4.65, 3.0, 0.72, "integrations  外部連携実装\n(GAS / Gemini / 暗号)", fill=CARD,
    border=LINE, size=11)
box(s, 3.6, 5.7, 4.6, 0.55, "shared  型・定数の共有(最下層。どこにも依存しない)", fill=CARD2,
    border=None, color=MUTED, size=11)

arrow(s, (2.2, 1.92), (2.2, 2.23), color=MUTED, width=1.4, dash=True)
text(s, 2.35, 1.94, 2.4, 0.28, "HTTPで呼ぶ(コード依存は無い)", size=9, color=MUTED)
arrow(s, (2.2, 2.87), (4.3, 3.28), color=GREEN, width=1.6)
arrow(s, (5.2, 2.87), (5.2, 3.28), color=GREEN, width=1.6)
arrow(s, (8.2, 2.87), (7.4, 3.28), color=GREEN, width=1.6)
# demo は api / core / db / integrations を束ねる(右側を回して core へ)
vline(s, 10.4, 1.92, 3.77, color=ORANGE, width=1.5, dash=True)
arrow(s, (10.4, 3.77), (8.25, 3.77), color=ORANGE, width=1.5, dash=True)
# db / integrations は core のポートを実装する側
arrow(s, (2.2, 4.63), (4.0, 4.28), color=GREEN, width=1.5)
arrow(s, (5.4, 4.63), (5.4, 4.28), color=GREEN, width=1.5)
arrow(s, (2.2, 5.4), (3.8, 5.78), color=MUTED, width=1.4)
arrow(s, (5.4, 5.4), (5.4, 5.68), color=MUTED, width=1.4)

text(s, 0.55, 3.35, 2.9, 0.95, "api / worker / ingestion は\nすべて core に依存する。\n"
     "web のコード上の依存は shared\nと(開発時のみ)demo だけ。", size=10.5, color=GREEN, line=1.32)
text(s, 8.6, 4.7, 4.2, 0.9, "db と integrations は、core が定義した\n窓口(ポート)を実装する側。\n"
     "core はどれが実装しているか知らない。", size=10.5, color=MUTED, line=1.32)
text(s, 8.6, 3.85, 4.2, 0.5, "demo は api / core / db / integrations を\n束ねてブラウザ内で動かす",
     size=10.5, color=ORANGE, line=1.3)

rect(s, ML, 6.45, CW, 0.5, fill=ORANGE_L, border=None)
text(s, ML + 0.2, 6.53, CW - 0.4, 0.3,
     "デモ用コードは本番ビルドに混ざらない:入口を空の実装に差し替え、CIが成果物そのものを検査する。",
     size=10.5, color=ORANGE, bold=True)

# ══════════════════════════════
# 9. ヘキサゴナル
# ══════════════════════════════════════════════════════════════
s = sl_("業務ロジックを中心に閉じ込める", "ポートとアダプタ(ヘキサゴナルアーキテクチャ)",
        source="packages/core/src/{ports,usecases,domain} / packages/api/src/container.ts")
# 中央
rect(s, 4.4, 1.55, 4.5, 3.5, fill=GREEN_L, border=GREEN, border_w=2.0)
text(s, 4.55, 1.65, 4.2, 0.3, "core(中心)", size=13, color=GREEN, bold=True,
     align=PP_ALIGN.CENTER)
box(s, 4.65, 2.05, 4.0, 0.62, "usecases  業務の手順\n(日報を保存する、ログインする…)", fill=WHITE,
    border=GREEN, size=10.5)
box(s, 4.65, 2.8, 4.0, 0.62, "domain  純粋な計算・規則\n(勤怠計算、氏名分割、重複判定…)", fill=WHITE,
    border=GREEN, size=10.5)
box(s, 4.65, 3.55, 4.0, 1.35,
    [("ports  外に対する窓口の定義だけ", {"size": 10.5, "bold": True}), ("\n", {}),
     ("「保存する」「送る」「暗号化する」という\n"
      "形(インターフェース)を28本定義している。\n中身は書かない", {"size": 10})],
    fill=WHITE, border=GREEN, size=10.5)

# 左(入口)
for i, (nm, sub) in enumerate([("api  HTTPルート", "8ファイル"), ("worker  定期実行", ""),
                               ("ingestion  CSV取込", "")]):
    yy = 1.75 + i * 0.85
    box(s, ML, yy, 3.35, 0.62,
        [(nm, {"size": 11, "bold": True}), ("  " + sub, {"size": 9.5, "color": MUTED})],
        fill=VIOLET_L, border=VIOLET, size=11)
    arrow(s, (3.9, yy + 0.31), (4.35, yy + 0.31), color=VIOLET, width=1.6)
text(s, ML, 4.35, 3.35, 0.55, "入口側:usecase を呼ぶ", size=10.5, color=VIOLET, bold=True)
text(s, ML, 4.62, 3.35, 0.9,
     "usecase は必要なポートだけを引数で受け取るため、テストでは偽の実装を渡せる",
     size=10, color=MUTED, line=1.3)

# 右(実装)
for i, (nm, sub, col, fl) in enumerate([
        ("db  リポジトリ実装", "PostgreSQL / Drizzle", ACCENT, ACCENT_L),
        ("integrations  外部連携", "GAS / Gemini / 暗号化", ACCENT, ACCENT_L),
        ("demo  ブラウザ内実装", "PGlite / WebCrypto", ORANGE, ORANGE_L),
        ("Noop 実装", "外部が無い環境用", MUTED, CARD)]):
    yy = 1.75 + i * 0.85
    box(s, 9.45, yy, 3.38, 0.62,
        [(nm, {"size": 11, "bold": True}), ("\n", {}), (sub, {"size": 9, "color": MUTED})],
        fill=fl, border=col, size=11)
    arrow(s, (9.4, yy + 0.31), (8.95, yy + 0.31), color=col, width=1.6)
text(s, 9.45, 5.2, 3.38, 0.9,
     "実装側:ポートを満たす形で外部とつなぐ。\ncore は誰が実装しているか知らない。",
     size=10, color=MUTED, line=1.3)

note(s, ML, 5.75, 6.0, 1.15, "この形にした見返り",
     "外部サービスが無い環境でも黙って壊れず、何もしない実装に落ちる(地図・予定・AI・ミラー)。"
     "そして同じ業務ロジックが、本番でもブラウザ内デモでもそのまま動く。",
     accent=GREEN, fill=GREEN_L, size=11)
note(s, ML + 6.33, 5.75, 6.0, 1.15, "正直に申し上げる例外",
     "パスワードのハッシュ化を担う窓口だけ、ports ではなく usecases 側に定義されています。"
     "動作に影響はありませんが、置き場所の一貫性は崩れています。",
     accent=AMBER, fill=AMBER_L, size=11)

# ══════════════════════════════════════════════════════════════
# 10. ポート一覧
# ══════════════════════════════════════════════════════════════
s = sl_("窓口(ポート)の一覧 — 28本", "core が「外にこれをやってほしい」と宣言しているものの全体",
        source="packages/core/src/ports/*.ts")
groups = [
    ("データの読み書き(14本)", ACCENT, ACCENT_L,
     ["Tenant テナント", "Staff スタッフ", "Session セッション", "PasswordResetCode 再設定コード",
      "Customer 顧客", "FamilyMember 世帯構成員", "DailyReport 日報",
      "AccidentReport 事故報告", "Receipt 領収書", "AttendanceDay 勤怠",
      "Coupon クーポン", "CouponRedemption クーポン適用記録",
      "AppSettings 管理者設定", "TenantKey 暗号鍵"]),
    ("外部サービス(9本)", VIOLET, VIOLET_L,
     ["ReportAi 日報の文章生成(Gemini)", "Notifier 通知(Google Chat)",
      "Mailer メール送信", "Calendar 予定の読み取り", "Maps 距離の計算",
      "Storage 画像の保存(GCS想定)", "MirrorSender スプレッドシートへの送信",
      "Mirror 送信予定の積み込み", "Schedule 予定の取得"]),
    ("横断的な関心(5本)", GREEN, GREEN_L,
     ["UnitOfWork 複数の書き込みを1つのトランザクションに",
      "Crypto 資格情報の暗号化・復号", "KeyManagement 鍵を包む・ほどく(KMS)",
      "AuditLog 監査ログの記録", "OutboxRepository 送信待ち行列の管理"]),
]
cx = ML
for ttl, col, fl, items in groups:
    w = 4.0 if ttl.startswith("データ") else 4.05
    rect(s, cx, 1.28, w, 4.35, fill=WHITE, border=col, border_w=1.3)
    fill_text(rect(s, cx, 1.28, w, 0.44, fill=col, border=None, shape=MSO_SHAPE.RECTANGLE),
              ttl, size=11.5, color=WHITE, bold=True)
    bullets(s, cx + 0.2, 1.85, w - 0.4, 3.7, [{"t": it, "s": 10.5} for it in items],
            size=10.5, line=1.25, gap=5.5, marker_color=col)
    cx += w + 0.14
card(s, ML, 5.8, 6.0, 1.1, "「窓口だけ定義する」ことの実利", accent=GREEN, items=[
    {"t": "テストでは偽の実装を渡すだけで済む。データベースも外部APIも起動しないため、"
          "692件のテストが約15秒で終わる"},
], body_size=10.5)
note(s, ML + 6.33, 5.8, 6.0, 1.1, "窓口の束(Container)",
     "全ポートの実装をまとめた「束」を1つ作り、それを usecase に渡します。"
     "Node.js用とブラウザ用の2種類の束が、同じ型で用意されています。",
     accent=ACCENT, fill=ACCENT_L, size=10.5)

# ══════════════════════════════════════════════════════════════
# 11. リクエストを1本追う
# ══════════════════════════════════════════════════════════════
s = sl_("リクエストを1本追う", "「日報を保存する」で何が起きるか",
        source="packages/core/src/usecases/reports.ts / packages/api/src/routes/reports.ts")
lanes = [("ブラウザ", ACCENT), ("api(入口)", VIOLET), ("core(業務)", GREEN),
         ("db / 外部", ORANGE)]
steps = [
    ("① 保存ボタン", "ブラウザ", "入力内容と Cookie を送る"),
    ("② 入口の検査", "api(入口)", "Cookie照合 → 権限確認 → Origin照合 → 入力検証"),
    ("③ 業務の手順", "core(業務)", "usecase が「日報を保存する」手順を実行"),
    ("④ 1つのトランザクション", "db / 外部", "日報の行 + 送信予定(outbox)を揃って確定"),
    ("⑤ 外への通知", "core(業務)", "Google Chat へ通知(txの外)"),
    ("⑥ 後から送信", "db / 外部", "ワーカーがスプレッドシートへ書き戻す"),
]
yy = 1.82
lane_x = {"ブラウザ": ML, "api(入口)": ML + 3.15, "core(業務)": ML + 6.3, "db / 外部": ML + 9.45}
lane_col = {"ブラウザ": ACCENT, "api(入口)": VIOLET, "core(業務)": GREEN, "db / 外部": ORANGE}
for i, (nm, lane, body) in enumerate(steps):
    x = lane_x[lane]
    col = lane_col[lane]
    rect(s, x, yy, 2.88, 0.66, fill=WHITE, border=col, border_w=1.3)
    text(s, x + 0.15, yy + 0.07, 2.6, 0.24, nm, size=10.5, color=col, bold=True)
    text(s, x + 0.15, yy + 0.32, 2.65, 0.38, body, size=9.5, color=INK, line=1.22)
    if i > 0:
        px = lane_x[steps[i - 1][1]]
        if px == x:
            arrow(s, (x + 1.44, yy - 0.12), (x + 1.44, yy), color=MUTED, width=1.4)
        else:
            arrow(s, (px + 1.44, yy - 0.12), (x + 1.44, yy), color=MUTED, width=1.4,
                  elbow=True)
    yy += 0.78
# レーン見出し
lx = ML
for nm, col in lanes:
    fill_text(rect(s, lx, 1.25, 2.88, 0.4, fill=col, border=None, shape=MSO_SHAPE.RECTANGLE),
              nm, size=11, color=WHITE, bold=True)
    lx += 3.15

rect(s, ML, 6.42, CW, 0.5, fill=ACCENT_L, border=None)
text(s, ML + 0.2, 6.52, CW - 0.4, 0.3,
     "要点:④で「日報の行」と「送信予定」を同じトランザクションで確定させる。片方だけ通ると、"
     "誰にも気づかれない取り残しが生まれる。",
     size=11, color=INK)

# ══════════════════════════════════════════════════════════════
# 12. §3
# ══════════════════════════════════════════════════════════════
sec_("第 3 章", "外部との連携",
     "現行のGAS版との共存、認証、AI、そして公開デモ")

# ══════════════════════════════════════════════════════════════
# 13. GAS版との共存
# ══════════════════════════════════════════════════════════════
s = sl_("現行のGAS版とどう共存するか", "正データはPostgreSQL、スプレッドシートは「写し」",
        source="packages/core/src/usecases/mirrorWorker.ts / packages/integrations/src/gas-bridge")
box(s, ML, 1.3, 2.6, 0.8, "PostgreSQL\n(正データ)", fill=GREEN_L, border=GREEN, color=GREEN,
    size=11.5, bold=True)
box(s, ML + 3.1, 1.3, 2.6, 0.8, "outbox_jobs\n送信待ち行列", fill=ACCENT_L, border=ACCENT,
    color=ACCENT, size=11.5, bold=True)
box(s, ML + 6.2, 1.3, 2.6, 0.8, "ミラーワーカー\n(定期実行)", fill=ORANGE_L, border=ORANGE,
    color=ORANGE, size=11.5, bold=True)
box(s, ML + 9.3, 1.3, 3.03, 0.8, "GAS Web App 1本\n→ スプレッドシート", fill=WHITE, border=AMBER,
    color=AMBER, size=11.5, bold=True)
for x in (ML + 2.65, ML + 5.75, ML + 8.85):
    arrow(s, (x, 1.7), (x + 0.4, 1.7), color=MUTED, width=1.8)

card(s, ML, 2.35, 6.0, 2.08, "この方針にした理由(doc/10)", accent=GREEN, items=[
    {"t": "新規のGoogle API連携より、既存のGASブリッジを優先した。①新規の課金・認証情報の準備を避ける "
          "②GAS側で実証済みのロジック(イベント分類・タグ解析・スタッフ名の照合)を再実装しない"},
    {"t": "スプレッドシートを止めるときは、ミラーのアダプタを外すだけで済む(業務ロジックは無変更)"},
    {"t": "多重に動かしても安全(SKIP LOCKED)。処理中のまま5分放置された行は再取得の対象になる"},
], body_size=10.5)
card(s, ML + 6.33, 2.35, 6.0, 2.08, "失敗を終端にしない設計", accent=ACCENT, items=[
    {"t": "送信に失敗しても捨てない。5秒から倍々(上限1時間)で再試行し、8回で失敗扱いにする"},
    {"t": "失敗扱いになった件数はエラーログに出るので、運用が気づける"},
    {"t": "同じ内容を二重に送らないよう、送信予定には一意キー(idempotency_key)を持たせている"},
], body_size=10.5)

text(s, ML, 4.6, CW, 0.3, "この依存のしかたに残る問題(判断事項①)", size=12.5, color=RED, bold=True)
probs = [
    ("4系統が1本に集中", "メール・地図・予定・スプレッドシートすべてがGAS Web App 1本を経由。"
                   "実行時間制限・クォータあり、SLAなし"),
    ("まだ一度もデプロイしていない", "スプレッドシートへの書き戻しとメール送信は、"
                          "一度も本番で動いたことがない。メール送信の処理はGAS側に存在すらしない"),
    ("secret がURLに載る", "GASはカスタムヘッダーを読めないため、認証用の文字列をURLのクエリに付ける。"
                     "実行ログやプロキシに残る。交換手順は未整備"),
    ("失敗分の再投入が手作業", "失敗扱いになった送信予定を戻す操作は、管理画面から行えない"),
]
cx = ML
for ttl, body in probs:
    w = 2.98
    rect(s, cx, 4.95, w, 1.3, fill=RED_L, border=None)
    rect(s, cx, 4.95, 0.075, 1.3, fill=RED, border=None, shape=MSO_SHAPE.RECTANGLE)
    text(s, cx + 0.2, 5.03, w - 0.38, 0.5, ttl, size=10.5, color=RED, bold=True, line=1.25)
    text(s, cx + 0.2, 5.45, w - 0.38, 0.75, body, size=9.5, color=INK, line=1.28)
    cx += w + 0.14
note(s, ML, 6.35, CW, 0.6, "選択肢",
     "(a) この依存のまま早期にデプロイして運用設計を詰める  (b) メール送信だけ別経路(SES / SendGrid等)に逃がす  "
     "(c) スプレッドシート連携そのものを移行対象から外す",
     accent=VIOLET, fill=VIOLET_L, size=10.5)

# ══════════════════════════════════════════════════════════════
# 14. 認証
# ══════════════════════════════════════════════════════════════
s = sl_("認証とセッション", "提案書のFirebase Authから自前実装に変更した",
        source="packages/core/src/usecases/{auth,passwordReset}.ts / packages/api/src/session.ts")
text(s, ML, 1.2, CW, 0.3,
     "変更した理由:GAS版の既存パスワードをそのまま引き継ぎ、スタッフに再設定を強いないため。"
     "初回ログイン時に古い方式のハッシュを黙って新方式へ入れ替える。",
     size=11.5, color=INK)
y = 1.62
flow = [("① ログイン", "法人 + メール +\nパスワード", ACCENT, ACCENT_L),
        ("② 検証", "argon2id で照合\n(コストを明示指定)", VIOLET, VIOLET_L),
        ("③ 発行", "32バイトの乱数トークン\nDBにはハッシュのみ保存", GREEN, GREEN_L),
        ("④ 配布", "httpOnly Cookie\nSameSite=Lax / 7日", GREEN, GREEN_L),
        ("⑤ 以後の要求", "Cookie照合 → 法人を特定\n→ RLSのスコープを張る", ACCENT, ACCENT_L)]
cx = ML
for ttl, body, col, fl in flow:
    w = 2.3
    rect(s, cx, y, w, 1.0, fill=fl, border=col, border_w=1.2)
    text(s, cx + 0.15, y + 0.08, w - 0.3, 0.25, ttl, size=11, color=col, bold=True)
    text(s, cx + 0.15, y + 0.36, w - 0.3, 0.6, body, size=10, color=INK, line=1.28)
    if cx < ML + 4 * 2.5 - 0.1:
        arrow(s, (cx + w + 0.02, y + 0.5), (cx + w + 0.18, y + 0.5), color=MUTED, width=1.5)
    cx += w + 0.2
card(s, ML, 2.85, 6.0, 2.05, "総当たり・列挙を塞いだところ", accent=GREEN, items=[
    {"t": "連続10回の失敗で15分ロック、成功でリセット。恒久ロックにはしない"
          "(狙って失敗させれば人を締め出せるため)"},
    {"t": "ロック中かどうかで応答を変えない(アカウントの有無が分かってしまうため)"},
    {"t": "再設定は、存在しない宛先でも同じ応答を返す(ユーザー列挙を塞ぐ)"},
    {"t": "6桁コードは検証子だけを保存。30分・誤入力5回で無効"},
], body_size=10.5)
card(s, ML + 6.33, 2.85, 6.0, 2.05, "書き込みを守るところ", accent=ACCENT, items=[
    {"t": "初期パスワードのまま他のAPIを叩くと403(入口の1か所で判定)"},
    {"t": "書き込み系は Origin を照合してクロスサイトからの要求を弾く"},
    {"t": "パスワードの差し替えは、行をロックして「差し替え → セッション全破棄」を1つの"
          "トランザクションで行う"},
    {"t": "ログインの成否・パスワード変更・管理者操作を「誰が・誰を」付きでログに残す"},
], body_size=10.5)
text(s, ML, 5.0, CW, 0.3, "残っている弱点", size=12.5, color=RED, bold=True)
weak = [("絞り込みがアカウント単位のみ", "IPや端末単位のレート制限は前段(WAF / Cloud Armor)が必要"),
        ("古い方式のハッシュが残る", "一度もログインしないスタッフの古いハッシュは、期限なく残り続ける"),
        ("セッションは絶対期限7日のみ", "一定時間操作が無ければ切れる仕組みや、同時ログイン数の制限は無い")]
cx = ML
for ttl, body in weak:
    w = 4.03
    rect(s, cx, 5.35, w, 1.05, fill=RED_L, border=None)
    rect(s, cx, 5.35, 0.075, 1.05, fill=RED, border=None, shape=MSO_SHAPE.RECTANGLE)
    text(s, cx + 0.2, 5.44, w - 0.38, 0.28, ttl, size=10.5, color=RED, bold=True)
    text(s, cx + 0.2, 5.72, w - 0.38, 0.6, body, size=9.5, color=INK, line=1.28)
    cx += w + 0.12
rect(s, ML, 6.52, CW, 0.42, fill=CARD, border=None)
text(s, ML + 0.2, 6.6, CW - 0.4, 0.3,
     "認証は「失敗する経路」を数え上げて塞ぐ作業でした。テストも、失敗すべきときに失敗することを中心に書いています。",
     size=10.5, color=INK)

# ══════════════════════════════════════════════════════════════
# 15. AIと通知
# ══════════════════════════════════════════════════════════════
s = sl_("AI(Gemini)と通知の扱い", "生成物より「元の入力」を残すことを優先している",
        source="packages/core/src/usecases/reportAi.ts / ports/ai.ts, notifier.ts")
box(s, ML, 1.35, 2.7, 1.05, "スタッフの口語メモ\n「今日は公園で…」", fill=WHITE, border=LINE,
    size=11)
box(s, ML + 3.2, 1.35, 2.7, 1.05, "Gemini API\n文章生成", fill=VIOLET_L, border=VIOLET,
    color=VIOLET, size=11.5, bold=True)
box(s, ML + 6.4, 1.35, 2.9, 1.05, "社内向けレポート\n保護者向けレポート", fill=WHITE, border=GREEN,
    size=11)
box(s, ML + 9.8, 1.35, 2.53, 1.05, "スタッフが確認・修正\nしてから保存", fill=GREEN_L,
    border=GREEN, color=GREEN, size=11, bold=True)
for x in (ML + 2.75, ML + 5.95, ML + 9.35):
    arrow(s, (x, 1.87), (x + 0.4, 1.87), color=MUTED, width=1.8)
card(s, ML, 2.65, 6.0, 1.85, "設計上の判断", accent=GREEN, items=[
    {"t": [("生成前の口語メモも列として保存する", {"bold": True}),
           (". 生成物だけを残すと、あとから「元は何と書かれていたか」を確かめられない", {})]},
    {"t": "AIが使えない環境では、何もしない実装に落ちる(画面は生成なしで動く)"},
    {"t": "領収書のOCRも同じ形。読み取れなかった場合は空にして、人が直せるようにする"},
], body_size=10.5)
card(s, ML + 6.33, 2.65, 6.0, 1.85, "APIキーと通知先の持ち方", accent=ACCENT, items=[
    {"t": "APIキーとGoogle ChatのWebhook URLは、法人ごとの管理者設定として保存する"},
    {"t": [("この3項目だけはアプリ側で暗号化している", {"bold": True}),
           ("(業務データは平文。詳細は doc/12 P13)", {})]},
    {"t": "未設定の場合は環境変数の既定値にフォールバックする"},
], body_size=10.5)
text(s, ML, 4.65, CW, 0.3, "通知(Google Chat)の位置づけ", size=12.5, color=INK, bold=True)
bullets(s, ML, 4.98, 6.0, 1.3, [
    {"t": "日報・領収書の登録時に、決まった書式のテキストを送る(GAS版と同じ文面)"},
    {"t": "トランザクションの外で送る。通知の失敗で保存を巻き戻さない"},
], size=11, line=1.3, gap=6)
note(s, ML + 6.33, 4.98, 6.0, 1.35, "未検証の部分",
     "Gemini APIの実呼び出しと、GASブリッジ経由の全経路(メール送信を含む)は、"
     "自動テストでは検証していません。テストでは偽の実装に差し替えています。",
     accent=AMBER, fill=AMBER_L, size=11)
rect(s, ML, 6.45, CW, 0.44, fill=CARD, border=None)
text(s, ML + 0.2, 6.53, CW - 0.4, 0.3,
     "AIは「下書きを作る道具」として位置づけ、最終的な内容の責任はスタッフが持つ形にしています。",
     size=10.5, color=INK)

# ══════════════════════════════════════════════════════════════
# 16. 公開デモ
# ══════════════════════════════════════════════════════════════
s = sl_("公開デモ — 同じコードをブラウザ内で動かす", "「core が外部SDKを知らない」ことの実証でもある",
        source="packages/demo/src/*.ts / scripts/assertNoDemoInBuild.mjs")
box(s, ML, 1.35, 2.8, 1.1, "ブラウザ(1枚のページ)\nReact の画面", fill=ACCENT_L, border=ACCENT,
    color=ACCENT, size=11, bold=True)
box(s, ML + 3.3, 1.35, 2.9, 1.1, "fetch を差し替える\nサーバーへ行かせない", fill=ORANGE_L,
    border=ORANGE, color=ORANGE, size=11, bold=True)
box(s, ML + 6.7, 1.35, 2.8, 1.1, "同じ Hono アプリ\n同じルート・同じ業務ロジック", fill=VIOLET_L,
    border=VIOLET, color=VIOLET, size=11, bold=True)
box(s, ML + 10.0, 1.35, 2.33, 1.1, "PGlite\nブラウザ内PostgreSQL", fill=GREEN_L, border=GREEN,
    color=GREEN, size=11, bold=True)
for x in (ML + 2.85, ML + 6.25, ML + 9.55):
    arrow(s, (x, 1.9), (x + 0.4, 1.9), color=MUTED, width=1.8)
card(s, ML, 2.7, 6.0, 2.0, "本番と同じものが動いている", accent=GREEN, items=[
    {"t": "同じマイグレーション(33テーブル)・同じ行レベルセキュリティ・同じ業務ロジック・同じAPIルート"},
    {"t": "差し替えているのは、Node.js専用の実装と、鍵を置けない外部API(AI・地図・メール)だけ"},
    {"t": "Service Worker ではなく fetch の差し替えにしたのは、GitHub Pages の"
          "サブパス配信で適用範囲の問題に悩まされないため"},
], body_size=10.5)
card(s, ML + 6.33, 2.7, 6.0, 2.0, "本番ビルドに混ざらないことの担保", accent=ACCENT, items=[
    {"t": "本番ビルドではデモの入口を空の実装に差し替える(ビルド設定)"},
    {"t": [("設定を読むのではなく、出来上がった成果物そのものをCIが検査する", {"bold": True}),
           (". ブラウザ内DBのファイルが含まれていないか、禁止文字列が無いかを確認", {})]},
    {"t": "デモの暗号鍵は公開された固定値。訪問者が入力したAPIキー等は永続化しない"},
], body_size=10.5)
text(s, ML, 4.85, CW, 0.3, "デモ固有の脆さ(本番には影響しない)", size=12.5, color=AMBER,
     bold=True)
bullets(s, ML, 5.2, CW, 1.1, [
    {"t": "PGlite は1.0未満。書き出しの完了を待つために内部の仕組みを直接呼んでいるため、"
          "バージョンを完全固定している"},
    {"t": "接続が1本しかないためトランザクションを直列化しているが、トランザクション外の単発クエリは対象外"},
    {"t": "複数タブを同時に開いたときの排他は未実装(画面上の案内も無い)"},
], size=11, line=1.3, gap=6)
rect(s, ML, 6.48, CW, 0.44, fill=ACCENT_L, border=None)
text(s, ML + 0.2, 6.56, CW - 0.4, 0.3,
     "デモURL:https://ohru131.github.io/katahimo-app/(admin@demo.example.com / demo1234)",
     size=11, color=ACCENT, bold=True)

# ══════════════════════════════════════════════════════════════
# 17. §4
# ══════════════════════════════════════════════════════════════
sec_("第 4 章", "品質と現状", "何をテストしていて、何をしていないか。そして判断いただきたいこと")

# ══════════════════════════════════════════════════════════════
# 18. テスト戦略
# ══════════════════════════════════════════════════════════════
s = sl_("何をテストし、何をしていないか", "テスト55ファイル / 692件。分布は意図的に偏らせている",
        source="vitest.config.ts / packages/core/src/usecases/testDoubles.ts")
card(s, ML, 1.28, 6.0, 3.3, "やっていること", accent=GREEN, items=[
    {"t": [("ドメインの純関数の回帰", {"bold": True}),
           ("  勤怠計算は、GAS版をNodeで実行した結果を正解として合成データ19ケース+月次集計で完全一致。"
            "CSV解析は実サンプル398行で一致", {})]},
    {"t": [("usecase の単体テスト", {"bold": True}),
           ("  偽の実装を渡し、「失敗すべきときに失敗する」ことを中心に検証(列挙防止・試行上限・"
            "割り込み・部分更新なし)", {})]},
    {"t": [("トランザクション境界", {"bold": True}),
           ("  送信予定への書き込みだけを失敗させ、日報の行が残らないことを固定", {})]},
    {"t": [("行レベルセキュリティ", {"bold": True}),
           ("  全テーブル分の静的検査と、権限を落としたロールでの実挙動の両方", {})]},
    {"t": [("制約が実際に効くこと", {"bold": True}),
           ("  CHECK・一意制約・複合外部キーが不正なINSERTを本当に拒否することを、本番と同じ"
            "マイグレーションを当てたDB上で確認(拒否理由が狙った制約名であることまで見る)", {})]},
], body_size=10.5, line=1.3, gap=6)
card(s, ML + 6.33, 1.28, 6.0, 3.3, "やっていないこと", accent=RED, items=[
    {"t": [("画面のテストが0本", {"bold": True}),
           ("  ブラウザを動かす自動テスト(E2E)もReactコンポーネントのテストも無い", {})]},
    {"t": [("APIルート層の統合テストが無い", {"bold": True}),
           ("  入口の検査は個別には検証しているが、通しでは確認していない", {})]},
    {"t": [("実PostgreSQLに対するテストが無い", {"bold": True}),
           ("  リポジトリ層はブラウザ内DBで検証しており、本番ドライバ固有の挙動差と "
            "EXPLAIN による索引の効き方は未確認", {})]},
    {"t": [("勤怠の実データ照合が未実施", {"bold": True}),
           ("  給与に直結する領域。実際の出勤簿との突き合わせはこれから", {})]},
    {"t": [("負荷試験・障害注入が未実施", {"bold": True}),
           ("  送信待ち行列の滞留や再試行の挙動を、実運用の量で見たことがない", {})]},
], body_size=10.5, line=1.3, gap=6)
note(s, ML, 4.72, 6.0, 1.18, "テストの書き方の方針",
     "新しく足したテストは「直した箇所を元に戻すと落ちること」を1つずつ確認してから残しています。"
     "通るだけのテストは、あとから読む人に誤解だけを与えるためです。",
     accent=GREEN, fill=GREEN_L, size=11)
note(s, ML + 6.33, 4.72, 6.0, 1.18, "判断事項④",
     "薄い層のうち、どれを運用開始の前提条件にするかを判断いただきたいです。"
     "特に勤怠は給与に直結します。",
     accent=VIOLET, fill=VIOLET_L, size=11)
text(s, ML, 6.0, CW, 0.3, "CI(毎push、GitHub Actions)", size=12.5, color=INK, bold=True)
ci = ["依存の取得", "静的検査(Biome)", "型検査(tsc strict)", "テスト(Vitest)", "本番ビルド",
      "デモ混入の検査", "デモビルド"]
cx = ML
for i, nm in enumerate(ci):
    w = 1.63
    box(s, cx, 6.35, w, 0.42, nm, fill=CARD, border=LINE, size=9.5)
    if i < len(ci) - 1:
        arrow(s, (cx + w + 0.01, 6.56), (cx + w + 0.13, 6.56), color=MUTED, width=1.3)
    cx += w + 0.15

# ══════════════════════════════════════════════════════════════
# 19. 主張と実装の対応
# ══════════════════════════════════════════════════════════════
s = sl_("ドキュメントの記述と、実装の実態", "誤解を招きやすい点を先にお伝えします",
        source="README「実装状況」/ doc/07 / packages/db/src/schema")
rows = [
    ["PostgreSQL + RLS のマルチテナント", "実装済み", "33テーブル、複合外部キー、FORCE。静的検査と実DB検証をCIで実行"],
    ["Outbox によるスプレッドシートへの書き戻し", "実装済み",
     "業務データの書き込みと同一トランザクション。再試行と失敗扱いの仕組みあり"],
    ["公開デモ", "稼働中", "本番と同一のスキーマ・業務ロジック・ルートがブラウザ内で動く"],
    ["認証は Firebase Auth / Identity Platform", "方針変更",
     "自前の argon2id + Cookie。GAS版のパスワードを移行できるようにするため"],
    ["Cloud Run 本番デプロイ", "未着手", "Dockerfileもインフラ定義も無い。自動化されているのはデモの公開だけ"],
    ["Sheetsミラーの実送信・メール送信", "未検証",
     "GASブリッジが未デプロイのため一度も動いていない。既定でミラーは無効"],
    ["Cloud KMS による鍵管理", "未着手", "鍵を包む鍵は環境変数のまま。再暗号化バッチも無い"],
    ["予約・請求・カルテ", "スキーマのみ", "表・制約・ドキュメントはある。リポジトリ実装・API・画面はこれから"],
    ["業種差の吸収(機能フラグ)", "未着手", "tenant_features 等は設計方針のみで、テーブルは無い"],
    ["勤怠計算はGAS版と一致", "合成データのみ", "実際の出勤簿での照合はこれから"],
]
colmap = {"実装済み": GREEN, "稼働中": GREEN, "方針変更": AMBER, "未検証": AMBER,
          "未着手": RED, "合成データのみ": AMBER, "スキーマのみ": VIOLET}
cc = {}
for i, r in enumerate(rows):
    cc[(i, 1)] = colmap[r[1]]
table(s, ML, 1.28, CW, ["ドキュメントが語っていること", "実装", "実際の状態"], rows,
      col_w=[4.4, 1.6, 6.5], size=10.5, hsize=10.5, row_h=0.44, header_h=0.33, first_bold=True,
      cell_colors=cc, aligns=[PP_ALIGN.LEFT, PP_ALIGN.CENTER, PP_ALIGN.LEFT])
note(s, ML, 6.0, CW, 0.9, "このページがいちばん大事かもしれません",
     "提案書だけを読むと、すでに揃っているように見えてしまいます。赤い行は着手すらしていません。"
     "ご判断いただきたいのは「この土台の上に、赤を積んでいってよいか」です。"
     "土台に構造的な問題があるなら、積む前に直したいと考えています。",
     accent=ACCENT, fill=ACCENT_L)

# ══════════════════════════════════════════════════════════════
# 20. 判断事項
# ══════════════════════════════════════════════════════════════
s = sl_("ご判断いただきたいこと", "優先度順。いずれも「直せない」ものではなく「今やるか、いつやるか」",
        source="データベース設計の論点は doc/12_データベース構造レビュー資料.pptx 第3〜4章")
items = [
    ("①", "GASブリッジ1本への依存", RED,
     "メール・地図・予定・スプレッドシートの4系統を1つのGAS Web Appに集約。SLAは無く、"
     "認証用の文字列がURLに載る。しかもまだ一度もデプロイしていない。",
     "(a) この依存のまま早期にデプロイして運用設計を詰める / (b) メールだけ別経路に逃がす / "
     "(c) スプレッドシート連携を移行対象から外す"),
    ("②", "鍵管理を本番相当にする時期", AMBER,
     "封筒暗号化の形はでき、鍵の世代も並存させているが、鍵を包む鍵は環境変数のまま。再暗号化バッチも無い。",
     "Cloud KMSを入れる前に、本番データを溜め始めてよいか"),
    ("③", "先行整備した5ドメインの進め方", VIOLET,
     "予約・請求・カルテ・訪問最適化・移動手当は、表と制約だけ先に用意してある。"
     "予約の二重取りだけはDBで止められておらず、アプリ側の責任になっている。",
     "どのドメインから実装に進めるか / 二重取り防止をどこで担保するか"),
    ("④", "テストの薄い層をどこまで埋めるか", AMBER,
     "ドメインとusecaseは厚いが、APIルート・実PostgreSQL・画面は手動確認のまま。",
     "どれを運用開始の前提条件にするか(特に勤怠は給与に直結)"),
    ("⑤", "単一障害点と運用の受け皿", AMBER,
     "失敗した送信予定の再投入、送信待ち行列の滞留、鍵の交換。いずれも今は手作業。",
     "運用画面を作るか、手順書で足りるか"),
]
yy = 1.25
for no, ttl, col, body, choice in items:
    h = 1.02
    rect(s, ML, yy, CW, h, fill=WHITE, border=LINE)
    rect(s, ML, yy, 0.075, h, fill=col, border=None, shape=MSO_SHAPE.RECTANGLE)
    text(s, ML + 0.22, yy + 0.1, 0.4, 0.3, no, size=13, color=col, bold=True)
    text(s, ML + 0.65, yy + 0.09, 3.5, 0.3, ttl, size=12, color=INK, bold=True)
    text(s, ML + 0.65, yy + 0.42, 6.2, 0.55, body, size=10, color=MUTED, line=1.28)
    rect(s, ML + 7.1, yy + 0.12, 5.1, h - 0.24, fill=CARD, border=None)
    text(s, ML + 7.25, yy + 0.2, 4.8, 0.7, choice, size=10, color=INK, line=1.3)
    yy += 1.1
text(s, ML, 6.78, CW, 0.3,
     "私の推奨:メール送信だけ別経路に逃がしたうえで、予約から実装に進めること。ただし意見ですので、ご判断をいただきたいです。",
     size=11, color=INK, bold=True)

# ══════════════════════════════════════════════════════════════
# 21. まとめ
# ══════════════════════════════════════════════════════════════
s = sl_("まとめ", "左は自信を持って言えること、右は判断いただきたいこと")
card(s, ML, 1.28, 6.0, 4.6, "この構成で守れていると考えているもの", accent=GREEN, items=[
    {"t": "業務ロジックが外部SDKを一切知らない。結果として、同じコードがNode.jsとブラウザの"
          "両方で動く(公開デモで実証)"},
    {"t": "依存の矢印が中心へ向かって一方通行。逆流は1本もない(package.json で確認できる)"},
    {"t": "揃って成立すべき書き込みが、1つのトランザクションで確定する。"
          "壊れたらテストが落ちるようにしてある"},
    {"t": "テナント分離が二重(アプリ側とデータベース側)。効いていることを静的検査と実DBの両方で検証"},
    {"t": "認証の失敗経路(列挙・総当たり・割り込み・部分更新・クロスサイト)を数え上げて塞いだ"},
    {"t": "33テーブルすべてで同じスキーマ規約。新しい表を足す手順が決まっている"},
    {"t": "毎pushで静的検査・型検査・692件のテスト・本番ビルド・混入検査まで自動実行"},
], body_size=11, line=1.32, gap=7)
card(s, ML + 6.33, 1.28, 6.0, 4.6, "判断をいただきたいもの", accent=VIOLET, items=[
    {"t": "GASブリッジ1本への依存と、その運用設計(判断事項①)"},
    {"t": "鍵管理を本番相当にする時期(②)"},
    {"t": "先行整備した5ドメインを実装へ進める順番(③)"},
    {"t": "テストの薄い層と、運用の受け皿をどこまで作るか(④⑤)"},
    {"t": [("データベース設計の論点は別資料", {"bold": True}),
           (":customers 37列の肥大化、業務データを平文にした前提、予約の二重取り防止、"
            "廃棄手順、監査の時期(doc/12 第3〜4章)", {})]},
    {"t": [("いちばん知りたいこと", {"bold": True}),
           (":自分では気づきようがない構造的な問題が、他にあるかどうか", {})]},
], body_size=11, line=1.32, gap=7)
note(s, ML, 6.05, CW, 0.85, "参照",
     "doc/07 技術構成提案書 / doc/09 データベース構造解説 / doc/10 GAS版連携の制約と方針 / "
     "doc/11 アーキテクチャ説明スライド(HTML) / doc/12 データベース構造レビュー資料(PowerPoint)  —  "
     "公開デモ:https://ohru131.github.io/katahimo-app/",
     accent=ACCENT, fill=ACCENT_L)

prs.save(str(OUT))
print(f"saved: {OUT}  ({PAGE['n']} slides)")
