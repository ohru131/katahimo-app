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
    "訪問保育(ベビーシッター法人)向け業務SaaS — PostgreSQL / 33テーブル",
    "現状の構成 ・ 設計上の問題点 ・ ご相談したいこと\n"
    "実装は packages/db/src/schema/*.ts が正 / 本番未配備・運用開始前",
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

text(s, ML, 3.9, CW, 0.3, "資料の構成(全29ページ)", size=13, color=INK, bold=True)
chs = [
    ("第1章", "まず用語から", "表・主キー・外部キー・\nトランザクション・RLS", ACCENT, ACCENT_L, "P4–5"),
    ("第2章", "現状の構成", "33テーブルの全体像と、\nテナント分離・データ保護", GREEN, GREEN_L, "P6–17"),
    ("第3章", "設計上の問題点", "customers 37列の肥大化ほか\n6件を自己申告", RED, RED_L, "P18–24"),
    ("第4章", "相談事項", "先行して用意したスキーマと、\n判断いただきたい論点", VIOLET, VIOLET_L, "P25–29"),
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
           ("  … Excelの1シートに相当。このシステムには33枚ある", {"size": 12})]},
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
s = sl_("用語② 制約・索引・トランザクション", "この先の図を読むのに必要な8語",
        source="RLS・封筒暗号化は第2章で図解します")
rows = [
    ["UNIQUE(一意制約)", "「この列の組み合わせは重複禁止」というルール",
     "同じメールで2人登録できないようにする"],
    ["CHECK(検査制約)", "「この列に入ってよい値」をデータベース側で縛るルール",
     "区分値・1〜5の評価・0以上の金額をDBが拒否する"],
    ["INDEX(索引)", "本の巻末索引。全ページ読まずに目的の行へ飛べる",
     "「姓が佐藤の顧客」を全件走査せず引く"],
    ["トランザクション", "複数の書き込みを「まとめて確定/まとめて取消」する単位",
     "日報の保存と通知予約を、揃って成立させる"],
    ["RLS(行レベルセキュリティ)", "データベース自身が持つ「見える行の絞り込み」機能",
     "他社のデータは、そもそも見えなくする"],
    ["マイグレーション", "表の設計変更の手順書。SQLのファイルを積み上げていく",
     "運用前のいまは 0000_baseline_schema の1本。配備後は積み増す"],
    ["ORM(Drizzle)", "表の定義をTypeScriptで書き、SQLを生成する道具",
     "列の型がプログラム側の型と食い違うのを防ぐ"],
    ["JSONB", "1つの列の中にJSON(入れ子の構造)をまとめて入れる型",
     "勤怠の1日分をまるごと1列に入れている"],
]
table(s, ML, 1.28, 7.75, ["用語", "ふだんの言葉で言うと", "このシステムでの使い所"], rows,
      col_w=[2.0, 3.3, 3.1], size=10.5, hsize=10.5, row_h=0.56, header_h=0.34, first_bold=True)

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
     "33テーブルの全体像と、テナント分離・データ保護・トランザクションの考え方")

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
card(s, ML + 6.2, 4.15, 6.13, 1.35, "この①〜④の外側に、まだ実装の無い5領域がある", accent=ORANGE, items=[
    {"t": "予約 / 請求・決済 / 顧客カルテ / 訪問割当の最適化 / 移動手段別の手当。"
          "表と制約だけ先に用意してあり、この資料の第4章で扱う"},
], body_size=11.5)
note(s, ML, 5.72, CW, 1.1, "設計の出発点",
     "現行のGoogle Apps Script版は、データがすべてスプレッドシートとDriveにあり、1法人・1Googleアカウントに強く依存しています。"
     "これを複数法人(テナント)が同居できる形に作り替えるのが今回の目的です。したがって「他社のデータが混ざらないこと」が"
     "設計上の最優先事項になっています。",
     accent=ACCENT, fill=ACCENT_L)

# ══════════════════════════════════════════════════════════════
# 8. 全体像 33テーブル
# ══════════════════════════════════════════════════════════════
s = sl_("全体像 — 33テーブル", "業務ドメインごとに10のまとまり。tenants以外の32枚はすべて同じ形を守る",
        source="packages/db/src/schema/*.ts / 詳細なER図は doc/09 第2章")

chip_row(s, ML, 1.12, [("全テーブルが tenant_id を持つ", ACCENT, ACCENT_L),
                       ("紫 = 稼働中", VIOLET, VIOLET_L),
                       ("橙 = スキーマのみ", ORANGE, ORANGE_L),
                       ("関係の矢印は doc/09 のER図", MUTED, CARD)], size=9.5)

GW, GG = 2.34, 0.16


def group_box(x, y, title, n, names, col, fl):
    h = 1.75
    rect(s, x, y, GW, h, fill=WHITE, border=col, border_w=1.2)
    fill_text(rect(s, x, y, GW, 0.4, fill=col, border=None, shape=MSO_SHAPE.RECTANGLE),
              f"{title} ({n})", size=10.5, color=WHITE, bold=True)
    text(s, x + 0.12, y + 0.48, GW - 0.24, h - 0.56, "\n".join(names), size=8, color=INK,
         font=MONO, line=1.5)


text(s, ML, 1.5, 6.0, 0.26, "稼働中 — アプリが読み書きしている15枚", size=11.5, color=VIOLET,
     bold=True)
