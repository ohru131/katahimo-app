// ==========================================
// Gemini AI連携(日報/事故報告の生成・領収書OCR・管理者向けAPIキー/モデル設定)
// 旧コード.js(Main.js に改名)から分割(2026-08-18)。
// ==========================================

const PROMPT_SHEET_NAME = 'ＡＩプロンプト';

const PROMPT_KEYS = {
    GENERATE_WITH_WARNINGS: 'GenerateWithWarnings',
    GENERATE_ACCIDENT: 'GenerateAccident',
    PLACEHOLDER_DAILY: 'PlaceholderDaily',
    PLACEHOLDER_ACCIDENT: 'PlaceholderAccident',
    HINT_ACCIDENT: 'HintAccident',
    PLACEHOLDER_HIYARI: 'PlaceholderHiyari'
};

const DEFAULT_PROMPTS = {
    [PROMPT_KEYS.GENERATE_WITH_WARNINGS]: `
あなたは保育士の業務を支援するAIアシスタントです。
以下の「保育日報のメモ（口語）」をもとに、日報を作成してください。

# 必須情報チェック
以下の3点が入力テキストに含まれているか確認してください。
1. **訪問当日のサポート内容** (具体的に何をしたか)
2. **お客様情報** (家庭内の状況や家族との会話から見えた生活状況など)
3. **振り返り** (自分のサポートに対しての内省・今回どうだったか)

# 指示
- 不足している必須情報があれば、その項目名を "warnings" 配列にリストアップしてください（例: ["お客様情報", "振り返り"]）。
- 不足情報の有無に関わらず、入力された情報を元に可能な範囲でレポートを作成してください。

# 入力テキスト
{anonymizedText}
時間情報: {timeInfo}

# 出力フォーマット (JSON)
{
  "warnings": ["不足項目名1", "不足項目名2"], // なければ空配列 []
  "internal": "社内向けレポート内容（事実・客観的）。読みやすさのため、適宜改行コード(\\n)を含めてください。",
  "customer": "保護者向けレポート内容（親しみやすく）。読みやすさのため、適宜改行コード(\\n)を含めてください。"
}
`,
    [PROMPT_KEYS.GENERATE_ACCIDENT]: `
あなたは保育園の事故報告書作成を支援するAIです。
入力された状況説明（メモ）から、以下の項目に整理・分解してJSON形式で出力してください。

# 入力テキスト
{anonymizedText}
時間情報: {timeInfo}

# 出力項目とルール
- occurrenceTime: 発生日時（令和〇年〇月〇日...の形式が望ましいが、入力から推測できる範囲で。不明なら「要確認」としてください）
- location: 発生場所（施設名＋部屋名、屋外ならエリアなど）
- accidentContent: 事故内容（端的な見出し。例：転倒による額切創）
- situation: 発生状況（5W1H、時系列。推測は避け事実のみ）
- immediateResponse: 発生時の対応（誰が、何分後に、何をしたか。タイムライン形式など）
- parentCorrespondence: 保護者への対応（連絡手段、時刻、反応、受診予定など）
- diagnosisTreatment: 診断名および処置状況/必要診察日数（未受診なら「診療前」と明記）
- prevention: 事故防止に向けた今後の対応（原因分析、一次対策、恒久対策）

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
`
    ,
    [PROMPT_KEYS.PLACEHOLDER_DAILY]: `①訪問当日のサポート内容
   　（実際に実施した保育・家事・対応内容など）
② お客様情報
   　（家庭内の状況、保護者や子どもの様子、会話から見えた生活状況・要望・健康面など）
③　振り返り
   　（支援中の状況→対応→結果、気づき、改善点、次回への申し送りなど）`,
    [PROMPT_KEYS.PLACEHOLDER_ACCIDENT]: `①事実を時系列で、客観的に
感情的な表現や推測は避け、見聞きした事実のみを時系列に並べます。

②「5W1H＋初動対応」を意識
いつ・どこで・誰が・何をしていて・何が起こり・どう対処したかを必ず押さえます。

③ヒヤリハットも記録
ヒヤリハットも重大事故と同じ視点で記録し、要因分析と再発防止策を残すことで重大事故を防げます`,
    [PROMPT_KEYS.HINT_ACCIDENT]: `事故報告書 記載項目と記載要領

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
    [PROMPT_KEYS.PLACEHOLDER_HIYARI]: `■ヒヤリハットを記入するときの追加留意点
①「もし○○していたら重大事故」まで想定して原因を書く
例：「高さ60 cmの踏み台から足を滑らせたが、すぐ横に職員がいて転落を回避」
②再発防止策を必ず具体化（配置変更、備品購入、声かけ方法など）

■よくあるNG集

NG例	修正方法
主観的表現 「急に暴れ出した」	行動を具体的に「立ち上がって走り出した」
「たぶん眠かった」	憶測を削除 or 根拠を追記「午睡前で目をこすっていたため眠気があった可能性」
時刻抜け・曖昧な順序	タイムラインで整理し、時計を確認して都度メモ。
再発防止策が抽象的 「注意する」	「○月○日までに踏み台に滑り止めテープを貼付、写真を共有」など行動・期限・担当を明示。`
};

// 現状未使用(事故報告のプロンプトキーはPROMPT_KEYS.GENERATE_ACCIDENTを使用)。
const PROMPT_ACCIDENT_KEY = 'GenerateAccident';

/**
 * Gets prompt from sheet or returns default (and saves it).
 */
function getPrompt(key) {
    const ss = getSpreadsheet();
    let sheet = ss.getSheetByName(PROMPT_SHEET_NAME);

    if (!sheet) {
        sheet = ss.insertSheet(PROMPT_SHEET_NAME);
        sheet.appendRow(['Key', 'Prompt Template']);
        Object.keys(DEFAULT_PROMPTS).forEach(k => {
            sheet.appendRow([k, DEFAULT_PROMPTS[k]]);
        });
        return DEFAULT_PROMPTS[key];
    }

    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
        if (data[i][0] === key) {
            return data[i][1];
        }
    }

    const defaultVal = DEFAULT_PROMPTS[key];
    if (defaultVal) {
        sheet.appendRow([key, defaultVal]);
        return defaultVal;
    }

    return "";
}

/**
 * Generates report and returns warnings if info is missing.
 */
// Refactored helper to support multimodal or text-only
function callGemini(apiKey, contentParts, generationConfig, modelName) {
    const model = modelName || 'gemini-2.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const payload = {
        contents: [{ parts: contentParts }],
        generationConfig: generationConfig || { responseMimeType: "application/json" }
    };

    try {
        const response = UrlFetchApp.fetch(url, {
            method: 'post',
            contentType: 'application/json',
            payload: JSON.stringify(payload),
            muteHttpExceptions: true
        });

        const httpCode = response.getResponseCode();
        const responseText = response.getContentText();

        // Map HTTP status codes to user-friendly messages
        let errorMsg = null;
        let logDetails = `HTTP ${httpCode}`;

        if (httpCode === 200) {
            // Success - process response
            try {
                const json = JSON.parse(responseText);
                if (!json.candidates || json.candidates.length === 0) {
                    return { error: "No candidates returned" };
                }

                // gemini-2.5-flash はデフォルトで思考モードが有効なため、
                // parts に thought:true のパートが含まれる場合がある。
                // 実際のレスポンステキストを持つパートを取得する。
                const responseParts = json.candidates[0].content.parts;
                const textPart = responseParts.find(p => !p.thought) || responseParts[0];
                if (!textPart || !textPart.text) {
                    return { error: "No text part found in response" };
                }
                const text = textPart.text;
                // Clean markdown JSON if present
                const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
                const parsed = JSON.parse(cleanText);

                // Helper to unescape newlines in strings
                const unescapeNewlines = (obj) => {
                    if (typeof obj === 'string') {
                        return obj.replace(/\\n/g, '\n');
                    } else if (Array.isArray(obj)) {
                        return obj.map(unescapeNewlines);
                    } else if (typeof obj === 'object' && obj !== null) {
                        Object.keys(obj).forEach(key => {
                            obj[key] = unescapeNewlines(obj[key]);
                        });
                    }
                    return obj;
                };

                return unescapeNewlines(parsed);
            } catch (parseError) {
                logDetails = `Parse Error (200 OK): ${parseError.message} | rawText(200): ${responseText.substring(0, 200)}`;
                errorMsg = "レスポンス解析エラー（サーバー側の問題の可能性があります）";
            }
        } else if (httpCode === 400) {
            // Bad Request - likely invalid API key or malformed request
            errorMsg = "リクエストが不正です（APIキーを確認してください）";
            logDetails = `${httpCode} Bad Request: ${responseText.substring(0, 200)}`;
        } else if (httpCode === 401) {
            // Unauthorized - invalid API key
            errorMsg = "APIキーが無効です（設定を確認してください）";
            logDetails = `${httpCode} Unauthorized - Invalid API Key`;
        } else if (httpCode === 403) {
            // Forbidden - API not enabled or quota exceeded
            errorMsg = "API呼び出しが許可されていません（QuotaまたはAPI有効化を確認してください）";
            logDetails = `${httpCode} Forbidden`;
        } else if (httpCode === 429) {
            // Too Many Requests - Rate limit exceeded
            errorMsg = "APIのレート制限に達しました。数分～数時間待ってから再度お試しください。";
            logDetails = `${httpCode} Too Many Requests - Rate Limited`;
        } else if (httpCode === 500) {
            // Internal Server Error
            errorMsg = "Gemini API側で一時的なエラーが発生しました。数分～数時間待ってから再度お試しください。";
            logDetails = `${httpCode} Internal Server Error`;
        } else if (httpCode === 503) {
            // Service Unavailable
            errorMsg = "Gemini APIサービスが混み合っており、一時的に利用できません。数分～数時間待ってから再度お試しください。";
            logDetails = `${httpCode} Service Unavailable`;
        } else if (httpCode >= 500) {
            // Other 5xx errors
            errorMsg = `Gemini APIサーバーエラー（${httpCode}）が発生しました。数分～数時間待ってから再度お試しください。`;
            logDetails = `${httpCode} Server Error`;
        } else {
            // Other errors
            errorMsg = `API呼び出しエラー（${httpCode}）`;
            logDetails = `${httpCode} Error: ${responseText.substring(0, 200)}`;
        }

        // If we got here, there's an error
        if (errorMsg) {
            logToBuffer("ERROR", "CallGemini_HttpError", "system", logDetails);
            return { error: errorMsg, httpCode: httpCode, rawError: responseText.substring(0, 500) };
        }

        return { error: "Unknown error" };

    } catch (e) {
        logToBuffer("ERROR", "CallGemini_Exception", "system", `Exception: ${e.message}\nStack: ${e.stack}`);
        return { error: `System Error: ${e.message}` };
    }
}

function generateReportWithWarnings(inputData) {
    const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
    if (!apiKey) return { warnings: ["API Key Missing"], internal: "Error: API Key not set", customer: "" };

    let promptTemplate = getPrompt(PROMPT_KEYS.GENERATE_WITH_WARNINGS);
    if (!promptTemplate) promptTemplate = DEFAULT_PROMPTS[PROMPT_KEYS.GENERATE_WITH_WARNINGS];

    let text = "";
    let timeInfo = "時間指定なし";

    if (typeof inputData === 'string') {
        text = inputData;
    } else {
        text = inputData.text;
        if (inputData.start && inputData.end) {
            timeInfo = `${inputData.start}〜${inputData.end}`;
        }
    }

    let prompt = promptTemplate.replace('{anonymizedText}', text);
    prompt = prompt.replace('{timeInfo}', timeInfo);

    // Schema for Daily Report
    const dailyReportSchema = {
        type: "OBJECT",
        properties: {
            warnings: { type: "ARRAY", items: { type: "STRING" } },
            internal: { type: "STRING" },
            customer: { type: "STRING" }
        },
        required: ["warnings", "internal", "customer"]
    };

    // Call with schema
    const result = callGemini(apiKey, [{ text: prompt }], {
        responseMimeType: "application/json",
        responseSchema: dailyReportSchema
    }, getGeminiModelForReport_());

    if (result.error) {
        logToBuffer("ERROR", "GenerateReportWithWarnings", "system", `API Error: ${result.error} (HTTP ${result.httpCode || 'Unknown'})`);
        // rawErrorがある場合は詳細も含めてUIに渡す
        const detail = result.rawError
            ? `${result.error}\n\n[詳細] ${result.rawError}`
            : result.error;
        return { warnings: ["API Error"], internal: detail, customer: "" };
    }
    return result;
}

/**
 * Extracts amount and store name from receipt image
 */
function extractAmountFromImage(base64Image) {
    const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
    if (!apiKey) return { amount: "", storeName: "", receiptDate: "" };

    const prompt = `
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
    `;

    // Removing header "data:image/jpeg;base64,"
    const rawBase64 = base64Image.split(',')[1];

    // OCR用モデルは管理者設定画面で変更可能(スクリプトプロパティ GEMINI_MODEL_OCR)
    const result = callGemini(apiKey, [
        { text: prompt },
        { inline_data: { mime_type: "image/jpeg", data: rawBase64 } }
    ], null, getGeminiModelForOcr_());

    if (result.error) {
        // console.errorはDriveへ永続化されないため、他のGemini呼び出し失敗と同様に
        // logToBufferにも記録する(領収書OCR失敗の発生状況を追跡できるようにする)。
        logToBuffer("ERROR", "ExtractAmountFromImage", "system", `API Error: ${result.error} (HTTP ${result.httpCode || 'Unknown'})`);
        return { amount: 0, storeName: "", receiptDate: "" };
    }
    return result;
}

/**
 * Generates accident report decomposition.
 */
function generateAccidentReport(inputData) {
    const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
    if (!apiKey) return { error: "API Key Missing" };

    let promptTemplate = getPrompt(PROMPT_KEYS.GENERATE_ACCIDENT);
    if (!promptTemplate) promptTemplate = DEFAULT_PROMPTS[PROMPT_KEYS.GENERATE_ACCIDENT];

    let text = "";
    let timeInfo = "時間指定なし";

    if (typeof inputData === 'string') {
        text = inputData;
    } else {
        text = inputData.text;
        if (inputData.start && inputData.end) {
            timeInfo = `${inputData.start}〜${inputData.end}`;
        } else if (inputData.start) {
            timeInfo = inputData.start; // Just occurrence time
        }
    }

    let prompt = promptTemplate.replace('{anonymizedText}', text);
    prompt = prompt.replace('{timeInfo}', timeInfo);

    // Schema for Accident Report
    const accidentSchema = {
        type: "OBJECT",
        properties: {
            occurrenceTime: { type: "STRING" },
            location: { type: "STRING" },
            accidentContent: { type: "STRING" },
            situation: { type: "STRING" },
            immediateResponse: { type: "STRING" },
            parentCorrespondence: { type: "STRING" },
            diagnosisTreatment: { type: "STRING" },
            prevention: { type: "STRING" }
        },
        required: ["occurrenceTime", "location", "accidentContent", "situation", "immediateResponse", "parentCorrespondence", "diagnosisTreatment", "prevention"]
    };

    const result = callGemini(apiKey, [{ text: prompt }], {
        responseMimeType: "application/json",
        responseSchema: accidentSchema
    }, getGeminiModelForReport_());

    if (result.error) {
        logToBuffer("ERROR", "GenerateAccidentReport", "system", `API Error: ${result.error} (HTTP ${result.httpCode || 'Unknown'})`);
        return { error: result.error };
    }
    return result;
}

const GEMINI_MODEL_REPORT_KEY = 'GEMINI_MODEL_REPORT';
const GEMINI_MODEL_OCR_KEY = 'GEMINI_MODEL_OCR';
const GEMINI_MODEL_REPORT_DEFAULT = 'gemini-2.5-flash';
const GEMINI_MODEL_OCR_DEFAULT = 'gemini-2.5-flash-lite';

/** 日報/事故報告生成に使うモデル名を返す(未設定時はデフォルト)。 */
function getGeminiModelForReport_() {
    return PropertiesService.getScriptProperties().getProperty(GEMINI_MODEL_REPORT_KEY) || GEMINI_MODEL_REPORT_DEFAULT;
}

/** 領収書OCRに使うモデル名を返す(未設定時はデフォルト)。 */
function getGeminiModelForOcr_() {
    return PropertiesService.getScriptProperties().getProperty(GEMINI_MODEL_OCR_KEY) || GEMINI_MODEL_OCR_DEFAULT;
}

/**
 * 管理者設定画面用: 現在のGemini APIキーを取得する。
 * 管理者以外が呼んだ場合はエラーを返す(キーの値自体は返さない)。
 */
function getGeminiApiKeyForAdmin(token) {
    const session = checkSession(token, false);
    if (!session || !session.valid || !session.isAdmin) {
        logAdminAccessDenied_('GetGeminiApiKey', session);
        return { success: false, message: '権限がありません。' };
    }
    const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY') || '';
    logToBuffer('SECURITY', 'GeminiApiKeyViewed', session.name, 'Gemini APIキーを設定画面で閲覧しました');
    return { success: true, apiKey: apiKey };
}

/**
 * 管理者設定画面用: Gemini APIキーを保存する。
 * 空文字での保存は既存キーの意図しない消失を防ぐため拒否する
 * (読み込み未完了/失敗のまま保存されて初期値で上書きされる事故を防ぐガード)。
 */
function saveGeminiApiKeyForAdmin(token, apiKey) {
    const session = checkSession(token, false);
    if (!session || !session.valid || !session.isAdmin) {
        logAdminAccessDenied_('SaveGeminiApiKey', session);
        return { success: false, message: '権限がありません。' };
    }

    const trimmed = String(apiKey || '').trim();
    if (!trimmed) {
        logToBuffer('WARN', 'SaveGeminiApiKeyRejected', session.name, '空文字での保存が試行されたため拒否しました');
        return { success: false, message: 'APIキーが空です。空のまま保存すると既存のキーが失われるため、保存を中止しました。' };
    }

    const props = PropertiesService.getScriptProperties();
    const previous = props.getProperty('GEMINI_API_KEY') || '';
    if (previous === trimmed) {
        return { success: true, message: 'Gemini APIキーは変更ありません。' };
    }

    props.setProperty('GEMINI_API_KEY', trimmed);
    logToBuffer('SECURITY', 'GeminiApiKeyChanged', session.name, 'Gemini APIキーを更新しました');
    return { success: true, message: 'Gemini APIキーを保存しました。' };
}

/**
 * 管理者設定画面用: 現在の日報/OCR用モデル設定を取得する。
 */
function getGeminiModelSettingsForAdmin(token) {
    const session = checkSession(token, false);
    if (!session || !session.valid || !session.isAdmin) {
        logAdminAccessDenied_('GetGeminiModelSettings', session);
        return { success: false, message: '権限がありません。' };
    }
    return {
        success: true,
        reportModel: getGeminiModelForReport_(),
        ocrModel: getGeminiModelForOcr_()
    };
}

/**
 * 管理者設定画面用: 日報/OCR用モデル設定を保存する。
 * どちらか一方でも空文字での保存は拒否する(既存設定の意図しない消失を防ぐガード)。
 */
function saveGeminiModelSettingsForAdmin(token, reportModel, ocrModel) {
    const session = checkSession(token, false);
    if (!session || !session.valid || !session.isAdmin) {
        logAdminAccessDenied_('SaveGeminiModelSettings', session);
        return { success: false, message: '権限がありません。' };
    }

    const trimmedReport = String(reportModel || '').trim();
    const trimmedOcr = String(ocrModel || '').trim();
    if (!trimmedReport || !trimmedOcr) {
        logToBuffer('WARN', 'SaveGeminiModelSettingsRejected', session.name, '未選択のまま保存が試行されたため拒否しました');
        return { success: false, message: 'モデルが未選択です。空のまま保存すると既存の設定が失われるため、保存を中止しました。' };
    }

    const props = PropertiesService.getScriptProperties();
    const previousReport = getGeminiModelForReport_();
    const previousOcr = getGeminiModelForOcr_();
    if (previousReport === trimmedReport && previousOcr === trimmedOcr) {
        return { success: true, message: 'モデル設定は変更ありません。' };
    }

    props.setProperty(GEMINI_MODEL_REPORT_KEY, trimmedReport);
    props.setProperty(GEMINI_MODEL_OCR_KEY, trimmedOcr);
    logToBuffer('SECURITY', 'GeminiModelSettingsChanged', session.name, `report=${trimmedReport}, ocr=${trimmedOcr}`);
    return { success: true, message: 'モデル設定を保存しました。' };
}

/**
 * 管理者設定画面用: Gemini APIで実際に使えるモデルの一覧を取得する(ListModels)。
 * generateContent に対応しているモデルのみを返す。
 * @param {string} token ログイントークン
 * @param {string} apiKeyOverride 指定時はこちらを使う(保存前の入力中キーで確認できるようにするため)。未指定ならスクリプトプロパティの値を使う。
 */
function listAvailableGeminiModelsForAdmin(token, apiKeyOverride) {
    const session = checkSession(token, false);
    if (!session || !session.valid || !session.isAdmin) {
        logAdminAccessDenied_('ListGeminiModels', session);
        return { success: false, message: '権限がありません。' };
    }

    const apiKey = String(apiKeyOverride || '').trim() || PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
    if (!apiKey) {
        return { success: false, message: 'Gemini APIキーが設定されていません。先にAPIキーを入力してください。' };
    }

    try {
        const models = [];
        let pageToken = '';
        let pageCount = 0;

        do {
            let url = 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=100&key=' + encodeURIComponent(apiKey);
            if (pageToken) url += '&pageToken=' + encodeURIComponent(pageToken);

            const response = UrlFetchApp.fetch(url, { method: 'get', muteHttpExceptions: true });
            if (response.getResponseCode() !== 200) {
                logToBuffer('ERROR', 'ListGeminiModelsFailed', session.name, 'HTTP ' + response.getResponseCode() + ': ' + response.getContentText());
                return { success: false, message: 'モデル一覧の取得に失敗しました(' + response.getResponseCode() + '): ' + response.getContentText() };
            }

            const json = JSON.parse(response.getContentText());
            (json.models || []).forEach(m => {
                const methods = m.supportedGenerationMethods || [];
                if (methods.indexOf('generateContent') !== -1) {
                    models.push({
                        name: String(m.name || '').replace(/^models\//, ''),
                        displayName: m.displayName || ''
                    });
                }
            });
            pageToken = json.nextPageToken || '';
            pageCount++;
        } while (pageToken && pageCount < 5);

        models.sort((a, b) => a.name.localeCompare(b.name));
        logToBuffer('INFO', 'ListGeminiModels', session.name, `モデル一覧を取得しました(${models.length}件)`);
        return { success: true, models: models };
    } catch (e) {
        logToBuffer('ERROR', 'ListGeminiModelsFailed', session.name, e.message);
        return { success: false, message: 'モデル一覧の取得に失敗しました: ' + e.message };
    }
}
