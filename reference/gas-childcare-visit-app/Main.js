// ==========================================
// Web App Logic (エントリポイント・顧客データ・日報/事故報告の保存・領収書処理)
// 旧ファイル名: コード.js。認証(Auth.js)/Gemini連携(GeminiReport.js)/CSV取込
// (CsvImport.js)/ログ基盤(Logging.js)を分割した残り(2026-08-18)。
// SPREADSHEET_ID/RECEIPT_FOLDER_ID/IMAGE_LOG_SS_ID等の環境依存IDはConfig.jsで定義。
// ==========================================

const REPORT_SHEET_NAME = '日報';
const ACCIDENT_SHEET_NAME = '事故報告';

function doGet(e) {
    // katahimo-app(新Webアプリ)からのMaps連携ブリッジ用リクエスト(Bridge.js参照)。
    // 通常のHTML表示とは完全に分離しており、既存の画面表示には影響しない。
    if (e && e.parameter && e.parameter.api === '1') {
        return handleBridgeRequest_(e);
    }
    return HtmlService.createTemplateFromFile('index').evaluate()
        .setTitle('保育日報アプリ')
        .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(filename) {
    return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Helper to get the Spreadsheet object
 */
function getSpreadsheet() {
    return SpreadsheetApp.openById(SPREADSHEET_ID);
}

/**
 * Finds the sheet by GID
 */
function getSheetByGid(ss, gid) {
    const sheets = ss.getSheets();
    for (let i = 0; i < sheets.length; i++) {
        if (sheets[i].getSheetId() === gid) {
            return sheets[i];
        }
    }
    return null;
}

/**
 * Fetches Customer data with Caching.
 * Wraps the sheet access to improve performance.
 */
function getData(token) {
    const session = checkSession(token, false);
    if (!session || !session.valid) {
        logToBuffer('WARN', 'GetDataAccessDenied', 'invalid-session', '無効なセッションでの顧客データ取得を試みました');
        throw new Error('ログインセッションが無効です。再度ログインしてください。');
    }

    const cache = CacheService.getScriptCache();
    const CACHE_KEY = "CUSTOMER_DATA_V1_CACHE";

    // 1. Try Cache
    const cached = cache.get(CACHE_KEY);
    if (cached) {
        // console.log("Serving Customer Data from Cache");
        return JSON.parse(cached);
    }

    // 2. Fetch from Sheet
    const data = fetchDataFromSheet();

    // 3. Save to Cache (Best Effort)
    try {
        // Cache for 6 hours (21600 sec)
        // Note: extensive data might exceed 100KB limit of GAS Cache.
        // If so, it throws. We catch it and proceed without caching.
        cache.put(CACHE_KEY, JSON.stringify(data), 21600);
    } catch (e) {
        console.warn("Failed to cache customer data (likely size limit): " + e.message);
    }

    return data;
}

/**
 * [Internal] Reads Customer data directly from Spreadsheet.
 * Renamed from original getData.
 */
function fetchDataFromSheet() {
    const ss = getSpreadsheet();
    let cSheet = ss.getSheetByName(CUSTOMER_DB_NAME);
    let fSheet = ss.getSheetByName(FAMILY_DB_NAME);

    // Fallback if sheets don't exist yet (return empty)
    if (!cSheet || !fSheet) return { cities: [], customers: [] };

    const cData = cSheet.getDataRange().getValues();
    const fData = fSheet.getDataRange().getValues();

    if (cData.length === 0) return { cities: [], customers: [] };

    // Headers are row 0. Data starts row 1.
    const cHeaders = cData[0];
    const cRows = cData.slice(1);
    const fRows = fData.slice(1);

    // Identify Columns by Header Name
    const mapIndices = {};
    cHeaders.forEach((h, i) => mapIndices[h] = i);

    // Helper indices
    const idxId = mapIndices['顧客ID'] !== undefined ? mapIndices['顧客ID'] : 0;
    const idxSei = mapIndices['姓'];
    const idxMei = mapIndices['名'];
    const idxName = mapIndices['氏名'];
    const idxAddr = mapIndices['住所'];
    // For Map
    const idxLat = mapIndices['緯度'];
    const idxLng = mapIndices['経度'];

    // Helper to safe string
    const toStr = (val) => (val === null || val === undefined) ? "" : String(val);
    const fmtDate = (val) => {
        if (val instanceof Date) {
            return Utilities.formatDate(val, "Asia/Tokyo", "yyyy/MM/dd");
        }
        return toStr(val);
    };


    // Map Families by CustomerID
    const familyMap = {};
    fRows.forEach(row => {
        const cId = toStr(row[0]);
        if (!cId) return;
        if (!familyMap[cId]) familyMap[cId] = [];
        familyMap[cId].push({
            name: toStr(row[1]),
            dob: fmtDate(row[2]),
            job: toStr(row[3]),
            allergy: toStr(row[4]),
            info: toStr(row[5])
        });
    });

    const customers = cRows.map(row => {
        const id = toStr(row[idxId]);
        if (!id) return null; // Skip empty IDs

        let name = "";
        // Construct Name
        if (idxSei !== undefined && idxMei !== undefined) {
            const s = toStr(row[idxSei]);
            const m = toStr(row[idxMei]);
            name = s + " " + m;
        } else if (idxName !== undefined) {
            name = toStr(row[idxName]);
        } else {
            name = "Unknown";
        }
        name = name.trim();
        const displayName = name;

        const address = idxAddr !== undefined ? toStr(row[idxAddr]) : "";
        const displayAddress = address;

        const lat = idxLat !== undefined ? row[idxLat] : "";
        const lng = idxLng !== undefined ? row[idxLng] : "";

        // Build Full Data Object (excluding sensitive)
        // Use array to guarantee order
        const orderedDetails = [];
        cHeaders.forEach((h, i) => {
            // Exclude fields
            if (h === 'パスワード' || h === '顧客ID') return;

            let val = row[i];
            // Smart formatting based on type and header
            if (val instanceof Date) {
                if (h.includes('生年月日') || h.includes('誕生日')) {
                    val = Utilities.formatDate(val, "Asia/Tokyo", "yyyy/MM/dd");
                } else {
                    // Assume timestamp for other dates like '登録日時', '最終更新日時'
                    val = Utilities.formatDate(val, "Asia/Tokyo", "yyyy/MM/dd HH:mm");
                }
            } else {
                val = toStr(val);
            }

            orderedDetails.push({ key: h, value: val });
        });

        // Extract City (Use Display Address for display)
        let city = '';
        if (displayAddress) {
            let dPref = "";
            let dRest = displayAddress;
            const pMatch = displayAddress.match(/^(東京都|北海道|(?:京都|大阪)府|.{2,3}県)\s*/);

            if (pMatch) {
                dPref = pMatch[0];
                dRest = displayAddress.substring(dPref.length);
            }

            // 1. Try "City + Ward" on remainder
            const cwMatch = dRest.match(/^([^0-9\s]+市[^0-9\s]+区)/);
            if (cwMatch) {
                city = cwMatch[1];
            } else {
                // 2. Fallback to Municipality
                const mMatch = dRest.match(/^([^0-9\s]+[市区町村])/);
                if (mMatch) {
                    city = mMatch[1];
                }
            }
        }

        return {
            id: id,
            name: displayName,
            address: displayAddress,
            city: city,
            lat: lat,
            lng: lng,
            family: familyMap[id] || [],
            details: orderedDetails
        };
    }).filter(c => c !== null);

    // Unique cities for filter
    const cities = [...new Set(customers.map(c => c.city).filter(c => c))].sort();

    return { cities, customers, version: checkDataVersion() };
}

// --- Firestore Integration ---
function getFirestore() {
    /*
    const props = PropertiesService.getScriptProperties();
    const email = props.getProperty('FIREBASE_CLIENT_EMAIL');
    const key = props.getProperty('FIREBASE_PRIVATE_KEY');
    const projectId = props.getProperty('FIREBASE_PROJECT_ID');

    if (!email || !key || !projectId) {
        console.warn("Firestore Config Missing: Email=" + !!email + ", Key=" + !!key + ", ProjectId=" + !!projectId);
        return null;
    }

    return FirestoreApp.getFirestore(email, key.replace(/\\n/g, '\n'), projectId);
    */
    return null;
}

/**
 * Saves the final report to 'Reports' sheet.
 */
function saveReport(token, reportData) {
    const session = checkSession(token, false);
    if (!session || !session.valid) {
        logToBuffer('WARN', 'SaveReportAccessDenied', 'invalid-session', '無効なセッションでの日報保存を試みました');
        return { success: false, message: 'ログインセッションが無効です。再度ログインしてください。' };
    }
    // クライアントの申告するstaffNameは信用しない。非管理者は必ずセッションの本人名に強制する。
    if (!session.isAdmin || !reportData.staffName) {
        reportData.staffName = session.name;
    }

    const lock = LockService.getScriptLock();
    // Wait up to 30 seconds for other processes to finish
    if (lock.tryLock(30000)) {
        try {
            const ss = getSpreadsheet();
            let sheet = ss.getSheetByName(REPORT_SHEET_NAME);

            if (!sheet) {
                sheet = ss.insertSheet(REPORT_SHEET_NAME);
                sheet.appendRow(['Timestamp', 'StartTime', 'EndTime', 'User', 'CustomerId', 'CustomerName', 'InputText', 'InternalReport', 'CustomerReport', 'RiskRating', 'EsRating']);
            }

            let timestampJST;
            if (reportData.reportDate) {
                // Use the selected date and start time
                const timePart = reportData.start || "00:00";
                // Ensure date uses slashes for better compatibility if needed, though most environments handle standard formats
                const datePart = reportData.reportDate.replace(/-/g, '/');
                const d = new Date(`${datePart} ${timePart}`);
                if (!isNaN(d.getTime())) {
                    timestampJST = Utilities.formatDate(d, "Asia/Tokyo", "yyyy/MM/dd HH:mm:ss");
                } else {
                    timestampJST = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy/MM/dd HH:mm:ss");
                }
            } else {
                timestampJST = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy/MM/dd HH:mm:ss");
            }

            let savedRowIndex;
            const rowValues = [
                timestampJST,
                reportData.start || "",
                reportData.end || "",
                reportData.staffName || "", // Use selected staff name only
                reportData.customerId || "",
                reportData.customerName || "",
                reportData.inputText,
                reportData.internalText,
                reportData.customerText,
                reportData.riskRating || "",
                reportData.esRating || ""
            ];

            if (reportData.rowIndex && Number(reportData.rowIndex) > 0) {
                savedRowIndex = Number(reportData.rowIndex);
                // Simple validation: ensure within range
                const lastRow = sheet.getLastRow();
                if (savedRowIndex <= lastRow) {
                    sheet.getRange(savedRowIndex, 1, 1, rowValues.length).setValues([rowValues]);
                } else {
                    // Fallback to append if index invalid
                    sheet.appendRow(rowValues);
                    savedRowIndex = sheet.getLastRow();
                }
            } else {
                sheet.appendRow(rowValues);
                savedRowIndex = sheet.getLastRow();
            }

            // --- Google Chat Notification ---
            try {
                const star = (n) => "★".repeat(Number(n) || 0) + "☆".repeat(5 - (Number(n) || 0));
                let ratingsInfo = "";
                if (reportData.riskRating || reportData.esRating) {
                    ratingsInfo = "\n【評価指標】";
                    if (reportData.riskRating) ratingsInfo += `\nPSI: ${star(reportData.riskRating)} (${reportData.riskRating})`;
                    if (reportData.esRating) ratingsInfo += `\n満足度: ${star(reportData.esRating)} (${reportData.esRating})`;
                }

                const visitTime = (reportData.start && reportData.end) ? `${reportData.start}〜${reportData.end}` : (reportData.start || "");

                // Updated format: Staff, Customer, Time + Internal Report
                const lwText = `【日報提出】
担当: ${reportData.staffName}
顧客名: ${reportData.customerName}
訪問時間: ${visitTime}${ratingsInfo}

${reportData.internalText}`;
                sendReportNotification(lwText);
            } catch (e) {
                console.error("Google Chat Notification Failed: " + e.message);
            }
            // ------------------------------

            logToBuffer("INFO", "SaveReport", reportData.staffName, `Saved report for ${reportData.customerName} (Row: ${savedRowIndex})`);
            return { success: true, message: "保存しました", rowIndex: savedRowIndex };
        } catch (e) {
            logToBuffer("ERROR", "SaveReportError", reportData.staffName, e.message);
            return { success: false, message: "エラーが発生しました: " + e.message };
        } finally {
            lock.releaseLock();
        }
    } else {
        logToBuffer("WARN", "SaveReportFailed", reportData.staffName, "Server Busy (Lock Timeout)");
        return { success: false, message: "サーバーが混み合っているため保存できませんでした。しばらく待ってから再試行してください。" };
    }
}

/**
 * Saves receipt images to Drive and logs to Spreadsheet
 * Updated to handle Amount, CustomerID, CustomerName, StoreName and Timestamp from report
 */
function processReceiptImages(imagesData, staffId, customerId, customerName, reportTimestamp, handoffText) {
    if (!imagesData || imagesData.length === 0) {
        return { uploadedCount: 0, duplicates: [] };
    }

    const folder = DriveApp.getFolderById(RECEIPT_FOLDER_ID);
    const ss = SpreadsheetApp.openById(IMAGE_LOG_SS_ID);
    const sheet = ss.getSheets()[0];
    // Ensure header matches new requirements
    // New: ['日時', 'ユーザーID', '顧客ID', '顧客名', '金額', '名称', 'Googleドライブ写真ファイルへのリンク', '申し送り']
    if (sheet.getLastRow() === 0) {
        sheet.appendRow(['日時', 'ユーザーID', '顧客ID', '顧客名', '金額', '名称', 'Googleドライブ写真ファイルへのリンク', '申し送り']);
    }

    // Use the timestamp from the report instead of current time
    const timestamp = reportTimestamp || Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy/MM/dd HH:mm:ss");
    const now = new Date();
    const filePrefix = Utilities.formatDate(now, "Asia/Tokyo", "yyyyMMdd_HHmmss");

    const normalizeAmount = (val) => {
        if (val === null || val === undefined || val === "") return "";
        const n = Number(String(val).replace(/,/g, '').trim());
        if (isNaN(n)) return String(val).trim();
        return String(n);
    };

    const normalizeText = (val) => {
        return (val === null || val === undefined) ? "" : String(val).trim();
    };

    // staffId をキーに含めることで、異なるスタッフが同日・同金額・同店舗名の領収書を登録しても
    // 互いに重複と判定されないようにする。
    const buildKey = (ts, sId, cId, amount, storeName) => {
        return [normalizeText(ts), normalizeText(sId), normalizeText(cId), normalizeAmount(amount), normalizeText(storeName)].join('||');
    };

    const existingKeys = new Set();
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
        // 列: [0]=日時, [1]=ユーザーID(staffId), [2]=顧客ID, [4]=金額, [5]=名称
        const rows = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
        rows.forEach(row => {
            const key = buildKey(row[0], row[1], row[2], row[4], row[5]);
            existingKeys.add(key);
        });
    }

    let successCount = 0;
    const duplicates = [];

    // Support legacy array of strings or new array of objects
    imagesData.forEach((item, index) => {
        let base64Data = "";
        let amount = "";
        let storeName = "";
        let receiptDate = ""; // OCRで取得した領収書日時

        if (typeof item === 'string') {
            base64Data = item;
        } else {
            base64Data = item.data;
            amount = item.amount;
            storeName = item.storeName || '';
            receiptDate = item.receiptDate || '';
        }

        // 領収書日時（OCR取得）を優先。未取得の場合はレポート送信時刻にフォールバック。
        const itemTimestamp = normalizeText(receiptDate) || timestamp;
        const normalizedAmount = normalizeAmount(amount || '');
        const normalizedStore = normalizeText(storeName || '');
        const canCheckDuplicate = normalizedAmount !== '' && normalizedStore !== '';
        const duplicateKey = buildKey(itemTimestamp, staffId || '', customerId || '', normalizedAmount, normalizedStore);
        // 同一バッチ内で往復運賃など「同金額・同店舗名」の2枚を登録する場合に備え、
        // バッチ内ループの既存キー追加にはインデックスを付与して区別する。
        // シート上の既存データとの照合は staffId+顧客ID+日時+金額+店舗名 の組み合わせで行う。
        if (canCheckDuplicate && existingKeys.has(duplicateKey)) {
            duplicates.push({
                index: index,
                timestamp: itemTimestamp,
                staffId: staffId || '',
                customerId: customerId || '',
                amount: normalizedAmount,
                storeName: normalizedStore
            });
            return;
        }

        const split = base64Data.split(',');
        if (split.length < 2) return; // Skip invalid

        const contentType = split[0].split(':')[1].split(';')[0];
        const bytes = Utilities.base64Decode(split[1]);

        const fileName = `${filePrefix}_${index + 1}_${staffId || 'unknown'}.jpg`;
        const blob = Utilities.newBlob(bytes, contentType, fileName);
        const file = folder.createFile(blob);
        const fileUrl = file.getUrl();

        let rowHandoff = '';
        if (successCount === 0) {
            rowHandoff = handoffText || '';
        }

        // Append to Spreadsheet with new columns
        // 領収書日時（OCR取得）を日時列に記録。フォールバック時はレポート送信時刻。
        sheet.appendRow([itemTimestamp, staffId || '', customerId || '', customerName || '', amount || '', storeName || '', fileUrl, rowHandoff]);
        if (canCheckDuplicate) {
            // 同一バッチ内の次の画像と照合するため追加するが、
            // 往復運賃など正当な重複は区別できるようインデックスをサフィックスで付与する。
            // これにより、既にシート上に存在するものと同一キーのものだけをブロックし、
            // 同バッチ内の同金額・同店舗の別枚数（往復など）は全件登録できる。
            existingKeys.add(duplicateKey + '||batch_' + index);
        }
        successCount++;
    });

    return { uploadedCount: successCount, duplicates: duplicates };
}

/**
 * Uploads receipt images without saving a daily report.
 * Duplicate keys are blocked by: timestamp + customerId + amount + storeName.
 */
function uploadReceiptsOnly(uploadData) {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) {
        return { success: false, message: "サーバーが混み合っています。しばらくしてから再試行してください。" };
    }

    try {
        if (!uploadData || !uploadData.images || uploadData.images.length === 0) {
            return { success: false, message: "領収書画像がありません。" };
        }

        const receiptTimestamp = uploadData.receiptTimestamp || Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy/MM/dd HH:mm:ss");
        const result = processReceiptImages(
            uploadData.images,
            uploadData.staffName || '',
            uploadData.customerId || '',
            uploadData.customerName || '',
            receiptTimestamp,
            uploadData.handoffText || ''
        );

        const duplicateCount = result.duplicates.length;
        const uploadedCount = result.uploadedCount;

        let message = `領収書を${uploadedCount}件アップロードしました`;
        if (duplicateCount > 0) {
            message += `（重複${duplicateCount}件は登録しませんでした）`;
        }

        logToBuffer("INFO", "UploadReceiptsOnly", uploadData.staffName || "unknown", `Customer=${uploadData.customerName || ''}, Uploaded=${uploadedCount}, Duplicates=${duplicateCount}`);

        if (uploadedCount > 0) {
            const customerStr = uploadData.customerName ? `顧客名: ${uploadData.customerName}\n` : ``;
            const dateStr = receiptTimestamp ? receiptTimestamp.split(' ')[0] : '';

            let receiptDetails = '';
            const duplicateIndices = new Set(result.duplicates.map(d => d.index));
            if (uploadData.images) {
                uploadData.images.forEach((img, idx) => {
                    if (!duplicateIndices.has(idx)) {
                        const amountStr = img.amount ? `${img.amount}円` : '未入力';
                        const storeStr = img.storeName ? img.storeName : '未入力';
                        receiptDetails += `\n名称: ${storeStr} / 金額: ${amountStr}`;
                    }
                });
            }

            const handoffStr = (uploadData.handoffText && uploadData.handoffText.trim()) ? `\n\n申し送り:\n${uploadData.handoffText.trim()}` : '';

            const lwMsg = `【領収書登録】\n担当: ${uploadData.staffName || '不明'}\n${customerStr}日付: ${dateStr}${receiptDetails}${handoffStr}`;
            sendReceiptNotification(lwMsg);
        }

        return {
            success: true,
            message: message,
            uploadedCount: uploadedCount,
            duplicateCount: duplicateCount,
            duplicates: result.duplicates
        };
    } catch (e) {
        logToBuffer("ERROR", "UploadReceiptsOnlyError", (uploadData && uploadData.staffName) || "unknown", e.message);
        return { success: false, message: "領収書アップロードでエラーが発生しました: " + e.message };
    } finally {
        lock.releaseLock();
    }
}