live = [
    ("テナント基盤", 4, ["tenants", "tenant_keys", "app_settings", "outbox_jobs"]),
    ("認証・スタッフ", 3, ["staff", "sessions", "password_reset_codes"]),
    ("顧客", 2, ["customers", "family_members"]),
    ("訪問の記録", 4, ["daily_reports", "accident_reports", "receipts", "attendance_days"]),
    ("割引クーポン", 2, ["coupons", "coupon_redemptions"]),
]
cx = ML
for ttl, n, names in live:
    group_box(cx, 1.8, ttl, n, names, VIOLET, VIOLET_L)
    cx += GW + GG

text(s, ML, 3.78, 8.5, 0.26, "スキーマだけ先に用意 — 表と制約はあるが、実装・API・画面はこれから(18枚)",
     size=11.5, color=ORANGE, bold=True)
planned = [
    ("顧客カルテ", 2, ["customer_notes", "customer_note_photos"]),
    ("予約", 4, ["service_menus", "reservations", "reservation_assignments", "staff_availabilities"]),
    ("請求・決済", 5, ["customer_payment_profiles", "invoices", "invoice_lines", "payments",
                   "stripe_webhook_events"]),
    ("訪問割当の最適化", 5, ["trait_definitions", "customer_traits", "staff_traits",
                      "staff_customer_compatibilities", "staff_customer_travel_estimates"]),
    ("移動手段と手当", 2, ["transport_allowance_rules", "travel_legs"]),
]
cx = ML
for ttl, n, names in planned:
    group_box(cx, 4.08, ttl, n, names, ORANGE, ORANGE_L)
    cx += GW + GG

note(s, ML, 6.02, CW, 0.78, "例外は3つだけ",
     "① tenants だけRLSの対象外(ログイン前に法人を特定するため)  "
     "② receipts.customer_id だけ空を許す(顧客に紐付かない経費)  "
     "③ sessions.token_hash だけ法人を越えて一意",
     accent=AMBER, fill=AMBER_L, size=10.5, lsize=10)

# ══════════════════════════════════════════════════════════════
# 9. テーブル一覧① 稼働中の15枚
# ══════════════════════════════════════════════════════════════
s = sl_("テーブル一覧① — 稼働中の15枚", "アプリが実際に読み書きしている表と、鍵になる制約",
        source="RLS = 行レベルセキュリティ(そのテナントの行しか見えなくするDB側の仕組み)")
rows = [
    ["tenants", "法人(テナント)マスタ", "slug で一意。ログイン前に法人を特定する", "対象外"],
    ["tenant_keys", "テナントごとの暗号鍵(ラップ済み)", "PK=(tenant_id, dek_version) 世代が並存", "○"],
    ["app_settings", "テナント単位の管理者設定", "1テナント1行。資格情報3列だけ暗号化", "○"],
    ["outbox_jobs", "スプレッドシート書き戻しの待ち行列", "UNIQUE(tenant_id, idempotency_key)", "○"],
    ["staff", "スタッフ。認証情報も兼ねる", "UNIQUE(tenant_id, email) / (tenant_id, id)", "○"],
    ["sessions", "ログインセッション", "生トークンは保存せずSHA-256のみ", "○"],
    ["password_reset_codes", "パスワード再設定の6桁コード", "HMACの検証子のみ保存。30分・5回で無効", "○"],
    ["customers", "顧客(利用世帯の代表者)。37列", "UNIQUE(tenant_id, external_source, external_id)", "○"],
    ["family_members", "世帯構成員(子ども等)", "customers への複合FK。生年月日は date + 元表記", "○"],
    ["daily_reports", "保育日報。本文は項目ごとの5列", "staff と customers 双方への複合FK", "○"],
    ["accident_reports", "事故報告 / ヒヤリハット。本文11列", "同上。report_type は CHECK で2値に限定", "○"],
    ["receipts", "領収書。画像はオブジェクトストレージ", "金額は整数の円。billing_type で顧客請求/会社経費", "○"],
    ["attendance_days", "勤怠(出勤簿)1日分", "UNIQUE(tenant_id, staff_id, business_date)", "○"],
    ["coupons", "割引クーポンの種別マスタ", "UNIQUE(tenant_id, code)。廃止は active=false", "○"],
    ["coupon_redemptions", "日報1件への割引クーポン適用記録", "UNIQUE(tenant_id, daily_report_id, coupon_id)", "○"],
]
cc = {(0, 3): MUTED}
table(s, ML, 1.25, CW, ["テーブル", "役割", "鍵になる制約・特徴", "RLS"], rows,
      col_w=[2.2, 3.9, 5.4, 0.75], size=10, hsize=10.5, row_h=0.29, header_h=0.33,
      first_bold=True, cell_colors=cc,
      aligns=[PP_ALIGN.LEFT, PP_ALIGN.LEFT, PP_ALIGN.LEFT, PP_ALIGN.CENTER])
note(s, ML, 6.0, 6.0, 1.0, "「複合FK」とは(次章で図解します)",
     "外部キーを (tenant_id, customer_id) の2列セットにしたもの。「そのIDが本当に同じ法人の行か」を"
     "データベース自身に確かめさせるための工夫です。",
     accent=ACCENT, fill=ACCENT_L, size=11)
note(s, ML + 6.33, 6.0, 6.0, 1.0, "この15枚が「土台」です",
     "提案書の差別化要因(予約・請求・カルテ)は、次ページの18枚としてスキーマだけ先に用意してあります。",
     accent=ORANGE, fill=ORANGE_L, size=11)

