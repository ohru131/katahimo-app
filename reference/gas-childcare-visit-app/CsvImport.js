// ==========================================
// 顧客CSVの自動取込・顧客/家族DBへの反映
// 旧コード.js(Main.js に改名)から分割(2026-08-18)。
// ==========================================

const CUSTOMER_DB_NAME = '顧客DB_New';
const FAMILY_DB_NAME = '家族DB_New';

// 取込元DriveフォルダID(CUSTOMER_CSV_FOLDER_ID)はConfig.jsで定義。

/**
 * Checks for the latest CSV in the dedicated folder and imports it if newer.
 * Can be run manually or by a time-based trigger.
 */
function checkAndImportLatestCsv() {
    try {
        const folder = DriveApp.getFolderById(CUSTOMER_CSV_FOLDER_ID);
        // getFilesByName exact match might not work with prefix. Use getFiles() and filter.
        let latestFile = null;
        let latestTime = 0;

        const iterator = folder.getFiles();
        while (iterator.hasNext()) {
            const file = iterator.next();
            const name = file.getName();

            // Match pattern: Kokyaku_YYYYMMDDHHmm_1.csv
            // We just need to parse the timestamp part purely string based or regex
            const match = name.match(/^Kokyaku_(\d{12})_\d+\.csv$/);
            if (match) {
                const timeStr = match[1];
                // Simple numerical comparison is enough for YYYYMMDDHHmm format
                const timeVal = parseInt(timeStr, 10);

                if (timeVal > latestTime) {
                    latestTime = timeVal;
                    latestFile = file;
                }
            }
        }

        if (!latestFile) {
            console.log("No matching CSV files found.");
            return "No files found";
        }

        // Check if we already imported this version
        const props = PropertiesService.getScriptProperties();
        const currentVersion = parseInt(props.getProperty('LATEST_CSV_VERSION') || '0', 10);

        console.log(`CSV Check - Latest: ${latestTime}, Current: ${currentVersion}`);

        if (latestTime <= currentVersion) {
            console.log("Already up to date.");
            return "Already up to date";
        }

        console.log("Newer CSV found, importing: " + latestFile.getName());

        // Read content
        // Try UTF-16LE first as it appeared in error logs, then Shift_JIS, then UTF-8
        const blob = latestFile.getBlob();
        let csvContent = "";
        let detected = false;
        const encodings = ['UTF-16LE', 'Shift_JIS', 'UTF-8'];

        for (const enc of encodings) {
            try {
                const text = blob.getDataAsString(enc);
                // Check for key header to validate encoding
                if (text.includes('顧客ID') || text.includes('Customer')) {
                    csvContent = text;
                    detected = true;
                    console.log("Detected Encoding: " + enc);
                    break;
                }
            } catch (e) { }
        }

        if (!detected) {
            console.log("Encoding detection failed, using default UTF-8");
            csvContent = blob.getDataAsString('UTF-8');
        }

        // Use shared helper - pass raw string!
        const result = updateDatabaseFromLinesV2(csvContent, getInternalCsvImportToken_());

        if (result === "Upload Successful") {
            props.setProperty('LATEST_CSV_VERSION', latestTime.toString());
            console.log("Import Success");
            logToBuffer("INFO", "AutoImport", "System", `Imported ${latestFile.getName()} (Version: ${latestTime})`);
            return "Imported: " + latestFile.getName();
        } else {
            console.error("Import Failed: " + result);
            logToBuffer("ERROR", "AutoImportFailed", "System", `${latestFile.getName()}: ${result}`);
            return "Failed: " + result;
        }

    } catch (e) {
        console.error("Auto Import Error: " + e.message);
        logToBuffer("ERROR", "AutoImportError", "System", e.message);
        return "Error: " + e.message;
    }
}
/**
 * Manually forces the import of the latest CSV, ignoring version checks.
 * トップレベル関数はgoogle.script.run経由で誰でも呼び出せてしまうため、管理者セッションの
 * トークンを必須にする(GASエディタから直接実行したい場合は、管理者としてログインした
 * ブラウザのlocalStorageからGAS_AUTH_TOKENの値を取得し、引数に渡して実行する)。
 */
