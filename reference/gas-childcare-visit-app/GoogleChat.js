// ==========================================
// Google Chat Webhook Notifications
// Webhook URLはスクリプトプロパティで設定する:
//   GCHAT_REPORT_WEBHOOK_URL  ... 日報/事故報告/訪問完了通知(社内向け)
//   GCHAT_RECEIPT_WEBHOOK_URL ... 領収書登録通知
// ==========================================

const GCHAT_PROPS = {
    REPORT_WEBHOOK_URL: 'GCHAT_REPORT_WEBHOOK_URL',
    RECEIPT_WEBHOOK_URL: 'GCHAT_RECEIPT_WEBHOOK_URL'
};

/**
 * テストモード判定。スクリプトプロパティ TEST_MODE=true のとき true を返す。
 * GASエディタの「プロジェクトの設定」→「スクリプトプロパティ」で
 *   キー: TEST_MODE / 値: true  を追加するとすべての通知がスキップされる。
 * テスト終了後はプロパティを削除すれば自動的に通知が復活する。
 */
function isTestMode() {
    return PropertiesService.getScriptProperties().getProperty('TEST_MODE') === 'true';
}

function sendToGoogleChatWebhook_(webhookUrl, text) {
    if (!webhookUrl) {
        console.error("Google Chat Webhook URL is not configured.");
        // 通知が届かない原因を管理者が追跡できるようにする(複数管理者が運用するため)。
        logToBuffer('WARN', 'GoogleChatWebhookNotConfigured', 'System', 'Webhook URLが未設定のため通知をスキップしました: ' + String(text).substring(0, 80));
        return;
    }
    if (isTestMode()) {
        console.log('[TEST_MODE] Google Chat notification skipped. text=' + String(text).substring(0, 80));
        return;
    }
    try {
        const response = UrlFetchApp.fetch(webhookUrl, {
            method: 'post',
            contentType: 'application/json',
            payload: JSON.stringify({ text: text }),
            muteHttpExceptions: true
        });
        const code = response.getResponseCode();
        if (code < 200 || code >= 300) {
            console.error('Google Chat Notification Failed: HTTP ' + code + ' ' + response.getContentText());
            logToBuffer('ERROR', 'GoogleChatWebhookFailed', 'System', 'HTTP ' + code + ': ' + response.getContentText().substring(0, 200) + ' / text=' + String(text).substring(0, 80));
        }
    } catch (e) {
        console.error("Google Chat Notification Error: " + e.message);
        logToBuffer('ERROR', 'GoogleChatWebhookError', 'System', e.message + ' / text=' + String(text).substring(0, 80));
    }
}

/**
 * 日報・事故報告・訪問完了通知を送信する(社内向け)。
 */
function sendReportNotification(text) {
    const url = PropertiesService.getScriptProperties().getProperty(GCHAT_PROPS.REPORT_WEBHOOK_URL);
    sendToGoogleChatWebhook_(url, text);
}

/**
 * 領収書登録通知を送信する。
 */
function sendReceiptNotification(text) {
    const url = PropertiesService.getScriptProperties().getProperty(GCHAT_PROPS.RECEIPT_WEBHOOK_URL);
    sendToGoogleChatWebhook_(url, text);
}

/**
 * 管理者設定画面用: 現在のGoogle Chat Webhook URL設定を取得する。
 * 管理者以外が呼んだ場合はエラーを返す。
 */
function getGoogleChatWebhookSettingsForAdmin(token) {
    const session = checkSession(token, false);
    if (!session || !session.valid || !session.isAdmin) {
        logAdminAccessDenied_('GetGoogleChatWebhookSettings', session);
        return { success: false, message: '権限がありません。' };
    }
    const props = PropertiesService.getScriptProperties();
    logToBuffer('SECURITY', 'GoogleChatWebhookSettingsViewed', session.name, 'Google Chat Webhook URLを設定画面で閲覧しました');
    return {
        success: true,
        reportWebhookUrl: props.getProperty(GCHAT_PROPS.REPORT_WEBHOOK_URL) || '',
        receiptWebhookUrl: props.getProperty(GCHAT_PROPS.RECEIPT_WEBHOOK_URL) || ''
    };
}

/**
 * 管理者設定画面用: Google Chat Webhook URLを保存する。
 * どちらか一方でも空文字での保存は既存URLの意図しない消失を防ぐため拒否する。
 */
function saveGoogleChatWebhookSettingsForAdmin(token, reportWebhookUrl, receiptWebhookUrl) {
    const session = checkSession(token, false);
    if (!session || !session.valid || !session.isAdmin) {
        logAdminAccessDenied_('SaveGoogleChatWebhookSettings', session);
        return { success: false, message: '権限がありません。' };
    }

    const trimmedReport = String(reportWebhookUrl || '').trim();
    const trimmedReceipt = String(receiptWebhookUrl || '').trim();
    if (!trimmedReport || !trimmedReceipt) {
        logToBuffer('WARN', 'SaveGoogleChatWebhookSettingsRejected', session.name, '空文字での保存が試行されたため拒否しました');
        return { success: false, message: 'Webhook URLが空です。空のまま保存すると既存の設定が失われるため、保存を中止しました。' };
    }

    const props = PropertiesService.getScriptProperties();
    const previousReport = props.getProperty(GCHAT_PROPS.REPORT_WEBHOOK_URL) || '';
    const previousReceipt = props.getProperty(GCHAT_PROPS.RECEIPT_WEBHOOK_URL) || '';
    if (previousReport === trimmedReport && previousReceipt === trimmedReceipt) {
        return { success: true, message: 'Webhook URLは変更ありません。' };
    }

    props.setProperty(GCHAT_PROPS.REPORT_WEBHOOK_URL, trimmedReport);
    props.setProperty(GCHAT_PROPS.RECEIPT_WEBHOOK_URL, trimmedReceipt);
    logToBuffer('SECURITY', 'GoogleChatWebhookSettingsChanged', session.name, '日報/領収書通知用Webhook URLを更新しました');
    return { success: true, message: 'Webhook URLを保存しました。' };
}
