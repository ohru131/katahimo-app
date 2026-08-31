// ==========================================
// Stage 3: 過去の予定確認・修正
// gas-integrated-system(スマホde出勤簿修正アプリ)のデータ操作ロジックを移植。
// 認証は Session.getActiveUser() ではなく、このアプリのログイントークン(checkSession)で行う。
// ==========================================

const PAST_SCHEDULE_YEAR_START_MONTH = 4; // 会計年度開始月(4月始まり)

// gas-integrated-system/doget.js の INPUT_COLUMNS をそのまま移植。
const PAST_SCHEDULE_INPUT_COLUMNS = {
    'C': { type: 'text', label: '#1訪問先等' },
    'D': { type: 'time', label: '#1始業時刻' },
    'E': { type: 'time', label: '#1終業時刻' },
    'AI': { type: 'number', label: '#1出勤距離' },
    'I': { type: 'select', label: '天候' },

    'H': { type: 'number', label: '#1→#2移動時間' },
    'L': { type: 'text', label: '#2訪問先等' },
    'M': { type: 'time', label: '#2始業時刻' },
    'N': { type: 'time', label: '#2終業時刻' },
    'AG': { type: 'number', label: '#1→#2移動距離' },
    'R': { type: 'select', label: '天候' },

    'Q': { type: 'number', label: '#2→#3移動時間' },
    'U': { type: 'text', label: '#3訪問先等' },
    'V': { type: 'time', label: '#3始業時刻' },
    'W': { type: 'time', label: '#3終業時刻' },
    'AH': { type: 'number', label: '#2→#3移動距離' },
    'AJ': { type: 'number', label: '退勤距離' },

    'X': { type: 'text', label: '作業１' },
    'Y': { type: 'time', label: '作業１開始' },
    'Z': { type: 'time', label: '作業１終了' },

    'AA': { type: 'text', label: '作業２' },
    'AB': { type: 'time', label: '作業２開始' },
    'AC': { type: 'time', label: '作業２終了' },

    'AN': { type: 'number', label: '買物代行' },
    'AO': { type: 'text', label: '備考' }
};

/**
 * ログイントークンからスタッフ名・管理者権限を確定する。
 * Session.getActiveUser() を使う gas-integrated-system の getAccessContext_ と違い、
 * このアプリのログインセッション(checkSession)を正とする。
 */
function getPastScheduleAccessContext_(token) {
    const session = checkSession(token, false);
    if (!session || !session.valid) {
        // 複数の管理者・利用者が使うため、無効なセッションでのアクセス試行を記録する。
        logToBuffer('WARN', 'PastScheduleAccessDenied', 'invalid-session', 'ログインセッションが無効な状態でアクセスがありました');
        throw new Error('ログインセッションが無効です。再度ログインしてください。');
    }
    return { selfStaffName: session.name, isAdmin: !!session.isAdmin };
}

function resolvePastScheduleTargetStaffName_(context, requestedStaffName) {
    if (!context.isAdmin) {
        return context.selfStaffName;
    }
    const requested = String(requestedStaffName || '').trim();
    return requested || context.selfStaffName;
}

/**
 * 対象日付が属する会計年度を返す('YYYY'形式の文字列)。
 */
function getFiscalYearForDate_(dateString) {
    const d = new Date(String(dateString || '').replace(/-/g, '/'));
    if (isNaN(d.getTime())) throw new Error('日付が不正です。YYYY-MM-DD 形式で指定してください。');
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    return String(m < PAST_SCHEDULE_YEAR_START_MONTH ? y - 1 : y);
}

/**
 * 現在有効なスタッフ名一覧を返す(退職者は除外)。トークン検証は行わない内部ヘルパー。
 * 夜間バッチ(autoSyncTodayScheduleForAllStaff)のようにログインセッションを持たない
 * 呼び出し元と、管理者向けAPI(getActiveStaffNamesForAdmin)の両方から使う。
 */
function getActiveStaffNames_() {
    const ss = SpreadsheetApp.openById(STAFF_SS_ID);
    const sheet = ss.getSheets().find(s => s.getSheetId() === STAFF_GID);
    if (!sheet) return [];

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];

    const data = sheet.getRange(2, 1, lastRow - 1, 15).getValues();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const names = [];
    data.forEach(row => {
        const name = String(row[1] || '').trim(); // Col B
        if (!name) return;
        const retirementDate = row[7]; // Col H
        if (retirementDate) {
            const rDate = new Date(retirementDate);
            if (!isNaN(rDate.getTime())) {
                rDate.setHours(0, 0, 0, 0);
                if (rDate <= today) return; // 退職済み
            }
        }
        names.push(name);
    });
    names.sort();
    return names;
}

/**
 * 管理者向け: 現在有効なスタッフ名一覧を返す(退職者は除外)。
 * 管理者以外が呼んだ場合は空配列を返す。
 */
function getActiveStaffNamesForAdmin(token) {
    try {
        const context = getPastScheduleAccessContext_(token);
        if (!context.isAdmin) {
            logToBuffer('WARN', 'GetActiveStaffNamesAccessDenied', context.selfStaffName, '管理者権限なしでスタッフ一覧の取得を試みました');
            return [];
        }
        return getActiveStaffNames_();
    } catch (e) {
        logToBuffer('ERROR', 'GetActiveStaffNamesError', 'unknown', e.message);
        return [];
    }
}

/**
 * Driveの検索クエリ(DriveApp.searchFiles)に文字列リテラルとして埋め込むための
 * エスケープ処理。Driveの検索クエリ構文ではシングルクォートを \' でエスケープする。
 * これを行わないと、staffNameに ' が含まれる場合にクエリの条件を書き換えられてしまう
 * (例: 管理者権限を奪取された場合に、出勤簿以外のデプロイ者Drive内ファイルを検索できてしまう)。
 */