# ══════════════════════════════════════════════════════════════
# 9b. テーブル一覧② 先行整備の18枚
# ══════════════════════════════════════════════════════════════
s = sl_("テーブル一覧② — スキーマだけ先に用意した18枚", "実装・API・画面はこれから",
        source="doc/15_追加ドメインの設計とレビュー論点.md", accent=ORANGE)
rows2 = [
    ["customer_notes", "カルテ", "カルテ・申し送り・鍵の位置・ガレージ・引継ぎ・注意点を区分で持つ1枚"],
    ["customer_note_photos", "カルテ", "上の子。写真は実体を持たず保存キーのみ。10MB・10枚をCHECKで制限"],
    ["service_menus", "予約", "提供メニュー。RESERVA由来は external_source + external_id で突合"],
    ["reservations", "予約", "予約(約束)。日報(実施記録)とは別。end_at > start_at をCHECK"],
    ["reservation_assignments", "予約", "予約へのスタッフ割当。主担当は1予約1人までを部分一意索引で保証"],
    ["staff_availabilities", "予約", "スタッフの稼働可能枠。曜日指定か特定日かの排他をCHECK"],
    ["customer_payment_profiles", "決済", "Stripeの顧客ID・支払方法ID・ブランド・下4桁。カード番号は持たない"],
    ["invoices", "決済", "請求書。total = subtotal − discount + tax をCHECKで強制"],
    ["invoice_lines", "決済", "明細。同じ領収書・同じクーポンが2行に載らないよう部分一意索引"],
    ["payments", "決済", "入金。状態の語はStripeのPaymentIntent statusに合わせ、対応表を持たない"],
    ["stripe_webhook_events", "決済", "Webhookの冪等化。UNIQUE(tenant_id, stripe_event_id)"],
    ["trait_definitions", "最適化", "特性の項目マスタ。顧客用/スタッフ用を subject_kind で区別"],
    ["customer_traits", "最適化", "顧客の特性値。型ごとに列を分け「ちょうど1つだけ非NULL」をCHECK"],
    ["staff_traits", "最適化", "スタッフの特性値。同上"],
    ["staff_customer_compatibilities", "最適化", "相性。スコア(1〜5)と「絶対に組ませない」を別の列にしている"],
    ["staff_customer_travel_estimates", "最適化", "自宅・訪問先間の所要時間と距離。移動手段ごとに1行"],
    ["transport_allowance_rules", "手当", "移動手段別の手当。距離比例/1移動定額/1日定額/実費の4通り"],
    ["travel_legs", "手当", "移動1区間の実績。手段・距離・時間・運賃・手当額"],
]
domcol = {"カルテ": PINK, "予約": ACCENT, "決済": GREEN, "最適化": VIOLET, "手当": ORANGE}
cc2 = {(i, 1): domcol[r[1]] for i, r in enumerate(rows2)}
table(s, ML, 1.22, CW, ["テーブル", "領域", "役割と、鍵になる制約"], rows2,
      col_w=[3.3, 1.1, 7.85], size=10, hsize=10.5, row_h=0.275, header_h=0.30,
      first_bold=True, cell_colors=cc2,
      aligns=[PP_ALIGN.LEFT, PP_ALIGN.CENTER, PP_ALIGN.LEFT])
text(s, ML, 6.52, CW, 0.4,
     "この18枚も既存15枚と同じ規約(tenant_id + RLS + 複合外部キー + CHECK + updated_at トリガー)に載せてあります。"
     "先に作った理由と、そこで迷った判断は第4章(P26・P27)で扱います。",
     size=10.5, color=MUTED, line=1.3)

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
    {"t": "静的検査:全33テーブル分のSQLに ENABLE と FORCE、ポリシーの条件が揃っているかを機械的に検査。"
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
     "この落とし穴は過去のレビューでご指摘いただいて塞いだものです。参照先には UNIQUE(tenant_id, id) を張ってあります。"
     "ON DELETE は全て no action(親を消せない)にしており、廃棄はテナント単位の物理削除で行う方針です。",
     accent=ACCENT, fill=ACCENT_L, size=11)

