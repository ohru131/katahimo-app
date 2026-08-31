// --------------------------------------------------------------------------
// Robust Logging System (Async + Safe)
// 旧コード.js(Main.js に改名)から分割(2026-08-18)。
// --------------------------------------------------------------------------

const LOG_BUFFER_KEY = "SYSTEM_LOG_BUFFER";
const LOG_FOLDER_PROP_KEY = "SYSTEM_LOG_FOLDER_ID";
// gas-childcare-reportと同じDriveフォルダ(LOG_FOLDER_ID)を共有しているが、
// ファイル名プレフィックスは"app_log_"のまま共通だったため、両アプリのログが
// 同じ月次CSVファイルに混在してしまっていた(LockServiceもプロジェクト単位のため
// 同時書き込みでの取りこぼしリスクもあった)。本アプリ専用のプレフィックスに変更し、
// 別ファイルに分離する。
const LOG_FILE_PREFIX = "visitapp_log_";

/**
 * Adds a log entry to the buffer.
 * If buffer is near full, it forces a flush to Drive immediately.
 *
 * @param {string} level - "INFO", "WARN", "ERROR", "SECURITY"
 * @param {string} action - Function name or User action
 * @param {string} user - User email or ID
 * @param {object|string} details - Detailed info object
 */
function logToBuffer(level, action, user, details) {
    const lock = LockService.getScriptLock();
    // Wait for other writes
    if (lock.tryLock(10000)) {
        try {
            const props = PropertiesService.getScriptProperties();
            let bufferStr = props.getProperty(LOG_BUFFER_KEY);
            let buffer = [];

            if (bufferStr) {
                try {
                    buffer = JSON.parse(bufferStr);
                } catch (e) {
                    // corrupted buffer, start new
                    console.error("Log buffer corrupted, resetting.");
                    buffer = [];
                }
            }

            const entry = {
                timestamp: Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy/MM/dd HH:mm:ss"),
                level: level,
                action: action,
                user: user,
                details: typeof details === 'object' ? JSON.stringify(details) : String(details)
            };

            buffer.push(entry);

            const newBufferStr = JSON.stringify(buffer);

            // PropertiesService limit is ~9KB. Safety margin at 7KB.
            if (newBufferStr.length > 7000) {
                // Buffer full: Flush immediately to Drive (Sync fallback)
                console.warn("Log buffer full, forcing immediate flush.");
                flushLogsToDriveLocked(buffer); // Reuse internal flush logic
                props.deleteProperty(LOG_BUFFER_KEY);
            } else {
                // Buffer OK: Save to Property
                props.setProperty(LOG_BUFFER_KEY, newBufferStr);
            }

        } catch (e) {
            console.error("Logging Failed: " + e.message);
        } finally {
            lock.releaseLock();
        }
    } else {
        console.error("Could not obtain lock for logging.");
    }
}

/**
 * Triggers the flush of buffered logs to Google Drive.
 * Should be called by a Time-Driven Trigger (e.g., every 10 mins).
 */
function flushLogsToDrive() {
    const lock = LockService.getScriptLock();
    if (lock.tryLock(30000)) { // Long wait for flush
        try {
            const props = PropertiesService.getScriptProperties();
            const bufferStr = props.getProperty(LOG_BUFFER_KEY);

            if (!bufferStr) return; // Nothing to flush

            let buffer = [];
            try {
                buffer = JSON.parse(bufferStr);
            } catch (e) {
                console.error("Buffer corrupted during flush.");
                props.deleteProperty(LOG_BUFFER_KEY);
                return;
            }

            if (buffer.length === 0) return;

            // Flush
            flushLogsToDriveLocked(buffer);

            // Clear buffer after successful flush
            props.deleteProperty(LOG_BUFFER_KEY);
            console.log(`Flushed ${buffer.length} logs to Drive.`);

        } catch (e) {
            console.error("Flush Failed: " + e.message);
        } finally {
            lock.releaseLock();
        }
    }
}

/**
 * Internal helper to write logs to Drive CSV.
 * Assumes Lock is already held.
 */
function flushLogsToDriveLocked(buffer) {
    const folder = getOrCreateLogFolder();
    if (!folder) {
        throw new Error("Log folder could not be found or created.");
    }

    // File name by Month (Rotate monthly) e.g. visitapp_log_2024-01.csv
    const now = new Date();
    const yyyyMM = Utilities.formatDate(now, "Asia/Tokyo", "yyyy-MM");
    const fileName = `${LOG_FILE_PREFIX}${yyyyMM}.csv`;

    const files = folder.getFilesByName(fileName);
    let file;
    if (files.hasNext()) {
        file = files.next();
    } else {
        // Create new CSV with header
        file = folder.createFile(fileName, "Timestamp,Level,Action,User,Details\n", MimeType.CSV);
    }

    let newRows = "";
    buffer.forEach(b => {
        // Escape CSV special chars in details
        const safeDetails = b.details.replace(/"/g, '""');
        newRows += `${b.timestamp},${b.level},${b.action},${b.user},"${safeDetails}"\n`;
    });

    // Append using blob text
    const combined = file.getBlob().getDataAsString() + newRows;
    file.setContent(combined);
}

/**
 * Gets the specific folder for logs.
 * フォルダID(LOG_FOLDER_ID)はConfig.jsで定義。
 */
function getOrCreateLogFolder() {
    try {
        return DriveApp.getFolderById(LOG_FOLDER_ID);
    } catch (e) {
        console.error("Specified Log Folder not found: " + e.message);
        return null;
    }
}

/**
 * One-time setup to create the trigger.
 * Run this function once manually.
 */
function setupLogTrigger() {
    const triggers = ScriptApp.getProjectTriggers();
    for (let t of triggers) {
        if (t.getHandlerFunction() === 'flushLogsToDrive') {
            return; // Already exists
        }
    }

    // Create every 10 minutes
    ScriptApp.newTrigger('flushLogsToDrive')
        .timeBased()
        .everyMinutes(10)
        .create();
}

/**
 * Stops the logging trigger.
 * Run this manually to disable auto-flushing.
 */
function deleteLogTrigger() {
    const triggers = ScriptApp.getProjectTriggers();
    let count = 0;
    for (let t of triggers) {
        if (t.getHandlerFunction() === 'flushLogsToDrive') {
            ScriptApp.deleteTrigger(t);
            count++;
        }
    }
    console.log(`Deleted ${count} log trigger(s).`);
}

/**
 * Test function to verify logging and flushing.
 */
function testLogAndFlush() {
    // 1. テストログを書き込む
    logToBuffer("INFO", "TestLogging", "admin@example.com", "これはテストログです " + new Date());
    console.log("ログをバッファに書き込みました。");

    // 2. 強制的に保存を実行する
    flushLogsToDrive();
    console.log("保存処理を実行しました。Driveを確認してください。");
}