function forceImportCsv(token) {
    const session = checkSession(token, false);
    if (!session || !session.valid || !session.isAdmin) {
        logAdminAccessDenied_('ForceImportCsv', session);
        return "Error: 権限がありません。";
    }
    try {
        // Reset Version
        PropertiesService.getScriptProperties().deleteProperty('LATEST_CSV_VERSION');
        console.log("Version reset. Starting import...");

        // Run standard check (which will now see '0' as current version)
        // checkAndImportLatestCsv自体もAutoImport/AutoImportFailedとしてSystem名義で記録するが、
        // それだけだと「誰が手動で実行させたか」が残らないため、ここで管理者名義のログも別途残す。
        const result = checkAndImportLatestCsv();
        console.log("Force Import Result: " + result);
        logToBuffer('INFO', 'ForceImportCsv', session.name, result);
        return result;
    } catch (e) {
        console.error("Force Import Error: " + e.message);
        logToBuffer('ERROR', 'ForceImportCsvError', session.name, e.message);
        return "Error: " + e.message;
    }
}

function checkDataVersion() {
    return PropertiesService.getScriptProperties().getProperty('DATA_VERSION') || '0';
}

// checkAndImportLatestCsv()の内部呼び出し専用であることを示すトークン(Script Propertiesに
// 保存され、クライアントには一切渡らない)。updateDatabaseFromLinesV2はDBを丸ごと削除・上書き
// するため、この値を知らない呼び出し元(=google.script.run経由の外部呼び出し)を弾く。
function getInternalCsvImportToken_() {
    const props = PropertiesService.getScriptProperties();
    let token = props.getProperty('INTERNAL_CSV_IMPORT_TOKEN');
    if (!token) {
        token = Utilities.getUuid();
        props.setProperty('INTERNAL_CSV_IMPORT_TOKEN', token);
    }
    return token;
}

/**
 * V2: Shared helper to update database from Parsed CSV Lines (Array of Arrays)
 * Supports full CSV column import.
 */
function updateDatabaseFromLinesV2(rawString, internalToken) {
    if (internalToken !== getInternalCsvImportToken_()) {
        logToBuffer('SECURITY', 'UpdateDatabaseAccessDenied', 'unknown', 'この関数はcheckAndImportLatestCsv経由以外から呼び出せません(内部トークン不一致)');
        throw new Error('この操作は許可されていません。');
    }

    const lock = LockService.getScriptLock();
    // Wait up to 30 seconds for other processes to finish
    if (lock.tryLock(30000)) {
        try {
            if (!rawString) return "Empty Data";

            // Detect Delimiter: Try Tab then Comma
            const firstLine = rawString.substring(0, rawString.indexOf('\n'));
            let delimiter = ',';
            // If tab count > visible comma count, assume tab
            if ((firstLine.match(/\t/g) || []).length > (firstLine.match(/,/g) || []).length) {
                delimiter = '\t';
            }

            const csvData = Utilities.parseCsv(rawString, delimiter);
            if (!csvData || csvData.length < 2) return "Invalid CSV Data";

            const ss = getSpreadsheet();
            let cSheet = ss.getSheetByName(CUSTOMER_DB_NAME);
            let fSheet = ss.getSheetByName(FAMILY_DB_NAME);

            // Ensure sheets exist
            if (!cSheet) cSheet = ss.insertSheet(CUSTOMER_DB_NAME);
            if (!fSheet) fSheet = ss.insertSheet(FAMILY_DB_NAME);

            // Full Replace for Customer DB based on Requirement "CSV has all data"
            // We will clear the sheet and rewrite it to match the CSV structure exactly.
            cSheet.clearContents();

            const headerRow = csvData[0];
            const dataRows = csvData.slice(1);

            // Write Headers
            if (headerRow) cSheet.appendRow(headerRow);

            // Write All Data
            if (dataRows.length > 0) {
                cSheet.getRange(2, 1, dataRows.length, headerRow.length).setValues(dataRows);
            }

            // Family DB Handling (Extract from CSV)
            // We still need to parse Family info to populate FAMILY_DB_NAME
            // Family DB Handling (Extract from CSV)
            // We still need to parse Family info to populate FAMILY_DB_NAME
            const idxFamily = headerRow.findIndex(h => h.includes('世帯') || h.includes('家族') || h.includes('Family'));
            const idxId = headerRow.findIndex(h => h.includes('顧客ID'));

            const fHeader = ['顧客ID', '家族氏名', '生年月日', '職業', 'アレルギー情報', '備考'];
            // Reset Family DB as well
            fSheet.clearContents();
            fSheet.appendRow(fHeader);

            const fRows = [];

            if (idxId !== -1 && idxFamily !== -1) {
                for (const row of dataRows) {
                    const id = String(row[idxId]);
                    if (!id) continue;

                    const familyRaw = (idxFamily < row.length) ? row[idxFamily] : "";
                    if (familyRaw) {
                        const parsedFamilies = parseFamilyInfo(familyRaw);
                        parsedFamilies.forEach(f => {
                            // f: { name, dob, info }
                            // Try to extract Allergy from info
                            // let allergy = "";
                            let otherInfo = f.info;

                            // Simple heuristic to extract allergy
                            // If info contains "アレルギー", try to extract closest segment
                            // But for now, just putting everything in info is safer, or column alignment
                            // The user prompt had specific "アレルギー:..." or "アレルギーなし"

                            // We will put everything else in "備考" for now, as splitting Job/Allergy is ambiguous without named fields
                            fRows.push([id, f.name, f.dob, "", "", otherInfo]);
                        });
                    }
                }
            }

            if (fRows.length > 0) {
                fSheet.getRange(2, 1, fRows.length, fHeader.length).setValues(fRows);
            }

            // Update Data Version
            PropertiesService.getScriptProperties().setProperty('DATA_VERSION', String(Date.now()));

            return "Upload Successful";
        } catch (e) {
            return "Error: " + e.message;
        } finally {
            lock.releaseLock();
        }
    } else {
        return "Server Busy";
    }
}