function sendVisitCompleteNotification(message) {
    try {
        sendReportNotification(message);
        return { success: true };
    } catch (e) {
        return { success: false, message: e.message };
    }
}

/**
 * Saves the accident report to 'AccidentReports' sheet.
 */
function saveAccidentReport(token, reportData) {
    const session = checkSession(token, false);
    if (!session || !session.valid) {
        logToBuffer('WARN', 'SaveAccidentReportAccessDenied', 'invalid-session', '無効なセッションでの事故報告保存を試みました');
        return { success: false, message: 'ログインセッションが無効です。再度ログインしてください。' };
    }
    // クライアントの申告するstaffNameは信用しない。非管理者は必ずセッションの本人名に強制する。
    if (!session.isAdmin || !reportData.staffName) {
        reportData.staffName = session.name;
    }

    const lock = LockService.getScriptLock();
    // Wait up to 30 seconds for other processes to finish
    if (lock.tryLock(30000)) {
        try {
            const ss = getSpreadsheet();
            let sheet = ss.getSheetByName(ACCIDENT_SHEET_NAME);

            if (!sheet) {
                sheet = ss.insertSheet(ACCIDENT_SHEET_NAME);
                sheet.appendRow([
                    'Timestamp', 'Reporter', 'CustomerId', 'CustomerName',
                    'OccurrenceTime', 'Location', 'AccidentContent',
                    'Situation', 'ImmediateResponse', 'ParentCorrespondence',
                    'DiagnosisTreatment', 'Prevention', 'OriginalInput', 'ReportType'
                ]);
            }

            const timestampJST = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy/MM/dd HH:mm:ss");

            let savedRowIndex;
            const rowValues = [
                timestampJST,
                reportData.staffName || "",
                reportData.customerId || "",
                reportData.customerName || "",
                reportData.targetName || "",
                reportData.targetDob || "",
                reportData.occurrenceTime,
                reportData.location,
                reportData.accidentContent,
                reportData.situation,
                reportData.immediateResponse,
                reportData.parentCorrespondence,
                reportData.diagnosisTreatment,
                reportData.prevention,
                reportData.inputText,
                reportData.reportType || "事故報告"
            ];

            if (reportData.rowIndex && Number(reportData.rowIndex) > 0) {
                savedRowIndex = Number(reportData.rowIndex);
                const lastRow = sheet.getLastRow();
                if (savedRowIndex <= lastRow) {
                    sheet.getRange(savedRowIndex, 1, 1, rowValues.length).setValues([rowValues]);
                } else {
                    sheet.appendRow(rowValues);
                    savedRowIndex = sheet.getLastRow();
                }
            } else {
                sheet.appendRow(rowValues);
                savedRowIndex = sheet.getLastRow();
            }

            // --- Google Chat Notification ---
            try {
                const typeLabel = reportData.reportType || "事故報告";
                const lwText = `【${typeLabel}】
担当: ${reportData.staffName}
顧客名: ${reportData.customerName}
対象: ${reportData.targetName}
生年月日: ${reportData.targetDob}
発生日時: ${reportData.occurrenceTime}
発生場所: ${reportData.location}
事故内容: ${reportData.accidentContent}
発生状況: ${reportData.situation}
発生時の対応: ${reportData.immediateResponse}
保護者への対応: ${reportData.parentCorrespondence}
診断名および処置状況: ${reportData.diagnosisTreatment}
今後の対応: ${reportData.prevention}`;
                sendReportNotification(lwText);
            } catch (e) {
                console.error("Google Chat Accident Notification Failed: " + e.message);
            }
            // ------------------------------

            logToBuffer("INFO", "SaveAccidentReport", reportData.staffName, `Accident report saved for ${reportData.targetName} (Row: ${savedRowIndex})`);
            return { success: true, rowIndex: savedRowIndex };
        } catch (e) {
            logToBuffer("ERROR", "SaveAccidentReportError", reportData.staffName, e.message);
            return "Error: " + e.message;
        } finally {
            lock.releaseLock();
        }
    } else {
        return "Server Busy";
    }
}

