// ==========================================
// 認証・セッション管理(ログイン/セッション検証/パスワードリセット・変更)
// 旧コード.js(Main.js に改名)から分割(2026-08-18)。
// STAFF_SS_ID/STAFF_GID(スタッフ台帳)はConfig.jsで定義(PastSchedule.js/RouteSearch.js
// からも参照される。環境依存IDはConfig.jsに集約している。2026-08-18)。
// ==========================================

/**
 * Checks if a staff member is still active (not retired)
 * Used for auto-login validation
 */
function checkStaffActiveStatus(staffName) {
    try {
        const ss = SpreadsheetApp.openById(STAFF_SS_ID);
        let sheet = null;
        const sheets = ss.getSheets();
        for (let i = 0; i < sheets.length; i++) {
            if (sheets[i].getSheetId() === STAFF_GID) {
                sheet = sheets[i];
                break;
            }
        }

        if (!sheet) return { active: false, message: "Staff sheet not found" };

        const data = sheet.getDataRange().getValues().slice(1); // Skip header

        // Find user by name (Col 1)
        const user = data.find(row => String(row[1]) === staffName);

        if (!user) {
            return { active: false, message: "ユーザーが見つかりません" };
        }

        // Check retirement date (Col 7 = H column)
        const retirementDate = user[7];
        if (retirementDate) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            let retireDate;
            if (retirementDate instanceof Date) {
                retireDate = new Date(retirementDate);
                retireDate.setHours(0, 0, 0, 0);
            } else {
                retireDate = new Date(retirementDate);
                if (!isNaN(retireDate.getTime())) {
                    retireDate.setHours(0, 0, 0, 0);
                } else {
                    retireDate = null;
                }
            }

            if (retireDate && retireDate <= today) {
                return { active: false, message: "ログインできないユーザーです" };
            }
        }

        return { active: true };
    } catch (e) {
        return { active: false, message: e.message };
    }
}

/**
 * スタッフ名一覧(Col A)を返す。現状index.htmlからは呼ばれていない。
 */
function getStaffList() {
    try {
        const ss = SpreadsheetApp.openById(STAFF_SS_ID);
        const sheet = ss.getSheets().find(s => s.getSheetId() == STAFF_GID);
        if (!sheet) return [];

        const lastRow = sheet.getLastRow();
        if (lastRow < 2) return [];

        // Name is in Col A (index 0 for getValues, but getRange is 1-based, so Column 1)
        const range = sheet.getRange(2, 1, lastRow - 1, 1);
        const values = range.getValues();
        return values.map(row => row[0]).filter(name => name);

    } catch (e) {
        console.error("Staff List Error: " + e.message);
        return [];
    }
}

// --- Security & Auth (V2) ---

/**
 * Computes SHA-256 hash of the input string with Salt.
 */
function computeHash(raw) {
    if (!raw) return "";

    // AUTH_SALTはScript Propertiesに必ず設定されている前提(秘密情報のハードコード禁止 - CLAUDE.md)。
    // 未設定の場合はここで気づけるよう例外にする(誰でも推測できる既定値へフォールバックしない)。
    const props = PropertiesService.getScriptProperties();
    const salt = props.getProperty('AUTH_SALT');
    if (!salt) throw new Error('AUTH_SALTがScript Propertiesに設定されていません。');

    const saltedRaw = raw + salt;
    const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, saltedRaw);
    return digest.map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, '0')).join('');
}

/**
 * Validates login credentials.
 * Supports both legacy plain text (auto-migrates) and SHA-256 hash.
 * Issues a Session Token on success.
 */