function escapeForDriveQuery_(value) {
    return String(value || '').replace(/'/g, "\\'");
}

/**
 * Driveから対象スタッフの出勤簿スプレッドシートを検索する。
 * gas-integrated-system/doget.js の findSpreadsheetGlobal をそのまま移植。
 */
// 出勤簿ファイルの格納先(このフォルダ配下に「{年度}出勤簿」フォルダがあり、
// その中に各スタッフの出勤簿ファイルが入っている)。
// gas-integrated-system/doget.js の ATTENDANCE_ROOT_FOLDER_ID と同じ場所を参照する。
// フォルダID(PAST_SCHEDULE_ATTENDANCE_ROOT_FOLDER_ID)はConfig.jsで定義。

function getPastScheduleAttendanceYearFolder_(year) {
    const rootFolder = DriveApp.getFolderById(PAST_SCHEDULE_ATTENDANCE_ROOT_FOLDER_ID);
    const folderName = year + '出勤簿';
    const candidates = rootFolder.getFoldersByName(folderName);
    if (candidates.hasNext()) {
        return candidates.next();
    }
    throw new Error('年度フォルダが見つかりません: ' + folderName + '(親フォルダID: ' + PAST_SCHEDULE_ATTENDANCE_ROOT_FOLDER_ID + ')');
}

function findPastScheduleSpreadsheet_(staffName, year) {
    const searchKey = staffName + '_出勤簿_' + year + '年度';
    const safeSearchKey = escapeForDriveQuery_(searchKey);
    const safeStaffName = escapeForDriveQuery_(staffName);
    const yearFolder = getPastScheduleAttendanceYearFolder_(year);
    const inYearFolder = "'" + yearFolder.getId() + "' in parents and ";

    const exactMatches = DriveApp.searchFiles(
        inYearFolder + "title = '" + safeSearchKey + "' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false"
    );
    const newestExactFile = getNewestPastScheduleFile_(exactMatches);
    if (newestExactFile) {
        return SpreadsheetApp.open(newestExactFile);
    }

    const searchKeyNoSpace = normalizePastScheduleFileName_(searchKey);
    const allCandidates = DriveApp.searchFiles(
        inYearFolder + "title contains '" + safeStaffName + "' and title contains '出勤簿' and trashed = false"
    );
    const newestNormalizedFile = getNewestPastScheduleFile_(allCandidates, file => normalizePastScheduleFileName_(file.getName()) === searchKeyNoSpace);
    if (newestNormalizedFile) {
        return SpreadsheetApp.open(newestNormalizedFile);
    }

    throw new Error('出勤簿ファイルが見つかりません(検索名: ' + searchKey + ' / フォルダ: ' + yearFolder.getName() + ')。');
}

function getNewestPastScheduleFile_(files, matcher) {
    let newestFile = null;
    let newestTime = -1;
    while (files.hasNext()) {
        const file = files.next();
        if (matcher && !matcher(file)) continue;
        const updatedTime = file.getLastUpdated().getTime();
        if (!newestFile || updatedTime > newestTime) {
            newestFile = file;
            newestTime = updatedTime;
        }
    }
    return newestFile;
}

function normalizePastScheduleFileName_(name) {
    return String(name || '').replace(/\s+/g, '').replace(/　/g, '');
}

// 出勤簿テンプレート(gas-childcare-daily-report/attendance.js)は「N月」シート・
// 4行目(DATA_START_ROW)起点で1日1行を連続配置する前提(transfer.jsの
// `DATA_START_ROW + day - 1` と同じ)。この前提でシート名・行番号を直接算出し、
// 全シート・全行の線形スキャンを避ける。前提が崩れている場合は線形スキャンにフォールバックする。
const PAST_SCHEDULE_DATA_START_ROW = 4;

function findPastScheduleTargetRow_(spreadsheet, dateString) {
    const searchDate = new Date(String(dateString).replace(/-/g, '/'));

    const month = searchDate.getMonth() + 1;
    const day = searchDate.getDate();
    const sheet = spreadsheet.getSheetByName(month + '月');
    if (sheet) {
        const rowNumber = PAST_SCHEDULE_DATA_START_ROW + day - 1;
        if (rowNumber <= sheet.getLastRow()) {
            const val = sheet.getRange(rowNumber, 1).getValue();
            if (val && isSamePastScheduleDate_(val, searchDate)) {
                return { sheet: sheet, rowNumber: rowNumber };
            }
        }
    }

    return findPastScheduleTargetRowByScan_(spreadsheet, searchDate);
}

function findPastScheduleTargetRowByScan_(spreadsheet, searchDate) {
    const sheets = spreadsheet.getSheets();

    for (let s = 0; s < sheets.length; s++) {
        const sheet = sheets[s];
        const lastRow = sheet.getLastRow();
        if (lastRow < 1) continue;

        const dateValues = sheet.getRange(1, 1, lastRow, 1).getValues();
        for (let i = 0; i < dateValues.length; i++) {
            const val = dateValues[i][0];
            if (!val) continue;
            if (isSamePastScheduleDate_(val, searchDate)) {
                return { sheet: sheet, rowNumber: i + 1 };
            }
        }
    }
    return { sheet: null, rowNumber: -1 };
}

function isSamePastScheduleDate_(d1, d2) {
    try {
        const s1 = Utilities.formatDate(new Date(d1), 'Asia/Tokyo', 'yyyyMMdd');
        const s2 = Utilities.formatDate(new Date(d2), 'Asia/Tokyo', 'yyyyMMdd');
        return s1 === s2;
    } catch (e) {
        return false;
    }
}

function isSamePastScheduleValue_(oldVal, newVal) {
    const sOld = String(oldVal);
    const sNew = String(newVal);
    if (sOld === sNew) return true;
    if (oldVal instanceof Date) {
        const formattedOld = Utilities.formatDate(oldVal, 'Asia/Tokyo', 'HH:mm');
        if (formattedOld === sNew) return true;
    }
    return false;
}

function pastScheduleColumnToNumber_(column) {
    let result = 0;
    for (let i = 0; i < column.length; i++) {
        result = result * 26 + (column.charCodeAt(i) - 'A'.charCodeAt(0) + 1);
    }
    return result;
}

// PAST_SCHEDULE_INPUT_COLUMNS の全列(C〜AOの間、約25列)を1回のgetValuesでまとめて読み取る
// (readPastScheduleMonthRows_と同じ考え方。列ごとにgetRange().getValue()を呼ぶと1回の
// 呼び出しで約25往復のAPIコールが発生していた)。
function readPastScheduleRowData_(sheet, rowNumber) {
    const colNumbers = Object.keys(PAST_SCHEDULE_INPUT_COLUMNS).map(pastScheduleColumnToNumber_);
    const maxCol = Math.max.apply(null, colNumbers);
    const rowValues = sheet.getRange(rowNumber, 1, 1, maxCol).getValues()[0];

    const rowData = {};
    for (const colChar in PAST_SCHEDULE_INPUT_COLUMNS) {
        const colNum = pastScheduleColumnToNumber_(colChar);
        let val = rowValues[colNum - 1];
        if (val instanceof Date) {
            val = Utilities.formatDate(val, 'Asia/Tokyo', 'HH:mm');
        }
        rowData[colChar] = val;
    }
    return rowData;
}

function getPastScheduleSelectOptions_(sheet, colChar) {
    try {
        const range = sheet.getRange(colChar + '5');
        const rule = range.getDataValidation();
        if (!rule) return [];
        const criteria = rule.getCriteriaType();
        const args = rule.getCriteriaValues();
        if (criteria === SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) {
            return args[0];
        } else if (criteria === SpreadsheetApp.DataValidationCriteria.VALUE_IN_RANGE) {
            const values = args[0].getValues();
            return values.flat().filter(v => v !== '');
        }
        return [];
    } catch (e) {
        return [];
    }
}

/**
 * 指定日の出勤簿1行を取得する(閲覧・編集フォーム表示用)。
 * @param {string} token ログイントークン
 * @param {string} dateString 'YYYY-MM-DD'
 * @param {string} requestedStaffName 管理者が他スタッフを指定する場合のみ使用。一般スタッフは無視され本人固定。
 */
function getPastScheduleForDate(token, dateString, requestedStaffName) {
    try {
        const context = getPastScheduleAccessContext_(token);
        const staffName = resolvePastScheduleTargetStaffName_(context, requestedStaffName);
        const year = getFiscalYearForDate_(dateString);

        const spreadsheet = findPastScheduleSpreadsheet_(staffName, year);
        const target = findPastScheduleTargetRow_(spreadsheet, dateString);

        if (target.rowNumber === -1) {
            logToBuffer('WARN', 'GetPastScheduleNotFound', context.selfStaffName, `対象=${staffName}, 日付=${dateString} の記録が出勤簿に見つかりませんでした`);
            return { success: false, message: '指定日(' + dateString + ')の記録が出勤簿に見つかりません。', isAdmin: context.isAdmin, staffName: staffName };
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const targetDate = new Date(String(dateString).replace(/-/g, '/'));
        targetDate.setHours(0, 0, 0, 0);
        const monthStartDate = new Date(today.getFullYear(), today.getMonth(), 1);
        const monthEndDate = new Date(today.getFullYear(), today.getMonth() + 1, 0); // 当月末日
        const editable = targetDate >= monthStartDate && targetDate <= monthEndDate;

        // 管理者が他スタッフの出勤簿を閲覧した場合は、操作者(自分自身)の名前を残す
        // (CLAUDE.mdのログ方針: 他スタッフを跨ぐ操作は頻度に関わらず記録する)。
        if (staffName !== context.selfStaffName) {
            logToBuffer('INFO', 'GetPastScheduleForDate', staffName, `日付=${dateString} (操作者=${context.selfStaffName})`);
        }

        return {
            success: true,
            dateString: dateString,
            staffName: staffName,
            isAdmin: context.isAdmin,
            sheetName: target.sheet.getName(),
            rowNumber: target.rowNumber,
            rowData: readPastScheduleRowData_(target.sheet, target.rowNumber),
            optionsI: getPastScheduleSelectOptions_(target.sheet, 'I'),
            optionsR: getPastScheduleSelectOptions_(target.sheet, 'R'),
            editable: editable,
            editableFrom: Utilities.formatDate(monthStartDate, 'Asia/Tokyo', 'yyyy-MM-dd'),
            editableTo: Utilities.formatDate(monthEndDate, 'Asia/Tokyo', 'yyyy-MM-dd')
        };
    } catch (e) {
        logToBuffer('ERROR', 'GetPastScheduleError', requestedStaffName || 'unknown', `日付=${dateString}: ${e.message}`);
        return { success: false, message: e.message };
    }
}

/**
 * 出勤簿1行を更新する。当月より前の日付は修正不可(gas-integrated-systemと同じ制約)。
 * @param {string} token ログイントークン
 * @param {Object} formObject {dateString, staffName, sheetName, rowNumber, values: {colChar: value}}
 */
function updatePastSchedule(token, formObject) {
    try {
        if (!formObject) throw new Error('入力データがありません。');
        const dateString = formObject.dateString;
        if (!dateString) throw new Error('日付情報が不足しています。');

        const targetDate = new Date(String(dateString).replace(/-/g, '/'));
        const today = new Date();
        targetDate.setHours(0, 0, 0, 0);
        today.setHours(0, 0, 0, 0);
        const monthStartDate = new Date(today.getFullYear(), today.getMonth(), 1);
        const monthEndDate = new Date(today.getFullYear(), today.getMonth() + 1, 0); // 当月末日

        if (targetDate < monthStartDate) {
            throw new Error('修正期限切れです。当月(' + Utilities.formatDate(monthStartDate, 'Asia/Tokyo', 'MM/dd') + ')より前の記録は変更できません。');
        }
        if (targetDate > monthEndDate) {
            throw new Error('修正できません。来月以降(' + Utilities.formatDate(monthEndDate, 'Asia/Tokyo', 'MM/dd') + 'より後)の記録はまだ修正できません。');
        }

        const context = getPastScheduleAccessContext_(token);
        const staffName = resolvePastScheduleTargetStaffName_(context, formObject.staffName);
        const year = getFiscalYearForDate_(dateString);

        const spreadsheet = findPastScheduleSpreadsheet_(staffName, year);
        // formObject.sheetName/rowNumber(getPastScheduleForDateがクライアントに返した値)は信用せず、
        // dateStringから必ずサーバー側で再算出する。これを怠ると、月ロックの検証だけdateString=当月
        // で通しつつ、sheetName/rowNumberだけ過去月の行を指すよう偽装することで、当月より前の
        // 確定済みデータを書き換えられてしまう。
        const target = findPastScheduleTargetRow_(spreadsheet, dateString);
        if (target.rowNumber === -1) {
            throw new Error('指定日(' + dateString + ')の記録が出勤簿に見つかりません。');
        }
        const sheet = target.sheet;
        const rowNumber = target.rowNumber;

        const values = formObject.values || {};
        let changedCount = 0;
        for (const colChar in PAST_SCHEDULE_INPUT_COLUMNS) {
            if (!(colChar in values)) continue;
            const newValue = values[colChar];
            const colNum = pastScheduleColumnToNumber_(colChar);
            const cell = sheet.getRange(rowNumber, colNum);
            const oldValue = cell.getValue();

            if (!isSamePastScheduleValue_(oldValue, newValue)) {
                cell.setValue(newValue);
                cell.setBackground('#fce4e4');
                changedCount++;
            }
        }

        logToBuffer('INFO', 'UpdatePastSchedule', context.selfStaffName, `Updated ${staffName} ${dateString} (${changedCount} cells changed)`);
        return { success: true, message: changedCount > 0 ? '修正しました。' : '変更はありませんでした。' };
    } catch (e) {
        logToBuffer('ERROR', 'UpdatePastScheduleError', (formObject && formObject.staffName) || 'unknown', `日付=${formObject && formObject.dateString}: ${e.message}`);
        return { success: false, message: e.message };
    }
}

// ==========================================
// カレンダー→出勤簿の自動反映(gas-integrated-system/doget.js の
// syncCalendarToTimesheet / syncCalendarForStaffOnDate_ 相当)
// 手入力修正(updatePastSchedule)と異なり、この機能には修正可能期限の制限は設けない
// (元の仕様のまま。カレンダー内容の反映はいつでも行えるようにする)。
// ==========================================

// rowDataに含まれる列(カレンダー反映で実際に変更する列のみ。buildCalendarSyncPlan_参照)を
// 列ごとのgetRange().setValue()ではなく、対象列の最小〜最大を1回のgetValues/setValuesで
// まとめて読み書きする(未変更の間の列は読み取った値をそのまま書き戻すだけで、
// rowDataに含まれない列の内容は変更しない)。
function writePastScheduleRowData_(sheet, rowNumber, rowData) {
    const colChars = Object.keys(rowData);
    if (colChars.length === 0) return;

    const colNumbers = colChars.map(pastScheduleColumnToNumber_);
    const minCol = Math.min.apply(null, colNumbers);
    const maxCol = Math.max.apply(null, colNumbers);

    const range = sheet.getRange(rowNumber, minCol, 1, maxCol - minCol + 1);
    const values = range.getValues()[0];
    colChars.forEach(colChar => {
        const colNum = pastScheduleColumnToNumber_(colChar);
        values[colNum - minCol] = rowData[colChar];
    });
    range.setValues([values]);
}

// カレンダー由来の列を、buildTimesheetRowDataFromAppointments_(RouteSearch.js)と同じ
// 「訪問#1/#2/#3・事務作業#1/#2」の5グループに束ねたもの。timeCols が両方とも入力されている
// 場合のみ、そのグループは「入っている」とみなす。グループの境界は
// buildTimesheetRowDataFromAppointments_ の割り当てと完全に一致させている
// (H/AGは#2への移動、Q/AHは#3への移動、AIは出勤距離として#1側に付随する)。
// 退勤距離(AJ)は、その日最後の訪問(件数によって#1〜#3のどれかになる。
// buildTimesheetRowDataFromAppointments_のwithLeaving探索を参照)に付随するため、
// 特定のスロットに固定せずPAST_SCHEDULE_VISIT_SLOT_KEYSとして下のbuildCalendarSyncPlan_で
// 別扱いする(訪問が2件以下の日にAJが出勤簿へ反映されなくなる不具合の修正)。
const PAST_SCHEDULE_SYNC_SLOTS = [
    { key: 'slot1', timeCols: ['D', 'E'], cols: ['C', 'D', 'E', 'AI'] },
    { key: 'slot2', timeCols: ['M', 'N'], cols: ['H', 'L', 'M', 'N', 'AG'] },
    { key: 'slot3', timeCols: ['V', 'W'], cols: ['Q', 'U', 'V', 'W', 'AH'] },
    { key: 'office1', timeCols: ['Y', 'Z'], cols: ['X', 'Y', 'Z'] },
    { key: 'office2', timeCols: ['AB', 'AC'], cols: ['AA', 'AB', 'AC'] }
];

const PAST_SCHEDULE_VISIT_SLOT_KEYS = ['slot1', 'slot2', 'slot3'];

// "HH:mm"→分変換は AttendanceCalc.js の parseTimeToMinutes と同じロジックのため、
// 重複定義せずそちらを再利用する。
function timeRangesOverlap_(startA, endA, startB, endB) {
    const sA = parseTimeToMinutes(startA), eA = parseTimeToMinutes(endA);
    const sB = parseTimeToMinutes(startB), eB = parseTimeToMinutes(endB);
    if (sA === null || eA === null || sB === null || eB === null) return false;
    return sA < eB && sB < eA;
}

/**
 * 出勤簿の現在の内容(currentRowData)とカレンダー由来の内容(calendarRowData)を比較し、
 * 「実際に書き込む列」だけを抽出する。
 *
 * 方針(手入力で追加した、カレンダーには存在しない予定を自動で消してしまわないため):
 * - カレンダー側にそのグループの予定がある(始業・終業とも入力がある)場合は、
 *   カレンダーの内容で上書きする(値が同じなら実質変更なし)。
 * - カレンダー側にそのグループの予定が無く、出勤簿側にだけ予定がある場合は、
 *   その時間帯がカレンダー由来の他グループの時間帯と重なっていない限り、
 *   その列には一切書き込まない(=既存の入力をそのまま残す)。
 *   時間帯が重なっている場合のみ、カレンダー側で表現し直された(=消えた)ものとみなしてクリアする。
 *
 * @return {{changes: Array<{col:string,label:string,oldValue:*,newValue:*}>, valuesToApply: Object}}
 */
function buildCalendarSyncPlan_(currentRowData, calendarRowData) {
    const changes = [];
    const valuesToApply = {};

    const incomingFilledSlots = PAST_SCHEDULE_SYNC_SLOTS.filter(slot => {
        const [sc, ec] = slot.timeCols;
        return calendarRowData[sc] && calendarRowData[ec];
    });

    PAST_SCHEDULE_SYNC_SLOTS.forEach(slot => {
        const [sc, ec] = slot.timeCols;
        const incomingFilled = !!(calendarRowData[sc] && calendarRowData[ec]);
        const currentFilled = !!(currentRowData[sc] && currentRowData[ec]);

        if (incomingFilled) {
            slot.cols.forEach(col => {
                const oldValue = currentRowData[col] !== undefined ? currentRowData[col] : '';
                const newValue = calendarRowData[col] !== undefined ? calendarRowData[col] : '';
                if (!isSamePastScheduleValue_(oldValue, newValue)) {
                    changes.push({ col: col, label: PAST_SCHEDULE_INPUT_COLUMNS[col].label, oldValue: oldValue, newValue: newValue });
                }
                valuesToApply[col] = newValue;
            });
            return;
        }

        if (currentFilled) {
            const overlapsAny = incomingFilledSlots.some(other => {
                const [osc, oec] = other.timeCols;
                return timeRangesOverlap_(currentRowData[sc], currentRowData[ec], calendarRowData[osc], calendarRowData[oec]);
            });
            if (overlapsAny) {
                slot.cols.forEach(col => {
                    const oldValue = currentRowData[col] !== undefined ? currentRowData[col] : '';
                    if (!isSamePastScheduleValue_(oldValue, '')) {
                        changes.push({ col: col, label: PAST_SCHEDULE_INPUT_COLUMNS[col].label, oldValue: oldValue, newValue: '' });
                    }
                    valuesToApply[col] = '';
                });
            }
            // 重なりが無ければ何もしない(valuesToApplyに含めない = 出勤簿側の入力をそのまま残す)。
        }
    });

    // 退勤距離(AJ): カレンダー由来の訪問のうち最後に埋まっている枠(slot1〜slot3で最も番号が
    // 大きいもの)に付随する値のため、そのスロットのcolsとは別にここで一度だけ判定する。
    const lastIncomingVisitSlot = incomingFilledSlots
        .filter(slot => PAST_SCHEDULE_VISIT_SLOT_KEYS.includes(slot.key))
        .pop();
    if (lastIncomingVisitSlot) {
        const oldValue = currentRowData.AJ !== undefined ? currentRowData.AJ : '';
        const newValue = calendarRowData.AJ !== undefined ? calendarRowData.AJ : '';
        if (!isSamePastScheduleValue_(oldValue, newValue)) {
            changes.push({ col: 'AJ', label: PAST_SCHEDULE_INPUT_COLUMNS.AJ.label, oldValue: oldValue, newValue: newValue });
        }
        valuesToApply.AJ = newValue;
    }

    return { changes: changes, valuesToApply: valuesToApply };
}

/**
 * 指定スタッフ・指定日について、出勤簿の該当行とカレンダー予定を突き合わせ、
 * 実際に書き込む内容(差分)を計算する。書き込みはまだ行わない。
 * トークン検証は呼び出し元が行う。
 */
// 書き込みは一切行わない(computeAttendanceRowDataForStaffOnDate_が純粋計算のため)。
// これにより previewCalendarSyncForStaffOnDate(プレビューのみ・書き込みなしのはず)が
// 「勤怠集計」シートを誤って書き換えてしまうことはない(以前はrefreshAttendanceForStaffOnDate
// を直接呼んでおり、プレビュー時にも副作用で書き込まれてしまっていた)。
function computeCalendarSyncPlanForStaffOnDate_(staffName, dateString) {
    const year = getFiscalYearForDate_(dateString);

    const spreadsheet = findPastScheduleSpreadsheet_(staffName, year);
    const target = findPastScheduleTargetRow_(spreadsheet, dateString);
    if (target.rowNumber === -1) {
        throw new Error('指定日(' + dateString + ')の出勤簿の行が見つかりませんでした。');
    }

    const result = computeAttendanceRowDataForStaffOnDate_(staffName, dateString);
    if (!result || result.success !== true) {
        throw new Error('カレンダー予定の取得に失敗しました。');
    }

    const currentRowData = readPastScheduleRowData_(target.sheet, target.rowNumber);
    const plan = buildCalendarSyncPlan_(currentRowData, result.rowData || {});

    return {
        sheet: target.sheet,
        rowNumber: target.rowNumber,
        staffName: result.staffName,
        dateStr: result.date,
        appointmentCount: (result.appointments || []).length,
        changes: plan.changes,
        valuesToApply: plan.valuesToApply,
        outputRows: result.outputRows // 「勤怠集計」への書き込み用(実際に反映する側の呼び出し元のみが使う)
    };
}

/**
 * 指定スタッフ・指定日について、出勤簿の該当行をカレンダー予定で反映する中核処理。
 * カレンダーに存在しない(=出勤簿側にしか無い)予定は、カレンダー由来の予定と時間帯が
 * 重ならない限り消さずに残す(buildCalendarSyncPlan_参照)。個別の出勤簿だけでなく、
 * 「勤怠集計」の集約行も合わせて更新する(元のrefreshAttendanceForStaffOnDateが
 * 単独で担っていた役割を、非破壊マージ導入後もここで引き継ぐ)。
 * トークン検証・ログ記録は呼び出し元(syncPastScheduleFromCalendar / 夜間バッチ)が行う。
 * @return {{appointmentCount: number}}
 */
function syncCalendarForStaffOnDate_(staffName, dateString) {
    const plan = computeCalendarSyncPlanForStaffOnDate_(staffName, dateString);
    writePastScheduleRowData_(plan.sheet, plan.rowNumber, plan.valuesToApply);
    writeAttendanceAggregateRows_(plan.staffName, plan.dateStr, plan.outputRows);
    return { appointmentCount: plan.appointmentCount };
}

function syncPastScheduleFromCalendar(token, dateString, requestedStaffName) {
    try {
        const context = getPastScheduleAccessContext_(token);
        const staffName = resolvePastScheduleTargetStaffName_(context, requestedStaffName);

        const syncResult = syncCalendarForStaffOnDate_(staffName, dateString);

        logToBuffer('INFO', 'SyncPastScheduleFromCalendar', context.selfStaffName, `Synced ${staffName} ${dateString} (${syncResult.appointmentCount} appointments)`);

        return {
            success: true,
            staffName: staffName,
            dateString: dateString,
            appointmentCount: syncResult.appointmentCount
        };
    } catch (e) {
        logToBuffer('ERROR', 'SyncPastScheduleFromCalendarError', requestedStaffName || 'unknown', `日付=${dateString}: ${e.message}`);
        return { success: false, message: e.message, staffName: requestedStaffName, dateString: dateString };
    }
}

/**
 * 「この日をカレンダーから反映」ボタン用: 実際には書き込まず、出勤簿の内容と
 * カレンダー由来の内容の差分だけを返す(確認ダイアログ表示用)。
 * @param {string} token ログイントークン
 * @param {string} dateString 'YYYY-MM-DD'
 * @param {string} requestedStaffName 管理者が他スタッフを指定する場合のみ使用。一般スタッフは無視され本人固定。
 */
function previewCalendarSyncForStaffOnDate(token, dateString, requestedStaffName) {
    try {
        const context = getPastScheduleAccessContext_(token);
        const staffName = resolvePastScheduleTargetStaffName_(context, requestedStaffName);

        const plan = computeCalendarSyncPlanForStaffOnDate_(staffName, dateString);

        // Maps API呼び出し(コスト発生)を伴う処理のため、管理者が他スタッフのデータに対して
        // 操作した場合は操作者を記録する(自分自身の閲覧は高頻度のため記録しない)。
        if (staffName !== context.selfStaffName) {
            logToBuffer('INFO', 'PreviewCalendarSync', staffName, `日付=${dateString}, 予定数=${plan.appointmentCount}, 変更数=${plan.changes.length} (操作者=${context.selfStaffName})`);
        }

        return {
            success: true,
            staffName: staffName,
            dateString: dateString,
            appointmentCount: plan.appointmentCount,
            hasChanges: plan.changes.length > 0,
            changes: plan.changes
        };
    } catch (e) {
        logToBuffer('ERROR', 'PreviewCalendarSyncError', requestedStaffName || 'unknown', `日付=${dateString}: ${e.message}`);
        return { success: false, message: e.message };
    }
}

/**
 * previewCalendarSyncForStaffOnDate の確認後、実際に出勤簿へ書き込む。
 * クライアントから送られた差分をそのまま信用せず、書き込み時に同じ計算をサーバー側で
 * やり直す(この間にカレンダー・出勤簿の内容が変わっていればその最新状態を反映する)。
 */
function applyCalendarSyncForStaffOnDate(token, dateString, requestedStaffName) {
    try {
        const context = getPastScheduleAccessContext_(token);
        const staffName = resolvePastScheduleTargetStaffName_(context, requestedStaffName);

        const plan = computeCalendarSyncPlanForStaffOnDate_(staffName, dateString);
        writePastScheduleRowData_(plan.sheet, plan.rowNumber, plan.valuesToApply);
        writeAttendanceAggregateRows_(plan.staffName, plan.dateStr, plan.outputRows);

        logToBuffer('INFO', 'ApplyCalendarSync', context.selfStaffName, `Synced ${staffName} ${dateString} (${plan.appointmentCount} appointments, ${plan.changes.length} changed)`);

        return {
            success: true,
            staffName: staffName,
            dateString: dateString,
            appointmentCount: plan.appointmentCount,
            changedCount: plan.changes.length
        };
    } catch (e) {
        logToBuffer('ERROR', 'ApplyCalendarSyncError', requestedStaffName || 'unknown', `日付=${dateString}: ${e.message}`);
        return { success: false, message: e.message };
    }
}

/**
 * 【トリガー専用】毎晩、当日分の予定を全スタッフの出勤簿へ自動反映する。
 * gas-childcare-daily-report の autoRunDailyTransfer(「勤怠集計」→個別出勤簿への夜間転記)を
 * 置き換える機能。ログインセッションが無いバッチ実行のため、トークン検証は行わない
 * (syncCalendarForStaffOnDate_を直接呼ぶ)。1スタッフの失敗が他スタッフの処理を止めないよう、
 * スタッフごとにtry/catchする。
 * 一度だけ setupAutoSyncTrigger() を実行し、時限トリガーを作成すること。
 */
function autoSyncTodayScheduleForAllStaff() {
    const dateString = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
    const staffNames = getActiveStaffNames_();

    let successCount = 0;
    let failureCount = 0;
    staffNames.forEach(staffName => {
        try {
            const syncResult = syncCalendarForStaffOnDate_(staffName, dateString);
            successCount++;
            logToBuffer('INFO', 'AutoSyncTodayScheduleForStaff', staffName, `日付=${dateString}, 予定数=${syncResult.appointmentCount}`);
        } catch (e) {
            failureCount++;
            logToBuffer('ERROR', 'AutoSyncTodayScheduleForStaffError', staffName, `日付=${dateString}: ${e.message}`);
        }
    });

    logToBuffer('INFO', 'AutoSyncTodayScheduleForAllStaffDone', 'system', `日付=${dateString}, 対象=${staffNames.length}, 成功=${successCount}, 失敗=${failureCount}`);
}

/**
 * autoSyncTodayScheduleForAllStaff の時限トリガーを作成する(初回のみApps Scriptエディタで手動実行)。
 * 既存のトリガーが残っていると重複実行されるため、作成前に同名トリガーを削除する。
 */
function setupAutoSyncTrigger() {
    ScriptApp.getProjectTriggers().forEach(trigger => {
        if (trigger.getHandlerFunction() === 'autoSyncTodayScheduleForAllStaff') {
            ScriptApp.deleteTrigger(trigger);
        }
    });
    ScriptApp.newTrigger('autoSyncTodayScheduleForAllStaff')
        .timeBased()
        .everyDays(1)
        .atHour(22) // 22時台に実行(業務時間終了後を想定。変更したい場合はここを編集して再実行する)
        .create();
}

// ==========================================
// 週間予定(過去の予定タブ: Googleカレンダー週間表示風の閲覧専用ビュー)
// カレンダーの内容を直接読むのではなく、出勤簿スプレッドシート(手入力・カレンダー反映の
// 結果が最終的に保存されている場所)から読み取る。カレンダー側の予定を直接見たい場合は、
// 既存の「この日をカレンダーから反映」ボタン(差分確認つき)を使う。
// ==========================================

const PAST_SCHEDULE_WEEK_MAX_DAYS = 31; // ANYONE_ANONYMOUS公開のため、1リクエストで取得できる日数に上限を設ける

/**
 * 出勤簿1行分のrowData(PAST_SCHEDULE_INPUT_COLUMNS形式)を、週間予定UI表示用の
 * イベント配列(訪問#1〜#3・事務作業#1〜#2)に変換する。始業・終業が両方入力されている
 * グループのみイベント化する(PAST_SCHEDULE_SYNC_SLOTSと同じグループ分け)。
 */
function buildScheduleEventsFromRowData_(dateStr, rowData) {
    const slotDefs = [
        { slotKey: 'slot1', name: rowData.C, start: rowData.D, end: rowData.E, eventType: 'CUSTOMER APPOINTMENT' },
        { slotKey: 'slot2', name: rowData.L, start: rowData.M, end: rowData.N, eventType: 'CUSTOMER APPOINTMENT' },
        { slotKey: 'slot3', name: rowData.U, start: rowData.V, end: rowData.W, eventType: 'CUSTOMER APPOINTMENT' },
        { slotKey: 'office1', name: rowData.X, start: rowData.Y, end: rowData.Z, eventType: 'OFFICE WORK' },
        { slotKey: 'office2', name: rowData.AA, start: rowData.AB, end: rowData.AC, eventType: 'OFFICE WORK' }
    ];
    return slotDefs
        .filter(slot => slot.start && slot.end)
        .map(slot => ({ date: dateStr, slotKey: slot.slotKey, title: slot.name || '', eventType: slot.eventType, start: slot.start, end: slot.end }));
}

/**
 * 指定期間(startDateString〜endDateString、両端含む)の対象スタッフの出勤簿の内容を返す
 * (週間予定UI用、閲覧専用)。出勤簿ファイルが無い年度・行が無い日は空扱いにするだけで
 * 握りつぶす(閲覧専用画面のため)。
 * @param {string} token ログイントークン
 * @param {string} requestedStaffName 管理者が他スタッフを指定する場合のみ使用。一般スタッフは無視され本人固定。
 */
function getWeeklyScheduleForStaff(token, startDateString, endDateString, requestedStaffName) {
    try {
        const context = getPastScheduleAccessContext_(token);
        const staffName = resolvePastScheduleTargetStaffName_(context, requestedStaffName);

        const start = new Date(String(startDateString || '').replace(/-/g, '/'));
        const end = new Date(String(endDateString || '').replace(/-/g, '/'));
        if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) {
            throw new Error('日付範囲が不正です。');
        }
        const dayCount = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
        if (dayCount > PAST_SCHEDULE_WEEK_MAX_DAYS) {
            throw new Error('一度に取得できる日数の上限(' + PAST_SCHEDULE_WEEK_MAX_DAYS + '日)を超えています。');
        }

        const spreadsheetByFiscalYear = {};
        const events = [];
        for (let i = 0; i < dayCount; i++) {
            const d = new Date(start);
            d.setDate(d.getDate() + i);
            const dateStr = Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd');
            const fiscalYear = getFiscalYearForDate_(dateStr);
            try {
                if (!spreadsheetByFiscalYear[fiscalYear]) {
                    spreadsheetByFiscalYear[fiscalYear] = findPastScheduleSpreadsheet_(staffName, fiscalYear);
                }
                const target = findPastScheduleTargetRow_(spreadsheetByFiscalYear[fiscalYear], dateStr);
                if (target.rowNumber === -1) continue;
                const rowData = readPastScheduleRowData_(target.sheet, target.rowNumber);
                events.push(...buildScheduleEventsFromRowData_(dateStr, rowData));
            } catch (e) {
                logToBuffer('WARN', 'GetWeeklyScheduleSheetMissing', context.selfStaffName, `対象=${staffName}, 日付=${dateStr}: ${e.message}`);
            }
        }

        // 管理者が他スタッフの出勤簿を閲覧した場合は、操作者(自分自身)の名前を残す
        // (CLAUDE.mdのログ方針: 他スタッフを跨ぐ操作は頻度に関わらず記録する)。
        if (staffName !== context.selfStaffName) {
            logToBuffer('INFO', 'GetWeeklyScheduleForStaff', staffName, `開始=${startDateString}, 終了=${endDateString}, 件数=${events.length} (操作者=${context.selfStaffName})`);
        }

        return { success: true, staffName: staffName, isAdmin: context.isAdmin, events: events };
    } catch (e) {
        logToBuffer('ERROR', 'GetWeeklyScheduleError', requestedStaffName || 'unknown', `開始=${startDateString}, 終了=${endDateString}: ${e.message}`);
        return { success: false, message: e.message };
    }
}

// ==========================================
// 月次集計(過去の予定タブ: 労働時間・残業時間・移動時間・距離・超過回数・領収書集計)
// AttendanceCalc.js の純粋計算関数(webapp-poc/server/attendanceCalcから移植)を、
// 出勤簿スプレッドシートから読み取ったrowDataに適用する。
// ==========================================

/**
 * 出勤簿シートから、月内の全日分の入力列(PAST_SCHEDULE_INPUT_COLUMNS)を1回のgetValuesで
 * まとめて読み取る(1日ごとにgetValueを呼ぶと日数×列数のAPI往復が発生するため)。
 * findPastScheduleTargetRow_と同じ「DATA_START_ROW + day - 1」前提だが、月次集計は閲覧専用の
 * 参考値のため、前提が崩れている(日付が一致しない)日は空データ扱いにするだけで済ませる
 * (更新系のfindPastScheduleTargetRow_のような全シート再走査フォールバックは行わない)。
 */
function readPastScheduleMonthRows_(sheet, year, month, numDays) {
    const colNumbers = Object.keys(PAST_SCHEDULE_INPUT_COLUMNS).map(pastScheduleColumnToNumber_);
    const maxCol = Math.max.apply(null, colNumbers);
    const startRow = PAST_SCHEDULE_DATA_START_ROW;
    const lastRow = sheet.getLastRow();
    const rowsToRead = Math.min(numDays, Math.max(0, lastRow - startRow + 1));

    const result = [];
    if (rowsToRead <= 0) {
        for (let i = 0; i < numDays; i++) result.push({});
        return result;
    }

    const values = sheet.getRange(startRow, 1, rowsToRead, maxCol).getValues();
    for (let i = 0; i < numDays; i++) {
        if (i >= values.length) {
            result.push({});
            continue;
        }
        const rowValues = values[i];
        const dateCell = rowValues[0]; // A列
        const expectedDate = new Date(year, month - 1, i + 1);
        if (!dateCell || !isSamePastScheduleDate_(dateCell, expectedDate)) {
            result.push({});
            continue;
        }

        const rowData = {};
        for (const colChar in PAST_SCHEDULE_INPUT_COLUMNS) {
            const colNum = pastScheduleColumnToNumber_(colChar);
            let val = rowValues[colNum - 1];
            if (val instanceof Date) {
                val = Utilities.formatDate(val, 'Asia/Tokyo', 'HH:mm');
            }
            rowData[colChar] = val;
        }
        result.push(rowData);
    }
    return result;
}

/**
 * 領収書(Main.jsのprocessReceiptImagesが書き込むIMAGE_LOG_SS_IDシート)を、
 * 対象スタッフ×対象月で集計する。ユーザーID列には実際にはスタッフ名の文字列が
 * 入っている(processReceiptImagesの呼び出し元がstaffNameをそのまま渡しているため)。
 * 集計専用の参考値表示のため、失敗しても空集計で握りつぶす。
 */
function getReceiptsForMonth_(staffName, yearMonth) {
    try {
        const ss = SpreadsheetApp.openById(IMAGE_LOG_SS_ID);
        const sheet = ss.getSheets()[0];
        const lastRow = sheet.getLastRow();
        const byDay = {};
        let total = 0;
        if (lastRow < 2) return { byDay: byDay, total: total };

        // 列: A=日時, B=ユーザーID(スタッフ名), C=顧客ID, D=顧客名, E=金額, F=名称
        const values = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
        const prefix = String(yearMonth).replace('-', '/');
        const normalize = normalizeStaffName_;
        const targetKey = normalize(staffName);

        values.forEach(row => {
            if (normalize(row[1]) !== targetKey) return;
            // appendRowで書き込んだ日時文字列("yyyy/MM/dd HH:mm:ss")はSheetsによって自動的に
            // Dateセルへ変換されるため、String(row[0])のままではprefix("yyyy/MM")と一致しない
            // (readPastScheduleRowData_等、他の箇所と同じinstanceof Dateガードが必要)。
            const timestamp = (row[0] instanceof Date)
                ? Utilities.formatDate(row[0], 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss')
                : String(row[0] || '');
            if (!timestamp.startsWith(prefix)) return;
            const dateKey = timestamp.split(' ')[0].replace(/\//g, '-');
            const amount = Number(row[4]) || 0;
            byDay[dateKey] = (byDay[dateKey] || 0) + amount;
            total += amount;
        });

        return { byDay: byDay, total: total };
    } catch (e) {
        logToBuffer('WARN', 'GetReceiptsForMonthError', staffName, e.message);
        return { byDay: {}, total: 0 };
    }
}

/**
 * 出勤簿テンプレート相当の月次データ(日次入力値+派生値+月合計+領収書集計)を返す。
 * @param {string} token ログイントークン
 * @param {string} yearMonth 'YYYY-MM'
 * @param {string} requestedStaffName 管理者が他スタッフを指定する場合のみ使用。一般スタッフは無視され本人固定。
 */
function getAttendanceMonth(token, yearMonth, requestedStaffName) {
    try {
        const context = getPastScheduleAccessContext_(token);
        const staffName = resolvePastScheduleTargetStaffName_(context, requestedStaffName);

        const parts = String(yearMonth || '').split('-');
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10);
        if (!year || !month || month < 1 || month > 12) {
            throw new Error('年月の指定が不正です(YYYY-MM形式で指定してください)。');
        }

        const fiscalYear = getFiscalYearForDate_(yearMonth + '-01');
        const numDays = new Date(year, month, 0).getDate();

        let monthRows;
        try {
            const spreadsheet = findPastScheduleSpreadsheet_(staffName, fiscalYear);
            const sheet = spreadsheet.getSheetByName(month + '月');
            monthRows = sheet ? readPastScheduleMonthRows_(sheet, year, month, numDays) : null;
        } catch (e) {
            // 出勤簿が見つからない場合も月次集計自体は空データで返す(閲覧専用画面のため)。
            logToBuffer('WARN', 'GetAttendanceMonthSheetMissing', context.selfStaffName, `対象=${staffName}, 年月=${yearMonth}: ${e.message}`);
            monthRows = null;
        }

        const days = [];
        for (let d = 1; d <= numDays; d++) {
            const dateString = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const rowData = monthRows ? monthRows[d - 1] : {};
            days.push({ date: dateString, rowData: rowData, derived: computeDayDerived(rowData) });
        }

        const monthlyTotals = computeMonthlyTotals(days);
        const receipts = getReceiptsForMonth_(staffName, yearMonth);

        // 管理者が他スタッフの月次集計(労働時間・残業・領収書等)を閲覧した場合は、
        // 操作者(自分自身)の名前を残す(CLAUDE.mdのログ方針: 他スタッフを跨ぐ操作は
        // 頻度に関わらず記録する)。
        if (staffName !== context.selfStaffName) {
            logToBuffer('INFO', 'GetAttendanceMonth', staffName, `年月=${yearMonth} (操作者=${context.selfStaffName})`);
        }

        return {
            success: true,
            staffName: staffName,
            isAdmin: context.isAdmin,
            yearMonth: yearMonth,
            days: days,
            monthlyTotals: monthlyTotals,
            receipts: receipts
        };
    } catch (e) {
        logToBuffer('ERROR', 'GetAttendanceMonthError', requestedStaffName || 'unknown', `年月=${yearMonth}: ${e.message}`);
        return { success: false, message: e.message };
    }
}
