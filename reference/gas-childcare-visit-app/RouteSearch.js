// ==========================================
// カレンダー予定検索・ルート検索
//
// 以前は別プロジェクト(01_GAS/gas-root-serach)をライブラリ(RootSearchLib)として参照していたが、
// 本アプリ以外の利用元(gas-integrated-system)は本アプリのリリースをもって廃止予定のため、
// ライブラリのバージョン管理(clasp push→新バージョンデプロイ→appsscript.jsonのversion更新)の
// 手間を無くすため、実際に使用している関数のみをこのファイルに直接統合した。
// (元のgas-root-serach/main.jsのうち、夜間バッチ通知用の関数(main/autoRunSaveAttendance等、
// LINE WORKS通知・「ルート集計」シート書き込み関連)は本アプリでは使用しないため移植していない)
//
// ロジックはgas-root-serach/main.jsの該当関数から変更していない(CONFIG.STAFF_SS_IDは
// Config.jsで定義済みの本アプリのSTAFF_SS_ID定数と同一の値のため、そちらを再利用している)。
// フォルダID(CUSTOMER_CSV_FOLDER_ID/ROUTE_SEARCH_ATTENDANCE_FOLDER_ID)もConfig.jsで定義。
// ==========================================

const ROUTE_SEARCH_ATTENDANCE_FILE_NAME = "勤怠集計";

// ルート集計/勤怠集計ファイルで共通して使うヘッダー。
const ATTENDANCE_SHEET_HEADER = [
    "日付", "スタッフ名", "種別", "顧客名", "開始時間", "終了時間", "予約詳細URL",
    "移動経路URL", "移動時間（分）", "移動距離（km）",
    "出勤経路URL", "出勤経路時間（分）", "出勤経路距離（km）",
    "退勤経路URL", "退勤経路時間（分）", "退勤経路距離（km）",
    "顧客ID"
];

// スタッフ名の空白差異(全角/半角スペース・タブ等)を無視して比較するための正規化。
// カレンダー予定・スタッフ台帳・出勤簿など入力元ごとに表記揺れがあるため、名前を比較する
// 箇所ではこれを通してから比較する(以前はこの関数と同じ定義がRouteSearch.js/PastSchedule.js
// 内に7箇所重複していた)。
function normalizeStaffName_(str) {
    return String(str || "").replace(/\s+/g, "");
}