function verifyLogin(userId, password) {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) return { success: false, message: "Server Busy" };

    try {
        const ss = SpreadsheetApp.openById(STAFF_SS_ID);
        let sheet = null;
        const sheets = ss.getSheets();
        for (let i = 0; i < sheets.length; i++) {
            if (sheets[i].getSheetId() === STAFF_GID) {
                sheet = sheets[i];
                break;
            }
        }
        if (!sheet) return { success: false, message: "Staff sheet not found" };

        const data = sheet.getDataRange().getValues();
        // Header is row 0. Data starts row 1.

        // Find User Row Index
        // Col E (idx 4) = Email
        let userRowIndex = -1;
        let userRow = null;

        for (let i = 1; i < data.length; i++) {
            if (String(data[i][4]) === userId) { // Use Email (userId argument acts as email)
                userRowIndex = i;
                userRow = data[i];
                break;
            }
        }

        if (!userRow) return { success: false, message: "メールアドレスまたはパスワードが違います" };

        // Check Retirement (Col H, idx 7)
        const retirementDate = userRow[7];
        if (retirementDate) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            let retireDate = new Date(retirementDate);
            if (!isNaN(retireDate.getTime())) {
                retireDate.setHours(0, 0, 0, 0);
                if (retireDate <= today) {
                    logToBuffer("WARN", "LoginFailed", userId || "unknown", "Retired user attempt");
                    return { success: false, message: "ログイン権限のないユーザーです" };
                }
            }
        }

        // Verify Password (Col J, idx 9)
        const storedPass = String(userRow[9]);
        const inputHash = computeHash(password);
        let matched = false;
        let migrated = false;

        // 1. Try Hash Match
        if (storedPass === inputHash) {
            matched = true;
        }
        // 2. Try Plain Text Match (Legacy Support)
        else if (storedPass === password) {
            matched = true;
            // Auto-migrate to hash for this user
            sheet.getRange(userRowIndex + 1, 10).setValue(inputHash); // idx 9 is Col J (10th col)
            migrated = true;
        }

        if (!matched) {
            logToBuffer("WARN", "LoginFailed", userId || "unknown", "Invalid password");
            return { success: false, message: "メールアドレスまたはパスワードが違います" };
        }

        // Generate Session Token
        const token = Utilities.getUuid();
        const now = new Date();
        const expiry = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days

        // Store Token in Col N (14), Expiry in Col O (15)
        // Leaving L(12) for LW_ID and M(13) open or used
        if (sheet.getMaxColumns() < 15) {
            sheet.insertColumnsAfter(sheet.getMaxColumns(), 15 - sheet.getMaxColumns());
        }

        // Update Sheet (Row is 1-based)
        sheet.getRange(userRowIndex + 1, 14).setValue(token);
        sheet.getRange(userRowIndex + 1, 15).setValue(Utilities.formatDate(expiry, "Asia/Tokyo", "yyyy/MM/dd HH:mm:ss"));

        const isAdmin = (userRow[10] == 1 || userRow[10] === '1');

        logToBuffer("INFO", "LoginSuccess", userRow[1] + ` (${userId})`, "Session started");

        return {
            success: true,
            name: userRow[1],
            isAdmin: isAdmin,
            token: token // Return token to client
        };

    } catch (e) {
        logToBuffer("ERROR", "LoginError", userId || "unknown", e.message);
        return { success: false, message: e.message };
    } finally {
        lock.releaseLock();
    }
}

/**
 * Validates a session token.
 * Replaces checkStaffActiveStatus for Auth.
 */
function checkSession(token, isInitialLoad) {
    if (!token) return { valid: false };

    try {
        const ss = SpreadsheetApp.openById(STAFF_SS_ID);
        let sheet = ss.getSheets().find(s => s.getSheetId() === STAFF_GID);
        if (!sheet) return { valid: false };

        const data = sheet.getDataRange().getValues();
        // Col N (idx 13) = Token, O (idx 14) = Expiry

        for (let i = 1; i < data.length; i++) {
            if (data[i][13] === token) {
                // Check Expiry
                const expiryStr = data[i][14];
                const expiry = new Date(expiryStr);
                if (expiry > new Date()) {
                    // Also check retirement again just in case
                    const retirementDate = data[i][7];
                    if (retirementDate) {
                        let rDate = new Date(retirementDate);
                        rDate.setHours(0, 0, 0, 0);
                        const today = new Date();
                        today.setHours(0, 0, 0, 0);
                        if (rDate <= today) return { valid: false };
                    }

                    // Auto-Extend Session (Rolling Expiry)
                    // If less than 6 days remaining, extend back to 7 days
                    // This prevents excessive writes on every single reload, but keeps active users logged in.
                    const now = new Date();
                    const daysRemaining = (expiry - now) / (1000 * 60 * 60 * 24);

                    if (daysRemaining < 6) {
                        const newExpiry = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
                        // Write to Col O (15) for Row i+1
                        sheet.getRange(i + 1, 15).setValue(Utilities.formatDate(newExpiry, "Asia/Tokyo", "yyyy/MM/dd HH:mm:ss"));
                    }

                    const isAdmin = (data[i][10] == 1 || data[i][10] === '1');
                    // Return email as userId for consistency if needed, or actual ID.
                    const userId = data[i][4]; // Col E (Email)

                    if (isInitialLoad) {
                        logToBuffer("INFO", "AutoLogin", data[i][1] + ` (${userId})`, "Page Loaded / Session Validated");
                    }

                    return { valid: true, name: data[i][1], isAdmin: isAdmin, userId: userId };
                }
            }
        }
        return { valid: false };
    } catch (e) {
        return { valid: false };
    }
}

/**
 * Initiates Password Reset via Email.
 */
const PASSWORD_RESET_SHEET_NAME = 'PasswordResets';

