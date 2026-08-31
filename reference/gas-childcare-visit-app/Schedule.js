// ==========================================
// Schedule Lookup (今日/明日の予定)
// Stage 1: RouteSearch.js のカレンダー解析結果(getScheduleForStaffOnDate)をそのまま表示する。
// Stage 2: タブを開いた時点でルート・移動時間も自動取得する(getRouteForStaffOnDate)。
// 管理者機能: 管理者ユーザーは requestedStaffName で自分以外のスタッフの予定も参照できる。
//
// セキュリティ: このアプリは executeAs: USER_DEPLOYING / access: ANYONE_ANONYMOUS で
// 公開されるため、google.script.run経由でこのファイルの関数は誰でも直接呼び出せる。
// staffNameをクライアントから受け取ってそのまま信用すると、未ログインの第三者が
// 他人の訪問予定(顧客名・訪問先の位置情報を含む)を取得できてしまう。そのため
// 必ずログイントークンを検証し、非管理者は必ずセッションから解決した本人名のみを使う。
// 管理者(session.isAdmin)のみ、クライアントから渡された requestedStaffName を使用できる
// (PastSchedule.js の resolvePastScheduleTargetStaffName_ と同じパターン)。
// ==========================================

/**
 * ログイントークンから、アクセス元の本人名・管理者フラグを確定する。
 * トークンが無効な場合は null を返す。
 */
function getScheduleAccessContext_(token) {
    const session = checkSession(token, false);
    if (!session || !session.valid) return null;
    return { selfStaffName: session.name, isAdmin: !!session.isAdmin };
}

/**
 * アクセス対象のスタッフ名を確定する。
 * 管理者以外は必ず本人名を返し、requestedStaffNameは無視する。
 * 管理者はrequestedStaffNameが指定されていればそれを、未指定なら本人名を返す。
 */
function resolveScheduleTargetStaffName_(context, requestedStaffName) {
    if (!context.isAdmin) {
        return context.selfStaffName;
    }
    const requested = String(requestedStaffName || '').trim();
    return requested || context.selfStaffName;
}

/**
 * 指定日の予定一覧を取得する(ルート・移動時間は含まない軽量版)。
 * 通常は本人のスタッフ名のみが対象。管理者はrequestedStaffNameで他スタッフも指定可能。
 * @param {string} token ログイントークン
 * @param {string} dateString 'YYYY-MM-DD' 形式の日付
 * @param {string} [requestedStaffName] 管理者が参照したい対象スタッフ名(管理者以外では無視される)
 * @return {{success: boolean, date?: string, staffName?: string, appointments?: Array, message?: string}}
 */
function getScheduleForDate(token, dateString, requestedStaffName) {
    try {
        const context = getScheduleAccessContext_(token);
        if (!context) {
            logToBuffer('WARN', 'GetScheduleAccessDenied', 'invalid-session', `無効なセッションでの予定取得を試みました(日付=${dateString})`);
            return { success: false, message: 'ログインセッションが無効です。再度ログインしてください。', appointments: [] };
        }
        const staffName = resolveScheduleTargetStaffName_(context, requestedStaffName);
        return getScheduleForStaffOnDate(staffName, dateString);
    } catch (e) {
        // 開くたびに呼ばれる軽量な閲覧系のため、成功時はログを取らず失敗時のみ記録する。
        logToBuffer('ERROR', 'GetScheduleError', 'unknown', `日付=${dateString}: ${e.message}`);
        return { success: false, message: e.message, appointments: [] };
    }
}

/**
 * 指定日の予定に、移動時間・ルートURL(出勤/訪問間/退勤)を付与して取得する。
 * 通常は本人のスタッフ名のみが対象。管理者はrequestedStaffNameで他スタッフも指定可能。
 * Google Maps APIを呼び出すため getScheduleForDate より時間がかかる。「勤怠集計」シートへの
 * 書き込みは行わない読み取り専用。ユーザーが明示的に操作した時だけ呼び出すこと。
 * @param {string} token ログイントークン
 * @param {string} dateString 'YYYY-MM-DD' 形式の日付
 * @param {string} [requestedStaffName] 管理者が参照したい対象スタッフ名(管理者以外では無視される)
 * @param {boolean} [forceRefresh] trueの場合、サーバー側共有キャッシュが有効でも読み飛ばして再計算する
 *   (手動の「🔄 再取得」ボタン用。タブを開いた時の自動取得ではキャッシュを使うためfalse/省略にする)
 * @return {{success: boolean, date?: string, staffName?: string, appointments?: Array, message?: string}}
 */
function getRouteForStaffOnDate(token, dateString, requestedStaffName, forceRefresh) {
    try {
        const context = getScheduleAccessContext_(token);
        if (!context) {
            logToBuffer('WARN', 'GetRouteAccessDenied', 'invalid-session', `無効なセッションでのルート取得を試みました(日付=${dateString})`);
            return { success: false, message: 'ログインセッションが無効です。再度ログインしてください。', appointments: [] };
        }
        const staffName = resolveScheduleTargetStaffName_(context, requestedStaffName);

        const result = getScheduleWithRouteForStaffOnDate(staffName, dateString, !!forceRefresh);
        // Maps APIの呼び出し(コスト発生)を伴うユーザー操作のため、誰がいつ実行したかを記録する。
        if (result && result.success) {
            const viaAdmin = staffName !== context.selfStaffName ? ` (操作者=${context.selfStaffName})` : '';
            logToBuffer('INFO', 'GetRouteForStaffOnDate', staffName, `日付=${dateString}, 予定数=${(result.appointments || []).length}${viaAdmin}`);
        } else {
            logToBuffer('WARN', 'GetRouteForStaffOnDateFailed', staffName, `日付=${dateString}: ${(result && result.message) || '不明なエラー'}`);
        }
        return result;
    } catch (e) {
        logToBuffer('ERROR', 'GetRouteForStaffOnDateError', 'unknown', `日付=${dateString}: ${e.message}`);
        return { success: false, message: e.message, appointments: [] };
    }
}