/**
 * Parses raw family text block into structured objects.
 * Handles various formats: YYYY.MM.DD, YYYYMMDD, Japanese Era, etc.
 * Supports multi-line blocks.
 */
function parseFamilyInfo(rawText) {
    const results = [];
    if (!rawText) return results;

    // Normalize newlines
    const lines = rawText.split(/[\r\n]+/);

    // Regex for Dates - COMPREHENSIVE v2
    // Supports:
    // 1. YYYY.MM.DD, YYYY/MM/DD, YYYY-MM-DD
    // 2. YYYY年M月D日
    // 3. 和暦 (明治|大正|昭和|平成|令和)N年M月D日 (with or without spaces)
    // 4. Abbreviated era: H1.10.16, h5.12.29, r3.5.14 (case insensitive, with optional 生)
    // 5. Abbreviated era with slash: H4/8/5
    // 6. Kanji era with dots: 令和5.9.25
    // 7. Compact 8 digit: 19860921
    const reDate = /((?:19|20)\d{2}[\.\\/\-]\d{1,2}[\.\\/\-]\d{1,2}|(?:明治|大正|昭和|平成|令和)\s*[0-9元]+\s*[\.\-年]\s*[0-9]+\s*[\.\-月]\s*[0-9]+\s*日?|(?:19|20)\d{2}年\d{1,2}月\d{1,2}日?|[MTSHRmtshr]\d{1,2}[\.\\/]\d{1,2}[\.\\/]\d{1,2}(?:生)?|(?:19|20)\d{6})/gi;

    let current = null;

    const flush = () => {
        if (current && (current.name || current.dob)) {
            // Clean up name: remove role indicators in parentheses
            if (current.name) {
                current.name = current.name.replace(/^\([^)]+\)\s*/, '').trim();
            }
            // Join info array
            current.info = current.infoList.join(" ");
            delete current.infoList;
            delete current.justStarted;
            results.push(current);
        }
        current = { name: "", dob: "", infoList: [], justStarted: false };
    };

    // Initialize first person
    current = { name: "", dob: "", infoList: [], justStarted: false };

    lines.forEach(line => {
        let clean = line.trim();
        if (!clean) return;

        // Remove leading bullet (・)
        if (clean.startsWith('・')) {
            clean = clean.substring(1).trim();
        }

        // Handle parentheses format: "Name（Date、Info、...）"
        // Extract content from parentheses and process separately
        let inParens = false;
        if (clean.includes('（') && clean.includes('）')) {
            const parenMatch = clean.match(/^([^（]+)（([^）]+)）$/);
            if (parenMatch) {
                const name = parenMatch[1].trim();
                const content = parenMatch[2].trim();
                // Process as "Name Content" format
                clean = name + ' ' + content.replace(/、/g, ' ');
                inParens = true;
            }
        }

        // Replace commas (、) with spaces for easier parsing
        if (!inParens) {
            clean = clean.replace(/、/g, ' ');
        }

        // Check for Date
        reDate.lastIndex = 0;
        const match = reDate.exec(clean);

        if (match) {
            const dateStr = match[0];
            const idx = match.index;
            let pre = clean.substring(0, idx).trim();
            let post = clean.substring(idx + dateStr.length).trim();

            // Remove role indicators from name (e.g., "(夫)" or "夫")
            pre = pre.replace(/^\([^)]+\)\s*/, '').trim();

            // Handle middle dot (・) separator: name is BEFORE the first middle dot
            if (pre.includes('・')) {
                const parts = pre.split('・');
                pre = parts[0].trim(); // Take the FIRST part as name
            }

            // Handle middle dot in post as well - replace with space
            if (post.startsWith('・')) {
                post = post.substring(1).trim();
            }
            if (post.includes('・')) {
                post = post.replace(/・/g, ' ');
            }

            // Detect if this is a "Property Line" (e.g. "生年月日: 1990...")
            // or an "Inline Name Line" (e.g. "Name 1990...")
            const isProperty = /生年月日|誕生日|DOB|Date/.test(pre) || pre.endsWith(":") || pre.endsWith("：");

            if (isProperty) {
                // Determine format:
                // If current person already has DOB, this must be a new person (or error, but assume new)
                // UNLESS valid Name was just set previously (e.g. L1: Name, L2: DOB)
                if (current.dob && !current.justStarted) {
                    flush();
                }
                current.dob = normalizeDateStr(dateStr);
                // 'pre' is likely label, ignore. 'post' might be info.
                if (post) current.infoList.push(post);
                current.justStarted = false; // logic handled
            } else {
                // Likely "Name Date Info" format
                // If we already have a partial person with Name only, and this line has NO name (Pre is empty), then it's that person's DOB.
                if (current.name && !current.dob && pre === "") {
                    current.dob = normalizeDateStr(dateStr);
                    if (post) current.infoList.push(post);
                    current.justStarted = false;
                } else {
                    // Otherwise, it's a fully self-contained line OR a new person line
                    // Flush previous if exists
                    if (current.name || current.dob) flush();

                    current.name = pre; // Name is before date
                    current.dob = normalizeDateStr(dateStr);
                    if (post) current.infoList.push(post);
                    current.justStarted = true; // Mark as fresh to capture subsequent info lines
                }
            }
        } else {
            // No Date Found on this line
            // Is it Name or Info?

            // Heuristics for Info
            const infoKeywords = ["職業", "勤務", "園", "学校", "社", "アレルギー", "疾患", "病", "薬", "申請", "検討", "利用", "金額", "備考", "共有", "男児", "女児", "時", "分", "保育園", "幼稚園", "未就学児", "母乳", "発達", "クラス", "理学療法士", "作業療法士", "公務員", "役員", "落花生", "いわし", "整備士", "医師"];
            const isInfoKey = infoKeywords.some(k => clean.includes(k));
            const isLong = clean.length > 20;

            // Heuristics for Name (Start of new block)
            // If current person is "Complete" (has DOB) and line looks like a Name -> Flush and Start New
            // If current person is Empty, this is Name.

            const isLikelyName = !isInfoKey && !isLong;

            if (current.dob) {
                // Current person has DOB.
                // If this line looks like a Name, start new person.
                // UNLESS it's just a short remark? e.g. "主婦"
                if (isLikelyName && !["主婦", "夫", "妻", "パート", "学生", "無職", "会社員", "自営業", "ケアマネージャー", "介護職", "教員", "医師", "整備士", "保育士"].includes(clean)) {
                    flush();
                    current.name = clean;
                    current.justStarted = true;
                } else {
                    current.infoList.push(clean);
                }
            } else {
                // No DOB yet.
                if (!current.name) {
                    // Empty person. Assume Name.
                    if (isLikelyName) {
                        current.name = clean;
                        current.justStarted = true;
                    } else {
                        // Weird to have info before name, but maybe partial?
                        // Or general note. Attach to current (which is empty) or previous?
                        // Just stash it.
                        current.infoList.push(clean);
                    }
                } else {
                    // Has Name, No DOB.
                    // This line is likely intermediate info or multi-line name?
                    // "夫 \n 鎌弥" -> handled by regex? No.
                    // If Name="夫", and this line="鎌弥", merge?
                    // If Line 1 was very short (<5 chars) and "Role-like", maybe append?
                    if (current.name.length < 5 && isLikelyName) {
                        current.name += " " + clean;
                    } else {
                        current.infoList.push(clean);
                    }
                }
            }
        }
    });

    flush(); // Final flush to capture last person

    return results;
}