/**
 * Initiates Password Reset via Email.
 * Uses a dedicated sheet for performance.
 */
function requestPasswordReset(userId) {
    const ss = SpreadsheetApp.openById(STAFF_SS_ID);

    // 1. Validate User from Staff Sheet (Read Only)
    // We only need to find the email for the ID.
    // Optimization: Don't read whole sheet if possible, but finding ID requires scan.
    let sheet = ss.getSheets().find(s => s.getSheetId() === STAFF_GID);
    if (!sheet) return { success: false, message: "System Error" };

    const data = sheet.getDataRange().getValues();
    let email = "";

    // Find Email (Col E, idx 4)
    for (let i = 1; i < data.length; i++) {
        if (String(data[i][4]) === userId) {
            email = data[i][4];
            break;
        }
    }

    if (!email || !email.includes('@')) {
        // 存在しないユーザーIDでのパスワードリセット試行(ユーザー列挙攻撃の可能性)を追跡する。
        logToBuffer("WARN", "PasswordResetRequestFailed", userId || "unknown", "ユーザーIDが見つからないか、メールアドレスが未登録です");
        return { success: false, message: "ユーザーIDが見つからないか、メールアドレスが登録されていません" };
    }

    // 2. Generate Code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const now = new Date();
    const expiry = new Date(now.getTime() + 30 * 60 * 1000); // 30 min

    // 3. Save to Dedicated Reset Sheet
    const lock = LockService.getScriptLock();
    if (lock.tryLock(5000)) {
        try {
            let resetSheet = ss.getSheetByName(PASSWORD_RESET_SHEET_NAME);
            if (!resetSheet) {
                resetSheet = ss.insertSheet(PASSWORD_RESET_SHEET_NAME);
                resetSheet.appendRow(['UserID', 'Email', 'Code', 'Expiry', 'CreatedAt']);
            }

            // Append logic is fast
            resetSheet.appendRow([
                userId,
                email,
                code,
                Utilities.formatDate(expiry, "Asia/Tokyo", "yyyy/MM/dd HH:mm:ss"),
                Utilities.formatDate(now, "Asia/Tokyo", "yyyy/MM/dd HH:mm:ss")
            ]);
        } finally {
            lock.releaseLock();
        }
    } else {
        return { success: false, message: "Server Busy" };
    }

    // 4. Send Email
    try {
        MailApp.sendEmail({
            to: email,
            subject: "【保育日報】パスワード再設定認証コード",
            body: `パスワード再設定のリクエストを受け付けました。\n以下の認証コードを入力してください。\n\nコード: ${code}\n有効期限: 30分`
        });
        logToBuffer("SECURITY", "PasswordResetRequest", userId, "Reset code sent");
        return { success: true };
    } catch (e) {
        logToBuffer("ERROR", "PasswordResetRequestError", userId || "unknown", e.message);
        return { success: false, message: "メール送信に失敗しました: " + e.message };
    }
}

/**
 * Completes Password Reset with Verification Code.
 */
function resetPasswordWithCode(userId, code, newPassword) {
    const ss = SpreadsheetApp.openById(STAFF_SS_ID);

    // 1. Verify Code from Reset Sheet
    let resetSheet = ss.getSheetByName(PASSWORD_RESET_SHEET_NAME);
    if (!resetSheet) return { success: false, message: "Invalid Request" };

    // Read recent requests (Optimized: read last 50 rows?)
    // For safety, let's read all but it should be small if cleaned up.
    // Or just read reverse.
    const resetData = resetSheet.getDataRange().getValues();
    let validRequest = null;
    let foundRowIndex = -1;

    // Loop backwards to find latest request
    for (let i = resetData.length - 1; i >= 1; i--) {
        const r = resetData[i];
        // Col 0: UserID, Col 2: Code, Col 3: Expiry
        if (String(r[0]) === userId && String(r[2]) === String(code)) {
            const expiry = new Date(r[3]);
            if (new Date() <= expiry) {
                validRequest = r;
                foundRowIndex = i + 1; // 1-based
                break;
            } else {
                logToBuffer("WARN", "PasswordResetFailed", userId || "unknown", "有効期限切れの認証コードでの再設定を試みました");
                return { success: false, message: "認証コードの有効期限が切れています" };
            }
        }
    }

    if (!validRequest) {
        // 総当たりでのコード推測を検知できるよう記録する。
        logToBuffer("WARN", "PasswordResetFailed", userId || "unknown", "無効な認証コードでの再設定を試みました");
        return { success: false, message: "無効な認証コードです" };
    }

    // 2. Update Password in Staff Sheet
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) return { success: false, message: "Server Busy" };

    try {
        let sheet = ss.getSheets().find(s => s.getSheetId() === STAFF_GID);
        const data = sheet.getDataRange().getValues();
        let userRowIndex = -1;

        for (let i = 1; i < data.length; i++) {
            if (String(data[i][4]) === userId) {
                userRowIndex = i;
                break;
            }
        }

        if (userRowIndex === -1) return { success: false, message: "ユーザーが見つかりません" };

        const hash = computeHash(newPassword);
        sheet.getRange(userRowIndex + 1, 10).setValue(hash); // Col J (10)

        // Mark code as used
        resetSheet.getRange(foundRowIndex, 3).setValue("USED");

        logToBuffer("SECURITY", "PasswordReset", userId, "Password reset successfully via code");
        return { success: true, message: "パスワードを再設定しました" };

    } catch (e) {
        logToBuffer("ERROR", "PasswordResetError", userId || "unknown", e.message);
        return { success: false, message: e.message };
    } finally {
        lock.releaseLock();
    }
}

