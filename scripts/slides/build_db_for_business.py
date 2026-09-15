# -*- coding: utf-8 -*-
"""doc/slides/db-for-business.pptx を生成する。

読み手は、ベビーシッター法人のパートナー企業で実務を担当されている方・責任者の方。
Excelには慣れているがデータベースは初めて、という前提に立ち、
「この設計で業務上の抜けが無いか」を確認していただくための資料にする。

doc/slides/db-review.pptx が技術的な妥当性を有識者に見ていただく資料なのに対し、
こちらは業務の言葉だけで書き、確認していただきたいことを質問の形で並べる。

内容の一次情報は packages/db/src/schema/*.ts と doc/db/overview.md・doc/db/guidelines.md・doc/db/new-domains.md・doc/db/reference.md。
業務の言葉への言い換えは scripts/slides/db_for_business_content.py に分けてある。

生成: pip install python-pptx && python3 scripts/slides/build_db_for_business.py
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN

from db_for_business_content import DOMAINS
from pptx_kit import (ACCENT, ACCENT_L, AMBER, AMBER_L, CARD, CARD2, CW, GREEN, GREEN_L, INK, LINE,
                      ML, MONO, MUTED, NAVY, ORANGE, ORANGE_L, PINK, PINK_L, RED, RED_L, SLIDE_W,
                      TEAL, TEAL_L, VIOLET, VIOLET_L, WHITE, _text_w, arrow, badge, box, bullets,
                      card, chip_row, fill_text, hline, new_deck, note, rect, section_slide, slide,
                      table, text, title_slide, vline)

OUT = Path(__file__).resolve().parents[2] / "doc" / "slides" / "db-for-business.pptx"

BODY_TOP = 1.22
BODY_BOTTOM = 6.88

COLORS = {
    'accent': (ACCENT, ACCENT_L),
    'violet': (VIOLET, VIOLET_L),
    'green': (GREEN, GREEN_L),
    'amber': (AMBER, AMBER_L),
    'red': (RED, RED_L),
    'pink': (PINK, PINK_L),
    'teal': (TEAL, TEAL_L),
    'muted': (MUTED, CARD),
}

prs = new_deck()
PAGE = {"n": 0}


def sl_(title, small="", source="", accent=ACCENT):
    PAGE["n"] += 1
    return slide(prs, title, small, page=PAGE["n"], source=source, accent=accent)


def sec_(no, title, sub=""):
    PAGE["n"] += 1
    return section_slide(prs, no, title, sub)


def lines_of(s, w, size):
    """幅 w インチのテキストボックスに size ポイントで流したときの概算行数。

    折り返し位置の都合で1行に収まらないことがあるので、9割の幅で見積もって多めに取る。
    """
    return max(1, math.ceil(_text_w(s, size) / (w * 0.93)))


def height_of(s, w, size, lead=1.45):
    return lines_of(s, w, size) * size * lead / 72.0


def note_(sl, x, y, w, label, body, accent=AMBER, fill=AMBER_L, size=11.5):
    """色つきの補足。高さは本文の長さから決める(pptx_kit.note の自動高さ版)。

    pptx_kit.note をそのまま使わないのは、本文のテキストボックスに実際の高さを
    持たせるため。生成後にPowerPointで動かすときに箱の大きさが見た目と合う。
    """
    body_w = w - 0.44
    bh = height_of(body, body_w, size, lead=1.42)
    top = 0.4 if label else 0.13
    h = top + bh + 0.14
    rect(sl, x, y, w, h, fill=fill, border=None)
    rect(sl, x, y, 0.075, h, fill=accent, border=None, shape=MSO_SHAPE.RECTANGLE)
    if label:
        text(sl, x + 0.22, y + 0.1, w - 0.44, 0.26, label, size=10.5, color=accent, bold=True)
    text(sl, x + 0.22, y + top, body_w, bh + 0.04, body, size=size, color=INK, line=1.42)
    return h


# ══════════════════════════════════════════════════════════════
# 表紙・はじめに
# ══════════════════════════════════════════════════════════════
PAGE["n"] += 1
title_slide(
    prs,
    "業務内容の確認のお願い",
    "新しい業務システムで\n「何を記録するか」の確認資料",
    "訪問保育(ベビーシッター)業務システム katahimo-app — データベース設計",
    "データベースの知識は不要です。Excelのシートと見出し行に置き換えてご説明します。\n"
    "お願いしたいのは「この項目で業務が回るか」「足りないものは無いか」のご確認です。",
)

s = sl_("この資料でお願いしたいこと", "はじめに")
card(s, ML, BODY_TOP, 4.06, 2.5, "お願いしたいこと", accent=ACCENT, items=[
    {'t': [("いま作っている業務システムが、", {}), ("業務に必要な情報をひととおり記録できているか", {'bold': True}),
           ("をご確認ください。", {})]},
    {'t': "「この項目が無いと困る」「この区分が足りない」を挙げていただくのが目的です。"},
    {'t': "細かい言い回しや画面の見た目は、この資料の対象ではありません。"},
], body_size=11.5)
card(s, ML + 4.26, BODY_TOP, 4.06, 2.5, "いまどの段階か", accent=GREEN, items=[
    {'t': [("まだ本稼働していません。", {'bold': True}), ("大きく作り直すこともできる段階です。", {})]},
    {'t': "いま見つかる抜けは、直すのに費用も時間もほとんどかかりません。"},
    {'t': [("運用開始後に見つかると、", {}), ("入力済みのデータを全件直す作業", {'bold': True}),
           ("が発生します。", {})]},
], body_size=11.5)
card(s, ML + 8.52, BODY_TOP, 4.06, 2.5, "どなたに見ていただきたいか", accent=VIOLET, items=[
    {'t': "実際に日々の入力・確認をされている実務担当の方"},
    {'t': "締め・請求・給与など、月次の処理をされている方"},
    {'t': "例外対応(キャンセル、事故、訂正)の判断をされている責任者の方"},
], body_size=11.5)

note_(s, ML, 4.0, CW, "データベースの知識は要りません",
     "この資料では、データベースを「Excelのブック」、テーブルを「シート」、列を「見出し行」に置き換えて説明します。"
     "次のページから、その対応をご説明します。専門用語は括弧で添えるだけにして、本文では使いません。",
     accent=ACCENT, fill=ACCENT_L)

card(s, ML, 5.12, 6.16, 1.7, "ご確認いただきたい3つの視点", accent=AMBER, items=[
    {'t': [("① 項目の抜け", {'bold': True}), (" — 記録したい情報で、一覧に無いもの", {})]},
    {'t': [("② 選択肢の抜け", {'bold': True}), (" — 「状態」「区分」に足りない選択肢", {})]},
    {'t': [("③ ルールの食い違い", {'bold': True}), (" — 実際の運用と、システムの決めごとのズレ", {})]},
], body_size=11.5)
card(s, ML + 6.36, 5.12, 6.16, 1.7, "ご確認いただかなくてよいこと", accent=MUTED, items=[
    {'t': "英語の名前(customers など)。実務では画面に出ません"},
    {'t': "技術的な正しさ。別途、データベースの専門家に見ていただきます"},
    {'t': "画面のデザイン・操作の手順。この資料の対象外です"},
], body_size=11.5)

s = sl_("この資料の読み方", "はじめに", source="各章は「記録している項目」→「確認していただきたいこと」の2ページ構成です")
items = [
    ("記録している項目", ACCENT, ACCENT_L,
     "そのシートに何を記録するか。Excelの見出し行にあたるものの一覧です。"
     "ここに無いものは、いまのままでは記録できません。"),
    ("自動で守られること", GREEN, GREEN_L,
     "システムが勝手に守ってくれる決めごと。入力ミスがあっても、この内容に反する登録は"
     "そもそもできないようになっています。"),
    ("まだ決まっていないこと", AMBER, AMBER_L,
     "設計側で決めきれていない点、または作りかけの点。ご意見をいただきたい箇所です。"),
    ("確認していただきたいこと", VIOLET, VIOLET_L,
     "質問の形で並べています。お答えいただくか、「これで問題ない」と一言いただければ十分です。"),
]
y = BODY_TOP
for label, col, fl, desc in items:
    h = 0.88
    rect(s, ML, y, CW, h, fill=fl, border=None)
    rect(s, ML, y, 0.075, h, fill=col, border=None, shape=MSO_SHAPE.RECTANGLE)
    text(s, ML + 0.24, y + 0.13, 2.9, 0.3, label, size=13, color=col, bold=True)
    text(s, ML + 3.3, y + 0.12, CW - 3.6, h - 0.24, desc, size=11.5, color=INK, line=1.4)
    y += h + 0.16

note_(s, ML, y + 0.05, CW, "ご回答の方法",
     "この資料のPowerPointファイルに直接コメントを入れていただくか、"
     "巻末の「確認シート」の形式でメール・チャットにご返信ください。"
     "「◯ページの△△について」と分かれば、形式は問いません。",
     accent=MUTED, fill=CARD)

# ══════════════════════════════════════════════════════════════
# 第1章 Excelに置き換えて理解する
# ══════════════════════════════════════════════════════════════
sec_("第1章", "まず、Excelに置き換えて理解する", "データベースの用語を、ふだん使っている言葉に言い換えます")

s = sl_("データベースは「Excelブック」だと思ってください", "第1章 Excelに置き換える")
table(s, ML, BODY_TOP, CW,
      ["Excelでいうと", "この資料での呼び方", "(専門用語)", "補足"],
      [
          ["1つのブック(ファイル)", "システムのデータ全体", "データベース", "業務で使うデータが1か所にまとまっている"],
          ["1枚のシート", "シート", "テーブル", "今回は44枚。「顧客」「予約」「日報」など内容ごとに分かれる"],
          ["1行目の見出し", "項目", "列(カラム)", "「氏名」「電話」など。あとから足せるが、足す作業が要る"],
          ["2行目以降の1行", "1件", "行(レコード)", "顧客1世帯、予約1件、日報1回 ＝ それぞれ1行"],
          ["A列の管理番号", "ID(見えない管理番号)", "主キー", "システムが自動で振る。重複しない"],
          ["VLOOKUPの参照先", "つながり", "外部キー", "「この予約はどの顧客か」を管理番号で指し示す"],
          ["入力規則(リスト)", "選べる値の一覧", "CHECK制約", "決めた選択肢以外は登録できない"],
          ["重複の削除・チェック", "重複禁止", "一意制約", "同じものが2件登録されることを、そもそも防ぐ"],
          ["並べ替え・フィルタ", "検索の速さの工夫", "インデックス", "件数が増えても一覧表示が遅くならないための仕掛け"],
          ["空欄", "未入力を許すかどうか", "NULL可否", "項目ごとに「必ず入れる/空でもよい」を決めてある"],
      ],
      col_w=[2.6, 2.4, 1.8, 5.6], size=11, hsize=11, row_h=0.43, header_h=0.36, first_bold=True)
note_(s, ML, 6.12, CW, "",
     "以降のページでは、左の2列(Excelでいうと / この資料での呼び方)の言葉だけを使います。"
     "専門用語は、ご興味があるときのために括弧で添えるだけにします。",
     accent=ACCENT, fill=ACCENT_L)

s = sl_("Excelとは違うところ", "第1章 Excelに置き換える",
        source="「Excelで十分では?」というご質問への回答でもあります")
left = [
    ("同時に触れる", "Excelは誰かが開いていると編集できない。システムは全員が同時に入力できる"),
    ("行が増えても重くならない", "数十万件でも一覧の表示が遅くならない仕掛けが入っている"),
    ("入力規則が必ず効く", "Excelの入力規則はコピー&ペーストで簡単に破れる。システムでは破れない"),
    ("計算式が壊れない", "行の挿入や並べ替えで式がずれることが無い。計算はその都度行う"),
]
right = [
    ("記録が消えない", "取り消しても行は残す(グレー表示)。「あったはずのものが痕跡なく消える」を作らない"),
    ("誰が・いつ が残る", "登録日時・更新日時・入力者が自動で記録される"),
    ("見える範囲を分けられる", "スタッフは自分の分だけ、管理者は全員分、という制御ができる"),
    ("他法人のデータは見えない", "システムの作り方として、他社のデータが混ざらないようになっている"),
]
card(s, ML, BODY_TOP, 6.16, 2.55, "Excelでは難しいこと", accent=ACCENT,
     items=[{'t': [(t, {'bold': True}), (" — " + d, {})]} for t, d in left], body_size=11.5, line=1.38)
card(s, ML + 6.36, BODY_TOP, 6.16, 2.55, "記録として強くなること", accent=GREEN,
     items=[{'t': [(t, {'bold': True}), (" — " + d, {})]} for t, d in right], body_size=11.5, line=1.38)
note_(s, ML, 4.0, CW, "そのかわり不便になること",
     "項目(見出し)を足すのは、Excelのように「列を1本挿入」では済みません。"
     "作業と確認が必要で、運用開始後は入力済みのデータをどう埋めるかも決める必要があります。"
     "だからこそ、始める前のいまのうちに「足りない項目」を挙げていただきたい、というのがこの資料の趣旨です。",
     accent=AMBER, fill=AMBER_L)
card(s, ML, 5.2, CW, 1.6, "「1シートにまとめた方が見やすいのでは?」について", accent=VIOLET, items=[
    {'t': [("シートを分けるのは、", {}), ("同じことを二度書かないため", {'bold': True}),
           ("です。顧客の住所を予約シートにも書いていると、引っ越したときに全部直す必要があり、直し漏れた行が残ります。", {})]},
    {'t': [("住所は「顧客」シートにだけ書き、予約からは管理番号で指し示します。"
            "これで住所を直す場所は常に1か所になります(VLOOKUPと同じ考え方です)。", {})]},
], body_size=11.5)

s = sl_("「つながり」の考え方", "第1章 Excelに置き換える", source="このあと出てくる図の読み方です")
box(s, ML + 0.4, 1.4, 2.6, 0.95, [("顧客シート", {'size': 13, 'bold': True}), ("\n", {}),
                                  ("1世帯 = 1行", {'size': 10.5, 'color': MUTED})],
    fill=ACCENT_L, border=ACCENT)
box(s, ML + 4.2, 1.4, 2.6, 0.95, [("予約シート", {'size': 13, 'bold': True}), ("\n", {}),
                                  ("予約1件 = 1行", {'size': 10.5, 'color': MUTED})],
    fill=GREEN_L, border=GREEN)
box(s, ML + 8.0, 1.4, 2.6, 0.95, [("日報シート", {'size': 13, 'bold': True}), ("\n", {}),
                                  ("訪問1回 = 1行", {'size': 10.5, 'color': MUTED})],
    fill=VIOLET_L, border=VIOLET)
arrow(s, (ML + 3.0, 1.88), (ML + 4.2, 1.88), color=MUTED, width=1.6, tail="oval")
arrow(s, (ML + 6.8, 1.88), (ML + 8.0, 1.88), color=MUTED, width=1.6, tail="oval")
text(s, ML + 2.95, 1.98, 1.3, 0.3, "1世帯に\n予約は何件でも", size=9.5, color=MUTED, align=PP_ALIGN.CENTER)
text(s, ML + 6.75, 1.98, 1.3, 0.3, "予約1件に\n日報は1件まで", size=9.5, color=MUTED, align=PP_ALIGN.CENTER)
card(s, ML, 2.95, 6.16, 1.9, "図の読み方", accent=ACCENT, items=[
    {'t': "四角がシート(Excelの1枚のシート)"},
    {'t': "矢印は「指し示している」向き。予約シートの1行が、顧客シートの1行を指しています"},
    {'t': "矢印の根元の丸は「何件でもつながる」、線だけは「1件まで」を表します"},
], body_size=11.5)
card(s, ML + 6.36, 2.95, 6.16, 1.9, "なぜ「1件まで」を決めるのか", accent=GREEN, items=[
    {'t': "1つの予約に日報が2件つくと、サービス提供分の請求が二重になります"},
    {'t': [("そうならないよう、", {}), ("システム側で2件目を受け付けません", {'bold': True}),
           ("。人の注意力に頼りません。", {})]},
], body_size=11.5)
note_(s, ML, 5.0, CW, "「つながり」が守ってくれること",
     "予約シートに、存在しない顧客の管理番号を書くことはできません。"
     "また、予約が残っている顧客を誤って削除することもできません。"
     "Excelでいえば「VLOOKUPが #N/A になる状態」を、そもそも作れないようにしてある、ということです。\n"
     "この仕組みのおかげで、「顧客名簿には無いのに日報だけ残っている」といった、"
     "あとから原因を追えない不整合が起きません。",
     accent=VIOLET, fill=VIOLET_L)

s = sl_("入力のルールは、システム側にも書いてあります", "第1章 Excelに置き換える")
table(s, ML, BODY_TOP, CW,
      ["ルールの種類", "例", "破ろうとすると"],
      [
          ["選べる値を限る", "予約の状態は「申込・確定・実施済・キャンセル・無連絡不来訪」のどれか", "登録できない(エラーになる)"],
          ["値の範囲を限る", "金額はマイナスにできない。ログイン失敗回数は0以上", "登録できない"],
          ["必ず対で入れる", "「キャンセル」にしたのにキャンセル日時が空、は不可", "登録できない"],
          ["重複を禁じる", "同じ予約に同じスタッフを2回、同じ日報に同じクーポンを2回", "2件目が登録できない"],
          ["計算が合うことを保証", "請求書の「合計 = 小計 − 割引 + 税」", "合わない請求書は登録できない"],
          ["必ずどちらか一方", "受付枠は「毎週◯曜日」か「◯月◯日」のどちらか。両方は不可", "登録できない"],
      ],
      col_w=[2.5, 7.0, 2.9], size=11, hsize=11, row_h=0.46, header_h=0.36, first_bold=True)
note_(s, ML, 4.6, CW, "なぜ画面のチェックだけでは足りないのか",
     "画面に入力チェックを入れても、データの取り込み(CSV)、別のシステムからの連携、"
     "不具合の修正作業などは画面を通りません。"
     "「絶対に守りたいこと」はデータの置き場所そのものに書いておく、というのが今回の方針です。"
     "Excelの入力規則がコピー&ペーストで破れてしまうのに対し、こちらは経路を問わず必ず効きます。",
     accent=GREEN, fill=GREEN_L)
card(s, ML, 5.85, CW, 0.95, "ご確認いただきたいのは、まさにこの「選べる値」です", accent=VIOLET, items=[
    {'t': "各章の「確認していただきたいこと」には、選択肢が足りているかの質問を入れています。"
          "あとから選択肢を足すこと自体はできますが、運用開始後だと「どれにも当てはまらない」データが"
          "先に溜まってしまい、後追いの仕分けが必要になります。"},
], body_size=11.5)

# ══════════════════════════════════════════════════════════════
# 第2章 全体像
# ══════════════════════════════════════════════════════════════
sec_("第2章", "全体像 — 44枚のシートの地図", "業務の流れのどこで、どのシートに記録が生まれるか")

s = sl_("業務の流れと、記録が生まれる場所", "第2章 全体像")
steps = [
    ("お客様登録", "顧客 / 世帯構成員 / カルテ", ACCENT, ACCENT_L, "3・5章"),
    ("予約受付", "予約 / サービスメニュー", GREEN, GREEN_L, "6章"),
    ("スタッフ割当", "割当 / 受付枠 / 相性", TEAL, TEAL_L, "6・12章"),
    ("訪問・実施", "日報 / 事故報告 / 領収書", VIOLET, VIOLET_L, "7・8章"),
    ("締め・集計", "勤怠 / 移動区間 / クーポン適用", AMBER, AMBER_L, "9・10・13章"),
    ("請求・入金", "請求書 / 明細 / 入金", PINK, PINK_L, "11章"),
]
bw = (CW - 0.28 * 5) / 6
for i, (t, sheets, col, fl, ch) in enumerate(steps):
    x = ML + i * (bw + 0.28)
    rect(s, x, 1.35, bw, 1.62, fill=fl, border=col, border_w=1.2)
    rect(s, x, 1.35, bw, 0.42, fill=col, border=None, shape=MSO_SHAPE.RECTANGLE)
    text(s, x, 1.42, bw, 0.3, t, size=12.5, color=WHITE, bold=True, align=PP_ALIGN.CENTER)
    text(s, x + 0.12, 1.87, bw - 0.24, 0.9, sheets.replace(" / ", "\n"), size=10.5, color=INK,
         align=PP_ALIGN.CENTER, line=1.5)
    text(s, x, 2.7, bw, 0.24, "第" + ch, size=9.5, color=col, align=PP_ALIGN.CENTER)
    if i < 5:
        arrow(s, (x + bw + 0.03, 2.16), (x + bw + 0.25, 2.16), color=MUTED, width=1.8)
note_(s, ML, 3.12, CW, "",
     "上の6つが業務の流れです。それぞれの段階で、その下に書いたシートに記録が生まれます。"
     "第3章以降は、この順番に沿って1つずつご確認いただきます。", accent=ACCENT, fill=ACCENT_L)
card(s, ML, 4.08, 4.06, 2.72, "流れの外にあるもの", accent=MUTED, items=[
    {'t': [("スタッフ", {'bold': True}), ("(第4章) — 全体で使う名簿", {})]},
    {'t': [("特性・相性", {'bold': True}), ("(第12章) — 割当を機械に手伝わせるための材料", {})]},
    {'t': [("システムの裏方", {'bold': True}), ("(第14章) — ログイン、通知先、締め日などの設定", {})]},
    {'t': [("日報AIの文面", {'bold': True}), ("(第15章) — AIに渡す指示文と、その調整の材料", {})]},
], body_size=11)
card(s, ML + 4.26, 4.08, 4.06, 2.72, "現行(GAS版)との関係", accent=AMBER, items=[
    {'t': "いま動いているのはスプレッドシートで作られた仕組みで、今回はその移行先です。"},
    {'t': [("給与計算は", {}), ("現行と1円も違ってはいけない", {'bold': True}),
           ("という条件で作っています。", {})]},
    {'t': "移行の期間中は、スプレッドシートにも同じ内容を自動で書き写します。"},
], body_size=11.5)
card(s, ML + 8.52, 4.08, 4.06, 2.72, "できている範囲", accent=GREEN, items=[
    {'t': [("画面まで動く: ", {'bold': True}),
           ("顧客・日報・事故報告・領収書・勤怠・クーポン・AIの文面・AIの調整材料(年齢帯・教育の言葉・"
            "関心度と負担の基準・ご家庭の設定)", {})]},
    {'t': [("入れ物だけ: ", {'bold': True}), ("カルテ・予約・請求・入金・相性・移動手当", {})]},
    {'t': "「入れ物だけ」は、記録する場所は決めたが画面がまだ無い状態です。"
          "だからこそ、いまなら項目を変えやすい段階でもあります。"},
], body_size=11.5)

s = sl_("44枚のシートの地図", "第2章 全体像", source="枠の中の数字は、この資料の章番号です")
groups = [
    ("第3-4章  お客様とスタッフ", ACCENT, ACCENT_L,
     ["顧客", "世帯構成員", "スタッフ"]),
    ("第5章  顧客カルテ", PINK, PINK_L, ["カルテ記載", "カルテ写真"]),
    ("第6章  予約", GREEN, GREEN_L,
     ["サービスメニュー", "予約", "スタッフ割当", "受付枠"]),
    ("第7-8章  訪問の記録", VIOLET, VIOLET_L, ["保育日報", "事故報告", "領収書"]),
    ("第9章  勤怠", TEAL, TEAL_L, ["出勤簿"]),
    ("第10章  割引クーポン", ORANGE, ORANGE_L, ["クーポン種別", "顧客への配布", "使用記録"]),
    ("第11章  請求と入金", RED, RED_L,
     ["決済プロフィール", "請求書", "請求明細", "入金", "決済通知の受信記録"]),
    ("第12章  相性と特性", AMBER, AMBER_L,
     ["特性項目マスタ", "顧客の特性", "スタッフの特性", "相性", "移動時間の見積"]),
    ("第13章  移動と手当", GREEN, GREEN_L, ["手当の単価マスタ", "移動区間"]),
    ("第14章  システムの裏方", MUTED, CARD,
     ["法人", "暗号鍵", "ログインセッション", "パスワード再設定コード", "外部送信の待ち行列", "法人ごとの設定"]),
    ("第15章  日報AIの文面", TEAL, TEAL_L,
     ["AIに渡す文面", "年齢帯", "教育の言葉", "年齢帯と言葉", "関心度の基準", "負担の基準",
      "言い回し", "ご家庭の設定", "AI生成の記録", "使われた語"]),
]
col_x = [ML, ML + 4.26, ML + 8.52]
col_y = [BODY_TOP, BODY_TOP, BODY_TOP]
gw = 4.06
for i, (title, col, fl, sheets) in enumerate(groups):
    ci = min(range(3), key=lambda c: col_y[c])
    x, y = col_x[ci], col_y[ci]
    h = 0.46 + math.ceil(len(sheets) / 2) * 0.3 + 0.1
    rect(s, x, y, gw, h, fill=WHITE, border=col, border_w=1.2)
    rect(s, x, y, gw, 0.34, fill=fl, border=None, shape=MSO_SHAPE.RECTANGLE)
    text(s, x + 0.14, y + 0.05, gw - 0.28, 0.26, title, size=11, color=col, bold=True)
    for j, nm in enumerate(sheets):
        bx = x + 0.12 + (j % 2) * ((gw - 0.24) / 2)
        by = y + 0.42 + (j // 2) * 0.3
        box(s, bx, by, (gw - 0.24) / 2 - 0.06, 0.26, nm, fill=CARD, border=None, size=10,
            color=INK, radius=0.3)
    col_y[ci] = y + h + 0.16


# ══════════════════════════════════════════════════════════════
# 第3章以降 — ドメインごとに「記録している項目」→「確認していただきたいこと」
# ══════════════════════════════════════════════════════════════
def sheet_card(sl, x, y, w, sh):
    """1枚のシートの説明カード。高さは項目の行数から決まる。"""
    col, fl = COLORS[sh['color']]
    body_w = w - 0.44
    bh = height_of(sh['cols'], body_w, 11, lead=1.5)
    h = 0.4 + bh + 0.16
    rect(sl, x, y, w, h, fill=WHITE, border=LINE, border_w=1.0)
    rect(sl, x, y, 0.075, h, fill=col, border=None, shape=MSO_SHAPE.RECTANGLE)
    text(sl, x + 0.22, y + 0.08, w - 5.0, 0.28,
         [(sh['name'], {'size': 12.5, 'bold': True, 'color': col}),
          ("  " + sh['en'], {'size': 9.5, 'color': MUTED, 'font': MONO})])
    unit_w = 0.3 + _text_w(sh['unit'], 9.5)
    badge(sl, x + w - unit_w - 0.16, y + 0.08, unit_w, 0.26, sh['unit'], color=col, fill=fl, size=9.5)
    text(sl, x + 0.22, y + 0.38, body_w, bh + 0.1, sh['cols'], size=11, color=INK, line=1.5)
    return h


def sheet_card_height(sh, w):
    return 0.4 + height_of(sh['cols'], w - 0.44, 11, lead=1.5) + 0.16


def domain_sheet_pages(d):
    """「記録している項目」のページ。入りきらなければ (続き) に送る。"""
    lead_h = height_of(d['lead'], CW - 0.5, 11.5, lead=1.5) + 0.3
    pages, cur, first = [], [], True
    avail = BODY_BOTTOM - (BODY_TOP + lead_h + 0.12)
    used = 0.0
    for sh in d['sheets']:
        h = sheet_card_height(sh, CW) + 0.14
        if cur and used + h > avail:
            pages.append((first, cur))
            cur, used, first = [], 0.0, False
            avail = BODY_BOTTOM - (BODY_TOP + 0.05)
        cur.append(sh)
        used += h
    pages.append((first, cur))

    for is_first, sheets in pages:
        title = "第%s章 %s" % (d['no'], d['title'])
        s = sl_(title if is_first else title + "(続き)",
                d['sub'] if is_first else "記録している項目",
                source="この一覧に無いものは、いまのままでは記録できません")
        y = BODY_TOP
        if is_first:
            text(s, ML + 0.02, y, CW - 0.5, lead_h, d['lead'], size=11.5, color=INK, line=1.5)
            y += lead_h + 0.12
        for sh in sheets:
            y += sheet_card(s, ML, y, CW, sh) + 0.14


def check_pages(d):
    """「確認していただきたいこと」のページ。決めごと・未決事項も同じページに載せる。"""
    title = "第%s章 %s — ご確認のお願い" % (d['no'], d['title'])

    # 上段: 自動で守られること / まだ決まっていないこと
    half = (CW - 0.2) / 2
    def block_h(items, w):
        if not items:
            return 0.0
        inner = w - 0.5
        return 0.45 + sum(height_of("・" + t, inner, 11, lead=1.45) + 0.07 for t in items) + 0.1

    rules, opens = d['rules'], d['opens']
    if rules and opens:
        rh = max(block_h(rules, half), block_h(opens, half))
        cols = [(ML, half, "自動で守られること", GREEN, rules),
                (ML + half + 0.2, half, "まだ決まっていないこと", AMBER, opens)]
    elif rules:
        rh = block_h(rules, CW)
        cols = [(ML, CW, "自動で守られること", GREEN, rules)]
    else:
        rh = block_h(opens, CW)
        cols = [(ML, CW, "まだ決まっていないこと", AMBER, opens)]

    s = sl_(title, source="ご回答は「これで問題ない」の一言でも構いません")
    for x, w, label, col, items in cols:
        card(s, x, BODY_TOP, w, rh, label, accent=col,
             items=[{'t': t} for t in items], body_size=11, line=1.45, gap=4)

    # 下段: 確認していただきたいこと(2列)
    top = BODY_TOP + rh + 0.2
    cw2 = (CW - 0.2) / 2
    inner = cw2 - 0.62
    heights = [height_of(c, inner, 11, lead=1.48) + 0.22 for c in d['checks']]
    # 2列に振り分ける。あふれたら続きのページへ。
    idx, page_no = 0, 0
    while idx < len(d['checks']):
        if page_no > 0:
            s = sl_(title + "(続き)",
                    source="ご回答は「これで問題ない」の一言でも構いません")
            top = BODY_TOP
        avail = BODY_BOTTOM - top - 0.42
        text(s, ML, top, CW, 0.3,
             [("確認していただきたいこと", {'size': 13, 'bold': True, 'color': VIOLET})])
        y = [top + 0.36, top + 0.36]
        placed = 0
        while idx < len(d['checks']):
            ci = 0 if (y[0] - top) <= (y[1] - top) else 1
            h = heights[idx]
            if y[ci] + h > top + 0.36 + avail:
                if placed == 0:
                    pass  # 1件も置けない極端な場合は、はみ出してでも置く
                else:
                    break
            x = ML + ci * (cw2 + 0.2)
            rect(s, x, y[ci], cw2, h, fill=VIOLET_L, border=None)
            box(s, x + 0.1, y[ci] + 0.08, 0.3, 0.3, str(idx + 1), fill=VIOLET, border=None,
                color=WHITE, size=10.5, bold=True, radius=0.5)
            text(s, x + 0.5, y[ci] + 0.1, inner, h - 0.16, d['checks'][idx], size=11, color=INK,
                 line=1.48)
            y[ci] += h + 0.12
            idx += 1
            placed += 1
        page_no += 1


for d in DOMAINS:
    if d['no'] == '3':
        sec_("第3章-第15章", "業務ごとに、記録する項目を確認する",
             "各章は「記録している項目」→「確認していただきたいこと」の順で並びます")
    domain_sheet_pages(d)
    check_pages(d)


# ══════════════════════════════════════════════════════════════
# 第16章 全体で守っている決めごと
# ══════════════════════════════════════════════════════════════
sec_("第16章", "全体で守っている決めごと", "どの章にも共通してかかっているルールです")

s = sl_("44枚すべてに共通する7つの決めごと", "第16章 全体の決めごと")
rules = [
    ("金額は「円の整数」で持つ", GREEN,
     "1円未満を持ちません。消費税の端数処理は決めた場所で1回だけ行い、"
     "Excelの表示桁で誤差が出るようなことは起きません。"),
    ("日付・時刻は「日付として」持つ", GREEN,
     "「2026/4/1」という文字ではなく日付そのものとして記録します。"
     "月またぎの集計や、勤務時間の計算が確実になります。"),
    ("消さずに「取り消し」を記録する", VIOLET,
     "領収書・請求書・予約は、訂正しても行を消しません。取り消しの印と理由を残します。"
     "「あったはずのものが痕跡なく消える」状態を作りません。"),
    ("過去の金額は後から動かない", VIOLET,
     "クーポンの割引率や移動手当の単価を改定しても、すでに適用済みの金額は変わりません。"
     "適用した時点の条件を控えとして残しているためです。"),
    ("登録日時・更新日時が自動で入る", ACCENT,
     "入力する人が意識しなくても、いつ作られ、いつ直されたかが必ず残ります。"),
    ("法人ごとに完全に分かれている", ACCENT,
     "1つのシステムで複数の法人が使えますが、他法人のデータは見えません。"
     "画面の作りではなく、データの置き場所そのもので分けています。"),
    ("パスワードは元に戻せない形で保存", AMBER,
     "管理者でも本人のパスワードを見ることはできません。"
     "万一データが流出しても、そのままログインには使えません。"),
]
y = BODY_TOP
for t, col, desc in rules:
    h = 0.62
    rect(s, ML, y, CW, h, fill=WHITE, border=LINE, border_w=1.0)
    rect(s, ML, y, 0.075, h, fill=col, border=None, shape=MSO_SHAPE.RECTANGLE)
    text(s, ML + 0.22, y + 0.16, 3.5, 0.3, t, size=11.5, color=col, bold=True)
    text(s, ML + 3.85, y + 0.11, CW - 4.1, h - 0.2, desc, size=11, color=INK, line=1.42)
    y += h + 0.1

s = sl_("「消さない」「後から動かない」が効く場面", "第16章 全体の決めごと",
        source="実務でいちばん影響が出る2つの決めごとです")
card(s, ML, BODY_TOP, 6.16, 2.5, "例1 — 領収書を間違えて登録した", accent=AMBER, items=[
    {'t': [("Excelなら: ", {'bold': True}), ("その行を消して入れ直す。誰が何を消したかは残らない。", {})]},
    {'t': [("このシステム: ", {'bold': True}),
           ("取り消しの印・理由・取り消した人を記録したうえで、新しい行を登録する。"
            "集計からは外れるが、履歴としては残る。", {})]},
    {'t': [("効いてくる場面: ", {'bold': True}),
           ("月次の締め後に金額が合わないとき、何がどう直されたかを追える。", {})]},
], body_size=11.5, line=1.42)
card(s, ML + 6.36, BODY_TOP, 6.16, 2.5, "例2 — クーポンの割引率を変えた", accent=VIOLET, items=[
    {'t': [("Excelなら: ", {'bold': True}),
           ("割引率のセルを直すと、それを参照している過去の請求額まで変わってしまうことがある。", {})]},
    {'t': [("このシステム: ", {'bold': True}),
           ("使った時点の割引率を、使用記録の側に控えとして持つ。"
            "マスタを直しても過去の請求額は1円も動かない。", {})]},
    {'t': [("効いてくる場面: ", {'bold': True}), ("値上げ・料金改定のたびに過去分を確認し直す必要がない。", {})]},
], body_size=11.5, line=1.42)
note_(s, ML, 3.95, CW, "ご確認いただきたいこと",
     "この「消さない」方針により、取り消した領収書や取り消した請求書が一覧に残り続けます"
     "(グレー表示で、集計からは外れます)。"
     "実務上、一覧が見づらくなるようであれば、既定で非表示にするなどの調整ができます。"
     "現場の感覚として、どちらが使いやすいかお聞かせください。",
     accent=ACCENT, fill=ACCENT_L)
card(s, ML, 5.3, CW, 1.5, "「後から動かない」の副作用", accent=MUTED, items=[
    {'t': "料金やクーポンの内容を直しても、過去分には反映されません。"
          "「過去にさかのぼって正しい金額に直したい」という場面があるなら、"
          "それは訂正の請求書を作る運用になります。"},
    {'t': "そうした遡及訂正が実務で発生するかどうか、あるとすれば年に何回くらいかを教えてください。"},
], body_size=11.5)

# ══════════════════════════════════════════════════════════════
# 第17章 まだ決まっていないこと
# ══════════════════════════════════════════════════════════════
sec_("第17章", "まだ決まっていないこと・作りかけのこと",
     "ご意見をいただきたい箇所を、章をまたいで一覧にしました")

s = sl_("業務の決めごととして、ご判断いただきたいこと", "第17章 まだ決まっていないこと",
        source="技術的な検討課題は別資料(doc/slides/db-review.pptx)にまとめてあり、ここには含めていません")
table(s, ML, BODY_TOP, CW,
      ["章", "決まっていないこと", "決まらないと困ること"],
      [
          ["第3章", "会員区分・会員状態・支払方法・支払状態に入る値の一覧", "どれにも当てはまらない顧客が出る"],
          ["第6章", "同じスタッフの時間が重なる予約を、止めるか警告だけにするか", "ダブルブッキングが起きる"],
          ["第6章", "キャンセル料の規定と、その記録場所", "キャンセル料を請求できない"],
          ["第7章", "「リスク評価」「ES評価」の意味と段階", "入力する人によって基準がばらつく"],
          ["第8章", "領収書の締め日と、取り消しを認める日数", "締め後の訂正の可否が現場で判断できない"],
          ["第9章", "1日4件以上の訪問があるか(現状は3件まで)", "4件目が記録できず給与に反映されない"],
          ["第10章", "クーポンの併用可否と、使用上限の単位", "想定外の割引が通ってしまう"],
          ["第11章", "請求サイクル・消費税の扱い・請求書番号の付け方", "請求書が発行できない"],
          ["第11章", "自治体助成・企業の福利厚生で請求先がお客様以外になるケース", "その分の請求ができない"],
          ["第12章", "割当を決めるときに実際に見ている条件", "自動割当の材料が揃わない"],
          ["第13章", "移動手当の規程(手段ごとの単価・上限・支給条件)", "手当が計算できない"],
          ["第15章", "教育への関心度★・負担の大きさ(PSI)の判定基準の中身(貴社の言葉で)",
           "日報の文面を組み替える材料(キーワード表・言い回し)が空のまま"],
      ],
      col_w=[0.9, 6.6, 4.5], size=11, hsize=11, row_h=0.34, header_h=0.32, first_bold=True)
note_(s, ML, 6.08, CW, "",
     "上の12件は、いずれも「業務の決めごと」であって、システムの都合ではありません。"
     "決まり次第、そのとおりに作ります。現時点で決まっているものがあれば教えてください。",
     accent=AMBER, fill=AMBER_L)

s = sl_("作りかけのもの(入れ物はあるが画面が無い)", "第17章 まだ決まっていないこと")
card(s, ML, BODY_TOP, 6.16, 2.4, "画面まで動くもの", accent=GREEN, items=[
    {'t': "顧客・世帯構成員の登録と一覧"},
    {'t': "保育日報・事故報告の登録"},
    {'t': "領収書(実費報告)の登録・一覧・取り消し"},
    {'t': "勤怠(出勤簿)の入力と月次集計"},
    {'t': "割引クーポンの登録・配布・適用"},
    {'t': "AIに渡す文面の編集(版の履歴・既定に戻す)"},
    {'t': "日報AIの年齢帯・教育の言葉・判定基準・ご家庭の設定・生成の記録"},
], body_size=11)
card(s, ML + 6.36, BODY_TOP, 6.16, 2.4, "記録する場所だけ決めてあるもの", accent=AMBER, items=[
    {'t': "顧客カルテ(写真の表示のしくみが未実装)"},
    {'t': "予約・サービスメニュー・スタッフ割当・受付枠"},
    {'t': "請求書・請求明細・入金・決済"},
    {'t': "特性・相性・移動時間の見積"},
    {'t': "移動手当の単価マスタ・移動区間"},
], body_size=11)
note_(s, ML, 3.85, CW, "「作りかけ」だからこそ、いま見ていただきたい",
     "右側の項目は、記録する場所(シートと見出し)だけを先に決めた状態です。"
     "画面も無く、データも1件も入っていないので、"
     "「この項目は要らない」「この項目が足りない」というご指摘を、いま反映するのがいちばん安く済みます。\n"
     "逆に、左側の「画面まで動くもの」も本番運用はまだ始めていないため、同じく変更できます。",
     accent=ACCENT, fill=ACCENT_L)
card(s, ML, 5.35, CW, 1.45, "本番環境について", accent=MUTED, items=[
    {'t': "本番のサーバー・データベースはまだ用意していません。"
          "バックアップ・保存時の暗号化・アクセス権限の設定は、本番を作るときにまとめて行います。"},
    {'t': "現在動いているのは、開発用の環境と、動きを見ていただくための公開デモだけです。"
          "デモには実在するお客様の情報は入っていません。"},
], body_size=11.5)

# ══════════════════════════════════════════════════════════════
# 第18章 レビューの進め方
# ══════════════════════════════════════════════════════════════
sec_("第18章", "ご確認の進め方", "お手数をおかけしますが、よろしくお願いいたします")

s = sl_("ご確認の進め方", "第18章 ご確認の進め方")
steps = [
    ("1", "ご自身の担当業務の章から", ACCENT,
     "全部を通して見る必要はありません。日々触っている業務の章("
     "受付なら第6章、締めなら第8・9・11章)だけでも十分です。"),
    ("2", "「記録している項目」を見て、足りないものを挙げる", GREEN,
     "Excelの見出し行を見るつもりでご覧ください。"
     "「この項目が無いと困る」が1つでもあれば、それが一番ありがたいご指摘です。"),
    ("3", "「確認していただきたいこと」に答える", VIOLET,
     "質問の形で並べています。「これで問題ない」の一言でも構いません。"
     "分からない・判断できないものは飛ばしてください。"),
    ("4", "気になったことは何でも書き添える", AMBER,
     "「そもそもこの業務はこうではない」といった前提のズレのご指摘が、"
     "いちばん大きな手戻りを防ぎます。"),
]
y = BODY_TOP
for no, t, col, desc in steps:
    h = 0.82
    rect(s, ML, y, CW, h, fill=WHITE, border=LINE, border_w=1.0)
    rect(s, ML, y, 0.075, h, fill=col, border=None, shape=MSO_SHAPE.RECTANGLE)
    box(s, ML + 0.24, y + 0.2, 0.42, 0.42, no, fill=col, border=None, color=WHITE, size=14,
        bold=True, radius=0.5)
    text(s, ML + 0.82, y + 0.13, 4.5, 0.3, t, size=12, color=col, bold=True)
    text(s, ML + 0.82, y + 0.42, CW - 1.1, h - 0.5, desc, size=11, color=INK, line=1.4)
    y += h + 0.14
note_(s, ML, y + 0.02, CW, "優先してご確認いただきたい章",
     "時間が限られている場合は、第6章(予約)・第8章(領収書)・第11章(請求と入金)・第13章(移動と手当)の"
     "4つを優先してください。この4つは、決まっていないことが多く、"
     "かつ金額に直結するため、後から直すときの影響がいちばん大きい箇所です。",
     accent=AMBER, fill=AMBER_L)

s = sl_("ご回答の書き方(例)", "第18章 ご確認の進め方",
        source="形式は問いません。メール・チャット・この資料への書き込み、どれでも構いません")
table(s, ML, BODY_TOP, CW,
      ["章・ページ", "対象", "ご指摘・ご回答", "急ぎ度"],
      [
          ["第3章", "顧客の項目", "「鍵の受け渡し方法」が必要。宅配ボックス・キーボックス・手渡しの3種類がある", "高"],
          ["第6章", "予約の状態", "「仮予約」が必要。電話で押さえてから正式確定まで2〜3日空くことがある", "高"],
          ["第8章", "締め日", "締めは毎月20日。取り消しは25日まで認めている", "高"],
          ["第9章", "訪問の件数", "4件入る日が月に2〜3回ある", "高"],
          ["第10章", "クーポンの併用", "併用は不可。1回の訪問につき1枚まで", "中"],
          ["第12章", "割当の条件", "車の有無、お子様の年齢、過去の担当実績の3つを見ている", "中"],
          ["第5章", "カルテの区分", "この7つで問題ない", "—"],
      ],
      col_w=[1.1, 1.9, 8.3, 0.9], size=10.5, hsize=10.5, row_h=0.44, header_h=0.34, first_bold=True)
card(s, ML, 4.65, 6.16, 1.25, "急ぎ度の目安", accent=ACCENT, items=[
    {'t': [("高 ", {'bold': True}), ("— これが無いと業務が回らない / 金額が合わない", {})]},
    {'t': [("中 ", {'bold': True}), ("— 運用でしのげるが、あると助かる", {})]},
    {'t': [("低 ", {'bold': True}), ("— いずれ欲しい", {})]},
], body_size=11)
card(s, ML + 6.36, 4.65, 6.16, 1.25, "ご指摘の書き方のコツ", accent=GREEN, items=[
    {'t': "「なぜ必要か」を一言添えていただけると、似た抜けをこちらで一緒に探せます"},
    {'t': "実際の件数・頻度(月に◯回、全体の◯割)があると、優先順位を付けられます"},
], body_size=11)
note_(s, ML, 6.05, CW, "",
     "分量が多いので、章ごとに分けてご返信いただいても構いません。"
     "気づいた順にお送りいただくのがいちばん助かります。",
     accent=MUTED, fill=CARD)

s = sl_("まとめ", "第18章 ご確認の進め方")
card(s, ML, BODY_TOP, 4.06, 2.4, "この資料は何だったか", accent=ACCENT, items=[
    {'t': "新しい業務システムが「何を記録するか」の一覧です"},
    {'t': "データベースをExcelのブックに置き換えて、シート(44枚)と見出し行の形でご説明しました"},
    {'t': "専門用語は括弧に添えるだけで、本文には使っていません"},
], body_size=11.5)
card(s, ML + 4.26, BODY_TOP, 4.06, 2.4, "お願いしたいこと", accent=VIOLET, items=[
    {'t': [("項目の抜け", {'bold': True}), ("(記録したいのに一覧に無いもの)", {})]},
    {'t': [("選択肢の抜け", {'bold': True}), ("(状態・区分に足りない選択肢)", {})]},
    {'t': [("ルールの食い違い", {'bold': True}), ("(実際の運用とのズレ)", {})]},
], body_size=11.5)
card(s, ML + 8.52, BODY_TOP, 4.06, 2.4, "いま見ていただく理由", accent=GREEN, items=[
    {'t': "本稼働前で、データが1件も入っていない段階です"},
    {'t': "いまなら、項目を足すのも作り直すのも短時間で済みます"},
    {'t': "運用開始後だと、入力済みのデータを全件直す作業が付いてきます"},
], body_size=11.5)
note_(s, ML, 3.9, CW, "この資料に無いもの",
     "技術的な妥当性(安全性・性能・設計の作法)は、この資料の対象外です。"
     "そちらは別の資料(データベース構造レビュー資料)で、データベースの専門家に見ていただきます。"
     "ここでお願いしたいのは、業務をご存じの方にしか分からない「抜け」だけです。",
     accent=MUTED, fill=CARD)
text(s, ML, 5.35, CW, 0.6, "お忙しいところ恐れ入りますが、よろしくお願いいたします。",
     size=15, color=INK, bold=True, align=PP_ALIGN.CENTER)
text(s, ML, 6.0, CW, 0.6, "ご不明な点は、どの章のどのページかだけ教えていただければ、個別にご説明にうかがいます。",
     size=11.5, color=MUTED, align=PP_ALIGN.CENTER)

prs.save(OUT)
print("%s (%d slides)" % (OUT, len(prs.slides.__iter__.__self__._sldIdLst)))