function testDriveAuth() {
    // Run this function in the GAS Editor to authorize DriveApp permissions (Write Access)
    const folder = DriveApp.getFolderById(RECEIPT_FOLDER_ID);
    console.log("Folder Found: " + folder.getName());

    // Create a dummy file to force Writer Authorization
    const file = folder.createFile("AuthTest.txt", "Write Permission Test");
    console.log("Write Successful: " + file.getName());

    // Clean up
    file.setTrashed(true);
    console.log("Cleanup Successful");
}

// --- Assessment Definitions ---
const ASSESSMENT_DEFINITIONS = {
    risk: {
        title: "PSI",
        levels: [
            { score: 5, label: "安心・良好", desc: "全く懸念がない状態。\n保護者の表情も明るく、お子様も衛生・情緒ともに安定している。\n部屋も安全に保たれている。" },
            { score: 4, label: "通常", desc: "一般的な家庭の状態。\n多少の疲れや散らかりはあるが、保育に支障はなく、親子の関わりも標準的。" },
            { score: 3, label: "要観察", desc: "「少し気になる」レベル。\n保護者がひどく疲れている、部屋が不衛生になりつつある、子供の情緒が少し不安定など。\n※次回の担当者に引き継ぎたい内容がある。" },
            { score: 2, label: "注意", desc: "明らかに異変を感じる状態。\n保護者の反応が鈍い（無視・無表情）、子供の体や服が著しく汚れている、怒鳴り声が多いなど。\n※管理者への報告を強く推奨。" },
            { score: 1, label: "危険・緊急", desc: "緊急の介入が必要な状態。\n明らかな虐待の痕跡（あざ・傷）、育児放棄（ネグレクト）、保護者の心身耗弱が激しく子供の安全が守れない。\n※直ちに管理者に電話連絡が必要。" }
        ]
    },
    es: {
        title: "従業員満足度(ES)",
        levels: [
            { score: 5, label: "最高", desc: "ぜひまた担当したい（優先希望）。\n顧客の態度が非常に良く、感謝されており、環境も快適。\n精神的にも報酬以上のやりがいを感じる。" },
            { score: 4, label: "良", desc: "問題なく担当できる。\n常識的な対応をしていただき、業務遂行にストレスがない。\n標準的な「良いお客様」。" },
            { score: 3, label: "可", desc: "担当しても良い（許容範囲）。\n多少のやりにくさ（細かい指示や部屋の環境など）はあるが、仕事として割り切れる範囲。" },
            { score: 2, label: "難あり", desc: "できれば担当したくない（回避希望）。\n高圧的な態度、契約外の要求が多い、部屋が極端に不衛生などで、精神的・体力的に消耗が激しい。" },
            { score: 1, label: "NG", desc: "二度と担当できない（ブラック）。\nハラスメント（暴言・セクハラ）、身の危険を感じる、著しい契約違反など。\n※担当を外れることを希望するレベル。" }
        ]
    }
};