/**
 * Changes password for logged-in user.
 */
function changePassword(token, currentPass, newPass) {
    const session = checkSession(token);
    if (!session.valid) {
        logToBuffer("WARN", "ChangePasswordAccessDenied", "invalid-session", "無効なセッションでのパスワード変更を試みました");
        return { success: false, message: "セッションが無効です" };
    }

    const userId = session.userId;
    // Reuse verify logic conceptually but we need to verify OLD pass first again

    const ss = SpreadsheetApp.openById(STAFF_SS_ID);
    let sheet = ss.getSheets().find(s => s.getSheetId() === STAFF_GID);
    const data = sheet.getDataRange().getValues();
    let rowIndex = -1;

    for (let i = 1; i < data.length; i++) {
        if (String(data[i][4]) === userId) {
            rowIndex = i;
            break;
        }
    }

    if (rowIndex === -1) return { success: false, message: "User error" };

    const storedPass = String(data[rowIndex][9]);
    const currentHash = computeHash(currentPass);

    // Verify Old
    if (storedPass !== currentHash && storedPass !== currentPass) {
        logToBuffer("WARN", "ChangePasswordFailed", userId, "Incorrect current password attempt");
        return { success: false, message: "現在のパスワードが正しくありません" };
    }

    // Update
    const newHash = computeHash(newPass);
    sheet.getRange(rowIndex + 1, 10).setValue(newHash);

    logToBuffer("SECURITY", "ChangePassword", userId, "Password changed successfully");
    return { success: true, message: "パスワードを変更しました" };
}

/**
 * Admin Migration Tool: Hash all plaintext passwords.
 * Run this ONCE from the editor.
 */
function migratePasswords() {
    const ss = SpreadsheetApp.openById(STAFF_SS_ID);
    let sheet = ss.getSheets().find(s => s.getSheetId() === STAFF_GID);

    // Normalize Headers
    // Ensure Col N(14), O(15) exist
    if (sheet.getMaxColumns() < 15) {
        sheet.insertColumnsAfter(sheet.getMaxColumns(), 15 - sheet.getMaxColumns());
    }
    const headers = sheet.getRange(1, 1, 1, 15).getValues()[0];
    // Check Col N (Index 13), O (Index 14)
    if (!headers[13]) sheet.getRange(1, 14).setValue("SessionToken");
    if (!headers[14]) sheet.getRange(1, 15).setValue("SessionExpiry");

    const data = sheet.getDataRange().getValues();
    let count = 0;

    for (let i = 1; i < data.length; i++) {
        const pass = String(data[i][9]); // Col J
        if (!pass) continue;

        // Simple check: SHA-256 hex is 64 chars. If not 64 chars, assume plain text.
        // Also check if it looks like hex.
        if (pass.length !== 64 || !/^[0-9a-fA-F]+$/.test(pass)) {
            const hash = computeHash(pass);
            sheet.getRange(i + 1, 10).setValue(hash);
            console.log(`Migrated User: ${data[i][1]}`);
            count++;
        }
    }
    return `Migrated ${count} users.`;
}

/**
 * 管理者専用機能で権限拒否(未ログイン/非管理者)が発生した際のログ記録。
 * 複数の管理者・利用者が同じアプリを使うため、誰が(あるいは無効なセッションで)
 * 管理者機能へのアクセスを試みたかを追跡できるようにする。
 */
function logAdminAccessDenied_(action, session) {
    const who = (session && session.name) ? session.name : 'invalid-session';
    const detail = (session && session.valid && !session.isAdmin) ? '管理者権限なしでアクセスを試みました' : 'ログインセッションが無効です';
    logToBuffer('WARN', action + 'AccessDenied', who, detail);
}