# ══════════════════════════════════════════════════════════════
# 13. データ保護の線引き
# ══════════════════════════════════════════════════════════════
s = sl_("データ保護の線引き", "アプリ側で暗号化するのは資格情報だけ。業務データは平文列で持つ",
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

card(s, ML + 6.33, 2.95, 6.0, 1.6, "法人ごとに独立生成する理由", accent=ACCENT, items=[
    {"t": "「マスター鍵 + 法人ID」から鍵を計算する方式にすると、マスター鍵が漏れれば"
          "全法人の鍵を誰でも再現できる。それは実質、鍵を1本共有しているのと変わらない"},
    {"t": "そのため法人ごとにランダム生成した鍵を、包んだ状態で保存している"},
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
s = sl_("33テーブルで守っている共通ルール", "表ごとに判断がぶれないよう、形を決めてある",
        source="doc/09 / packages/db/src/schema/*.ts のコメントに理由を記載")
left = [
    ("主キーは必ず uuid のランダム値", "連番にしない。件数が外から推測できず、採番の集中点も作らない"),
    ("日時は必ず timestamptz", "タイムゾーン付き。業務上の「日」だけ date(勤怠の business_date)"),
    ("派生値は保存しない", "残業時間・移動距離などは入力値から毎回計算する。二重管理を作らない"),
    ("削除しない", "顧客の退会は deactivated_at を立てるだけ。物理削除の経路を持たない"),
    ("updated_at はDBのトリガーが更新", "アプリのコードでは書かない。書き忘れを構造的に起こせなくする"),
]
right = [
    ("参照はすべて2列セットの外部キー", "(tenant_id, xxx_id) → (tenant_id, id)。法人跨ぎを構造的に防ぐ"),
    ("索引・一意制約は tenant_id を先頭に", "staff(tenant_id, email) / customers(tenant_id, family_name)"),
    ("外部システム由来の値は隔離する", "external_source + external_id にまとめ、その組で一意にする"),
    ("区分値はDBのCHECK制約で縛る", "許可値の配列は contracts/ の1か所に置き、そこからDDLを組み立てる"),
]
for col_i, group in enumerate([left, right]):
    x = ML + col_i * 6.33
    for i, (ttl, body) in enumerate(group):
        y = 1.26 + i * 0.85
        rect(s, x, y, 6.0, 0.75, fill=WHITE, border=LINE)
        rect(s, x, y, 0.075, 0.75, fill=ACCENT if col_i == 0 else GREEN, border=None,
             shape=MSO_SHAPE.RECTANGLE)
        text(s, x + 0.22, y + 0.07, 5.6, 0.26, ttl, size=11,
             color=ACCENT if col_i == 0 else GREEN, bold=True)
        text(s, x + 0.22, y + 0.34, 5.65, 0.4, body, size=10, color=INK, line=1.28)

note(s, ML, 5.6, 6.0, 1.3, "この規約のおかげで楽になっていること",
     "新しい表を足すときに考えることが少ない(同じ形をコピーすればよい)。"
     "RLSとupdated_atトリガーの張り忘れはCIが機械的に検出する。第4章の18枚も、この形にそのまま載せてあります。",
     accent=GREEN, fill=GREEN_L)
note(s, ML + 6.33, 5.6, 6.0, 1.3, "規約の副作用も出ている(第3章)",
     "「派生値を保存しない」は二重管理を防ぐ一方、月次集計を毎回全件計算することになります。"
     "「削除しない」は事故を防ぐ一方、廃棄の手順を別に整備しないと契約上の返還・削除義務を果たせません。",
     accent=AMBER, fill=AMBER_L)

# ══════════════════════════════════════════════════════════════
# 17. 第3章 divider
# ══════════════════════════════════════════════════════════════
sec_("第 3 章", "設計上の問題点(自己申告)",
     "気づいている弱点を6件並べます。ここが今回いちばんご意見をいただきたい部分です")

# ══════════════════════════════════════════════════════════════
# 18. 問題① customers 37列
# ══════════════════════════════════════════════════════════════
s = sl_("問題① customers が37列に肥大化している", "外部CSVの全項目を1枚の表で受けた結果",
        source="packages/db/src/schema/customers.ts / doc/09 4.1節", accent=RED)
text(s, ML, 1.2, CW, 0.3,
     "外部予約システム(RESERVA)の顧客CSVを「1項目も落とさず取り込む」方針にしたため、CSVの列がほぼそのまま列になっている。",
     size=12, color=INK)
cats = [
    ("識別子", 4, "id / tenant_id / 取込元 / 取込元ID", ACCENT),
    ("氏名", 5, "表示名 / 姓 / 名 / かな2種", ACCENT),
    ("連絡先・住所", 7, "メール / 電話 / 市区 / 住所 / 駐車場2種 / 第2住所", VIOLET),
    ("第三者情報・自由記述", 4, "緊急連絡先 / 続柄 / 避難場所 / メモ", PINK),
    ("位置情報", 3, "緯度 / 経度 / 取込元の生表記", PINK),
    ("他システムの会員証", 1, "Benefit会員ID", PINK),
    ("運用区分", 6, "会員種別 / 状態 / 支払方法 / 支払状況 / 性別 / 年代", GREEN),
    ("日時", 7, "登録日 / 外部更新日 / 第2住所の期間2列 / 退会日 / 作成・更新", MUTED),
]
text(s, ML, 1.58, 5.9, 0.28, "現状:1枚に8カテゴリが同居している", size=12, color=RED, bold=True)
yy = 1.9
for nm, n, cols, col in cats:
    rect(s, ML, yy, 5.9, 0.38, fill=WHITE, border=LINE)
    rect(s, ML, yy, 0.06, 0.38, fill=col, border=None, shape=MSO_SHAPE.RECTANGLE)
    text(s, ML + 0.16, yy + 0.04, 2.1, 0.3, nm, size=10.5, color=col, bold=True)
    text(s, ML + 2.28, yy + 0.04, 0.55, 0.3, f"{n}列", size=10.5, color=INK, bold=True,
         align=PP_ALIGN.RIGHT)
    text(s, ML + 2.95, yy + 0.07, 2.9, 0.3, cols, size=9, color=MUTED)
    yy += 0.44
box(s, ML, yy, 5.9, 0.36, "合計 37列(1テーブル)", fill=RED_L, border=None, color=RED, size=11.5,
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
     "「37列は多すぎるので分けるべき」か、「顧客マスタなら37列は普通で分けるほうが害」か。判断の基準"
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
# 20. 問題③ 予約の二重取りをDBで止められていない
# ══════════════════════════════════════════════════════════════
s = sl_("問題③ 予約の二重取りをDBで止められていない",
        "同じスタッフに時間の重なる予約を2件入れられる",
        source="packages/db/src/schema/reservations.ts / doc/15 §2", accent=RED)
text(s, ML, 1.2, CW, 0.3,
     "「同じスタッフ・時間帯が重なる予約は1件まで」は、本来 PostgreSQL の除外制約(EXCLUDE)で"
     "データベース自身に守らせられる。それが使えていない。",
     size=12, color=INK)

text(s, ML, 1.58, 6.0, 0.28, "本来書きたかった制約", size=12, color=GREEN, bold=True)
rect(s, ML, 1.88, 6.0, 1.0, fill=CARD, border=LINE)
text(s, ML + 0.18, 1.98, 5.65, 0.85,
     'EXCLUDE USING gist (\n'
     '  tenant_id WITH =, staff_id WITH =,\n'
     '  tstzrange(start_at, end_at) WITH &&)',
     size=10.5, color=INK, font=MONO, line=1.35)
text(s, ML, 2.96, 6.0, 0.5,
     "「同じ法人・同じスタッフで、時間の範囲が重なる行は入れさせない」を1行で表せる。"
     "アプリが何度呼ばれても、同時に呼ばれても、破れない。",
     size=10.5, color=MUTED, line=1.3)

text(s, ML, 3.52, 6.0, 0.28, "使えない理由", size=12, color=RED, bold=True)
bullets(s, ML, 3.82, 6.0, 1.4, [
    {"t": [("EXCLUDE には btree_gist 拡張が要る", {"bold": True}),
           ("。公開デモとテストで使っているブラウザ内PostgreSQL(PGlite)には、この拡張が存在しない"
            "(実機で確認済み)", {})]},
    {"t": "本番だけで有効にすると、テストが通っているのに本番だけ制約があるという「環境で形が違う」"
          "状態になり、いちばん危ない"},
], size=10.5, line=1.3, gap=6)

text(s, ML + 6.33, 1.58, 6.0, 0.28, "考えられる4案(どれを採るべきかご相談したい)", size=12,
     color=VIOLET, bold=True)
opts = [
    ("A 本番だけ EXCLUDE を張る", "守りは最強。ただしテスト環境と本番でスキーマが分岐する", AMBER),
    ("B アプリ側で直列化して確認する", "予約作成時にスタッフ行をロックして重なりを検査。"
     "実装の書き忘れが即バグになる", AMBER),
    ("C 時間枠を固定スロットにする", "開始時刻を30分刻みに丸め、(staff_id, slot) を一意にする。"
     "自由な時間帯が表せなくなる", MUTED),
    ("D 重なりを許し、運用で気づかせる", "検知クエリを定期実行して警告する。事故は起きうる", RED),
]
yy = 1.90
for ttl, body, col in opts:
    rect(s, ML + 6.33, yy, 6.0, 0.86, fill=WHITE, border=col, border_w=1.2)
    text(s, ML + 6.5, yy + 0.07, 5.65, 0.26, ttl, size=11, color=col, bold=True)
    text(s, ML + 6.5, yy + 0.34, 5.7, 0.46, body, size=10, color=INK, line=1.28)
    yy += 0.94
text(s, ML + 6.33, 5.64, 6.0, 0.5,
     "現状は制約を張らず、予約の作成処理が重なりを検査する前提にしてあります"
     "(その処理もまだ実装していません)。",
     size=10, color=MUTED, line=1.3)

note(s, ML, 5.30, 6.0, 1.0, "同じ形の穴が他にもある",
     "「同じ顧客に同時刻の予約を2件入れない」なども、範囲の重なりで表す種類の制約です。"
     "1つ方針を決めれば、まとめて同じやり方に揃えられます。",
     accent=AMBER, fill=AMBER_L, size=10.5)
note(s, ML, 6.22, CW, 0.6, "ご相談したいこと(相談③)",
     "A〜Dのどれを採るべきでしょうか。テスト環境と本番でスキーマが違うことを許容してでも、"
     "DB側で守るべき種類の制約でしょうか。",
     accent=RED, fill=RED_L, size=11)

# ══════════════════════════════════════════════════════════════
# 21. 問題④ 勤怠は正規化の途中
# ══════════════════════════════════════════════════════════════
s = sl_("問題④ 勤怠だけJSONを1列に入れている",
        "キーと型は直したが、明細テーブルへの分解はまだ",
        source="packages/db/src/schema/attendanceDays.ts / doc/14 §2", accent=RED)
text(s, ML, 1.2, CW, 0.3,
     "日報・事故報告は項目ごとの列に分けたが、勤怠は1日分をJSONのまま1列(row_data)に入れている。",
     size=12, color=INK)

text(s, ML, 1.58, 6.0, 0.28, "いまの形 attendance_days.row_data(jsonb)", size=12, color=GREEN,
     bold=True)
rect(s, ML, 1.88, 6.0, 1.5, fill=CARD, border=LINE)
text(s, ML + 0.18, 1.98, 5.65, 1.35,
     '{ "visits": [\n'
     '    { "place": "○○邸", "startTime": "9:00",\n'
     '      "endTime": "12:00", "distanceKm": 12.4 }, … ],\n'
     '  "officeWork": [ … ] }',
     size=10, color=INK, font=MONO, line=1.35)
bullets(s, ML, 3.48, 6.0, 1.6, [
    {"t": [("キーは意味のある名前にしてある", {"bold": True, "color": GREEN}),
           ("。以前はスプレッドシートの列記号(C / D / AG …)だった。"
            "何を指す値かがデータベースから読めるようになり、訪問件数の上限も外れた", {})]},
    {"t": [("時刻・距離も型のある値にしてある", {"bold": True, "color": GREEN}),
           ("。形は contracts/attendance.ts のスキーマが正で、保存前にアプリ境界で検証する", {})]},
    {"t": "jsonb 1列のままなのは、常に「1日分をまるごと読み書き」する用途しかないため"},
], size=10.5, line=1.3, gap=6)

text(s, ML + 6.33, 1.58, 6.0, 0.28, "それでも残っている弱点", size=12, color=RED, bold=True)
weak = [
    ("型のチェックがデータベース側で効かない", "JSONの中身は jsonb_typeof='object' しか見ていない。"
     "数値のはずの場所に文字列が入ってもDBは受け入れる"),
    ("集計がしにくい", "「残業が多い月」「訪問距離の合計」を出すには、全行のJSONを読んで計算する必要がある"),
    ("社労士・監査への説明がしづらい", "列の一覧がスキーマに現れないため、何を保存しているかを"
     "データベースの定義だけでは示せない"),
]
yy = 1.9
for ttl, body in weak:
    rect(s, ML + 6.33, yy, 6.0, 0.78, fill=WHITE, border=RED, border_w=1.1)
    text(s, ML + 6.5, yy + 0.05, 5.65, 0.26, ttl, size=11, color=RED, bold=True)
    text(s, ML + 6.5, yy + 0.31, 5.7, 0.42, body, size=10, color=INK, line=1.28)
    yy += 0.85
card(s, ML + 6.33, 4.46, 6.0, 0.98, "分解する場合の行き先(設計済み・未実施)", accent=ACCENT,
     items=[
    {"t": [("attendance_segments", {"font": MONO, "bold": True}),
           ("(訪問・事務作業の1区間 = 1行)に分け、日次の値だけ attendance_days に数値列として残す", {})]},
], body_size=10.5)

note(s, ML, 5.48, CW, 0.66, "いま分解していない理由",
     "給与計算はGAS版と1円もずれてはいけないため、実際の出勤簿での照合が済むまで保存形式を動かしません。",
     accent=AMBER, fill=AMBER_L, size=11)
note(s, ML, 6.22, CW, 0.66, "ご相談したいこと(相談④)",
     "照合の前に分解すべきでしょうか。1日分をまるごと扱う使い方でも明細テーブルに分けるべきでしょうか。",
     accent=RED, fill=RED_L, size=11)

# ══════════════════════════════════════════════════════════════
# 22. 問題⑤ 小さな設計負債
# ══════════════════════════════════════════════════════════════
s = sl_("問題⑤ 小さな設計負債", "気づいているが、まだ手を付けていないもの",
        source="doc/09 3.4節 / doc/15 §6 / README「実装状況」", accent=RED)
rows = [
    ["ON DELETE がすべて no action", "親(顧客・スタッフ)を消せない。廃棄はテナント単位の物理削除で行う方針",
     "契約上の返還・廃棄義務(秘密保持契約 第7条)に対する具体的な手順とバックアップ保持期間が未整備", "高"],
    ["索引の効き方を実機で確認していない", "主要な検索経路に複合索引を張っているが、"
     "EXPLAIN で Seq Scan → Index Scan を確認できていない",
     "本番相当のPostgreSQLもDockerも用意できておらず、索引が実際に使われているかは机上の判断のまま", "中"],
    ["実PostgreSQLに対する検証が薄い", "リポジトリ層のテストはブラウザ内DB(PGlite)で行っている",
     "本番ドライバ(postgres-js)固有の挙動差、コネクションプールと SET LOCAL の組み合わせを"
     "実環境で確認していない", "中"],
    ["使うクエリが決まる前に索引を張った表がある", "予約・請求・最適化の索引は、想定した検索経路から起こしている",
     "画面もAPIもまだ無いため、過剰な索引・足りない索引のどちらもありうる。書き込みの負担だけが先に増える", "中"],
    ["派生値を持たない方針の裏返し", "残業時間・月次集計などを毎回全件計算している",
     "件数が増えたときの性能を実運用の量で確認していない。負荷試験・障害注入は未実施", "中"],
    ["tenants だけRLSの対象外", "ログイン前に法人を特定する必要があるため、この表だけ絞り込みを外している",
     "アプリのロールが全法人の一覧を読める。法人名は個人情報ではないが、"
     "顧客リストの規模感は推測できてしまう", "低"],
]
table(s, ML, 1.28, CW, ["項目", "現状", "何が困るか", "重さ"], rows,
      col_w=[2.6, 3.5, 5.4, 0.75], size=10, hsize=10.5, row_h=0.72, header_h=0.33,
      first_bold=True,
      cell_colors={(0, 3): RED, (1, 3): AMBER, (2, 3): AMBER, (3, 3): AMBER, (4, 3): AMBER,
                   (5, 3): MUTED},
      aligns=[PP_ALIGN.LEFT, PP_ALIGN.LEFT, PP_ALIGN.LEFT, PP_ALIGN.CENTER])
note(s, ML, 6.0, CW, 0.9, "ご相談したいこと(相談⑤)",
     "この6件の優先順位付けが妥当かをご確認いただきたいです。特に「ON DELETE と廃棄手順」を最優先に置いていますが、"
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
sec_("第 4 章", "先行して用意したスキーマと、相談事項",
     "実装より先にDBの形だけ固めた5領域。そこで迷った判断と、まとめての相談事項")

# ══════════════════════════════════════════════════════════════
# 25. 先行整備した5領域
# ══════════════════════════════════════════════════════════════
s = sl_("実装より先に、DBの形だけ固めた5領域", "18テーブル。リポジトリ実装・API・画面はまだ無い",
        source="doc/15_追加ドメインの設計とレビュー論点.md", accent=ORANGE)
text(s, ML, 1.16, CW, 0.3,
     "あとから足すと既存データの移行が伴うため、運用前のいまのうちに表と制約だけ作ってあります。",
     size=12, color=INK)
plans = [
    ("顧客カルテ", PINK, [["customer_notes", "customer_note_photos"],
                     "カルテ・申し送り・鍵の位置・ガレージ場所・引継ぎ事項・注意点を区分で1枚に持つ",
                     "写真は子テーブル。実体は持たず保存キーのみ",
                     "customers の列にしないのは、上書きだと「いつ誰がその情報にしたか」が残らないため"]),
    ("予約(RESERVA移植版)", ACCENT, [["service_menus", "reservations",
                                "reservation_assignments", "staff_availabilities"],
                            "予約(約束)と日報(実施記録)は別の表。片方だけ存在する状態が正常にあり得るため",
                            "主担当は1予約1人までを部分一意索引で保証",
                            "二重取りの防止だけはDBで守れていない(第3章③)"]),
    ("請求・決済(Stripe)", GREEN, [["customer_payment_profiles", "invoices", "invoice_lines",
                              "payments", "stripe_webhook_events"],
                           "カード番号は受け取らず保存しない。Stripeの識別子とブランド・下4桁だけ",
                           "total = subtotal − discount + tax をCHECKで強制",
                           "Webhookは (tenant_id, event_id) の一意制約で冪等化"]),
    ("訪問割当の最適化", VIOLET, [["trait_definitions", "customer_traits", "staff_traits",
                           "staff_customer_compatibilities", "staff_customer_travel_estimates"],
                        "何を見て最適化するかが未確定のため、特性の項目そのものをデータにしてある",
                        "値はjsonbの塊にせず型ごとに列を分け、「ちょうど1つだけ非NULL」をCHECKで縛る",
                        "相性は「スコア」と「絶対に組ませない」を別の列に"]),
    ("移動手段と手当", ORANGE, [["transport_allowance_rules", "travel_legs"],
                        "自動車・公共交通機関・自転車・徒歩を選べる",
                        "手段ごとに計算方法(距離比例/1移動定額/1日定額/実費精算)と単価を持つ",
                        "金額への換算ロジックはGAS版にも無く、新規追加"]),
]
GW2, GG2 = 2.34, 0.16
cx = ML
for ttl, col, items in plans:
    rect(s, cx, 1.62, GW2, 4.0, fill=WHITE, border=col, border_w=1.3)
    fill_text(rect(s, cx, 1.62, GW2, 0.44, fill=col, border=None, shape=MSO_SHAPE.RECTANGLE),
              ttl, size=10.5, color=WHITE, bold=True)
    text(s, cx + 0.13, 2.12, GW2 - 0.26, 0.82, "\n".join(items[0]), size=7.5, color=col,
         font=MONO, line=1.45)
    bullets(s, cx + 0.13, 3.02, GW2 - 0.26, 2.5,
            [{"t": it, "s": 9} for it in items[1:]], size=9, line=1.3, gap=6, marker_color=col)
    cx += GW2 + GG2

card(s, ML, 5.78, 6.0, 1.12, "既存15枚と同じ規約に載せてある", accent=GREEN, items=[
    {"t": "tenant_id + RLS(FORCE)・(tenant_id, 参照先ID) の複合外部キー・金額は円の整数・"
          "updated_at はトリガー。張り忘れはCIが機械的に検出する"},
], body_size=10.5)
note(s, ML + 6.33, 5.78, 6.0, 1.12, "ご相談したいこと(相談⑦)",
     "実装より先にスキーマを置いたこの進め方は妥当でしょうか。"
     "要件が固まる前に作った表は、結局作り直しになるものでしょうか。",
     accent=VIOLET, fill=VIOLET_L, size=10.5)

# ══════════════════════════════════════════════════════════════
# 26. 追加した5領域で迷った判断
# ══════════════════════════════════════════════════════════════
s = sl_("追加した5領域で迷った判断", "どれも「こちらが正しい」と言い切れず、選んで実装しています",
        source="doc/15_追加ドメインの設計とレビュー論点.md 各章「レビューで確認いただきたい点」")
rows = [
    ["特性を項目マスタ+値テーブル(EAV)にした", "訪問最適化",
     "何を見て最適化するかが今後のヒアリングで決まるため、項目自体をデータにした",
     "項目が固まった後もこの形を維持すべきか、列に移すべきか"],
    ["請求書を void して作り直せるようにした", "請求",
     "明細に superseded_at を足し、部分一意索引の条件に含めた"
     "(1つの領収書は「有効な」明細1つにしか載らない)",
     "無効化を別テーブルに分ける・請求書ごと複製する等の定石があるか"],
    ["状態の語をStripeにそのまま合わせた", "決済",
     "PaymentIntent の7状態・Invoice の5状態をそのまま持ち、自前の対応表を作らない",
     "外部サービスの語彙を自分のDBに持ち込むことの是非(乗り換え時の影響)"],
    ["写真の並び順に一意制約を張らなかった", "カルテ",
     "一意制約は行ごとに即時判定され、2枚の順番を入れ替えるUPDATEが必ず衝突するため。"
     "並びは ORDER BY sort_order, id で決めている",
     "遅延評価(DEFERRABLE)を使うべきか、この割り切りでよいか"],
    ["1日あたり定額の手当を、移動1区間の表で扱う", "手当",
     "手当の計算方法に「1日あたり定額」があるが、実績は移動1区間ごとに記録している",
     "日次の粒度を別に持つべきか、集計時に日でまとめれば足りるか"],
    ["取込元キーの対をCHECKで縛った", "予約",
     "部分一意索引はNULL同士を別物として扱い、取込元が空の行は重複を防げないため",
     "同じ形の customers の索引にも同じCHECKを足すべきか"],
]
dom_colors = [VIOLET, GREEN, GREEN, PINK, ORANGE, ACCENT]
table(s, ML, 1.25, CW, ["選んだ判断", "領域", "そうした理由", "ご意見をいただきたい点"], rows,
      col_w=[3.3, 1.1, 4.6, 3.33], size=9.5, hsize=10, row_h=0.70, header_h=0.33,
      first_bold=True, cell_colors={(i, 1): c for i, c in enumerate(dom_colors)},
      aligns=[PP_ALIGN.LEFT, PP_ALIGN.CENTER, PP_ALIGN.LEFT, PP_ALIGN.LEFT])
note(s, ML, 6.06, CW, 0.8, "ご相談したいこと(相談⑧)",
     "この6件について、より一般的な作り方があればご教示ください。"
     "とくにEAVは「項目が決まっていないから」という理由で選びましたが、後戻りしにくい選択だと考えています。",
     accent=VIOLET, fill=VIOLET_L, size=11)

# ══════════════════════════════════════════════════════════════
# 27. 相談事項まとめ
# ══════════════════════════════════════════════════════════════
s = sl_("ご相談したいこと(まとめ)", "優先度順。特に伺いたいのは ①②③⑨",
        source="doc/09 第5章「レビュー観点」/ doc/15 §6 に対応")
rows = [
    ["①", "customers 37列を分けるべきか", "19",
     "顧客マスタとして何列までが常識的か、分ける単位の基準。運用前の今が最も安く直せる"],
    ["②", "業務データ平文化の前提が妥当か", "14・20",
     "「保存時暗号化は本番基盤に任せる」という前提の置き方。本番未配備のまま進めてよいか"],
    ["③", "予約の二重取りをどこで止めるか", "21",
     "EXCLUDE制約が使えない(テスト環境に拡張が無い)。本番だけ張る / アプリで直列化 / 固定スロット / 運用で検知"],
    ["④", "勤怠のJSONをいつ分解するか", "22",
     "給与直結。実データ照合の前に分解すべきか、照合の基準を動かさないため後にすべきか"],
    ["⑤", "廃棄・返還の手順と、その他の負債の優先順位", "23",
     "ON DELETE と物理削除手順、バックアップ保持期間。運用前に必須のものはどれか"],
    ["⑥", "監査と鍵管理を本番相当にする時期", "24",
     "pgaudit等を入れる時期と粒度。Cloud KMS 前に本番データを溜め始めてよいか"],
    ["⑦", "実装より先にスキーマを置く進め方の是非", "26",
     "要件が固まる前に作った18テーブルは、結局作り直しになるか"],
    ["⑧", "追加5領域で迷った6つの判断", "27",
     "EAV・請求書のvoid・Stripeの語彙・並び順・手当の粒度・取込元キー"],
    ["⑨", "見落としているPostgreSQLの落とし穴", "12・13",
     "複合外部キー + RLS の二重防御で塞いだつもりだが、他に仕様上の抜け道はないか"],
]
table(s, ML, 1.28, CW, ["", "論点", "頁", "何を判断いただきたいか"], rows,
      col_w=[0.45, 3.9, 0.75, 7.2], size=10.5, hsize=10.5, row_h=0.48, header_h=0.32,
      cell_colors={(i, 0): (RED if i in (0, 1, 2, 8) else ACCENT) for i in range(9)},
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
           ("  33テーブルの定義。列ごとに「なぜこの形か」をコメントで書いてある", {})]},
    {"t": [("packages/db/drizzle/0000_baseline_schema.sql", {"font": MONO, "bold": True}),
           ("  適用されるDDL。RLSの FORCE と updated_at トリガーはここに手で追記", {})]},
    {"t": [("packages/shared/src/contracts/", {"font": MONO, "bold": True}),
           ("  区分値(CHECK制約の許可値)の定義。DDLはここから組み立てる", {})]},
    {"t": [("packages/core/src/ports/", {"font": MONO, "bold": True}),
           ("  業務ロジックが外部に求める窓口の定義(28本)", {})]},
], body_size=10.5)
card(s, ML + 6.33, 1.28, 6.0, 2.6, "ドキュメント", accent=GREEN, items=[
    {"t": [("doc/09_データベース構造解説.md", {"bold": True}),
           ("  本資料の詳細版。ER図・全列一覧・レビュー観点", {})]},
    {"t": [("doc/15_追加ドメインの設計とレビュー論点.md", {"bold": True}),
           ("  第4章の18テーブルの設計理由と、未決の論点", {})]},
    {"t": [("doc/14_データベース設計の指針と落とし穴.md", {"bold": True}),
           ("  DBを触るときの決めごとと、実際に踏んだ落とし穴", {})]},
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
       ["鍵を鍵で包む", "封筒暗号化(envelope encryption)", "tenant_keys.wrapped_dek / KeyManagementPort"],
       ["入ってよい値を縛る", "CHECK 制約", "check('xxx_check', sql`...`) / contracts の zod enum"]],
      col_w=[3.2, 3.6, 5.5], size=10, hsize=10.5, row_h=0.32, header_h=0.32, first_bold=True)
text(s, ML, 6.78, CW, 0.3,
     "本資料の図はすべてPowerPointの図形で作ってあるため、コメントの書き込み・修正がそのままできます。",
     size=10.5, color=MUTED)

prs.save(str(OUT))
print(f"saved: {OUT}  ({PAGE['n']} slides)")