/**
 * Normalizes date string to YYYY/MM/DD format.
 */
function normalizeDateStr(dateStr) {
    if (!dateStr) return "";

    // Remove '生' suffix if matched
    let str = dateStr.replace(/生$/, '').trim();

    // 1. Compact 8 digit: 19860921
    if (/^\d{8}$/.test(str)) {
        return str.substring(0, 4) + '/' + str.substring(4, 6) + '/' + str.substring(6, 8);
    }

    // 2. Japanese Era (Kanji, with flexible spacing)
    // Matches: 昭和59年5月9日, 平成5年1月14日, 令和7年7月17日
    const eraMatch = str.match(/^(明治|大正|昭和|平成|令和)\s*([0-9元]+)\s*年\s*([0-9]+)\s*月\s*([0-9]+)\s*日?$/);
    if (eraMatch) {
        let era = eraMatch[1];
        let year = (eraMatch[2] === '元') ? 1 : parseInt(eraMatch[2], 10);
        const month = parseInt(eraMatch[3], 10);
        const day = parseInt(eraMatch[4], 10);

        if (era === '明治') year += 1867;
        else if (era === '大正') year += 1911;
        else if (era === '昭和') year += 1925;
        else if (era === '平成') year += 1988;
        else if (era === '令和') year += 2018;

        return `${year}/${month}/${day}`;
    }

    // 2b. Abbreviated Japanese Era (Alpha): H1.10.16, h5.12.29, r3.5.14, H4/8/5
    // Case insensitive, supports both . and /
    const abbrevMatch = str.match(/^([MTSHRmtshr])(\d{1,2})[\.\\/](\d{1,2})[\.\\/](\d{1,2})$/i);
    if (abbrevMatch) {
        let era = abbrevMatch[1].toUpperCase(); // Normalize to uppercase
        let year = parseInt(abbrevMatch[2], 10);
        const month = parseInt(abbrevMatch[3], 10);
        const day = parseInt(abbrevMatch[4], 10);

        // Convert alpha to base year
        if (era === 'M') year += 1867;      // 明治
        else if (era === 'T') year += 1911; // 大正
        else if (era === 'S') year += 1925; // 昭和
        else if (era === 'H') year += 1988; // 平成
        else if (era === 'R') year += 2018; // 令和

        return `${year}/${month}/${day}`;
    }

    // 2b2. Kanji era with dots: 令和5.9.25, 平成5.1.14
    const kanjiDotMatch = str.match(/^(明治|大正|昭和|平成|令和)(\d{1,2})\.(\d{1,2})\.(\d{1,2})$/);
    if (kanjiDotMatch) {
        let era = kanjiDotMatch[1];
        let year = parseInt(kanjiDotMatch[2], 10);
        const month = parseInt(kanjiDotMatch[3], 10);
        const day = parseInt(kanjiDotMatch[4], 10);

        if (era === '明治') year += 1867;
        else if (era === '大正') year += 1911;
        else if (era === '昭和') year += 1925;
        else if (era === '平成') year += 1988;
        else if (era === '令和') year += 2018;

        return `${year}/${month}/${day}`;
    }

    // 2c. Western calendar with 年月日: 1961年9月2日
    const westernMatch = str.match(/^(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?$/);
    if (westernMatch) {
        return `${westernMatch[1]}/${westernMatch[2]}/${westernMatch[3]}`;
    }

    // 3. Standard YYYY.MM.DD or YYYY-MM-DD
    // Replace '年' '月' '.' '-' with '/'
    let norm = str
        .replace(/[年月\.\-]/g, '/')
        .replace(/日/g, '');

    return norm;
}
