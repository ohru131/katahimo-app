/**
 * setup.js
 * スクリプト プロパティのエクスポート／インポートユーティリティ。
 *
 * 【使い方】
 *   コピー元プロジェクト: exportScriptProperties() を実行 → ダイアログの JSON をコピー
 *   コピー先プロジェクト: 下の PASTE_JSON_HERE に貼り付けて importScriptProperties() を実行
 *
 * 【セキュリティ】
 *   - エクスポートはスプレッドシートに書き込まない（GASエディタ上のダイアログのみ）
 *   - インポートは貼り付け後すぐに PASTE_JSON_HERE を空に戻すこと
 *   - いずれもGASエディタへのアクセス権を持つ人のみ実行可能
 */

// ============================================================
// ▼ インポート時: ここに exportScriptProperties() の出力を貼り付ける
// ============================================================
const PASTE_JSON_HERE = `
`;
// ============================================================

/**
 * 全スクリプト プロパティを JSON 形式で実行ログに出力する。
 * コピー元プロジェクトで実行し、実行ログの JSON をコピーする。
 *
 * 【コピー方法】
 *   GASエディタ右下の「実行ログ」パネルに出力される JSON を
 *   そのまま選択してコピーする。
 */
function exportScriptProperties() {
    const props = PropertiesService.getScriptProperties().getProperties();
    const json = JSON.stringify(props, null, 2);

    // 実行ログに出力（GASエディタのみ閲覧可能）
    console.log('========== EXPORT START ==========');
    console.log(json);
    console.log('========== EXPORT END ============');
    console.log('↑ 上の JSON をコピーして、コピー先の PASTE_JSON_HERE に貼り付けてください。');
}

/**
 * PASTE_JSON_HERE に貼り付けた JSON をスクリプト プロパティへ書き込む。
 * コピー先プロジェクトで実行する。
 *
 * - 既存のキーは上書きする（merge モード: 他のキーは消さない）
 * - 実行後は PASTE_JSON_HERE の内容を空に戻すこと
 */
function importScriptProperties() {
    const jsonStr = PASTE_JSON_HERE.trim();

    if (!jsonStr) {
        throw new Error('PASTE_JSON_HERE が空です。exportScriptProperties() でコピーした JSON を貼り付けてから実行してください。');
    }

    let parsed;
    try {
        parsed = JSON.parse(jsonStr);
    } catch (e) {
        throw new Error('JSON パースエラー: ' + e.message);
    }

    if (typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('JSON はオブジェクト形式である必要があります。');
    }

    PropertiesService.getScriptProperties().setProperties(parsed, false); // false = 他キーを消さない

    const keys = Object.keys(parsed);
    const MASK_KEYS = ['LW_CLIENT_SECRET', 'LW_PRIVATE_KEY', 'FIREBASE_PRIVATE_KEY', 'GEMINI_API_KEY', 'AUTH_SALT'];
    const lines = keys.map(k => `  ${k}: ${MASK_KEYS.includes(k) ? '****(masked)****' : parsed[k]}`);

    console.log(`✅ ${keys.length} 件のプロパティをインポートしました。\n` + lines.join('\n'));
    console.log('⚠️ setup.js の PASTE_JSON_HERE を空に戻してください。');
}

/**
 * 現在のスクリプト プロパティ一覧をログに出力する（値の確認用）。
 * センシティブな値はマスクして表示する。
 */
function listScriptProperties() {
    const props = PropertiesService.getScriptProperties().getProperties();
    const MASK_KEYS = ['LW_CLIENT_SECRET', 'LW_PRIVATE_KEY', 'FIREBASE_PRIVATE_KEY', 'GEMINI_API_KEY', 'AUTH_SALT'];

    const lines = Object.entries(props).map(([k, v]) => {
        const display = MASK_KEYS.includes(k) ? '****(masked)****' : v;
        return `  ${k}: ${display}`;
    });

    console.log('=== Script Properties ===\n' + lines.join('\n'));
}