/**
 * Retrieves UI configuration (placeholders, hints) from the prompt sheet.
 */
function getUiConfig() {
    return {
        dailyPlaceholder: getPrompt(PROMPT_KEYS.PLACEHOLDER_DAILY),
        accidentPlaceholder: getPrompt(PROMPT_KEYS.PLACEHOLDER_ACCIDENT),
        accidentHint: getPrompt(PROMPT_KEYS.HINT_ACCIDENT),
        hiyariPlaceholder: getPrompt(PROMPT_KEYS.PLACEHOLDER_HIYARI),
        assessments: ASSESSMENT_DEFINITIONS
    };
}

/**
 * Retrieves past reports for a specific customer.
 * Returns both Daily and Accident reports, sorted by date (newest first).
 */
function getCustomerReports(token, customerId, startAfterTime) {
    const session = checkSession(token, false);
    if (!session || !session.valid) {
        logToBuffer('WARN', 'GetCustomerReportsAccessDenied', 'invalid-session', `無効なセッションでの日報閲覧を試みました(顧客ID=${customerId})`);
        throw new Error('ログインセッションが無効です。再度ログインしてください。');
    }

    const limit = 5;

    // --- Firestore Read (Skipped) ---

    // --- Sheet Fallback ---

    // NOTE: This approach reads all data then filters.
    // For much larger datasets, we would need to read only the bottom N rows.
    // However, given user request for "Load More" and speed, sending small chunks is the main win here.

    const ss = getSpreadsheet();
    const results = [];
    const fmt = (d) => {
        if (!d) return "";
        if (d instanceof Date) return Utilities.formatDate(d, "Asia/Tokyo", "yyyy/MM/dd HH:mm");
        return String(d);
    };

    // Helper to scan sheet backwards
    const scanSheet = (sheetName, mapFn) => {
        const sheet = ss.getSheetByName(sheetName);
        if (!sheet) return;
        const lastRow = sheet.getLastRow();
        if (lastRow < 2) return;

        // Optimization Idea: If we knew exactly where the time limit was, we could range read.
        // For now, read all is safest for correctness with mixed report types.
        const values = sheet.getDataRange().getValues();

        // Loop backwards
        for (let i = values.length - 1; i >= 1; i--) {
            const row = values[i];
            const res = mapFn(row);
            if (res) results.push(res);
        }
    };

    // Daily Reports
    scanSheet(REPORT_SHEET_NAME, (row) => {
        if (String(row[4]) !== String(customerId)) return null;
        return {
            type: 'daily',
            timestamp: fmt(row[0]),
            staff: row[3],
            original: row[6],
            internal: row[7],
            customer: row[8],
            risk: row[9],
            es: row[10]
        };
    });

    // Accident Reports
    scanSheet(ACCIDENT_SHEET_NAME || '事故報告', (row) => {
        if (String(row[2]) !== String(customerId)) return null;

        const parts = [];
        if (row[6]) parts.push(`【発生時間】${row[6]}`);
        if (row[7]) parts.push(`【場所】${row[7]}`);
        if (row[9]) parts.push(`【状況】\n${row[9]}`);
        if (row[8]) parts.push(`【事故内容】\n${row[8]}`);
        if (row[10]) parts.push(`【応急処置】\n${row[10]}`);
        if (row[12]) parts.push(`【受診・治療】\n${row[12]}`);
        if (row[13]) parts.push(`【再発防止策】\n${row[13]}`);

        const internalText = parts.join('\n\n');

        return {
            type: 'accident',
            timestamp: fmt(row[0]),
            staff: row[1],
            original: row[14],
            internal: internalText,
            customer: row[11],
            isAccident: true,
            subtype: row[15] || '事故報告'
        };
    });

    // Sort by date descending
    results.sort((a, b) => {
        const da = new Date(a.timestamp);
        const db = new Date(b.timestamp);
        return db - da; // Descending
    });

    // Pagination Logic
    let startIndex = 0;
    if (startAfterTime) {
        // Find the index of the item that matches startAfterTime
        // And start from the next one.
        // Since timestamps might be non-unique, strictly finding the object is hard without distinct ID.
        // We will assume checking timestamp < startAfterTime is enough for "next page".

        const startTime = new Date(startAfterTime).getTime();

        // Find first item that is strictly older than startAfterTime
        // (Since sorted descending, we look for timestamp < startTime)
        // However, if we have duplicate timestamps, this skips all of them.
        // A simple array scan findIndex is better if we assume results are consistent.
        // But since sheet might have been modified, filtering by time is more robust.

        const filtered = results.filter(r => new Date(r.timestamp).getTime() < startTime);
        return filtered.slice(0, limit);
    }

    return results.slice(0, limit);
}

