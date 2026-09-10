# -*- coding: utf-8 -*-
"""doc/12_データベース構造レビュー資料.pptx を生成する。

有識者レビュー用。DB設計の用語をかみ砕きながら、現状の構成・問題点・相談事項を図で示す。
内容の一次情報は packages/db/src/schema/*.ts と doc/09_データベース構造解説.md。
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN

from pptx_kit import (ACCENT, ACCENT_L, AMBER, AMBER_L, CARD, CARD2, CW, GREEN, GREEN_L, INK, LINE,
                      ML, MONO, MUTED, NAVY, ORANGE, ORANGE_L, PINK, PINK_L, RED, RED_L, SLIDE_W,
                      TEAL, TEAL_L, VIOLET, VIOLET_L, WHITE, arrow, badge, box, bullets, card,
                      chip_row, fill_text, hline, new_deck, note, rect, section_slide, slide,
                      table, text, title_slide, vline)

OUT = Path(__file__).resolve().parents[2] / "doc" / "12_データベース構造レビュー資料.pptx"
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
    "DATABASE DESIGN REVIEW",
    "katahimo-app\nデータベース構造レビュー資料",
    "訪問保育(ベビーシッター法人)向け業務SaaS — PostgreSQL / 13テーブル",
    "現状の構成 ・ 設計上の問題点 ・ ご相談したいこと\n"
    "2026-09 時点 / 実装は packages/db/src/schema/*.ts が正 / 本番未配備・運用開始前",
)

# ══════════════════════════════════════════════════════════════
# 2. この資料の目的と読み方
# ══════════════════════════════════════════════════════════════
s = sl_("この資料の目的と読み方", "はじめに", source="doc/09_データベース構造解説.md を図解・要約したもの")
card(s, ML, 1.25, 3.95, 2.35, "お願いしたいこと", accent=ACCENT, items=[
    {"t": [("この設計のまま運用を始めてよいか", {"bold": True}), ("を判断いただきたい", {})]},
    {"t": "まだ運用前なので、破壊的な作り直しも可能な段階"},
    {"t": "「褒めていただく」より「危ないところを指摘いただく」ことが目的"},
], body_size=11.5)
card(s, ML + 4.15, 1.25, 3.95, 2.35, "作った人の前提", accent=AMBER, items=[
    {"t": [("データベース設計は今回が初めて", {"bold": True}), ("。用語の使い方自体が間違っている可能性がある", {})]},
    {"t": "実装は動いており、テストとCIも回っている"},
    {"t": "「知らないので選ばなかった」選択肢があるはず、という前提で見ていただきたい"},
], body_size=11.5)
card(s, ML + 8.3, 1.25, 4.03, 2.35, "この資料の作り", accent=GREEN, items=[
    {"t": "用語は出てくるたびに日常の言葉で言い換える(第1章に用語辞典)"},
    {"t": "図を中心にし、正確な定義はコードとdoc/09に委ねる"},
    {"t": [("赤い枠", {"color": RED, "bold": True}), ("は自覚している弱点。隠さず並べる", {})]},
], body_size=11.5)

text(s, ML, 3.9, CW, 0.3, "資料の構成(全28ページ)", size=13, color=INK, bold=True)
chs = [
    ("第1章", "まず用語から", "表・主キー・外部キー・\nトランザクション・RLS", ACCENT, ACCENT_L, "P4–5"),
    ("第2章", "現状の構成", "13テーブルの全体像と、\nテナント分離・データ保護", GREEN, GREEN_L, "P6–16"),
    ("第3章", "設計上の問題点", "customers 35列の肥大化ほか\n6件を自己申告", RED, RED_L, "P17–23"),
    ("第4章", "相談事項", "これから足す機能と、\n判断いただきたい論点", VIOLET, VIOLET_L, "P24–28"),
]
cx = ML
for no, ttl, body, col, fl, pg in chs:
    w = 2.95
    rect(s, cx, 4.3, w, 1.85, fill=fl, border=None)
    rect(s, cx, 4.3, 0.075, 1.85, fill=col, border=None, shape=MSO_SHAPE.RECTANGLE)
    text(s, cx + 0.22, 4.42, w - 0.4, 0.25, no, size=10.5, color=col, bold=True)
    text(s, cx + 0.22, 4.68, w - 0.4, 0.35, ttl, size=15, color=INK, bold=True)
    text(s, cx + 0.22, 5.12, w - 0.4, 0.8, body, size=11, color=MUTED, line=1.35)
    text(s, cx + 0.22, 5.82, w - 0.4, 0.25, pg, size=10, color=col, bold=True)
    cx += w + 0.17

note(s, ML, 6.28, CW, 0.66, "レビューを効率化するために",
     "「この用語の使い方が違う」という指摘も歓迎です。詳細な定義・全列一覧は doc/09_データベース構造解説.md に記載しています。",
     accent=ACCENT, fill=ACCENT_L, size=11)

# ══════════════════════════════════════════════════════════════
# 3. 第1章 divider
# ══════════════════════════════════════════════════════════════
sec_("第 1 章", "まず用語から",
     "この資料に出てくるデータベース用語を、日常の言葉で言い換えておきます")

# ══════════════════════════════════════════════════════════════
# 4. 用語① テーブル・行・列・主キー・外部キー
# ══════════════════════════════════════════════════════════════
s = sl_("用語① テーブル・行・列・キー", "データベースは「関係づけられた表の集まり」",
        source="実物は packages/db/src/schema/customers.ts, dailyReports.ts")
bullets(s, ML, 1.25, 5.9, 4.6, [
    {"t": [("テーブル(表)", {"bold": True, "color": ACCENT, "size": 13}),
           ("  … Excelの1シートに相当。このシステムには13枚ある", {"size": 12})]},
    {"t": [("行(レコード)", {"bold": True, "color": ACCENT, "size": 13}),
           ("  … 1件のデータ。「顧客1人」「日報1本」", {"size": 12})]},
    {"t": [("列(カラム)", {"bold": True, "color": ACCENT, "size": 13}),
           ("  … 項目。「氏名」「電話番号」。列ごとに", {"size": 12}),
           ("型", {"size": 12, "bold": True}),
           ("(文字列・数値・日時など)を決める", {"size": 12})]},
    {"t": [("主キー(PK)", {"bold": True, "color": VIOLET, "size": 13}),
           ("  … その行を一意に指す背番号。このシステムは全テーブル ", {"size": 12}),
           ("uuid", {"size": 11.5, "font": MONO}),
           (" のランダムな値", {"size": 12})]},
    {"t": [("外部キー(FK)", {"bold": True, "color": GREEN, "size": 13}),
           ("  … 別の表の行を指す「紐付け」。日報が「どの顧客の記録か」を持つのに使う。"
            "存在しない顧客IDを書こうとするとデータベースが拒否する", {"size": 12})]},
    {"t": [("なぜ表を分けるのか", {"bold": True, "size": 13}),
           ("  … 顧客の住所を1か所に置けば、住所が変わったとき直すのは1行だけで済む。"
            "日報ごとに住所を書き写していたら、直し漏れが必ず出る(これを", {"size": 12}),
           ("正規化", {"size": 12, "bold": True}),
           ("と呼ぶ)", {"size": 12})]},
], size=12, line=1.34, gap=9)

# 右: ミニER図
DX = 6.75
text(s, DX, 1.22, 6.0, 0.25, "顧客テーブル(customers)", size=11, color=ACCENT, bold=True)
table(s, DX, 1.5, 5.85, ["id 〈主キー〉", "tenant_id", "name(氏名)"],
      [["a1f3-…", "T社", "聖徳 太子"], ["b2c4-…", "T社", "金太郎"]],
      col_w=[1.5, 1.0, 1.6], size=10.5, hsize=10, row_h=0.3, header_h=0.32,
      cell_colors={(0, 0): VIOLET, (1, 0): VIOLET})
text(s, DX + 1.35, 2.5, 4.4, 0.25, "1行 = 顧客1人 / 1列 = 1つの項目", size=10, color=MUTED)

text(s, DX, 3.95, 6.0, 0.25, "日報テーブル(daily_reports)", size=11, color=GREEN, bold=True)
table(s, DX, 4.23, 5.85, ["id 〈主キー〉", "customer_id 〈外部キー〉", "occurred_at"],
      [["e9d1-…", "a1f3-…", "2026/09/03 9:00"], ["f0a2-…", "a1f3-…", "2026/09/05 9:00"]],
      col_w=[1.25, 1.85, 1.7], size=10.5, hsize=10, row_h=0.3, header_h=0.32,
      cell_colors={(0, 1): GREEN, (1, 1): GREEN})
vline(s, DX + 1.85, 4.21, 3.48, color=GREEN, width=1.6)
hline(s, DX + 0.62, 3.48, DX + 1.85, color=GREEN, width=1.6)
arrow(s, (DX + 0.62, 3.48), (DX + 0.62, 2.48), color=GREEN, width=1.6)
text(s, DX + 1.95, 3.32, 3.9, 0.5,
     "外部キーが主キーを指す。\n「この日報は聖徳太子さんの記録」という関係を表す。",
     size=10.5, color=GREEN, line=1.3)
note(s, DX, 5.42, 5.85, 1.15, "この2枚を見ながら覚えていただきたいこと",
     "以降の図に出てくる矢印は、ほぼすべて「外部キーによる紐付け」です。矢印の向きは"
     "「参照する側 → 参照される側」。tenant_id 列については次章で説明します。",
     accent=ACCENT, fill=ACCENT_L, size=11)

# ══════════════════════════════════════════════════════════════
# 5. 用語② 制約・索引・トランザクション・RLS
# ══════════════════════════════════════════════════════════════
s = sl_("用語② 制約・索引・トランザクション", "この先の図を読むのに必要な7語",
        source="RLS・封筒暗号化は第2章で図解します")
rows = [
    ["UNIQUE(一意制約)", "「この列の組み合わせは重複禁止」というルール",
     "同じメールで2人登録できないようにする"],
    ["INDEX(索引)", "本の巻末索引。全ページ読まずに目的の行へ飛べる",
     "「姓が佐藤の顧客」を全件走査せず引く"],
    ["トランザクション", "複数の書き込みを「まとめて確定/まとめて取消」する単位",
     "日報の保存と通知予約を、揃って成立させる"],
    ["RLS(行レベルセキュリティ)", "データベース自身が持つ「見える行の絞り込み」機能",
     "他社のデータは、そもそも見えなくする"],
    ["マイグレーション", "表の設計変更の履歴。SQLのファイルを積み上げていく",
     "現在0000〜0007の8本。前に進むだけ(戻さない)"],
    ["ORM(Drizzle)", "表の定義をTypeScriptで書き、SQLを生成する道具",
     "列の型がプログラム側の型と食い違うのを防ぐ"],
    ["JSONB", "1つの列の中にJSON(入れ子の構造)をまとめて入れる型",
     "勤怠の1日分をまるごと1列に入れている"],
]
table(s, ML, 1.28, 7.75, ["用語", "ふだんの言葉で言うと", "このシステムでの使い所"], rows,
      col_w=[2.0, 3.3, 3.1], size=10.5, hsize=10.5, row_h=0.62, header_h=0.34, first_bold=True)

# 右: 2つのミニ図
DX = 8.55
text(s, DX, 1.25, 4.3, 0.25, "図1 索引(INDEX)があると速い", size=11, color=ACCENT, bold=True)
box(s, DX, 1.56, 1.75, 1.0, "索引\n姓「佐藤」→ 3行目", fill=ACCENT_L, border=ACCENT, color=ACCENT,
    size=10, bold=True)
box(s, DX + 2.35, 1.56, 1.95, 1.0, "顧客テーブル\n(何万行でも)", fill=CARD, border=LINE, size=10)
arrow(s, (DX + 1.8, 2.06), (DX + 2.3, 2.06), color=ACCENT, width=1.8)
text(s, DX, 2.62, 4.3, 0.3, "索引が無いと毎回全行を読む。ただし索引は書き込みを少し遅くする",
     size=9.5, color=MUTED, line=1.25)

text(s, DX, 3.15, 4.3, 0.25, "図2 トランザクション(まとめて確定)", size=11, color=GREEN, bold=True)
rect(s, DX, 3.45, 4.3, 1.35, fill=GREEN_L, border=GREEN, border_w=1.6, dash=True)
text(s, DX + 0.12, 3.52, 4.0, 0.22, "1つのトランザクション", size=9.5, color=GREEN, bold=True)
box(s, DX + 0.15, 3.78, 1.95, 0.42, "日報を1行書く", fill=WHITE, border=GREEN, size=10)
box(s, DX + 0.15, 4.26, 1.95, 0.42, "通知の予約を1行書く", fill=WHITE, border=GREEN, size=10)
box(s, DX + 2.3, 3.78, 1.85, 0.9, "両方成功なら確定\n片方失敗なら両方無し", fill=WHITE, border=GREEN,
    color=GREEN, size=10, bold=True)
arrow(s, (DX + 2.15, 4.22), (DX + 2.25, 4.22), color=GREEN, width=1.5)
note(s, DX, 4.95, 4.3, 1.15, "なぜ重要か",
     "「日報は保存できたのに、通知だけ永久に飛ばない」状態を作らないため。"
     "片方だけ成立すると、どの記録が取り残されたのか誰にも分からなくなる。",
     accent=GREEN, fill=GREEN_L, size=10.5)

# ══════════════════════════════════════════════════════════════
# 6. 第2章 divider
# ══════════════════════════════════════════════════════════════
sec_("第 2 章", "現状の構成",
     "13テーブルの全体像と、テナント分離・データ保護・トランザクションの考え方")

# ══════════════════════════════════════════════════════════════
# 7. 何を記録しているのか(業務の流れ)
# ══════════════════════════════════════════════════════════════
s = sl_("何を記録しているのか", "業務の流れと、それを受けるテーブル",
        source="現行はGoogle Apps Script版が稼働中。PostgreSQLを唯一の正データにする移行の途中")
y0 = 1.35
steps = [
    ("① 顧客を取り込む", "外部予約システム\nRESERVA のCSV", "customers\nfamily_members", ACCENT, ACCENT_L),
    ("② 訪問する", "スタッフが顧客宅へ\n(スマホで操作)", "staff\nsessions", VIOLET, VIOLET_L),
    ("③ 記録を残す", "日報・事故報告・\n領収書・勤怠", "daily_reports / accident_reports\nreceipts / attendance_days", GREEN, GREEN_L),
    ("④ 外へ渡す", "スプレッドシート・\nGoogle Chat 通知", "outbox_jobs\napp_settings", ORANGE, ORANGE_L),
]
bw = 2.85
cx = ML
for i, (t1, t2, tbls, col, fl) in enumerate(steps):
    rect(s, cx, y0, bw, 2.5, fill=WHITE, border=col, border_w=1.3)
    rect(s, cx, y0, bw, 0.42, fill=col, border=None, shape=MSO_SHAPE.RECTANGLE)
    fill_text(rect(s, cx, y0, bw, 0.42, fill=col, border=None, shape=MSO_SHAPE.RECTANGLE),
              t1, size=12, color=WHITE, bold=True)
    text(s, cx + 0.18, y0 + 0.58, bw - 0.36, 0.7, t2, size=11.5, color=INK, line=1.35,
         align=PP_ALIGN.CENTER)
    hline(s, cx + 0.3, y0 + 1.35, cx + bw - 0.3, color=LINE)
    text(s, cx + 0.18, y0 + 1.45, bw - 0.36, 0.9, "受けるテーブル", size=9.5, color=MUTED,
         align=PP_ALIGN.CENTER)
    text(s, cx + 0.12, y0 + 1.7, bw - 0.24, 0.75, tbls, size=10, color=col, bold=True,
         align=PP_ALIGN.CENTER, line=1.3, font=MONO)
    if i < 3:
        arrow(s, (cx + bw + 0.03, y0 + 1.25), (cx + bw + 0.32, y0 + 1.25), color=MUTED, width=2)
    cx += bw + 0.35

card(s, ML, 4.15, 6.0, 1.35, "記録は「後から書き換えない」データが多い", accent=GREEN, items=[
    {"t": "日報・事故報告・領収書・勤怠は、その日の事実を積み上げる性質。削除は行わず、"
          "顧客の退会も deactivated_at を立てるだけ(ソフトデリート)"},
], body_size=11.5)
card(s, ML + 6.2, 4.15, 6.13, 1.35, "AI(Gemini)と通知が絡む", accent=VIOLET, items=[
    {"t": "口語メモから社内向け・保護者向けの文章を生成する。生成前の元テキストも列として残す。"
          "APIキーとWebhook URLは app_settings に暗号化して保存"},
], body_size=11.5)
note(s, ML, 5.72, CW, 1.1, "設計の出発点",
     "現行のGoogle Apps Script版は、データがすべてスプレッドシートとDriveにあり、1法人・1Googleアカウントに強く依存しています。"
     "これを複数法人(テナント)が同居できる形に作り替えるのが今回の目的です。したがって「他社のデータが混ざらないこと」が"
     "設計上の最優先事項になっています。",
     accent=ACCENT, fill=ACCENT_L)

# ══════════════════════════════════════════════════════════════
# 8. 全体像 13テーブル
# ══════════════════════════════════════════════════════════════
s = sl_("全体像 — 13テーブル", "マイグレーション8本 / tenants以外の12枚はすべて同じ形を守る",
        source="packages/db/src/schema/*.ts / 詳細なER図は doc/09 第2章")

chip_row(s, ML, 1.15, [("矢印 = 外部キーの参照", MUTED, CARD),
                       ("紫 = staff を参照", VIOLET, VIOLET_L),
                       ("緑 = customers を参照", GREEN, GREEN_L),
                       ("全テーブルが tenant_id を持つ", ACCENT, ACCENT_L)], size=9.5)

box(s, 5.35, 1.55, 2.6, 0.44, "tenants(法人マスタ)", fill=NAVY, border=None, color=WHITE,
    size=11.5, bold=True)

# 認証・スタッフ枠
rect(s, ML, 2.35, 3.5, 2.62, fill=VIOLET_L, border=None)
text(s, ML + 0.15, 2.42, 3.2, 0.25, "認証・スタッフ・勤怠", size=10.5, color=VIOLET, bold=True)
box(s, ML + 0.22, 2.72, 3.05, 0.4, "staff(スタッフ)", fill=WHITE, border=VIOLET, size=11,
    bold=True)
for i, (nm, sub) in enumerate([("sessions", "ログイン状態"),
                               ("password_reset_codes", "再設定コード"),
                               ("attendance_days", "勤怠1日分")]):
    yy = 3.25 + i * 0.56
    box(s, ML + 0.22, yy, 3.05, 0.44,
        [(nm, {"size": 10.5, "bold": True}), ("  " + sub, {"size": 9.5, "color": MUTED})],
        fill=WHITE, border=LINE, size=10.5)
hline(s, ML + 0.1, 3.15, ML + 0.4, color=VIOLET, width=1.2)
vline(s, ML + 0.1, 3.15, 3.25 + 2 * 0.56 + 0.22, color=VIOLET, width=1.2)
for i in range(3):
    arrow(s, (ML + 0.1, 3.25 + i * 0.56 + 0.22), (ML + 0.21, 3.25 + i * 0.56 + 0.22),
          color=VIOLET, width=1.2)

# 訪問記録枠
rect(s, 4.35, 2.35, 4.55, 2.62, fill=CARD, border=None)
text(s, 4.5, 2.42, 4.2, 0.25, "訪問の記録(スタッフと顧客の両方を参照)", size=10.5, color=INK,
     bold=True)
mid = []
for i, (nm, sub) in enumerate([("daily_reports", "保育日報 / 本文5列"),
                               ("accident_reports", "事故報告・ヒヤリハット / 本文11列"),
                               ("receipts", "領収書 / 画像はGCS想定")]):
    yy = 2.75 + i * 0.72
    box(s, 4.55, yy, 4.15, 0.6,
        [(nm, {"size": 11, "bold": True}), ("\n", {}), (sub, {"size": 9.5, "color": MUTED})],
        fill=WHITE, border=LINE, size=11)
    mid.append(yy + 0.3)

# 顧客枠
rect(s, 9.3, 2.35, 3.53, 2.62, fill=GREEN_L, border=None)
text(s, 9.45, 2.42, 3.2, 0.25, "顧客(利用世帯)", size=10.5, color=GREEN, bold=True)
box(s, 9.5, 2.72, 3.15, 0.4, "customers(顧客/35列)", fill=WHITE, border=GREEN, size=11, bold=True)
box(s, 9.5, 3.25, 3.15, 0.44,
    [("family_members", {"size": 10.5, "bold": True}), ("  世帯構成員", {"size": 9.5, "color": MUTED})],
    fill=WHITE, border=LINE, size=10.5)
arrow(s, (9.72, 3.12), (9.72, 3.47), color=GREEN, width=1.2)
text(s, 9.5, 3.85, 3.15, 0.95,
     "customers は RESERVA の顧客CSVの全項目を受けるため35列ある(第3章の論点①)",
     size=10, color=MUTED, line=1.3)

for yy in mid:
    arrow(s, (3.82, yy), (4.5, yy), color=VIOLET, width=1.3)
    arrow(s, (9.45, yy), (8.75, yy), color=GREEN, width=1.3)

# tenants から全テーブルへ(幹線1本 + 枝3本)
vline(s, 6.65, 1.99, 2.14, color=NAVY, width=1.2, dash=True)
hline(s, 2.1, 2.14, 11.05, color=NAVY, width=1.2, dash=True)
for bx in (2.1, 6.65, 11.05):
    arrow(s, (bx, 2.14), (bx, 2.32), color=NAVY, width=1.2, dash=True)

# 基盤枠
rect(s, ML, 5.15, CW, 0.92, fill=CARD2, border=None)
text(s, ML + 0.15, 5.22, 4.0, 0.25, "テナント基盤・外部連携(tenant_id のみを持つ)", size=10.5,
     color=INK, bold=True)
for i, (nm, sub, col) in enumerate([
        ("tenant_keys", "テナントごとの暗号鍵(世代あり)", ACCENT),
        ("app_settings", "APIキー・Webhook URL(暗号化)", ACCENT),
        ("outbox_jobs", "スプレッドシートへの書き戻し待ち行列", ORANGE)]):
    box(s, ML + 0.2 + i * 4.02, 5.52, 3.85, 0.45,
        [(nm, {"size": 10.5, "bold": True, "color": col}), ("  " + sub, {"size": 9.5, "color": MUTED})],
        fill=WHITE, border=LINE, size=10.5)

note(s, ML, 6.1, CW, 0.82, "例外は3つだけ",
     "① tenants だけRLSの対象外(ログイン前に法人を特定するため)  "
     "② receipts.customer_id だけ空を許す(顧客に紐付かない経費)  "
     "③ sessions.token_hash だけ法人を越えて一意",
     accent=AMBER, fill=AMBER_L, size=11)

# ══════════════════════════════════════════════════════════════
# 9. テーブル一覧
# ══════════════════════════════════════════════════════════════
s = sl_("テーブル一覧", "13枚の役割と、鍵になる制約",
        source="RLS = 行レベルセキュリティ(そのテナントの行しか見えなくするDB側の仕組み)")
rows = [
    ["tenants", "法人(テナント)マスタ", "slug で一意。ログイン前に法人を特定する", "対象外"],
    ["tenant_keys", "テナントごとの暗号鍵(ラップ済み)", "PK=(tenant_id, dek_version) 世代が並存", "○"],
    ["staff", "スタッフ。認証情報も兼ねる", "UNIQUE(tenant_id, email) / (tenant_id, id)", "○"],
    ["customers", "顧客(利用世帯の代表者)。35列", "UNIQUE(tenant_id, external_source, external_id)", "○"],
    ["family_members", "世帯構成員(子ども等)", "customers への複合FK", "○"],
    ["daily_reports", "保育日報。本文は項目ごとの5列", "staff と customers 双方への複合FK", "○"],
    ["accident_reports", "事故報告 / ヒヤリハット。本文11列", "同上", "○"],
    ["receipts", "領収書。画像はオブジェクトストレージ", "customer_id は空可。dedupe_key で重複検出", "○"],
    ["attendance_days", "勤怠(出勤簿)1日分", "UNIQUE(tenant_id, staff_id, business_date)", "○"],
    ["sessions", "ログインセッション", "生トークンは保存せずSHA-256のみ", "○"],
    ["password_reset_codes", "パスワード再設定の6桁コード", "HMACの検証子のみ保存。30分・5回で無効", "○"],
    ["outbox_jobs", "スプレッドシート書き戻しの待ち行列", "UNIQUE(tenant_id, idempotency_key)", "○"],
    ["app_settings", "テナント単位の管理者設定", "1テナント1行。資格情報3列だけ暗号化", "○"],
]
cc = {(0, 3): MUTED}
table(s, ML, 1.25, CW, ["テーブル", "役割", "鍵になる制約・特徴", "RLS"], rows,
      col_w=[2.2, 3.9, 5.4, 0.75], size=10.5, hsize=10.5, row_h=0.315, header_h=0.33,
      first_bold=True, cell_colors=cc,
      aligns=[PP_ALIGN.LEFT, PP_ALIGN.LEFT, PP_ALIGN.LEFT, PP_ALIGN.CENTER])
note(s, ML, 5.72, 6.0, 1.15, "「複合FK」とは(第2章で図解します)",
     "外部キーを (tenant_id, customer_id) の2列セットにしたもの。「そのIDが本当に同じ法人の行か」を"
     "データベース自身に確かめさせるための工夫です。",
     accent=ACCENT, fill=ACCENT_L, size=11)
note(s, ML + 6.33, 5.72, 6.0, 1.15, "この一覧に無いもの",
     "予約・請求・カルテのテーブルはまだ存在しません(第4章)。提案書では中心的な機能として"
     "書いていますが、スキーマには未着手です。",
     accent=RED, fill=RED_L, size=11)

# ══════════════════════════════════════════════════════════════
# 10. マルチテナント方式の比較
# ══════════════════════════════════════════════════════════════
s = sl_("複数の法人をどう同居させるか", "3つの方式の比較と、採用した方式",
        source="doc/07_技術構成提案書.md 第4章 / 実装は packages/db/src/schema/_rls.ts")
opts = [
    ("方式A 共有スキーマ + tenant_id 列", ACCENT, ACCENT_L, True,
     ["1つのデータベース・1組の表に全社のデータを入れ、各行に tenant_id 列で「どの法人か」を持たせる",
      "○ 表が1組なので、機能追加・設計変更が1回で全社に効く",
      "○ 法人が増えても運用の手間が増えない",
      "× 取り違えれば混ざる。仕組みで防ぐ必要がある"]),
    ("方式B 法人ごとにスキーマを分ける", MUTED, CARD, False,
     ["同じデータベースの中に、法人ごとの区画(スキーマ)を作る",
      "○ 混ざりにくい",
      "× 法人ごとに設計が分岐しやすく、変更を全区画に適用する手間が増える",
      "× 法人数に比例して運用が重くなる"]),
    ("方式C 法人ごとにデータベースを分ける", MUTED, CARD, False,
     ["法人1社ごとに別のデータベースを立てる",
      "○ 分離は最も強い",
      "× 費用と運用(バックアップ・移行・監視)が法人数だけ増える",
      "× 数社規模では明らかに過剰"]),
]
cx = ML
for ttl, col, fl, chosen, points in opts:
    w = 3.95
    rect(s, cx, 1.3, w, 2.95, fill=WHITE, border=col if chosen else LINE,
         border_w=2.0 if chosen else 1.0)
    fill_text(rect(s, cx, 1.3, w, 0.5, fill=col if chosen else CARD2, border=None,
                   shape=MSO_SHAPE.RECTANGLE),
              ttl, size=11.5, color=WHITE if chosen else INK, bold=True)
    if chosen:
        badge(s, cx + 0.2, 1.88, 1.6, 0.28, "◆ この方式を採用", color=WHITE, fill=GREEN, size=10)
    items = []
    for i, b in enumerate(points):
        c = INK
        mk = "▪"
        if b.startswith("○"):
            c, mk, b = GREEN, "○", b[1:].strip()
        elif b.startswith("×"):
            c, mk, b = RED, "×", b[1:].strip()
        items.append({"t": b, "c": c, "mk": mk, "mkc": c, "s": 10.5})
    bullets(s, cx + 0.2, 2.24, w - 0.4, 1.95, items, size=10.5, line=1.3, gap=5)
    cx += w + 0.24

# 採用方式の図
rect(s, ML, 4.45, 6.0, 2.1, fill=ACCENT_L, border=None)
text(s, ML + 0.2, 4.56, 5.6, 0.25, "採用方式のイメージ(1組の表に全社が同居)", size=10.5,
     color=ACCENT, bold=True)
table(s, ML + 0.2, 4.9, 5.6, ["tenant_id", "name", "phone"],
      [["T社", "聖徳 太子", "090-…"], ["U社", "織田 信長", "080-…"], ["T社", "金太郎", "070-…"]],
      col_w=[1.2, 1.6, 1.4], size=10, hsize=9.5, row_h=0.26, header_h=0.28,
      cell_colors={(0, 0): ACCENT, (1, 0): PINK, (2, 0): ACCENT})
note(s, ML + 6.33, 4.45, 6.0, 2.1, "方式Aの弱点をどう塞ぐか(次の2ページ)",
     "「行が混ざりうる」という方式Aの弱点に対して、二重の仕組みを入れています。"
     "① データベース自身に「この法人の行しか見せない」と設定する(RLS)  "
     "② 紐付けを2列セットにして「同じ法人の行か」をデータベースに確かめさせる(複合外部キー)",
     accent=AMBER, fill=AMBER_L, size=11)

# ══════════════════════════════════════════════════════════════
# 11. RLS
# ══════════════════════════════════════════════════════════════
s = sl_("守り① データベース自身に絞り込ませる", "RLS(Row Level Security / 行レベルセキュリティ)",
        source="packages/db/src/schema/_rls.ts, tenantScope.ts / doc/09 1.1節")
text(s, ML, 1.22, 12.3, 0.3,
     "アプリが「WHERE tenant_id = …」を書き忘れても、他社の行が返らないようにする仕組み。条件はデータベース側に登録しておく。",
     size=12, color=INK)

y = 1.68
box(s, ML, y, 2.0, 0.95, "ブラウザ\n(T社のスタッフ)", fill=WHITE, border=LINE, size=11)
box(s, ML + 2.4, y, 2.45, 0.95, "API サーバー\nwithTenant(T社ID)", fill=ACCENT_L, border=ACCENT,
    color=ACCENT, size=11, bold=True)
box(s, ML + 5.25, y, 2.9, 0.95,
    [("SET LOCAL", {"font": MONO, "size": 10.5, "bold": True}), ("\n", {}),
     ("app.tenant_id = 'T社'", {"font": MONO, "size": 10}), ("\n", {}),
     ("この接続の「今の法人」を宣言", {"size": 9.5, "color": MUTED})],
    fill=WHITE, border=ACCENT, size=10.5)
box(s, ML + 8.55, y, 3.78, 0.95,
    [("PostgreSQL のポリシー", {"size": 10.5, "bold": True, "color": GREEN}), ("\n", {}),
     ("tenant_id = current_setting('app.tenant_id')", {"font": MONO, "size": 9})],
    fill=GREEN_L, border=GREEN, size=10)
arrow(s, (ML + 2.05, y + 0.47), (ML + 2.35, y + 0.47), color=MUTED, width=1.6)
arrow(s, (ML + 4.9, y + 0.47), (ML + 5.2, y + 0.47), color=ACCENT, width=1.6)
arrow(s, (ML + 8.2, y + 0.47), (ML + 8.5, y + 0.47), color=ACCENT, width=1.6)

y2 = 2.95
text(s, ML, y2, 6.0, 0.25, "同じ SELECT を投げても、返る行が変わる", size=11.5, color=INK, bold=True)
text(s, ML, y2 + 0.28, 6.0, 0.3, "SELECT * FROM customers;   ← 絞り込みを書いていない",
     size=10.5, color=MUTED, font=MONO)
table(s, ML, y2 + 0.62, 6.0, ["tenant_id", "name", "この接続から"],
      [["T社", "聖徳 太子", "見える"], ["U社", "織田 信長", "見えない(存在しない扱い)"],
       ["T社", "金太郎", "見える"]],
      col_w=[1.1, 1.7, 2.5], size=10, hsize=10, row_h=0.29, header_h=0.3,
      cell_colors={(0, 2): GREEN, (1, 0): PINK, (1, 1): MUTED, (1, 2): RED, (2, 2): GREEN})
text(s, ML, y2 + 1.88, 6.0, 0.5,
     "設定を忘れた接続からは、どの行も見えない(安全側に倒れる)。書き込みも同じ条件で弾かれる。",
     size=10.5, color=MUTED, line=1.3)

card(s, ML + 6.33, 2.95, 6.0, 1.45, "効いていることをCIで毎回確かめている", accent=GREEN, items=[
    {"t": "静的検査:全13テーブル分のSQLに ENABLE と FORCE、ポリシーの条件が揃っているかを機械的に検査。"
          "新しい表を足して書き忘れると落ちる"},
    {"t": "実DB検証:権限を落としたロールを作り、実際に他社の行が見えないことを確認"},
], body_size=10.5)
note(s, ML + 6.33, 4.5, 6.0, 1.08, "FORCE を手で足している理由",
     "表の所有者はPostgreSQLの仕様上RLSを素通りします。FORCE ROW LEVEL SECURITY を付けると所有者にも適用されます。"
     "この1行はORMが生成しないため手で追記しています。",
     accent=AMBER, fill=AMBER_L, size=10.5)
note(s, ML, 5.65, CW, 1.2, "ご確認いただきたいこと",
     "この方式で塞いだつもりなのは ① アプリのWHERE書き忘れ ② 表所有者による素通り(FORCE) "
     "③ コネクションプールで設定が次のリクエストに残ること(トランザクション単位の SET LOCAL にしている)の3点です。"
     "PostgreSQLの仕様上、他に見落としている抜け道はないでしょうか。",
     accent=ACCENT, fill=ACCENT_L)

# ══════════════════════════════════════════════════════════════
# 12. 複合外部キー
# ══════════════════════════════════════════════════════════════
s = sl_("守り② 紐付けを2列セットにする", "外部キーの制約チェックはRLSを常に素通りする(PostgreSQLの仕様)",
        source="packages/db/src/schema/dailyReports.ts ほか / doc/09 1.2節")
text(s, ML, 1.22, CW, 0.3,
     "RLSは SELECT / UPDATE / DELETE を絞り込むだけで、外部キーの参照チェックには効きません。"
     "つまり単一列の外部キーだと、他社の行を指す値を書けてしまいます。",
     size=12, color=INK)

# Before
rect(s, ML, 1.68, 6.0, 2.9, fill=RED_L, border=None)
text(s, ML + 0.2, 1.76, 5.6, 0.28, "対策前:単一列の外部キー", size=12, color=RED, bold=True)
box(s, ML + 0.25, 2.14, 2.5, 0.85,
    [("daily_reports", {"size": 10.5, "bold": True}), ("\n", {}),
     ("customer_id = 'x9…'", {"font": MONO, "size": 9.5})],
    fill=WHITE, border=LINE, size=10.5)
box(s, ML + 3.3, 2.14, 2.5, 0.85,
    [("customers(U社)", {"size": 10.5, "bold": True, "color": PINK}), ("\n", {}),
     ("id = 'x9…'", {"font": MONO, "size": 9.5})],
    fill=WHITE, border=PINK, size=10.5)
arrow(s, (ML + 2.8, 2.56), (ML + 3.25, 2.56), color=RED, width=1.8)
box(s, ML + 2.55, 3.1, 0.5, 0.42, "✕", fill=RED, border=None, color=WHITE, size=15, bold=True)
text(s, ML + 0.25, 3.62, 5.55, 1.2,
     "T社の作業中にU社の顧客IDを書き込んでも、参照先が実在するためデータベースは通してしまう。"
     "「T社の日報がU社の顧客を指す」行が生まれ、しかも RLS で見えないので気づけない。",
     size=11, color=INK, line=1.32)

# After
rect(s, ML + 6.33, 1.68, 6.0, 2.9, fill=GREEN_L, border=None)
text(s, ML + 6.53, 1.76, 5.6, 0.28, "対策後:(tenant_id, id) の2列セットで参照", size=12,
     color=GREEN, bold=True)
box(s, ML + 6.58, 2.14, 2.5, 0.85,
    [("daily_reports", {"size": 10.5, "bold": True}), ("\n", {}),
     ("(tenant_id='T社',", {"font": MONO, "size": 9.5}), ("\n", {}),
     (" customer_id='x9…')", {"font": MONO, "size": 9.5})],
    fill=WHITE, border=GREEN, size=10.5)
box(s, ML + 9.63, 2.14, 2.5, 0.85,
    [("customers", {"size": 10.5, "bold": True}), ("\n", {}),
     ("UNIQUE(tenant_id, id)", {"font": MONO, "size": 9})],
    fill=WHITE, border=GREEN, size=10.5)
arrow(s, (ML + 9.13, 2.56), (ML + 9.58, 2.56), color=GREEN, width=1.8)
box(s, ML + 8.88, 3.1, 0.5, 0.42, "✓", fill=GREEN, border=None, color=WHITE, size=15, bold=True)
text(s, ML + 6.58, 3.62, 5.55, 1.2,
     "「T社 かつ そのID」の組み合わせが参照先に無ければ、データベースが書き込みを拒否する。"
     "アプリにバグがあっても、法人を跨いだ紐付けは物理的に作れない。",
     size=11, color=INK, line=1.32)

text(s, ML, 4.72, CW, 0.3, "この形を適用した参照(全7本)", size=12, color=INK, bold=True)
rows = [["daily_reports → staff / customers", "accident_reports → staff / customers",
         "receipts → staff / customers(顧客は空可)"],
        ["attendance_days → staff(給与に直結するため特に重要)", "family_members → customers",
         "sessions / password_reset_codes → staff"]]
for r_i, row in enumerate(rows):
    for c_i, cell in enumerate(row):
        box(s, ML + c_i * 4.13, 5.04 + r_i * 0.5, 3.95, 0.42, cell, fill=WHITE, border=LINE,
            size=10.5, align=PP_ALIGN.LEFT)
note(s, ML, 6.05, CW, 0.85, "補足",
     "この落とし穴は 2026-08 のレビューでご指摘いただいて塞いだものです。参照先には UNIQUE(tenant_id, id) を追加してあります。"
     "ON DELETE は全て no action(親を消せない)にしており、廃棄はテナント単位の物理削除で行う方針です。",
     accent=ACCENT, fill=ACCENT_L, size=11)

# ══════════════════════════════════════════════════════════════
# 13. データ保護の線引き
# ══════════════════════════════════════════════════════════════
s = sl_("データ保護の線引き", "2026-09に方針変更:アプリ側で暗号化するのは資格情報だけにした",
        source="doc/09 1.3節 / packages/db/src/schema/appSettings.ts")
rect(s, ML, 1.25, 6.0, 2.5, fill=WHITE, border=RED, border_w=1.5)
text(s, ML + 0.2, 1.33, 5.6, 0.28, "アプリで暗号化する(3列だけ)", size=12, color=RED, bold=True)
bullets(s, ML + 0.2, 1.68, 5.6, 1.95, [
    {"t": [("app_settings.gemini_api_key", {"font": MONO, "size": 10.5}),
           ("  Gemini APIキー", {"size": 10.5, "color": MUTED})]},
    {"t": [("gchat_report_webhook_url", {"font": MONO, "size": 10.5}),
           ("  通知先URL", {"size": 10.5, "color": MUTED})]},
    {"t": [("gchat_receipt_webhook_url", {"font": MONO, "size": 10.5}),
           ("  通知先URL", {"size": 10.5, "color": MUTED})]},
    {"t": "理由:個人情報ではなく検索の対象外。一方でデータベースの中身が流出すると"
          "被害が外部サービスまで広がるため", "s": 10.5, "c": INK},
], size=10.5, line=1.3, gap=6)

rect(s, ML + 6.33, 1.25, 6.0, 2.5, fill=WHITE, border=GREEN, border_w=1.5)
text(s, ML + 6.53, 1.33, 5.6, 0.28, "平文で持つ(業務データすべて)", size=12, color=GREEN, bold=True)
bullets(s, ML + 6.53, 1.68, 5.6, 1.95, [
    {"t": "顧客・世帯構成員・日報・事故報告・勤怠・領収書"},
    {"t": "理由① 検索・集計・全文検索をSQLでできるようにする(暗号文のままでは"
          "1語探すのに全件復号が必要)"},
    {"t": "理由② 日報を機械的に読む用途(傾向分析・要約)で、復号の配線を分析側まで広げたくない"},
    {"t": "理由③ 秘密保持契約が求めるのは「アクセス制限・通信と保存時の暗号化・パスワード管理」で、"
          "列単位の暗号化は要求されていない"},
], size=10.5, line=1.3, gap=6)

text(s, ML, 3.95, CW, 0.3, "では業務データは何で守るのか — 4枚重ね", size=12.5, color=INK, bold=True)
layers = [
    ("① 認証・権限", "ログインとセッション、\n管理者限定API", GREEN, GREEN_L, "実装済み"),
    ("② RLS + ロール分離", "他社の行は見えない。\n所有者ロールにもFORCE", GREEN, GREEN_L, "実装済み"),
    ("③ 通信の暗号化(TLS)", "ブラウザ〜API〜DBの\n通信を暗号化", AMBER, AMBER_L, "本番配備時"),
    ("④ 保存時の暗号化", "Cloud SQLの既定機能。\nバックアップも含む", RED, RED_L, "本番未配備"),
]
cx = ML
for ttl, body, col, fl, st in layers:
    w = 2.98
    rect(s, cx, 4.28, w, 1.3, fill=fl, border=None)
    rect(s, cx, 4.28, 0.075, 1.3, fill=col, border=None, shape=MSO_SHAPE.RECTANGLE)
    text(s, cx + 0.18, 4.36, w - 0.36, 0.25, ttl, size=11, color=col, bold=True)
    text(s, cx + 0.18, 4.63, w - 0.36, 0.6, body, size=10.5, color=INK, line=1.3)
    badge(s, cx + 0.18, 5.22, 1.35, 0.26, st, color=col, fill=WHITE, size=9.5)
    cx += w + 0.14

note(s, ML, 5.75, CW, 1.1,
     "ここが最大の論点です(第3章 論点②)",
     "業務データを平文にした判断は、④の保存時暗号化が本番で実際に効くことを前提にしています。"
     "ところが本番(Cloud Run + Cloud SQL)は未配備で、いま動いているのはローカル開発(Docker、保存時暗号化なし)と"
     "公開デモ(ブラウザ内DB、鍵は公開の固定値)だけです。この前提の置き方が妥当かをご判断いただきたいです。",
     accent=RED, fill=RED_L)

# ══════════════════════════════════════════════════════════════
# 14. 封筒暗号化
# ══════════════════════════════════════════════════════════════
s = sl_("資格情報の暗号化のしくみ", "封筒暗号化(鍵を鍵で包む)/ 対象は app_settings の3列だけ",
        source="packages/core/src/ports/kms.ts, packages/integrations/src/local-crypto / doc/09 第3章")
text(s, ML, 1.22, CW, 0.3,
     "「鍵を1本だけ使う」と、その1本が漏れたら全社分が読めてしまう。そこで法人ごとに別の鍵を作り、"
     "その鍵自体をさらに上位の鍵で包んで保管する。",
     size=12, color=INK)
y = 1.68
box(s, ML, y, 3.2, 1.0,
    [("KEK(鍵を包む鍵)", {"size": 11.5, "bold": True, "color": VIOLET}), ("\n", {}),
     ("現状:環境変数に1本", {"size": 10.5}), ("\n", {}),
     ("本番想定:Cloud KMS(未実装)", {"size": 10, "color": RED})],
    fill=VIOLET_L, border=VIOLET, size=10.5)
box(s, ML + 4.0, y, 3.6, 1.0,
    [("DEK(データを暗号化する鍵)", {"size": 11.5, "bold": True, "color": ACCENT}), ("\n", {}),
     ("法人ごとにランダム生成", {"size": 10.5}), ("\n", {}),
     ("包まれた状態でのみDBに保存", {"size": 10.5})],
    fill=ACCENT_L, border=ACCENT, size=10.5)
box(s, ML + 8.4, y, 3.93, 1.0,
    [("暗号文(app_settings 3列)", {"size": 11.5, "bold": True, "color": GREEN}), ("\n", {}),
     ("xxx_ciphertext と xxx_key_version", {"size": 10, "font": MONO}), ("\n", {}),
     ("必ず2列ペア。どの世代の鍵で暗号化したかを必ず記録", {"size": 10})],
    fill=GREEN_L, border=GREEN, size=10.5)
arrow(s, (ML + 3.25, y + 0.5), (ML + 3.95, y + 0.5), color=VIOLET, width=1.8)
text(s, ML + 3.15, y + 0.12, 0.95, 0.3, "包む", size=9.5, color=VIOLET, align=PP_ALIGN.CENTER)
arrow(s, (ML + 7.65, y + 0.5), (ML + 8.35, y + 0.5), color=ACCENT, width=1.8)
text(s, ML + 7.55, y + 0.12, 0.95, 0.3, "暗号化", size=9.5, color=ACCENT, align=PP_ALIGN.CENTER)

text(s, ML, 2.95, 6.0, 0.3, "鍵の世代を並存させている(tenant_keys)", size=12, color=INK, bold=True)
table(s, ML, 3.27, 6.0, ["tenant_id", "dek_version", "wrapped_dek", "使い方"],
      [["T社", "1", "(包まれた鍵)", "古い暗号文の復号に使う"],
       ["T社", "2", "(包まれた鍵)", "新しい暗号化は常に最新世代"]],
      col_w=[1.0, 1.2, 1.6, 2.2], size=10, hsize=9.5, row_h=0.3, header_h=0.3)
bullets(s, ML, 4.25, 6.0, 1.3, [
    {"t": "1法人1行だと、鍵を交換した瞬間に既存の暗号文が全部読めなくなる(=交換が実質不可能)"},
    {"t": "解約時はこの行を無効化すれば、バックアップに残った暗号文も復号できなくなる(暗号学的削除)"},
], size=10.5, line=1.3, gap=5)

card(s, ML + 6.33, 2.95, 6.0, 1.6, "この形にした理由(2026-08のレビュー反映)", accent=ACCENT, items=[
    {"t": "以前は「マスター鍵 + 法人ID」から鍵を計算する方式だった。これはマスター鍵が漏れれば"
          "全法人の鍵を誰でも再現できるため、実質1本の鍵と同じだった"},
    {"t": "法人ごとに独立生成した鍵を包んで保存する形に変更した"},
], body_size=10.5)
note(s, ML + 6.33, 4.7, 6.0, 0.85, "本番のKEKは未実装(論点⑥)",
     "Cloud KMSへの差し替え口は用意してあるが、中身は環境変数のまま。"
     "鍵の物理分離とKMS側の監査という主要な利点は未実現。",
     accent=RED, fill=RED_L, size=10.5)
note(s, ML, 5.75, CW, 1.1, "ご相談したいこと(論点⑥)",
     "世代を並存させたので鍵の交換自体はできますが、既存データを新しい世代へ移す「再暗号化バッチ」を作っていません。"
     "読めなくはならない代わりに、古い世代の鍵をいつまでも捨てられない状態です。"
     "オンラインで少しずつ再暗号化するのと、停止時間を取って一括で流すのと、どちらが定石でしょうか。",
     accent=VIOLET, fill=VIOLET_L)

# ══════════════════════════════════════════════════════════════
# 15. トランザクションとOutbox
# ══════════════════════════════════════════════════════════════
s = sl_("揃って成立させる仕組み", "日報1本を保存するとき、何と何を同時に確定させているか",
        source="packages/core/src/usecases/reports.ts, ports/unitOfWork.ts / doc/09 1.4節")
box(s, ML, 1.3, 1.9, 0.75, "画面\n(日報を保存)", fill=WHITE, border=LINE, size=10.5)
rect(s, ML + 2.2, 1.22, 5.3, 1.5, fill=GREEN_L, border=GREEN, border_w=1.8, dash=True)
text(s, ML + 2.35, 1.28, 4.0, 0.24, "1つのトランザクション(揃って確定)", size=10, color=GREEN,
     bold=True)
box(s, ML + 2.4, 1.56, 2.35, 0.5, "daily_reports に1行", fill=WHITE, border=GREEN, size=10.5)
box(s, ML + 2.4, 2.12, 2.35, 0.5, "outbox_jobs に1行", fill=WHITE, border=GREEN, size=10.5)
box(s, ML + 5.0, 1.56, 2.35, 1.06, "COMMIT\n両方 or どちらも無し", fill=WHITE, border=GREEN,
    color=GREEN, size=10.5, bold=True)
arrow(s, (ML + 4.8, 2.06), (ML + 4.95, 2.06), color=GREEN, width=1.5)
arrow(s, (ML + 1.95, 1.65), (ML + 2.35, 1.65), color=MUTED, width=1.5)

box(s, ML + 7.85, 1.22, 2.1, 0.65, "ミラーワーカー\n(別プロセス)", fill=ORANGE_L, border=ORANGE,
    color=ORANGE, size=10.5, bold=True)
box(s, ML + 10.25, 1.22, 2.08, 0.65, "GAS ブリッジ →\nスプレッドシート", fill=WHITE, border=LINE,
    size=10.5)
arrow(s, (ML + 7.55, 1.55), (ML + 7.8, 1.55), color=ORANGE, width=1.5)
arrow(s, (ML + 10.0, 1.55), (ML + 10.2, 1.55), color=ORANGE, width=1.5)
text(s, ML + 7.85, 1.95, 4.45, 0.75,
     "outbox_jobs から未処理の行を取り出して送る。失敗しても捨てず、5秒から倍々(上限1時間)で"
     "再試行し、8回で失敗扱いにして運用が気づけるようにする。",
     size=10, color=MUTED, line=1.3)

text(s, ML, 2.95, CW, 0.28, "outbox_jobs(送信待ち行列)の状態遷移", size=12, color=INK, bold=True)
st = [("pending", "送信待ち", ACCENT, ACCENT_L), ("processing", "送信中", VIOLET, VIOLET_L),
      ("done", "送信完了", GREEN, GREEN_L), ("failed", "8回失敗(要手動対応)", RED, RED_L)]
cx = ML
for i, (nm, sub, col, fl) in enumerate(st):
    box(s, cx, 3.28, 2.35, 0.62, [(nm, {"size": 11, "bold": True, "font": MONO}), ("\n", {}),
                                  (sub, {"size": 9.5})], fill=fl, border=col, color=col, size=10.5)
    if i < 3:
        arrow(s, (cx + 2.4, 3.59), (cx + 2.85, 3.59), color=MUTED, width=1.5)
    cx += 2.9
arrow(s, (ML + 3.5, 3.95), (ML + 1.2, 3.95), color=AMBER, width=1.5, elbow=True)
text(s, ML + 1.3, 4.0, 4.5, 0.3, "失敗 → 待ち時間を延ばして pending に戻す", size=10, color=AMBER)
text(s, ML + 8.7, 4.0, 3.6, 0.5, "処理中のまま5分放置された行は、\n再び取り出し対象になる(ワーカー異常終了の回収)",
     size=10, color=MUTED, line=1.3)

card(s, ML, 4.62, 6.0, 1.2, "同一トランザクションにしているのは2種類だけ", accent=GREEN, items=[
    {"t": "日報 / 事故報告 / 勤怠 / 領収書の保存 + 送信待ち行列への積み込み"},
    {"t": "パスワード再設定コードの使用済み化 + 新しいパスワードの書き込み"},
], body_size=10.5)
note(s, ML + 6.33, 4.62, 6.0, 1.2, "テストで固定していること",
     "送信待ち行列への書き込みだけを失敗させたとき、日報の行が残らないことを検証しています"
     "(片方だけ成立する状態を作らない、という設計意図が壊れたら落ちる)。",
     accent=ACCENT, fill=ACCENT_L, size=10.5)
note(s, ML, 5.9, CW, 1.0, "なぜ「Outbox」という形にするのか",
     "スプレッドシートへの送信をその場で行うと、送信が失敗したときに日報の保存まで巻き戻すか、"
     "送信を諦めるかの二択になります。いったんデータベースに「送る予定」として書いておけば、"
     "保存は確実に完了させたうえで、送信は後から何度でも再試行できます。",
     accent=ACCENT, fill=ACCENT_L)

# ══════════════════════════════════════════════════════════════
# 16. スキーマ共通ルール
# ══════════════════════════════════════════════════════════════
s = sl_("13テーブルで守っている共通ルール", "表ごとに判断がぶれないよう、形を決めてある",
        source="doc/09 / packages/db/src/schema/*.ts のコメントに理由を記載")
left = [
    ("主キーは必ず uuid のランダム値", "連番にしない。件数が外から推測できず、採番の集中点も作らない"),
    ("日時は必ず timestamptz", "タイムゾーン付き。業務上の「日」だけ date(勤怠の business_date)"),
    ("派生値は保存しない", "残業時間・移動距離などは入力値から毎回計算する。二重管理を作らない"),
    ("削除しない", "顧客の退会は deactivated_at を立てるだけ。物理削除の経路を持たない"),
]
right = [
    ("参照はすべて2列セットの外部キー", "(tenant_id, xxx_id) → (tenant_id, id)。法人跨ぎを構造的に防ぐ"),
    ("索引・一意制約は tenant_id を先頭に", "staff(tenant_id, email) / customers(tenant_id, family_name)"),
    ("外部システム由来の値は隔離する", "external_source + external_id にまとめ、その組で一意にする"),
    ("マイグレーションは前に進むだけ", "0000〜0007の8本。戻す手順(down)は持たない"),
]
for col_i, group in enumerate([left, right]):
    x = ML + col_i * 6.33
    for i, (ttl, body) in enumerate(group):
        y = 1.28 + i * 1.0
        rect(s, x, y, 6.0, 0.88, fill=WHITE, border=LINE)
        rect(s, x, y, 0.075, 0.88, fill=ACCENT if col_i == 0 else GREEN, border=None,
             shape=MSO_SHAPE.RECTANGLE)
        text(s, x + 0.22, y + 0.11, 5.6, 0.26, ttl, size=11.5,
             color=ACCENT if col_i == 0 else GREEN, bold=True)
        text(s, x + 0.22, y + 0.41, 5.65, 0.44, body, size=10.5, color=INK, line=1.3)

note(s, ML, 5.42, 6.0, 1.4, "この規約のおかげで楽になっていること",
     "新しい表を足すときに考えることが少ない(同じ形をコピーすればよい)。"
     "RLSの張り忘れはCIが機械的に検出する。第4章で足す予定の予約・請求も、この形に載せる想定です。",
     accent=GREEN, fill=GREEN_L)
note(s, ML + 6.33, 5.42, 6.0, 1.4, "規約の副作用も出ている(第3章)",
     "「派生値を保存しない」は二重管理を防ぐ一方、月次集計を毎回全件計算することになります。"
     "「削除しない」は事故を防ぐ一方、廃棄の手順を別に整備しないと契約上の返還・削除義務を果たせません。",
     accent=AMBER, fill=AMBER_L)

# ══════════════════════════════════════════════════════════════
# 17. 第3章 divider
# ══════════════════════════════════════════════════════════════
sec_("第 3 章", "設計上の問題点(自己申告)",
     "気づいている弱点を6件並べます。ここが今回いちばんご意見をいただきたい部分です")

# ══════════════════════════════════════════════════════════════
# 18. 問題① customers 35列
# ══════════════════════════════════════════════════════════════
s = sl_("問題① customers が35列に肥大化している", "外部CSVの全項目を1枚の表で受けた結果",
        source="packages/db/src/schema/customers.ts / doc/09 4.1節", accent=RED)
text(s, ML, 1.2, CW, 0.3,
     "外部予約システム(RESERVA)の顧客CSVを「1項目も落とさず取り込む」方針にしたため、CSVの列がほぼそのまま列になっている。",
     size=12, color=INK)
cats = [
    ("識別子", 4, "id / tenant_id / 取込元 / 取込元ID", ACCENT),
    ("氏名", 5, "表示名 / 姓 / 名 / かな2種", ACCENT),
    ("連絡先・住所", 7, "メール / 電話 / 市区 / 住所 / 駐車場2種 / 第2住所", VIOLET),
    ("第三者情報・位置・自由記述", 5, "緊急連絡先 / 続柄 / 避難場所 / メモ / 緯度経度", PINK),
    ("他システムの会員証", 1, "Benefit会員ID", PINK),
    ("運用区分", 6, "会員種別 / 状態 / 支払方法 / 支払状況 / 性別 / 年代", GREEN),
    ("日時", 7, "登録日 / 外部更新日 / 第2住所の期間2列 / 退会日 / 作成・更新", MUTED),
]
text(s, ML, 1.58, 5.9, 0.28, "現状:1枚に7カテゴリが同居している", size=12, color=RED, bold=True)
yy = 1.9
for nm, n, cols, col in cats:
    rect(s, ML, yy, 5.9, 0.42, fill=WHITE, border=LINE)
    rect(s, ML, yy, 0.06, 0.42, fill=col, border=None, shape=MSO_SHAPE.RECTANGLE)
    text(s, ML + 0.16, yy + 0.06, 2.1, 0.3, nm, size=10.5, color=col, bold=True)
    text(s, ML + 2.28, yy + 0.06, 0.55, 0.3, f"{n}列", size=10.5, color=INK, bold=True,
         align=PP_ALIGN.RIGHT)
    text(s, ML + 2.95, yy + 0.09, 2.9, 0.3, cols, size=9, color=MUTED)
    yy += 0.5
box(s, ML, yy, 5.9, 0.36, "合計 35列(1テーブル)", fill=RED_L, border=None, color=RED, size=11.5,
    bold=True)

text(s, ML + 6.33, 1.58, 6.0, 0.28, "分けるとしたらこうなる(案)", size=12, color=GREEN, bold=True)
future = [
    ("customers(コア)", "識別子・氏名・状態など、必ず要る12列前後", GREEN),
    ("customer_contacts", "連絡先・住所・駐車場。第2住所は期間付きの別行にできる", ACCENT),
    ("customer_emergency", "緊急連絡先・続柄・避難場所(第三者の個人情報)", PINK),
    ("customer_external_refs", "取込元ID・Benefit会員ID など他システムの識別子", VIOLET),
]
yy2 = 1.88
for nm, body, col in future:
    rect(s, ML + 6.33, yy2, 6.0, 0.63, fill=WHITE, border=col, border_w=1.2)
    text(s, ML + 6.5, yy2 + 0.04, 5.6, 0.26, nm, size=10.5, color=col, bold=True, font=MONO)
    text(s, ML + 6.5, yy2 + 0.29, 5.7, 0.32, body, size=10, color=INK, line=1.25)
    yy2 += 0.7
card(s, ML + 6.33, yy2 + 0.06, 6.0, 1.35, "分けた場合に払う代償", accent=AMBER, items=[
    {"t": "顧客1件を表示するだけでJOIN(表の結合)が増え、コードもクエリも長くなる"},
    {"t": "CSVの1行=1テーブルの1行という素直な対応が崩れ、取込処理が複雑になる"},
    {"t": "分ける単位を間違えると、後から直すコストは今より高くなる"},
], body_size=10.5)
note(s, ML, 6.13, CW, 0.8, "ご相談したいこと(相談①)",
     "「35列は多すぎるので分けるべき」か、「顧客マスタなら35列は普通で分けるほうが害」か。判断の基準"
     "(何列を超えたら、どういう単位で分けるか)をご教示いただきたいです。運用前なので、分けるなら今が最も安いタイミングです。",
     accent=RED, fill=RED_L, size=11)

# ══════════════════════════════════════════════════════════════
# 19. 問題② 平文化の代償
# ══════════════════════════════════════════════════════════════
s = sl_("問題② 業務データを平文にした代償", "検索性とAI活用を取り、その分の守りを外部環境に預けた",
        source="doc/09 1.3節・3.4節", accent=RED)
card(s, ML, 1.25, 6.0, 1.85, "得たもの", accent=GREEN, items=[
    {"t": "SQLで直接検索・集計・匿名化できる(報告書作成や統計化が実装しやすい)"},
    {"t": "日報テキストをAIで扱える。復号の配線を分析側まで広げなくてよい"},
    {"t": "領収書の重複検出が単純な文字列一致で済むようになった(HMACの別鍵を廃止)"},
], body_size=10.5)
card(s, ML + 6.33, 1.25, 6.0, 1.85, "引き受けたもの", accent=RED, items=[
    {"t": "データベースに直接届く経路があれば、業務データはそのまま読める"},
    {"t": "「誰がどのデータを見たか」の記録が資格情報の復号時にしか残らない"},
    {"t": "保存時の暗号化は本番の基盤(Cloud SQL)頼み。その本番がまだ無い"},
], body_size=10.5)

text(s, ML, 3.3, CW, 0.28, "データに到達する3つの経路と、それぞれの守り", size=12, color=INK,
     bold=True)
paths = [
    ("経路A アプリ経由", "ログイン → 権限チェック → RLS", "守れている", GREEN, GREEN_L,
     "記録も残る(認証・権限イベントは「誰が・誰を」まで)"),
    ("経路B データベースに直接", "psql や管理ツールからの接続", "IAM・ロール分離のみ", AMBER, AMBER_L,
     "平文なので中身は読める。DB側の監査(pgaudit等)は未導入"),
    ("経路C バックアップ・ダンプ", "流出した場合", "保存時暗号化のみ", RED, RED_L,
     "その保存時暗号化が本番未配備。資格情報だけは暗号文のまま守られる"),
]
cx = ML
for ttl, how, guard, col, fl, body in paths:
    w = 3.98
    rect(s, cx, 3.62, w, 1.65, fill=WHITE, border=col, border_w=1.3)
    rect(s, cx, 3.62, w, 0.4, fill=col, border=None, shape=MSO_SHAPE.RECTANGLE)
    fill_text(rect(s, cx, 3.62, w, 0.4, fill=col, border=None, shape=MSO_SHAPE.RECTANGLE),
              ttl, size=11, color=WHITE, bold=True)
    text(s, cx + 0.18, 4.1, w - 0.36, 0.28, how, size=10, color=MUTED)
    text(s, cx + 0.18, 4.38, w - 0.36, 0.28, "守り:" + guard, size=10.5, color=col, bold=True)
    text(s, cx + 0.18, 4.66, w - 0.36, 0.55, body, size=10, color=INK, line=1.3)
    cx += w + 0.19

text(s, ML, 5.45, CW, 0.28, "いま実際に動いている3つの環境", size=12, color=INK, bold=True)
table(s, ML, 5.75, CW, ["環境", "データベース", "保存時の暗号化", "状態"],
      [["ローカル開発", "Docker の PostgreSQL", "なし", "稼働中"],
       ["公開デモ", "ブラウザ内(PGlite)", "なし。鍵は公開の固定値", "稼働中"],
       ["本番", "Cloud Run + Cloud SQL", "Cloud SQL の既定機能で満たす想定", "未配備"]],
      col_w=[1.6, 3.4, 5.0, 1.4], size=10.5, hsize=10.5, row_h=0.3, header_h=0.32,
      cell_colors={(2, 3): RED, (0, 2): AMBER, (1, 2): AMBER, (2, 2): MUTED}, first_bold=True)

# ══════════════════════════════════════════════════════════════
# 20. 問題③ 勤怠 jsonb
# ══════════════════════════════════════════════════════════════
s = sl_("問題③ 勤怠だけJSONを1列に押し込んでいる", "給与に直結する領域なのに、構造がデータベースから読めない",
        source="packages/db/src/schema/attendanceDays.ts", accent=RED)
text(s, ML, 1.2, CW, 0.3,
     "日報・事故報告は項目ごとの列に分けたが、勤怠は1日分をJSONのまま1列(row_data)に入れている。",
     size=12, color=INK)
text(s, ML, 1.58, 6.0, 0.28, "現状 attendance_days.row_data(jsonb)", size=12, color=RED, bold=True)
rect(s, ML, 1.9, 6.0, 1.35, fill=CARD, border=LINE)
text(s, ML + 0.2, 2.0, 5.6, 1.15,
     '{ "C": "9:00", "D": "18:00", "E": "60",\n  "F": "訪問", "G": "12.4", … }',
     size=11.5, color=INK, font=MONO, line=1.4)
text(s, ML + 0.2, 2.72, 5.6, 0.45,
     "キーはスプレッドシートの列記号。意味はアプリ側のコードにしか書かれていない。",
     size=10, color=MUTED, line=1.3)
bullets(s, ML, 3.35, 6.0, 1.9, [
    {"t": "そうした理由:キーが動的で、常に「1日分をまるごと読み書き」する用途しかなく、"
          "分解する利点が無かった"},
    {"t": "残業時間・移動距離などの計算結果は保存せず、毎回このJSONから計算している"},
    {"t": "jsonb なので、必要になればSQLから個別キーを参照することもできる"},
], size=11, line=1.32, gap=6)

text(s, ML + 6.33, 1.58, 6.0, 0.28, "この形の弱点", size=12, color=RED, bold=True)
weak = [
    ("型のチェックがデータベース側で効かない", '"9:00" のところに文字化けや空文字が入っても、DBは受け入れる'),
    ("列の意味がDBから読めない", '"C" が何かを知るにはアプリのコードを読むしかない。社労士への説明もしづらい'),
    ("集計がしにくい", "「残業が多い月」を出すには全行のJSONを読んで計算する必要がある"),
    ("スプレッドシートの列構成に縛られる", "元のテンプレートの列記号に依存しており、様式変更に弱い"),
]
yy = 1.88
for ttl, body in weak:
    rect(s, ML + 6.33, yy, 6.0, 0.74, fill=WHITE, border=RED, border_w=1.1)
    text(s, ML + 6.5, yy + 0.05, 5.65, 0.26, ttl, size=11, color=RED, bold=True)
    text(s, ML + 6.5, yy + 0.32, 5.7, 0.38, body, size=10, color=INK, line=1.28)
    yy += 0.82
note(s, ML, 5.24, CW, 0.8, "とくに気になっている点",
     "勤怠は給与計算に直結します。現在は旧システム(Google Apps Script版)と同じ計算結果になることを"
     "合成データ19ケースで確認していますが、実際の出勤簿での照合はまだ行っていません。",
     accent=AMBER, fill=AMBER_L, size=11)
note(s, ML, 6.12, CW, 0.8, "ご相談したいこと(相談③)",
     "給与直結の勤怠を、日報と同じように項目ごとの列へ分解すべきでしょうか。"
     "1日分をまるごと扱う使い方ならJSONのままで足りるでしょうか。判断の分かれ目をご教示ください。",
     accent=RED, fill=RED_L, size=11)

# ══════════════════════════════════════════════════════════════
# 21. 問題④ 金額が文字列
# ══════════════════════════════════════════════════════════════
s = sl_("問題④ 金額を文字列型で持っている", "領収書の金額が text。請求機能を載せる前に直すべきか",
        source="packages/db/src/schema/receipts.ts / doc/07 第6章は「金額は整数」と書いている",
        accent=RED)
text(s, ML, 1.2, CW, 0.3,
     "領収書の金額は、OCRで読み取った文字列をそのまま text 列に入れている。集計や請求の計算には使えない形。",
     size=12, color=INK)
text(s, ML, 1.6, 6.0, 0.28, "現状 receipts の主な列", size=12, color=RED, bold=True)
table(s, ML, 1.9, 6.0, ["列", "型", "中身"],
      [["amount", "text", '"1,000" や "1000円" のような文字列'],
       ["store_name", "text", "店舗名(正規化済み)"],
       ["dedupe_key", "text", "重複検出用の正規化文字列"],
       ["customer_id", "uuid(空可)", "顧客に紐付かない経費もあるため"],
       ["file_key", "text", "画像の保存キー(実体はGCS想定)"]],
      col_w=[1.6, 1.5, 3.4], size=10.5, hsize=10.5, row_h=0.3, header_h=0.32,
      cell_colors={(0, 1): RED, (0, 2): RED}, first_bold=True)
bullets(s, ML, 3.75, 6.0, 1.5, [
    {"t": "「1,000」と「1000」が別の値になり、合計が出せない"},
    {"t": "「1000円」のような値が入っても、データベースは受け入れてしまう"},
    {"t": "請求書を作る段階では必ず数値が必要になる"},
], size=11, line=1.32, gap=6)

card(s, ML + 6.33, 1.6, 6.0, 2.0, "提案書(doc/07 第6章)に書いていること", accent=ACCENT, items=[
    {"t": [("「金額は常に整数(銭単位)で保持し、浮動小数は使わない」", {"bold": True})]},
    {"t": "請求明細の金額は生成列(データベースが計算して保証する列)にし、"
          "合計値との不整合はコミット時に検証する、とも書いている"},
    {"t": "つまり請求機能を作る段階の方針は決めてあるのに、いま入っている領収書の金額はその方針に合っていない"},
], body_size=10.5)
card(s, ML + 6.33, 3.75, 6.0, 1.5, "直すなら(運用前なので破壊的変更が可能)", accent=GREEN, items=[
    {"t": [("amount_yen integer", {"font": MONO, "bold": True}), (" に変更し、OCRの生文字列は "
                                                                  "別列(", {}),
           ("amount_raw text", {"font": MONO}), (")に残す", {})]},
    {"t": "読み取れなかった場合は空(null)を許し、あとから人が直せるようにする"},
], body_size=10.5)
note(s, ML, 5.32, CW, 0.8, "同じ問題が他にもある可能性",
     "勤怠の row_data も時刻・距離を文字列で持っています(\"9:00\" / \"12.4\")。"
     "「外部システムから来た文字列をそのまま入れる」という判断が、あとから型を必要とする場所で"
     "詰まる可能性があります。",
     accent=AMBER, fill=AMBER_L, size=11)
note(s, ML, 6.16, CW, 0.8, "ご相談したいこと(相談④)",
     "金額・時刻・距離のような「計算に使う値」は、取り込み時点で数値へ正規化すべきでしょうか。"
     "変換できなかった値の扱い(取り込みを止める / 空にして人が直す / 生文字列を併存)の定石もご教示ください。",
     accent=RED, fill=RED_L, size=11)

# ══════════════════════════════════════════════════════════════
# 22. 問題⑤ 小さな設計負債
# ══════════════════════════════════════════════════════════════
s = sl_("問題⑤ 小さな設計負債", "気づいているが、まだ手を付けていないもの",
        source="doc/09 3.4節 / README「フェーズ状況」", accent=RED)
rows = [
    ["updated_at をアプリが更新している", "更新日時の列は、アプリのコードが毎回セットしている。"
     "データベースのトリガーは無い",
     "管理ツールから直接UPDATEすると、更新日時が古いまま残る。"
     "スプレッドシートへの同期キーにも使っているため、取り残しの原因になりうる", "中"],
    ["tenants だけRLSの対象外", "ログイン前に法人を特定する必要があるため、この表だけ絞り込みを外している",
     "アプリのロールが全法人の一覧を読める。法人名は個人情報ではないが、"
     "顧客リストの規模感は推測できてしまう", "低"],
    ["ON DELETE がすべて no action", "親(顧客・スタッフ)を消せない。廃棄はテナント単位の物理削除で行う方針",
     "契約上の返還・廃棄義務(秘密保持契約 第7条)に対する具体的な手順とバックアップ保持期間が未整備", "高"],
    ["派生値を持たない方針の裏返し", "残業時間・月次集計などを毎回全件計算している",
     "件数が増えたときの性能を実運用の量で確認していない。負荷試験・障害注入は未実施", "中"],
    ["実PostgreSQLに対する検証が薄い", "リポジトリ層のテストはブラウザ内DB(PGlite)で行っている",
     "本番ドライバ(postgres-js)固有の挙動差、コネクションプールと SET LOCAL の組み合わせを"
     "実環境で確認していない", "中"],
]
table(s, ML, 1.28, CW, ["項目", "現状", "何が困るか", "重さ"], rows,
      col_w=[2.6, 3.5, 5.4, 0.75], size=10, hsize=10.5, row_h=0.86, header_h=0.33,
      first_bold=True,
      cell_colors={(2, 3): RED, (0, 3): AMBER, (3, 3): AMBER, (4, 3): AMBER, (1, 3): MUTED},
      aligns=[PP_ALIGN.LEFT, PP_ALIGN.LEFT, PP_ALIGN.LEFT, PP_ALIGN.CENTER])
note(s, ML, 6.0, CW, 0.9, "ご相談したいこと(相談⑤)",
     "この5件の優先順位付けが妥当かをご確認いただきたいです。特に「ON DELETE と廃棄手順」を最優先に置いていますが、"
     "運用開始前に必ず整備すべきものと、動かしながら直せるものの線引きをご教示いただけると助かります。",
     accent=RED, fill=RED_L)

# ══════════════════════════════════════════════════════════════
# 23. 問題⑥ 鍵管理と監査
# ══════════════════════════════════════════════════════════════
s = sl_("問題⑥ 鍵管理と監査が本番相当でない", "形はできているが、中身が開発用のまま",
        source="doc/09 3.4節 / packages/core/src/ports/kms.ts, audit.ts", accent=RED)
text(s, ML, 1.22, 6.0, 0.28, "鍵の置き場所:現状と本番想定", size=12, color=INK, bold=True)
box(s, ML, 1.55, 2.85, 1.15, "現状\n環境変数に KEK 1本\n(.env ファイル)", fill=RED_L, border=RED,
    color=RED, size=11, bold=True)
box(s, ML + 3.15, 1.55, 2.85, 1.15, "本番想定\nCloud KMS\n(差し替え口のみ用意)", fill=CARD,
    border=LINE, color=MUTED, size=11, bold=True, dash=True)
arrow(s, (ML + 2.9, 2.12), (ML + 3.1, 2.12), color=MUTED, width=1.6, dash=True)
bullets(s, ML, 2.82, 6.0, 1.5, [
    {"t": "鍵の物理分離とKMS側の監査という、封筒暗号化の主要な利点が未実現"},
    {"t": "再暗号化バッチが無いため、古い世代の鍵を捨てられない(対象は資格情報3列のみ)"},
    {"t": "差し替えは実装1か所の置き換えで済む設計にはしてある"},
], size=11, line=1.32, gap=6)

text(s, ML + 6.33, 1.22, 6.0, 0.28, "監査ログ:何が残り、何が残らないか", size=12, color=INK,
     bold=True)
table(s, ML + 6.33, 1.55, 6.0, ["操作", "記録される内容"],
      [["ログイン成否・パスワード変更", "誰が・誰を まで記録(構造化ログ)"],
       ["管理者によるスタッフ操作", "誰が・誰を まで記録"],
       ["資格情報の復号", "どの法人のものを、いつ(「誰が」は無い)"],
       ["業務データの参照", "残らない(平文なので復号を通らない)"]],
      col_w=[2.6, 3.4], size=10, hsize=10, row_h=0.42, header_h=0.32,
      cell_colors={(3, 1): RED, (2, 1): AMBER})
bullets(s, ML + 6.33, 3.6, 6.0, 1.2, [
    {"t": "業務データを平文にした結果、「誰がどの顧客を見たか」を追う手段が無くなった"},
    {"t": "本命はデータベース側の監査機能(pgaudit 等)。未導入"},
], size=11, line=1.32, gap=6)

note(s, ML, 4.5, CW, 1.0, "将来の展開を見据えた懸念",
     "提案書では訪問看護事業者への展開を想定しています(doc/07 第7章)。医療系の記録を扱うなら、"
     "「誰がどの記録を参照したか」の記録と保存年限の管理が要件になる可能性が高いと考えています。",
     accent=AMBER, fill=AMBER_L)
note(s, ML, 5.65, CW, 1.2, "ご相談したいこと(相談⑥)",
     "① データベース側の監査(pgaudit 等)を入れるべき時期と粒度。全参照を記録すると量が膨大になるため、"
     "どこで線を引くのが実務的でしょうか。 "
     "② Cloud KMS を入れる前に本番データを溜め始めてよいか(後から移せるが、その間の鍵は環境変数のまま)。",
     accent=RED, fill=RED_L)

# ══════════════════════════════════════════════════════════════
# 24. 第4章 divider
# ══════════════════════════════════════════════════════════════
sec_("第 4 章", "これから足すもの・相談事項",
     "拡張のしやすさをどう作ってあるか、そして直近で決めたいこと")

# ══════════════════════════════════════════════════════════════
# 25. 未着手の機能
# ══════════════════════════════════════════════════════════════
s = sl_("まだ存在しない機能", "提案書の中心的な機能が、スキーマには無い",
        source="doc/07_技術構成提案書.md 第4〜7章")
text(s, ML, 1.2, CW, 0.3,
     "13テーブルは「土台」にあたる部分です。差別化要因として提案書に書いた機能は、まだテーブルすら作っていません。",
     size=12, color=INK)
plans = [
    ("予約・スケジュール", RED, ["reservations(スタッフ・顧客・時間帯)",
                          "二重予約の防止は EXCLUDE USING gist 制約で\nデータベース側に強制させる想定",
                          "初期化SQLで btree_gist 拡張は有効化済み(仕込み)"], "未着手"),
    ("請求・決済", RED, ["invoices / invoice_lines / payments /\npayment_allocations",
                    "金額は整数(銭単位)。明細の金額は生成列にし、\n合計との不整合をコミット時に検証",
                    "レセプト請求(保険)はスコープ外"], "未着手"),
    ("カルテ・記録", RED, ["care_records(共通)+ 訪問看護向けの\nnursing_vitals / physician_instructions",
                     "改訂履歴と保存年限の管理が要件になる", "法定保存年数は要確認事項として残っている"], "未着手"),
    ("業種差の吸収", AMBER, ["tenant_features(機能フラグ)で法人ごとに\n使う機能を切り替える",
                        "表示・検索用途に限ったJSONB列(custom_fields)",
                        "請求・カルテの本体データはJSONBに置かない方針"], "設計のみ"),
]
cx = ML
for ttl, col, items, st in plans:
    w = 2.98
    rect(s, cx, 1.62, w, 3.15, fill=WHITE, border=col, border_w=1.3, dash=True)
    rect(s, cx, 1.62, w, 0.42, fill=col, border=None, shape=MSO_SHAPE.RECTANGLE)
    fill_text(rect(s, cx, 1.62, w, 0.42, fill=col, border=None, shape=MSO_SHAPE.RECTANGLE),
              ttl, size=12, color=WHITE, bold=True)
    badge(s, cx + 0.18, 2.14, 1.1, 0.26, st, color=col, fill=WHITE, size=9.5)
    bullets(s, cx + 0.18, 2.5, w - 0.36, 2.2,
            [{"t": it, "s": 10} for it in items], size=10, line=1.28, gap=7)
    cx += w + 0.14

card(s, ML, 5.0, 6.0, 1.25, "「拡張しやすい形」にはしてあると考えている", accent=GREEN, items=[
    {"t": "表を1枚足す手順が決まっている(同じ規約をコピーし、RLSの張り忘れはCIが検出)"},
    {"t": "業務ロジックはデータベースの実装から切り離してあるため、表の追加が画面まで波及しにくい"},
], body_size=10.5)
note(s, ML + 6.33, 5.0, 6.0, 1.25, "ただし後から足すのが高いものがある",
     "予約の二重登録防止と請求の金額整合は、あとから入れると既存データの移行が伴います。"
     "「土台のうちに入れるべきか、後回しでよいか」を判断いただきたい部分です。",
     accent=AMBER, fill=AMBER_L)
note(s, ML, 6.33, CW, 0.62, "ご相談したいこと(相談⑦)",
     "予約・請求のスキーマを、運用開始前のいま入れておくべきでしょうか。"
     "それとも実際の運用で要件が固まってから作るほうが結果的に安いでしょうか。",
     accent=VIOLET, fill=VIOLET_L, size=11)

# ══════════════════════════════════════════════════════════════
# 26. 直近の拡張検討(領収書の請求区分・クーポン)
# ══════════════════════════════════════════════════════════════
s = sl_("直近で決めたい拡張", "領収書の「顧客請求 / 会社立替」の区別と、クーポンの記録",
        source="現場からの要望。現状は表現できていない")
rect(s, ML, 1.22, 6.0, 2.05, fill=RED_L, border=None)
text(s, ML + 0.2, 1.3, 5.6, 0.28, "現状:表現できていない2つのこと", size=12, color=RED, bold=True)
bullets(s, ML + 0.2, 1.65, 5.6, 2.0, [
    {"t": [("① 領収書の負担者", {"bold": True}),
           ("  顧客に紐付くか否か(customer_id が空か)でしか区別できない。"
            "ガレージ代のように「顧客の訪問に紐付くが会社が負担する」経費を表せない", {})]},
    {"t": [("② クーポンの適用", {"bold": True}),
           ("  顧客メモの自由記述に「クーポン利用 25枚利用」などと書かれているだけ。"
            "残枚数も使用履歴も集計できない", {})]},
], size=11, line=1.32, gap=8)
rect(s, ML, 3.45, 6.0, 1.1, fill=CARD, border=LINE)
text(s, ML + 0.15, 3.55, 5.7, 0.95,
     'customers.memo(自由記述)の実例:\n'
     '  「月末払い承諾済 / クーポン利用 25枚利用 / 駐車場代 600円」',
     size=10.5, color=INK, font=MONO, line=1.4)

text(s, ML + 6.33, 1.22, 6.0, 0.28, "拡張案", size=12, color=GREEN, bold=True)
rect(s, ML + 6.33, 1.52, 6.0, 1.05, fill=WHITE, border=GREEN, border_w=1.3)
text(s, ML + 6.5, 1.6, 5.65, 0.26, "receipts に列を1つ足す", size=11, color=GREEN, bold=True)
text(s, ML + 6.5, 1.88, 5.7, 0.6,
     "billing_type:顧客請求 / 会社負担 の2値。顧客に紐付かない領収書は必ず会社負担になるよう"
     "データベース側で制約する",
     size=10, color=INK, line=1.28)
for i, (nm, body) in enumerate([
        ("coupons", "クーポンの定義(名称・種別・割引額または枚数)"),
        ("customer_coupon_balances", "顧客ごとの残枚数・残額"),
        ("coupon_usages", "使用履歴。いつ・誰が・どの訪問(日報)で使ったか")]):
    yy = 2.72 + i * 0.72
    rect(s, ML + 6.33, yy, 6.0, 0.64, fill=WHITE, border=ACCENT, border_w=1.2)
    text(s, ML + 6.5, yy + 0.07, 5.65, 0.24, nm, size=10.5, color=ACCENT, bold=True, font=MONO)
    text(s, ML + 6.5, yy + 0.32, 5.7, 0.28, body, size=10, color=INK)
text(s, ML + 6.33, 4.92, 6.0, 0.3, "3枚とも既存の規約(tenant_id + 複合外部キー + RLS)に載せる",
     size=10, color=MUTED)

card(s, ML, 5.25, 6.0, 1.05, "この2件は将来の請求機能の入力になる", accent=VIOLET, items=[
    {"t": "billing_type は請求明細の分類、coupon_usages は値引き行として使える。"
          "先に区分だけ持っておけば、請求機能を作るときに過去分も請求できる"},
], body_size=10.5)
note(s, ML + 6.33, 5.25, 6.0, 1.05, "気になっている点",
     "問題④(金額が文字列)と同じ話が絡みます。クーポンの割引額を持つなら、"
     "金額の型を先に決める必要があります。",
     accent=AMBER, fill=AMBER_L, size=10.5)
note(s, ML, 6.35, CW, 0.68, "ご相談したいこと(相談⑧)",
     "請求機能とまとめて設計すべきか、いま区分とクーポンだけ先に入れてよいか。「先に小さく入れる」場合の注意点をご教示ください。",
     accent=VIOLET, fill=VIOLET_L, size=11)

# ══════════════════════════════════════════════════════════════
# 27. 相談事項まとめ
# ══════════════════════════════════════════════════════════════
s = sl_("ご相談したいこと(まとめ)", "優先度順。特に伺いたいのは ①②⑤",
        source="doc/09 第5章「レビュー観点」に対応")
rows = [
    ["①", "customers 35列を分けるべきか", "18",
     "顧客マスタとして何列までが常識的か、分ける単位の基準。運用前の今が最も安く直せる"],
    ["②", "業務データ平文化の前提が妥当か", "13・19",
     "「保存時暗号化は本番基盤に任せる」という前提の置き方。本番未配備のまま進めてよいか"],
    ["③", "勤怠のJSON 1列を分解すべきか", "20",
     "給与直結の領域。項目ごとの列にすべきか、1日単位で扱うならJSONで足りるか"],
    ["④", "計算に使う値の型をどこで決めるか", "21",
     "金額・時刻・距離を文字列のまま持つか、取り込み時に数値へ正規化するか"],
    ["⑤", "廃棄・返還の手順と、その他の負債の優先順位", "22",
     "ON DELETE と物理削除手順、バックアップ保持期間。運用前に必須のものはどれか"],
    ["⑥", "監査と鍵管理を本番相当にする時期", "23",
     "pgaudit等を入れる時期と粒度。Cloud KMS 前に本番データを溜め始めてよいか"],
    ["⑦", "予約・請求を土台に入れる順番", "25",
     "あとから足すとデータ移行が伴う。今スキーマに入れるべきか"],
    ["⑧", "領収書の請求区分とクーポンの入れ方", "26",
     "請求機能とまとめて設計するか、区分だけ先に入れるか"],
    ["⑨", "見落としているPostgreSQLの落とし穴", "11・12",
     "複合外部キー + RLS の二重防御で塞いだつもりだが、他に仕様上の抜け道はないか"],
]
table(s, ML, 1.28, CW, ["", "論点", "頁", "何を判断いただきたいか"], rows,
      col_w=[0.45, 3.9, 0.55, 7.4], size=10.5, hsize=10.5, row_h=0.48, header_h=0.32,
      cell_colors={(i, 0): (RED if i in (0, 1, 4) else ACCENT) for i in range(9)},
      aligns=[PP_ALIGN.CENTER, PP_ALIGN.LEFT, PP_ALIGN.CENTER, PP_ALIGN.LEFT])
note(s, ML, 6.05, CW, 0.85, "いちばん困っていること",
     "⑨のような「自分では気づきようがない落とし穴」が、他にもあるかどうかを知りたいです。"
     "①〜⑧は選択肢が見えている判断ですが、⑨は見えていないものを指摘いただく必要があります。",
     accent=ACCENT, fill=ACCENT_L)

# ══════════════════════════════════════════════════════════════
# 28. 付録
# ══════════════════════════════════════════════════════════════
s = sl_("付録 — 一次情報の在り処と、用語の対応", "この資料は要約なので、判断に必要な詳細はこちらを")
card(s, ML, 1.28, 6.0, 2.6, "コード(こちらが正)", accent=ACCENT, items=[
    {"t": [("packages/db/src/schema/*.ts", {"font": MONO, "bold": True}),
           ("  13テーブルの定義。列ごとに「なぜこの形か」をコメントで書いてある", {})]},
    {"t": [("packages/db/drizzle/*.sql", {"font": MONO, "bold": True}),
           ("  マイグレーション8本。RLSの FORCE はここに手で追記", {})]},
    {"t": [("packages/db/src/tenantScope.ts", {"font": MONO, "bold": True}),
           ("  テナントを指定してトランザクションを開く入口", {})]},
    {"t": [("packages/core/src/ports/", {"font": MONO, "bold": True}),
           ("  業務ロジックが外部に求める窓口の定義(26本)", {})]},
], body_size=10.5)
card(s, ML + 6.33, 1.28, 6.0, 2.6, "ドキュメント", accent=GREEN, items=[
    {"t": [("doc/09_データベース構造解説.md", {"bold": True}),
           ("  本資料の詳細版。ER図・全列一覧・レビュー観点", {})]},
    {"t": [("doc/07_技術構成提案書.md", {"bold": True}),
           ("  予約・請求・カルテの設計方針(第4〜7章)", {})]},
    {"t": [("doc/11_アーキテクチャ説明スライド.html", {"bold": True}),
           ("  発表用スライド(ブラウザで開く)", {})]},
    {"t": [("doc/13_アーキテクチャ説明資料.pptx", {"bold": True}),
           ("  本資料の対になるアプリ構成の説明資料", {})]},
], body_size=10.5)
text(s, ML, 4.05, CW, 0.28, "この資料で使った言い換えの対応表", size=12, color=INK, bold=True)
table(s, ML, 4.35, CW, ["この資料での言い方", "正式な用語", "実装上の名前"],
      [["法人 / 会社", "テナント(tenant)", "tenants テーブル / tenant_id 列"],
       ["紐付けを2列セットにする", "複合外部キー(composite foreign key)", "foreignKey({ columns: [tenantId, xxxId] })"],
       ["データベース自身に絞り込ませる", "行レベルセキュリティ(RLS)", "pgPolicy('tenant_isolation') / FORCE ROW LEVEL SECURITY"],
       ["まとめて確定させる", "トランザクション / UnitOfWork", "UnitOfWorkPort / withTenant()"],
       ["送信待ち行列", "Outbox パターン", "outbox_jobs テーブル / MirrorPort"],
       ["鍵を鍵で包む", "封筒暗号化(envelope encryption)", "tenant_keys.wrapped_dek / KeyManagementPort"]],
      col_w=[3.2, 3.6, 5.5], size=10, hsize=10.5, row_h=0.33, header_h=0.32, first_bold=True)
text(s, ML, 6.78, CW, 0.3,
     "本資料の図はすべてPowerPointの図形で作ってあるため、コメントの書き込み・修正がそのままできます。",
     size=10.5, color=MUTED)

prs.save(str(OUT))
print(f"saved: {OUT}  ({PAGE['n']} slides)")