// ==========================================
// 1. カレンダー情報取得
// ==========================================
function getCalendarEvents(date, customerList) {
    const calendars = CalendarApp.getAllCalendars();
    const uniqueEventsMap = new Map();

    const startTime = new Date(date);
    startTime.setHours(0, 0, 0, 0);
    const endTime = new Date(startTime);
    endTime.setHours(23, 59, 59, 999);

    calendars.forEach(calendar => {
        const calendarName = calendar.getName();
        const events = calendar.getEvents(startTime, endTime);

        events.forEach(event => {
            if (event.getMyStatus() === CalendarApp.GuestStatus.NO) {
                return;
            }
            const eventId = event.getId();
            if (!uniqueEventsMap.has(eventId)) {
                uniqueEventsMap.set(eventId, {
                    event: event,
                    ownerName: calendarName
                });
            }
        });
    });

    const allEventData = Array.from(uniqueEventsMap.values());
    const processedEvents = [];

    allEventData.forEach(data => {
        const event = data.event;
        const ownerName = data.ownerName;

        const subject = event.getTitle();
        const description = event.getDescription() || "";
        const location = event.getLocation();

        const isConfirmed = subject.includes("[予約確定]");
        const isNewCustomer = subject.includes("[新規]");
        const isSpecialEvent = subject.includes("[イベント]");
        const isOfficeWork = subject.includes("[事務]");

        const cleanedSubjectName = subject
            .replace("[予約確定]", "")
            .replace("[新規]", "")
            .replace("[イベント]", "")
            .replace("[事務]", "")
            .trim();

        if (isConfirmed) {
            const staffMatch = description.match(/施設：(.*?)\[/);
            const staffNameFromDesc = staffMatch ? staffMatch[1].trim() : ownerName;

            const isOnline = description.includes("オンライン");

            let customer = customerList.find(c => {
                const targetName = String(c.name || "").replace(/\s+/g, "");
                const searchName = cleanedSubjectName.replace(/\s+/g, "");
                return targetName === searchName;
            });

            if (!customer) {
                customer = {
                    name: cleanedSubjectName,
                    address: "",
                    lat: "",
                    lng: "",
                    parkingarea: ""
                };
            }

            if (isOnline) {
                customer.address = "";
                customer.lat = "";
                customer.lng = "";
            }

            const urlMatch = description.match(/https?:\/\/[\w/:%#\$&\?\(\)~\.=\+\-]+/);

            processedEvents.push({
                startTime: event.getStartTime(),
                endTime: event.getEndTime(),
                eventType: "CUSTOMER APPOINTMENT",
                customerInfo: customer,
                staffNameRaw: staffNameFromDesc,
                reservaUrl: urlMatch ? urlMatch[0] : "",
                isMeeting: false
            });
        }
        else if (isNewCustomer) {
            let geo = location ? getLatLngFromAddress(location) : { lat: "", lng: "" };

            processedEvents.push({
                startTime: event.getStartTime(),
                endTime: event.getEndTime(),
                eventType: "CUSTOMER APPOINTMENT",
                customerInfo: {
                    name: cleanedSubjectName,
                    address: location,
                    lat: geo.lat,
                    lng: geo.lng,
                    parkingarea: ""
                },
                staffNameRaw: ownerName,
                reservaUrl: "",
                isMeeting: false
            });
        }
        else if (isSpecialEvent) {
            let geo = location ? getLatLngFromAddress(location) : { lat: "", lng: "" };
            const guestNames = event.getGuestList().map(guest => guest.getName() || guest.getEmail());

            processedEvents.push({
                startTime: event.getStartTime(),
                endTime: event.getEndTime(),
                eventType: "EVENT",
                customerInfo: {
                    name: cleanedSubjectName,
                    address: location,
                    lat: geo.lat,
                    lng: geo.lng,
                    parkingarea: ""
                },
                guestNames: guestNames,
                ownerName: ownerName,
                reservaUrl: "",
                isMeeting: true
            });
        }
        else if (isOfficeWork) {
            let geo = location ? getLatLngFromAddress(location) : { lat: "", lng: "" };

            processedEvents.push({
                startTime: event.getStartTime(),
                endTime: event.getEndTime(),
                eventType: "OFFICE WORK",
                customerInfo: {
                    name: cleanedSubjectName,
                    address: location || "",
                    lat: geo.lat,
                    lng: geo.lng,
                    parkingarea: ""
                },
                staffNameRaw: ownerName,
                reservaUrl: "",
                isMeeting: false
            });
        }
    });

    return mergeOverlappingOfficeWork(processedEvents);
}

function mergeOverlappingOfficeWork(events) {
    const officeWorks = events.filter(e => e.eventType === "OFFICE WORK");
    const nonOfficeWorks = events.filter(e => e.eventType !== "OFFICE WORK");

    if (officeWorks.length === 0) {
        return events;
    }

    // グルーピングキーは空白の有無(全角/半角スペース差異)を無視して正規化する。
    // groupEventsByStaff側の staff 名マッチングと同じ正規化にしないと、
    // 同一スタッフの事務作業が表記差だけで別グループに分かれ、マージされない。
    const staffGroups = {};
    const staffNameRawByKey = {};
    officeWorks.forEach(event => {
        const rawName = event.staffNameRaw || "";
        const key = normalizeStaffName_(rawName);
        if (!staffGroups[key]) {
            staffGroups[key] = [];
            staffNameRawByKey[key] = rawName;
        }
        staffGroups[key].push(event);
    });

    const mergedEvents = [];
    Object.keys(staffGroups).forEach(key => {
        const staffEvents = staffGroups[key];
        staffEvents.sort((a, b) => a.startTime - b.startTime);

        const processed = [];
        let currentMergeGroup = null;

        staffEvents.forEach(event => {
            if (!currentMergeGroup) {
                currentMergeGroup = {
                    names: [event.customerInfo.name],
                    startTime: event.startTime,
                    endTime: event.endTime,
                    baseEvent: event
                };
            } else if (event.startTime < currentMergeGroup.endTime) {
                currentMergeGroup.names.push(event.customerInfo.name);
                currentMergeGroup.endTime = new Date(Math.max(currentMergeGroup.endTime.getTime(), event.endTime.getTime()));
            } else {
                processed.push(currentMergeGroup);
                currentMergeGroup = {
                    names: [event.customerInfo.name],
                    startTime: event.startTime,
                    endTime: event.endTime,
                    baseEvent: event
                };
            }
        });

        if (currentMergeGroup) {
            processed.push(currentMergeGroup);
        }

        processed.forEach(group => {
            mergedEvents.push({
                startTime: group.startTime,
                endTime: group.endTime,
                eventType: "OFFICE WORK",
                customerInfo: {
                    name: group.names.join(","),
                    address: group.baseEvent.customerInfo.address,
                    lat: group.baseEvent.customerInfo.lat,
                    lng: group.baseEvent.customerInfo.lng,
                    parkingarea: group.baseEvent.customerInfo.parkingarea
                },
                staffNameRaw: staffNameRawByKey[key],
                reservaUrl: "",
                isMeeting: false
            });
        });
    });

    return [...nonOfficeWorks, ...mergedEvents];
}

// 同一実行内で同じ住所を何度もジオコーディングしないためのメモ化キャッシュ。
// (スクリプト実行が終わるとリセットされる、実行内限定のキャッシュ)
const GEOCODE_MEMO_CACHE_ = {};

function getLatLngFromAddress(address) {
    const key = String(address || '').trim();
    if (!key) return { lat: "", lng: "" };
    if (GEOCODE_MEMO_CACHE_.hasOwnProperty(key)) {
        return GEOCODE_MEMO_CACHE_[key];
    }

    try {
        const response = Maps.newGeocoder().geocode(key);
        if (response.status === 'OK' && response.results.length > 0) {
            const loc = response.results[0].geometry.location;
            const result = { lat: loc.lat, lng: loc.lng };
            GEOCODE_MEMO_CACHE_[key] = result; // 成功時のみメモ化(失敗はリトライ可能なままにする)
            return result;
        }
    } catch (e) {
        console.warn(`ジオコーディング失敗: ${key}`, e);
    }
    return { lat: "", lng: "" };
}

// ==========================================
// 2. スタッフごとのグループ化（招待ゲスト対応）
// ==========================================
function groupEventsByStaff(events, staffList) {
    const staffGroups = {};
    const normalize = normalizeStaffName_;

    events.forEach(event => {
        if (event.isMeeting) {
            if (event.guestNames && event.guestNames.length > 0) {
                event.guestNames.forEach(guestName => {
                    const staff = staffList.find(s => normalize(s.name) === normalize(guestName));
                    if (staff) {
                        addEventToGroup(staffGroups, staff, event);
                    }
                });
            } else if (event.ownerName) {
                const staff = staffList.find(s => normalize(s.name) === normalize(event.ownerName));
                if (staff) {
                    addEventToGroup(staffGroups, staff, event);
                }
            }
        } else {
            const staff = staffList.find(s => normalize(s.name) === normalize(event.staffNameRaw));
            if (staff) {
                addEventToGroup(staffGroups, staff, event);
            }
        }
    });

    Object.keys(staffGroups).forEach(key => {
        staffGroups[key].appointments.sort((a, b) => a.startTime - b.startTime);
    });
    return staffGroups;
}

function addEventToGroup(groups, staff, event) {
    if (!groups[staff.id]) {
        groups[staff.id] = { staffInfo: staff, appointments: [] };
    }
    groups[staff.id].appointments.push(event);
}

// ==========================================
// 3. ルート計算
// ==========================================
function calculateDetailedRoutes(groupedEvents, dateStr, targetDate) {
    const allRows = [];
    Object.values(groupedEvents).forEach(group => {
        const staff = group.staffInfo;
        const apps = group.appointments;

        const validLocApps = apps.filter(app =>
            app.customerInfo && (
                (app.customerInfo.lat && app.customerInfo.lng) ||
                (app.customerInfo.address && app.customerInfo.address.trim() !== "")
            )
        );

        for (let i = 0; i < apps.length; i++) {
            const currentApp = apps[i];
            const hasLocation = currentApp.customerInfo && (
                (currentApp.customerInfo.lat && currentApp.customerInfo.lng) ||
                (currentApp.customerInfo.address && currentApp.customerInfo.address.trim() !== "")
            );

            let moveInfo = { url: "", min: "", km: "" };
            let attendanceInfo = { url: "", min: "", km: "" };
            let leavingInfo = { url: "", min: "", km: "" };

            if (hasLocation) {
                if (currentApp === validLocApps[0]) {
                    attendanceInfo = getRouteDetails(staff, currentApp.customerInfo, targetDate);
                }

                const myIndexInValid = validLocApps.indexOf(currentApp);
                if (myIndexInValid > 0) {
                    const prevValidApp = validLocApps[myIndexInValid - 1];
                    moveInfo = getRouteDetails(prevValidApp.customerInfo, currentApp.customerInfo, targetDate);
                }

                if (currentApp === validLocApps[validLocApps.length - 1]) {
                    leavingInfo = getRouteDetails(currentApp.customerInfo, staff, targetDate);
                }
            } else {
                let moveFromLocation = null;
                for (let j = i - 1; j >= 0; j--) {
                    const prevApp = apps[j];
                    const prevHasLocation = prevApp.customerInfo && (
                        (prevApp.customerInfo.lat && prevApp.customerInfo.lng) ||
                        (prevApp.customerInfo.address && prevApp.customerInfo.address.trim() !== "")
                    );
                    if (prevHasLocation) {
                        moveFromLocation = prevApp.customerInfo;
                        break;
                    }
                }

                if (moveFromLocation && currentApp.customerInfo && currentApp.customerInfo.address) {
                    moveInfo = getRouteDetails(moveFromLocation, currentApp.customerInfo, targetDate);
                }
            }

            // 顧客ID を末尾に追加 (RESERVA 顧客ID、CRM と同じ形式)
            allRows.push([
                dateStr,
                staff.name,
                currentApp.eventType,
                currentApp.customerInfo.name,
                Utilities.formatDate(currentApp.startTime, "JST", "HH:mm"),
                Utilities.formatDate(currentApp.endTime, "JST", "HH:mm"),
                currentApp.reservaUrl,
                moveInfo.url, moveInfo.min, moveInfo.km,
                attendanceInfo.url, attendanceInfo.min, attendanceInfo.km,
                leavingInfo.url, leavingInfo.min, leavingInfo.km,
                currentApp.customerInfo.id || ''   // ← 追加: RESERVA 顧客ID
            ]);
        }
    });
    return allRows;
}

// 同一実行内で同じ起点/終点のルートを何度も計算しないためのメモ化キャッシュ。
const DIRECTIONS_MEMO_CACHE_ = {};

function getRouteDetails(from, to, targetDate) {
    const origin = resolveLocation(from, targetDate);
    const destination = resolveLocation(to, targetDate);

    if (!origin.lat || !origin.lng || !destination.lat || !destination.lng) {
        return { url: "", min: "", km: "" };
    }

    const cacheKey = `${origin.lat},${origin.lng}->${destination.lat},${destination.lng}`;
    if (DIRECTIONS_MEMO_CACHE_.hasOwnProperty(cacheKey)) {
        return DIRECTIONS_MEMO_CACHE_[cacheKey];
    }

    try {
        const directions = Maps.newDirectionFinder()
            .setOrigin(origin.lat, origin.lng)
            .setDestination(destination.lat, destination.lng)
            .setMode(Maps.DirectionFinder.Mode.DRIVING)
            .getDirections();

        if (directions.routes && directions.routes.length > 0) {
            const leg = directions.routes[0].legs[0];
            const result = {
                url: `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}&destination=${destination.lat},${destination.lng}&travelmode=driving`,
                km: (leg.distance.value / 1000).toFixed(2),
                min: Math.round(leg.duration.value / 60)
            };
            DIRECTIONS_MEMO_CACHE_[cacheKey] = result; // 成功時のみメモ化(失敗はリトライ可能なままにする)
            return result;
        }
    } catch (e) {
        console.warn("ルート計算失敗", e);
    }
    return { url: "", min: "", km: "" };
}

function resolveLocation(loc, targetDate) {
    let finalAddress = loc.address;
    let finalLat = loc.lat;
    let finalLng = loc.lng;

    if (loc.address2 && loc.address2_start && loc.address2_end) {
        const startDate = new Date(loc.address2_start);
        const endDate = new Date(loc.address2_end);

        const checkDate = new Date(targetDate.getTime());
        checkDate.setHours(0, 0, 0, 0);
        startDate.setHours(0, 0, 0, 0);
        endDate.setHours(0, 0, 0, 0);

        if (checkDate >= startDate && checkDate <= endDate) {
            finalAddress = loc.address2;
            finalLat = "";
            finalLng = "";
        }
    }

    if (!finalLat || !finalLng) {
        if (finalAddress) {
            const geo = getLatLngFromAddress(finalAddress);
            finalLat = geo.lat;
            finalLng = geo.lng;
        }
    }

    return { lat: finalLat, lng: finalLng };
}

// ==========================================
// 顧客DB/スタッフDBのキャッシュ(効率化)
// 1日に何度も更新されない前提のマスタデータを CacheService で短時間キャッシュし、
// 呼び出しごとのDrive走査・スプレッドシート全読みを減らす。
// ==========================================
const ROOT_SEARCH_MASTER_CACHE_TTL_SEC = 1800; // 30分
const ROOT_SEARCH_CUSTOMER_CACHE_KEY = 'RS_CUSTOMER_DATA_V1';
const ROOT_SEARCH_STAFF_CACHE_KEY = 'RS_STAFF_DATA_V1';

function getCustomerDataCached_() {
    const cache = CacheService.getScriptCache();
    const cached = cache.get(ROOT_SEARCH_CUSTOMER_CACHE_KEY);
    if (cached) {
        try {
            return JSON.parse(cached);
        } catch (e) {
            // パース失敗時は再取得にフォールスルー
        }
    }

    const folder = DriveApp.getFolderById(CUSTOMER_CSV_FOLDER_ID);
    const data = getCustomerDataFromCsv(folder);
    try {
        cache.put(ROOT_SEARCH_CUSTOMER_CACHE_KEY, JSON.stringify(data), ROOT_SEARCH_MASTER_CACHE_TTL_SEC);
    } catch (e) {
        console.warn('顧客データのキャッシュ保存に失敗しました(サイズ超過等、処理は継続): ' + e.message);
    }
    return data;
}

function getStaffDataCached_() {
    const cache = CacheService.getScriptCache();
    const cached = cache.get(ROOT_SEARCH_STAFF_CACHE_KEY);
    if (cached) {
        try {
            return JSON.parse(cached);
        } catch (e) {
            // パース失敗時は再取得にフォールスルー
        }
    }

    const data = getStaffDataFromSpreadsheet(STAFF_SS_ID);
    try {
        cache.put(ROOT_SEARCH_STAFF_CACHE_KEY, JSON.stringify(data), ROOT_SEARCH_MASTER_CACHE_TTL_SEC);
    } catch (e) {
        console.warn('スタッフデータのキャッシュ保存に失敗しました(サイズ超過等、処理は継続): ' + e.message);
    }
    return data;
}

// 同一実行内で同じ日付のカレンダー走査(getCalendarEvents)・スタッフ別グルーピング
// (groupEventsByStaff)を使い回すためのメモ化キャッシュ(GEOCODE_MEMO_CACHE_等と同じく、
// スクリプト実行が終わるとリセットされる実行内限定のキャッシュ)。夜間バッチ
// (autoSyncTodayScheduleForAllStaff)や管理者の一括反映(範囲×スタッフ)のように、
// 同じ日付を複数スタッフ分処理する場合に、Calendar APIの走査を人数分繰り返さないようにする。
// 書き込み系(勤怠集計への反映)でも、同一実行内であればカレンダー状態は変わらないため安全。
const GROUPED_EVENTS_MEMO_CACHE_ = {};
function getGroupedEventsForDateCached_(targetDate, customerData, staffData) {
    const key = Utilities.formatDate(targetDate, "Asia/Tokyo", "yyyy-MM-dd");
    if (GROUPED_EVENTS_MEMO_CACHE_.hasOwnProperty(key)) {
        return GROUPED_EVENTS_MEMO_CACHE_[key];
    }
    const calendarEvents = getCalendarEvents(targetDate, customerData);
    const groupedEvents = groupEventsByStaff(calendarEvents, staffData);
    GROUPED_EVENTS_MEMO_CACHE_[key] = groupedEvents;
    return groupedEvents;
}

function getCustomerDataFromCsv(folder) {
    const files = folder.getFiles();
    const targetFiles = [];

    while (files.hasNext()) {
        const file = files.next();
        const name = file.getName();
        if (name.startsWith("Kokyaku_") && name.endsWith(".csv")) {
            targetFiles.push(file);
        }
    }

    if (targetFiles.length === 0) {
        throw new Error("対象のCSVファイルが見つかりません。");
    }

    targetFiles.sort((a, b) => b.getLastUpdated() - a.getLastUpdated());
    const latestFile = targetFiles[0];
    console.log(`読み込み対象ファイル: ${latestFile.getName()} (更新日: ${latestFile.getLastUpdated()})`);

    const csvContent = latestFile.getBlob().getDataAsString("UTF-16");
    const values = Utilities.parseCsv(csvContent, '\t');

    if (values.length < 2) return [];

    const header = values.shift();
    const idx = getColumnIndices(header);

    return values.map(row => {
        const lastName = String(row[idx.lastName] || "");
        const firstName = String(row[idx.firstName] || "");

        let lat = row[idx.lat];
        let lng = row[idx.lng];

        const combinedLatLng = String(row[idx.lat_lng] || "");
        if (combinedLatLng && combinedLatLng.includes(",")) {
            const parts = combinedLatLng.split(",");
            lat = parseFloat(parts[0].trim());
            lng = parseFloat(parts[1].trim());
        }

        return {
            id: row[idx.customerId],
            name: `${lastName} ${firstName}`.trim(),
            address: row[idx.address],
            parkingarea: row[idx.parkingArea],
            lat: lat,
            lng: lng,
            address2: row[idx.address2],
            address2_start: row[idx.address2_start],
            address2_end: row[idx.address2_end],
        };
    }).filter(item => item.name); // 顧客ID未発行でも氏名があればカレンダー予定の名前マッチング対象にする
}

function getStaffDataFromSpreadsheet(spreadsheetId) {
    const ss = SpreadsheetApp.openById(spreadsheetId);
    const sheet = ss.getSheets()[0];

    const data = sheet.getDataRange().getValues();

    if (data.length < 2) throw new Error("スプレッドシートにデータが見つかりません。");

    const header = data.shift();
    const idx = getColumnIndices(header);

    return data.map((row, rowIndex) => {
        const lastName = String(row[idx.lastName] || "");
        const firstName = String(row[idx.firstName] || "");

        // 姓/名に [ID] 形式が無い場合、row[0] は一意性が保証されない
        // (別の行と値が重複するとグループ化時に予定が混線するリスクがある)ため、
        // シート内の行位置(常に一意)をフォールバックIDとして使う。
        // ※ このidはこの実行内のグループ化キーとしてのみ使われ、外部に保存・表示されることはない。
        const id = extractIdFromName(lastName) || extractIdFromName(firstName) || ('ROW_' + rowIndex);

        let lat = row[idx.lat];
        let lng = row[idx.lng];

        const combinedLatLng = String(row[idx.lat_lng] || "");
        if (combinedLatLng && combinedLatLng.includes(",")) {
            const parts = combinedLatLng.split(",");
            lat = parseFloat(parts[0].trim());
            lng = parseFloat(parts[1].trim());
        }

        return {
            id: id,
            name: `${lastName} ${firstName}`.trim() || row[idx.name] || row[1],
            address: row[idx.address],
            lat: lat,
            lng: lng,
            lwId: row[idx.lwId]
        };
    });
}

function getColumnIndices(header) {
    const find = (names) => header.findIndex(h => names.some(name => h.includes(name)));
    return {
        customerId: find(["顧客ID"]),
        lastName: find(["姓", "名字"]),
        firstName: find(["名", "名前"]),
        address: find(["住所"]),
        lat_lng: find(['緯度・経度', '緯度/経度', '緯度,経度']),
        lat: find(["緯度", "lat"]),
        lng: find(["経度", "lng"]),
        parkingArea: find(["駐車場"]),
        lwId: find(["LW_ID"]),
        name: find(["氏名", "スタッフ名"]),
        address2: find(['住所2', '住所2']),
        address2_start: find(['住所2[適用開始日YYYY/MM/DD]']),
        address2_end: find(['住所2[適用終了日YYYY/MM/DD]'])
    };
}

function extractIdFromName(str) {
    if (!str) return null;
    const match = str.match(/\[(.*?)\]/);
    return match ? match[1].trim() : null;
}

// ==========================================
// 勤怠集計シートへの反映(出勤簿カレンダー同期用)
// ==========================================
function normalizeSheetDateValue_(value) {
    if (value instanceof Date && !isNaN(value.getTime())) {
        return Utilities.formatDate(value, "Asia/Tokyo", "yyyy-MM-dd");
    }

    const raw = String(value || "").trim();
    if (!raw) {
        return "";
    }

    const normalizedText = raw.replace(/\./g, "/");
    const parsed = new Date(normalizedText.replace(/-/g, "/"));
    if (!isNaN(parsed.getTime())) {
        return Utilities.formatDate(parsed, "Asia/Tokyo", "yyyy-MM-dd");
    }

    return raw.replace(/\//g, "-");
}

function isTargetSheetDate_(value, dateStr) {
    return normalizeSheetDateValue_(value) === dateStr;
}

// 削除対象の行番号(1-based, 順不同)をまとめて削除する。連続する行はまとめて
// deleteRows し、1行ずつ deleteRow を呼ぶより実行するAPI呼び出し数を減らす。
function deleteSheetRowsBatched_(sheet, rowNumbers) {
    if (!rowNumbers || rowNumbers.length === 0) return;
    const sorted = rowNumbers.slice().sort((a, b) => b - a); // 降順(下から削除して行番号のズレを避ける)
    let i = 0;
    while (i < sorted.length) {
        let j = i;
        while (j + 1 < sorted.length && sorted[j] - sorted[j + 1] === 1) {
            j++;
        }
        sheet.deleteRows(sorted[j], j - i + 1);
        i = j + 1;
    }
}

function getOrCreateSpreadsheetInFolder(folderId, fileName) {
    const folder = DriveApp.getFolderById(folderId);
    const files = folder.getFilesByName(fileName);
    if (files.hasNext()) {
        return SpreadsheetApp.open(files.next());
    }

    const ss = SpreadsheetApp.create(fileName);
    const file = DriveApp.getFileById(ss.getId());
    folder.addFile(file);

    try {
        DriveApp.getRootFolder().removeFile(file);
    } catch (e) {
        console.warn("作成ファイルのマイドライブ除去をスキップしました: " + e.message);
    }

    return ss;
}

// 予定の所要時間(分)を計算する。「15分の顧客対応=事務作業」判定(isOfficeWorkAppointment)で使用。
function calcDurationMinForAttendance(startTime, endTime) {
    if (!startTime || !endTime) return null;

    const toMin = (value) => {
        const normalized = String(value).substring(0, 5);
        const parts = normalized.split(':');
        if (parts.length < 2) return null;
        const h = Number(parts[0]);
        const m = Number(parts[1]);
        if (isNaN(h) || isNaN(m)) return null;
        return h * 60 + m;
    };

    const s = toMin(startTime);
    const e = toMin(endTime);
    if (s === null || e === null) return null;

    if (e >= s) return e - s;
    return (24 * 60 - s) + e;
}

function isOfficeWorkAppointment(appointment) {
    if (appointment.eventType === 'OFFICE WORK') return true;

    if (appointment.eventType === 'CUSTOMER APPOINTMENT') {
        return calcDurationMinForAttendance(appointment.startTime, appointment.endTime) === 15;
    }

    return false;
}

// 数値0を「未入力」と誤判定しないための空値判定(0分/0kmを空欄化するバグの修正)。
function emptyOrValue_(value) {
    return (value === undefined || value === null || value === '') ? '' : value;
}

function buildTimesheetRowDataFromAppointments_(appointments) {
    const rowData = {
        C: '', D: '', E: '',
        H: '',
        L: '', M: '', N: '',
        Q: '',
        U: '', V: '', W: '',
        X: '', Y: '', Z: '',
        AA: '', AB: '', AC: '',
        AG: '', AH: '', AI: '', AJ: ''
    };

    const officeWorks = appointments.filter(isOfficeWorkAppointment);
    const visits = appointments.filter(app => !isOfficeWorkAppointment(app));

    if (visits[0]) {
        rowData.C = visits[0].customerName || '';
        rowData.D = visits[0].startTime || '';
        rowData.E = visits[0].endTime || '';
    }

    if (visits[1]) {
        rowData.L = visits[1].customerName || '';
        rowData.M = visits[1].startTime || '';
        rowData.N = visits[1].endTime || '';
        rowData.H = emptyOrValue_(visits[1].moveMin);
        rowData.AG = emptyOrValue_(visits[1].moveKm);
    }

    if (visits[2]) {
        rowData.U = visits[2].customerName || '';
        rowData.V = visits[2].startTime || '';
        rowData.W = visits[2].endTime || '';
        rowData.Q = emptyOrValue_(visits[2].moveMin);
        rowData.AH = emptyOrValue_(visits[2].moveKm);
    }

    // 出勤距離(AI)・退勤距離(AJ)は、位置情報のある最初/最後の予定(calculateDetailedRoutes側の
    // validLocApps[0]/[末尾])に付与される。それが必ずしも visits[0]/visits[末尾] とは限らないため
    // (先頭や末尾がオンライン相談等で位置情報を持たない場合)、値を持つ予定を探して読み取る。
    const withAttendance = visits.find(v => v.attendanceKm !== undefined && v.attendanceKm !== null && v.attendanceKm !== '');
    if (withAttendance) {
        rowData.AI = withAttendance.attendanceKm;
    }
    const withLeaving = visits.find(v => v.leavingKm !== undefined && v.leavingKm !== null && v.leavingKm !== '');
    if (withLeaving) {
        rowData.AJ = withLeaving.leavingKm;
    }

    if (officeWorks[0]) {
        rowData.X = officeWorks[0].customerName || '';
        rowData.Y = officeWorks[0].startTime || '';
        rowData.Z = officeWorks[0].endTime || '';
    }

    if (officeWorks[1]) {
        rowData.AA = officeWorks[1].customerName || '';
        rowData.AB = officeWorks[1].startTime || '';
        rowData.AC = officeWorks[1].endTime || '';
    }

    return rowData;
}

// カレンダーから、指定スタッフ・指定日の勤怠情報(訪問先/時刻/移動時間・距離等)を計算する。
// 書き込みは一切行わない純粋な計算のみ(computeCalendarSyncPlanForStaffOnDate_のプレビュー用途
// でも使うため、誤って「勤怠集計」シートに書き込んでしまわないよう、計算と書き込みを分離した)。
function computeAttendanceRowDataForStaffOnDate_(staffName, dateString) {
    const normalizedStaff = String(staffName || "").trim();
    if (!normalizedStaff) throw new Error("staffName が指定されていません。");

    const targetDate = new Date(String(dateString || "").replace(/-/g, "/"));
    if (isNaN(targetDate.getTime())) {
        throw new Error("dateString が不正です。YYYY-MM-DD 形式で指定してください。");
    }
    targetDate.setHours(0, 0, 0, 0);

    const y = targetDate.getFullYear();
    const m = ("0" + (targetDate.getMonth() + 1)).slice(-2);
    const d = ("0" + targetDate.getDate()).slice(-2);
    const dateStr = `${y}-${m}-${d}`;

    const customerData = getCustomerDataCached_();
    const staffData = getStaffDataCached_();
    const groupedEvents = getGroupedEventsForDateCached_(targetDate, customerData, staffData);

    const normalize = normalizeStaffName_;
    const staff = staffData.find(s => normalize(s.name) === normalize(normalizedStaff));

    let outputRows = [];
    if (staff && groupedEvents[staff.id]) {
        const singleGroup = {};
        singleGroup[staff.id] = groupedEvents[staff.id];
        outputRows = calculateDetailedRoutes(singleGroup, dateStr, targetDate);
    }

    const appointments = outputRows.map(row => ({
        eventType:     row[2],
        customerName:  row[3],
        startTime:     String(row[4] || ""),
        endTime:       String(row[5] || ""),
        reservaUrl:    row[6],
        moveUrl:       row[7],
        moveMin:       row[8],
        moveKm:        row[9],
        attendanceUrl: row[10],
        attendanceMin: row[11],
        attendanceKm:  row[12],
        leavingUrl:    row[13],
        leavingMin:    row[14],
        leavingKm:     row[15],
        customerId:    row[16]
    }));

    const rowData = buildTimesheetRowDataFromAppointments_(appointments);

    return {
        success: true,
        date: dateStr,
        staffName: normalizedStaff,
        appointments: appointments,
        rowData: rowData,
        outputRows: outputRows // writeAttendanceAggregateRows_専用。書き込み時に再計算しなくて済むよう保持する
    };
}

// computeAttendanceRowDataForStaffOnDate_ の計算結果(outputRows)を「勤怠集計」シートに
// 書き込む(該当スタッフ・該当日の既存行を削除してから再挿入する集約保存)。
function writeAttendanceAggregateRows_(staffName, dateStr, outputRows) {
    const normalize = normalizeStaffName_;
    const normalizedStaff = normalize(staffName);
    const sheetName = dateStr.slice(0, 4) + dateStr.slice(5, 7); // 'YYYY-MM-DD' -> 'YYYYMM'

    const ss = getOrCreateSpreadsheetInFolder(ROUTE_SEARCH_ATTENDANCE_FOLDER_ID, ROUTE_SEARCH_ATTENDANCE_FILE_NAME);
    let sheet = ss.getSheetByName(sheetName);
    const header = ATTENDANCE_SHEET_HEADER;
    if (!sheet) {
        sheet = ss.insertSheet(sheetName);
        sheet.appendRow(header);
    } else {
        const lastRow = sheet.getLastRow();
        if (lastRow >= 2) {
            const dateStaffVals = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
            const rowsToDelete = [];
            for (let i = 0; i < dateStaffVals.length; i++) {
                const rowStaff = normalize(String(dateStaffVals[i][1] || ""));
                if (rowStaff === normalizedStaff &&
                    isTargetSheetDate_(dateStaffVals[i][0], dateStr)) {
                    rowsToDelete.push(i + 2);
                }
            }
            deleteSheetRowsBatched_(sheet, rowsToDelete);
        }
    }

    if (outputRows.length > 0) {
        sheet.getRange(sheet.getLastRow() + 1, 1, outputRows.length, header.length).setValues(outputRows);
    }
}

// カレンダーから最新の勤怠情報を計算し、「勤怠集計」シートに書き込む(集約保存)。
// 個別の出勤簿への書き込みは行わない(呼び出し元がwritePastScheduleRowData_等で別途行う)。
// google.script.run経由で誰でも呼び出せてしまうため、他の書き込み系エンドポイントと同様に
// セッション検証・管理者限定チェックを行う(getScheduleAccessContext_はSchedule.jsで定義)。
function refreshAttendanceForStaffOnDate(token, staffName, dateString) {
    const context = getScheduleAccessContext_(token);
    if (!context) {
        logToBuffer('WARN', 'RefreshAttendanceAccessDenied', 'invalid-session', `無効なセッションでの勤怠集計書き込みを試みました(対象=${staffName}, 日付=${dateString})`);
        throw new Error('ログインセッションが無効です。再度ログインしてください。');
    }
    if (!context.isAdmin) {
        logToBuffer('WARN', 'RefreshAttendanceAccessDenied', context.selfStaffName, `管理者権限なしで勤怠集計の書き込みを試みました(対象=${staffName}, 日付=${dateString})`);
        throw new Error('この操作には管理者権限が必要です。');
    }

    const result = computeAttendanceRowDataForStaffOnDate_(staffName, dateString);
    writeAttendanceAggregateRows_(result.staffName, result.date, result.outputRows);
    logToBuffer('INFO', 'RefreshAttendanceForStaffOnDate', context.selfStaffName, `対象=${result.staffName}, 日付=${result.date}`);
    return {
        success: true,
        date: result.date,
        staffName: result.staffName,
        appointments: result.appointments,
        rowData: result.rowData
    };
}

function getScheduleForStaffOnDate(staffName, dateString) {
    const normalizedStaffName = String(staffName || "").trim();
    if (!normalizedStaffName) {
        throw new Error("staffName が指定されていません。");
    }

    const targetDate = new Date(String(dateString || "").replace(/-/g, "/"));
    if (isNaN(targetDate.getTime())) {
        throw new Error("dateString が不正です。YYYY-MM-DD 形式で指定してください。");
    }
    targetDate.setHours(0, 0, 0, 0);

    const customerData = getCustomerDataCached_();
    const staffData = getStaffDataCached_();
    const groupedEvents = getGroupedEventsForDateCached_(targetDate, customerData, staffData);

    const normalize = normalizeStaffName_;
    const staff = staffData.find(s => normalize(s.name) === normalize(normalizedStaffName));
    if (!staff) {
        return {
            success: true,
            date: Utilities.formatDate(targetDate, "Asia/Tokyo", "yyyy-MM-dd"),
            staffName: normalizedStaffName,
            appointments: []
        };
    }

    const group = groupedEvents[staff.id];
    const appointments = group ? group.appointments : [];

    return {
        success: true,
        date: Utilities.formatDate(targetDate, "Asia/Tokyo", "yyyy-MM-dd"),
        staffName: staff.name,
        appointments: appointments.map(app => ({
            title: app.customerInfo ? app.customerInfo.name : "",
            eventType: app.eventType,
            start: Utilities.formatDate(app.startTime, "Asia/Tokyo", "HH:mm"),
            end: Utilities.formatDate(app.endTime, "Asia/Tokyo", "HH:mm"),
            address: app.customerInfo ? (app.customerInfo.address || "") : ""
        }))
    };
}

/**
 * 指定スタッフ・指定日の予定に移動時間/ルートURLを付与して返す。
 * refreshAttendanceForStaffOnDate と同じ計算(calculateDetailedRoutes)を使うが、
 * 「勤怠集計」シートへの書き込みは行わない読み取り専用版。
 * 予定を表示するだけの用途(スケジュール閲覧アプリ等)から都度呼び出すことを想定。
 */
// ルート結果の共有キャッシュ(閲覧専用のgetScheduleWithRouteForStaffOnDateのみが対象)。
// 同じスタッフ・同じ日の予定を別のユーザー・別のブラウザから短時間に何度も見ても
// Maps APIを呼び直さないよう、計算結果をCacheService(全ユーザー共有・TTLで自動失効)に保存する。
// ブラウザ側のlocalStorageキャッシュ(index.html、有効期限2時間)と揃えて2時間にしている。
// 勤怠記録に書き込むrefreshAttendanceForStaffOnDateは、常に最新のカレンダー状態を反映する
// 必要があるため、このキャッシュは使わず毎回計算する。
const ROUTE_RESULT_CACHE_TTL_SEC = 7200; // 2時間

// 予定オブジェクトの形が変わった場合(フィールド追加等)、デプロイ直後は各ユーザーの
// 実行環境でこのCacheServiceに旧デプロイ時の結果(最大2時間)が残っていることがあり、
// 新フィールドが反映されない。形を変えるたびに接頭辞末尾のバージョンを上げて、
// 確実に再計算させる(2026-08-17: addressフィールド追加でV2に)。
function routeResultCacheKey_(staffName, dateStr) {
    const normalize = normalizeStaffName_;
    return 'RS_ROUTE_V2_' + normalize(staffName) + '_' + dateStr;
}

function getScheduleWithRouteForStaffOnDate(staffName, dateString, forceRefresh) {
    const normalizedStaff = String(staffName || "").trim();
    if (!normalizedStaff) throw new Error("staffName が指定されていません。");

    const targetDate = new Date(String(dateString || "").replace(/-/g, "/"));
    if (isNaN(targetDate.getTime())) {
        throw new Error("dateString が不正です。YYYY-MM-DD 形式で指定してください。");
    }
    targetDate.setHours(0, 0, 0, 0);

    const y = targetDate.getFullYear();
    const m = ("0" + (targetDate.getMonth() + 1)).slice(-2);
    const d = ("0" + targetDate.getDate()).slice(-2);
    const dateStr = `${y}-${m}-${d}`;

    const cache = CacheService.getScriptCache();
    const cacheKey = routeResultCacheKey_(normalizedStaff, dateStr);
    // forceRefresh=true(手動での「🔄 再取得」ボタン)の場合は、キャッシュが有効でも読み飛ばして
    // 必ず最新のカレンダー状態を計算する。計算結果は後段でキャッシュに書き直すため、
    // 以後の閲覧(自動取得・他ユーザー)には反映される。
    if (!forceRefresh) {
        const cachedResult = cache.get(cacheKey);
        if (cachedResult) {
            try {
                return JSON.parse(cachedResult);
            } catch (e) {
                // パース失敗時は再計算にフォールスルー
            }
        }
    }

    const customerData = getCustomerDataCached_();
    const staffData = getStaffDataCached_();
    const groupedEvents = getGroupedEventsForDateCached_(targetDate, customerData, staffData);

    const normalize = normalizeStaffName_;
    const staff = staffData.find(s => normalize(s.name) === normalize(normalizedStaff));

    let outputRows = [];
    let rawApps = []; // calculateDetailedRoutes()の戻り値(勤怠集計シートの列と1:1のrow配列)には
    // 住所を含めていない(refreshAttendanceForStaffOnDateの書き込み先シート列数と厳密に一致させる
    // 必要があるため、共通関数の出力に列を追加しない)。住所はここで元のappointments(同じ順序・
    // 件数)から別途引き当てて、閲覧専用のこの関数でだけ付与する。
    if (staff && groupedEvents[staff.id]) {
        const singleGroup = {};
        singleGroup[staff.id] = groupedEvents[staff.id];
        outputRows = calculateDetailedRoutes(singleGroup, dateStr, targetDate);
        rawApps = groupedEvents[staff.id].appointments || [];
    }

    const appointments = outputRows.map((row, i) => ({
        eventType: row[2],
        customerName: row[3],
        startTime: String(row[4] || ""),
        endTime: String(row[5] || ""),
        reservaUrl: row[6],
        moveUrl: row[7],
        moveMin: row[8],
        moveKm: row[9],
        attendanceUrl: row[10],
        attendanceMin: row[11],
        attendanceKm: row[12],
        leavingUrl: row[13],
        leavingMin: row[14],
        leavingKm: row[15],
        customerId: row[16],
        address: (rawApps[i] && rawApps[i].customerInfo) ? (rawApps[i].customerInfo.address || "") : ""
    }));

    const result = {
        success: true,
        date: dateStr,
        staffName: normalizedStaff,
        appointments: appointments
    };

    try {
        cache.put(cacheKey, JSON.stringify(result), ROUTE_RESULT_CACHE_TTL_SEC);
    } catch (e) {
        console.warn('ルート結果のキャッシュ保存に失敗しました(サイズ超過等、処理は継続): ' + e.message);
    }

    return result;
}
