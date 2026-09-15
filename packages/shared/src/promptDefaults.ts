import type { PromptTemplateKey } from './contracts/reportAi';

/**
 * プロンプト文面の既定値。GAS版 GeminiReport.js の DEFAULT_PROMPTS(日報・事故報告の生成、
 * 入力欄のプレースホルダー・記載要領)と、GAS版ではコードにベタ書きだった領収書OCRの文面を、
 * そのまま移植したもの。
 *
 * テナントが prompt_templates(packages/db/src/schema/reportAi.ts)に版を積んでいないキーは
 * この文面で動く(GAS版 getPrompt の「シートに無ければ既定」と同じ挙動)。管理画面の
 * 「既定に戻す」も、この文面を新しい版として積む。
 *
 * ここ(@katahimo/shared)に置くのは、生成側(@katahimo/core のユースケース)と画面側
 * (@katahimo/web の入力欄フォールバック)の両方が同じ文面を参照するため。
 *
 * 日報生成(daily_report)の差し込みは GAS版と同じ {anonymizedText} と {timeInfo} だけ。
 * 3軸の差し込み({childContext} {keywordGuide} {toneGuide})は既定文面には含めず、
 * テナントが文面を編集して足す(doc/db/new-domains.md 第6章)。
 */
export const DEFAULT_PROMPT_TEMPLATES: Readonly<Record<PromptTemplateKey, string>> = {
  daily_report: `
あなたは保育士の業務を支援するAIアシスタントです。
以下の「保育日報のメモ(口語)」をもとに、日報を作成してください。

# 必須情報チェック
以下の3点が入力テキストに含まれているか確認してください。
1. **訪問当日のサポート内容** (具体的に何をしたか)
2. **お客様情報** (家庭内の状況や家族との会話から見えた生活状況など)
3. **振り返り** (自分のサポートに対しての内省・今回どうだったか)

# 指示
- 不足している必須情報があれば、その項目名を "warnings" 配列にリストアップしてください(例: ["お客様情報", "振り返り"])。
- 不足情報の有無に関わらず、入力された情報を元に可能な範囲でレポートを作成してください。

# 入力テキスト
{anonymizedText}
時間情報: {timeInfo}

# 出力フォーマット (JSON)
{
  "warnings": ["不足項目名1", "不足項目名2"], // なければ空配列 []
  "internal": "社内向けレポート内容(事実・客観的)。読みやすさのため、適宜改行コード(\\n)を含めてください。",
  "customer": "保護者向けレポート内容(親しみやすく)。読みやすさのため、適宜改行コード(\\n)を含めてください。"
}
`,

  daily_report_stance: '',

  accident_report: `
あなたは保育園の事故報告書作成を支援するAIです。
入力された状況説明(メモ)から、以下の項目に整理・分解してJSON形式で出力してください。

# 入力テキスト
{anonymizedText}
時間情報: {timeInfo}

# 出力項目とルール
- occurrenceTime: 発生日時(令和〇年〇月〇日...の形式が望ましいが、入力から推測できる範囲で。不明なら「要確認」としてください)
- location: 発生場所(施設名+部屋名、屋外ならエリアなど)
- accidentContent: 事故内容(端的な見出し。例:転倒による額切創)
- situation: 発生状況(5W1H、時系列。推測は避け事実のみ)
- immediateResponse: 発生時の対応(誰が、何分後に、何をしたか。タイムライン形式など)
- parentCorrespondence: 保護者への対応(連絡手段、時刻、反応、受診予定など)
- diagnosisTreatment: 診断名および処置状況/必要診察日数(未受診なら「診療前」と明記)
- prevention: 事故防止に向けた今後の対応(原因分析、一次対策、恒久対策)

# 出力フォーマット (JSON)
{
  "occurrenceTime": "...",
  "location": "...",
  "accidentContent": "...",
  "situation": "...",
  "immediateResponse": "...",
  "parentCorrespondence": "...",
  "diagnosisTreatment": "...",
  "prevention": "..."
}
`,

  receipt_ocr: `
Analyze the image of this receipt.
Identify the following information:
1. Total Amount (Total, 合計, 支払い金額)
2. Store Name or Parking Name (店舗名や駐車場名など、発行元の名称)
3. Date and Time of transaction (取引日時や精算日時).
   - Look for keywords like "取引日時", "精算時刻", "発行日時", "20XX年XX月XX日".
   - Format as "yyyy/MM/dd HH:mm".
   - If time is not found but date is, use "yyyy/MM/dd 00:00".
   - If not found at all, return "".

Return the result in JSON format: {"amount": number, "storeName": "string", "receiptDate": "string"}
Do NOT include currency symbols or commas in the amount.
`,

  daily_memo_placeholder: `①訪問当日のサポート内容
   　（実際に実施した保育・家事・対応内容など）
② お客様情報
   　（家庭内の状況、保護者や子どもの様子、会話から見えた生活状況・要望・健康面など）
③　振り返り
   　（支援中の状況→対応→結果、気づき、改善点、次回への申し送りなど）`,

  accident_memo_placeholder: `①事実を時系列で、客観的に
感情的な表現や推測は避け、見聞きした事実のみを時系列に並べます。

②「5W1H＋初動対応」を意識
いつ・どこで・誰が・何をしていて・何が起こり・どう対処したかを必ず押さえます。

③ヒヤリハットも記録
ヒヤリハットも重大事故と同じ視点で記録し、要因分析と再発防止策を残すことで重大事故を防げます`,

  accident_hint: `事故報告書 記載項目と記載要領

発生日時
「令和〇年〇月〇日（曜）午後〇時〇分頃」の形で、分単位まで記載。発見時刻と発生時刻が異なる場合は両方書く。

発生場所
施設名＋部屋名／屋外の場合はエリアまで具体的に
（例：〇〇公園すべり台下）。

事故内容
端的な見出し語で
「転倒による額切創」「アレルギー症状（じんましん）」など
原因＋結果をセットで。

発生状況
①環境 ②子どもの行動 ③職員配置 ④事故発生の瞬間
の順に、1文1事実で記録。観察できない部分は書かない。

発生時の対応
①誰が ②何分後に ③何をしたのかをタイムライン形式で。
「14:05 冷水で5分間冷却 → 14:10 止血確認 → 14:12 保護者へ電話」など。

保護者への対応
連絡手段・時刻・先方の反応・今後の受診予定を簡潔に。
「14:12 母・携帯へ連絡、15:00 来園し受診同意」

診断名および処置状況／必要診察日数
受診後に医師の診断名を正式に転記。
未受診の段階では「診察前」と明記し暫定措置を書く。

事故防止に向けた今後の対応
①原因分析（環境・人・手順の観点で）
→②一次対策（急ぎの安全策）
→③恒久対策（マニュアル改訂・研修など）
を箇条書きで。`,

  hiyari_hint: `■ヒヤリハットを記入するときの追加留意点
①「もし○○していたら重大事故」まで想定して原因を書く
例：「高さ60 cmの踏み台から足を滑らせたが、すぐ横に職員がいて転落を回避」
②再発防止策を必ず具体化（配置変更、備品購入、声かけ方法など）

■よくあるNG集

NG例	修正方法
主観的表現 「急に暴れ出した」	行動を具体的に「立ち上がって走り出した」
「たぶん眠かった」	憶測を削除 or 根拠を追記「午睡前で目をこすっていたため眠気があった可能性」
時刻抜け・曖昧な順序	タイムラインで整理し、時計を確認して都度メモ。
再発防止策が抽象的 「注意する」	「○月○日までに踏み台に滑り止めテープを貼付、写真を共有」など行動・期限・担当を明示。`,
};