/**
 * One-time migration function to copy data from Sheet to Firestore.
 * Run this manually from GAS Editor.
 */
/*
function migrateDataToFirestore() {
    const firestore = getFirestore();
    if (!firestore) {
        console.error("Firestore not configured. Please checks Script Properties.");
        return "Firestore Not Configured";
    }

    const ss = getSpreadsheet();
    let migratedCount = 0;

    // 1. Daily Reports
    const dailySheet = ss.getSheetByName(REPORT_SHEET_NAME);
    if (dailySheet && dailySheet.getLastRow() > 1) {
        const rows = dailySheet.getDataRange().getValues().slice(1);
        rows.forEach(row => {
            try {
                if (!row[4]) return; // Skip if no Customer ID

                const timeStr = (row[0] instanceof Date) ? Utilities.formatDate(row[0], "Asia/Tokyo", "yyyy/MM/dd HH:mm:ss") : String(row[0]);
                // Create deterministic ID to prevent duplicates on re-run
                // ID: D_CustomerID_Timestamp(NumbersOnly)
                const docId = `D_${String(row[4])}_${timeStr.replace(/[^0-9]/g, '')}`;

                const docData = {
                    timestamp: timeStr,
                    start: String(row[1]),
                    end: String(row[2]),
                    staffName: String(row[3]),
                    customerId: String(row[4]),
                    customerName: String(row[5]),
                    inputText: String(row[6]),
                    internalText: String(row[7]),
                    customerText: String(row[8]),
                    riskRating: Number(row[9]) || 0,
                    esRating: Number(row[10]) || 0,
                    type: 'daily',
                    migratedAt: new Date()
                };

                // Use ID in path to ensure Upsert behavior (overwrite if exists with this ID)
                firestore.createDocument("reports/" + docId, docData);
                migratedCount++;
            } catch (e) {
                console.warn("Skipped Daily Row: " + e.message);
            }
        });
    }

    // 2. Accident Reports
    const accSheet = ss.getSheetByName(ACCIDENT_SHEET_NAME || '事故報告');
    if (accSheet && accSheet.getLastRow() > 1) {
        const rows = accSheet.getDataRange().getValues().slice(1);
        rows.forEach(row => {
            try {
                if (!row[2]) return; // CustomerID

                const timeStr = (row[0] instanceof Date) ? Utilities.formatDate(row[0], "Asia/Tokyo", "yyyy/MM/dd HH:mm:ss") : String(row[0]);
                // ID: A_CustomerID_Timestamp(NumbersOnly)
                const docId = `A_${String(row[2])}_${timeStr.replace(/[^0-9]/g, '')}`;

                const docData = {
                    timestamp: timeStr,
                    staffName: String(row[1]),
                    customerId: String(row[2]),
                    customerName: String(row[3]),
                    targetName: String(row[4]),
                    targetDob: (row[5] instanceof Date) ? Utilities.formatDate(row[5], "Asia/Tokyo", "yyyy/MM/dd") : String(row[5]),
                    occurrenceTime: String(row[6]),
                    location: String(row[7]),
                    accidentContent: String(row[8]),
                    situation: String(row[9]),
                    immediateResponse: String(row[10]),
                    parentCorrespondence: String(row[11]),
                    diagnosisTreatment: String(row[12]),
                    prevention: String(row[13]),
                    inputText: String(row[14] || ""),
                    reportType: String(row[15] || "事故報告"),
                    type: 'accident',
                    migratedAt: new Date()
                };

                firestore.createDocument("reports/" + docId, docData);
                migratedCount++;
            } catch (e) {
                console.warn("Skipped Accident Row: " + e.message);
            }
        });
    }

    console.log(`Migration Completed. Total documents processed: ${migratedCount}`);
    return `Migration Completed. ${migratedCount} records processed.`;
}
*/
