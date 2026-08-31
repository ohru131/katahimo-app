// ==========================================
// katahimo-app(新Webアプリ、Node.jsサーバー)からのMaps API連携用ブリッジ。
//
// GASのMapsサービス(Maps.newGeocoder()/newDirectionFinder())はAPIキー不要・無料で使えるが、
// Apps Script実行環境の中でしか呼び出せない(外部サーバーから直接叩けるHTTP APIではない)。
// 一方、katahimo-appはGoogle Maps Platform(有料・要APIキー・要課金設定)へ切り替える案も
// あったが、このWeb Appデプロイ自体が既にMapsサービスを無料で使えているため、
// これを軽量なJSON APIプロキシとして使い、Maps Platformの新規契約を避ける。
//
// 認証はBRIDGE_API_SECRET(Script Properties、Apps Scriptエディタの「プロジェクトの設定」→
// 「スクリプト プロパティ」で手動設定する)による共有シークレット方式。
// このWeb Appは access: ANYONE_ANONYMOUS のため、doGet全体を保護するのではなく、
// ブリッジ用アクション(?api=1)のリクエストごとにシークレットを検証する。
// ==========================================

function verifyBridgeSecret_(secret) {
  const expected = PropertiesService.getScriptProperties().getProperty('BRIDGE_API_SECRET');
  return !!expected && String(secret || '') === expected;
}

function bridgeJsonResponse_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

/** GAS版RouteSearch.js getLatLngFromAddress()と同じロジック(実行内メモ化は無し、単発呼び出しのため)。 */
function bridgeGeocode_(address) {
  const key = String(address || '').trim();
  if (!key) return { success: true, location: null };
  try {
    const response = Maps.newGeocoder().geocode(key);
    if (response.status === 'OK' && response.results && response.results.length > 0) {
      const loc = response.results[0].geometry.location;
      return { success: true, location: { lat: loc.lat, lng: loc.lng } };
    }
    return { success: true, location: null };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

/**
 * GAS版RouteSearch.js getRouteDetails()と同じロジック(自動車移動・出発時刻指定無し)。
 * 距離はGAS版と同じ小数点2桁(km)、時間は分単位の整数に丸める。
 */
function bridgeRoute_(originLat, originLng, destLat, destLng) {
  const oLat = Number(originLat);
  const oLng = Number(originLng);
  const dLat = Number(destLat);
  const dLng = Number(destLng);
  if (!oLat || !oLng || !dLat || !dLng) {
    return { success: true, route: null };
  }
  try {
    const directions = Maps.newDirectionFinder()
      .setOrigin(oLat, oLng)
      .setDestination(dLat, dLng)
      .setMode(Maps.DirectionFinder.Mode.DRIVING)
      .getDirections();

    if (directions.routes && directions.routes.length > 0) {
      const leg = directions.routes[0].legs[0];
      return {
        success: true,
        route: {
          durationMin: Math.round(leg.duration.value / 60),
          distanceKm: Number((leg.distance.value / 1000).toFixed(2)),
        },
      };
    }
    return { success: true, route: null };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

/**
 * GAS版RouteSearch.js getScheduleForStaffOnDate()をそのまま呼ぶ(ルート・移動時間を含まない
 * 軽量版)。katahimo-app側で対象スタッフ名の解決(管理者以外は本人名に強制)を既に済ませた
 * staffNameを渡してもらう前提のため、GAS版Schedule.jsのようなセッション検証はここでは行わない
 * (katahimo-app側のセッション/権限チェックに委ねる)。
 */
function bridgeSchedule_(staffName, dateString) {
  try {
    return getScheduleForStaffOnDate(staffName, dateString);
  } catch (e) {
    return { success: false, message: e.message, appointments: [] };
  }
}

/** GAS版RouteSearch.js getScheduleWithRouteForStaffOnDate()をそのまま呼ぶ(ルート・移動時間つき)。 */
function bridgeScheduleWithRoute_(staffName, dateString, forceRefresh) {
  try {
    return getScheduleWithRouteForStaffOnDate(staffName, dateString, !!forceRefresh);
  } catch (e) {
    return { success: false, message: e.message, appointments: [] };
  }
}

/**
 * JSON API用のリクエストハンドラ。doGet(e)から e.parameter.api === '1' の場合に呼ばれる
 * (通常のdoGet呼び出し、すなわちWeb AppのHTML本体表示とは完全に分離している)。
 */
function handleBridgeRequest_(e) {
  const params = (e && e.parameter) || {};

  if (!verifyBridgeSecret_(params.secret)) {
    return bridgeJsonResponse_({ success: false, message: '認証エラー' });
  }

  switch (params.action) {
    case 'geocode':
      return bridgeJsonResponse_(bridgeGeocode_(params.address));
    case 'route':
      return bridgeJsonResponse_(
        bridgeRoute_(params.originLat, params.originLng, params.destLat, params.destLng),
      );
    case 'schedule':
      return bridgeJsonResponse_(bridgeSchedule_(params.staffName, params.date));
    case 'scheduleWithRoute':
      return bridgeJsonResponse_(
        bridgeScheduleWithRoute_(params.staffName, params.date, params.forceRefresh === '1'),
      );
    default:
      return bridgeJsonResponse_({ success: false, message: '不明なactionです: ' + params.action });
  }
}

// ==========================================
// katahimo-app(新Webアプリ)側のPostgreSQL書き込みを、outboxワーカー(packages/worker)
// 経由でGAS版のスプレッドシート/Driveへミラーする書き込みaction群(Phase 5)。
//
// 読み取り側(geocode/route/schedule/scheduleWithRoute)と異なりPOSTで受ける。
// 領収書画像のbase64データ・日報等の自由記述テキストはURLクエリに載せるには不向きなため。
// secret/actionはGET側と同じくURLクエリに載せ(?api=1&action=writeXxx&secret=...)、
// 本文(JSON)にペイロードを乗せる(packages/integrations/gasBridgeClient.tsのpostJson参照)。
//
// 「日報」「事故報告」シートは、katahimo-app側のレポートID(reportId)を最終列に追記した
// KatahimoReportId列で追跡し、同じreportIdの再送(編集保存)は該当行を上書きする
// (無ければ末尾に追記する)。GAS版自身のrowIndex方式(1ブラウザセッション内でしか使えない)
// とは別に、outboxからの再送でも正しい行を上書きできるようにするための仕組み。
// ==========================================

/** シート内の指定列(1始まり)からkatahimoIdに一致する行番号を探す。無ければ-1。 */
function bridgeFindRowByKatahimoId_(sheet, katahimoIdColumn, katahimoId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  const ids = sheet.getRange(2, katahimoIdColumn, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(katahimoId)) return i + 2;
  }
  return -1;
}

/** GAS版Main.js saveReportと同じ「日報」シートに、KatahimoReportId列(最終列)を追加した形で書き込む。 */
function bridgeWriteDailyReport_(payload) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return { success: false, message: 'サーバーが混み合っています。しばらくしてから再試行してください。' };
  }
  try {
    const ss = getSpreadsheet();
    let sheet = ss.getSheetByName(REPORT_SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(REPORT_SHEET_NAME);
      sheet.appendRow([
        'Timestamp', 'StartTime', 'EndTime', 'User', 'CustomerId', 'CustomerName',
        'InputText', 'InternalReport', 'CustomerReport', 'RiskRating', 'EsRating',
        'KatahimoReportId',
      ]);
    }
    const katahimoIdColumn = 12;
    const rowValues = [
      payload.timestampJst || '',
      payload.startTime || '',
      payload.endTime || '',
      payload.staffName || '',
      payload.customerId || '',
      payload.customerName || '',
      payload.inputText || '',
      payload.internalText || '',
      payload.customerText || '',
      payload.riskRating != null ? payload.riskRating : '',
      payload.esRating != null ? payload.esRating : '',
      payload.reportId || '',
    ];
    const existingRow = bridgeFindRowByKatahimoId_(sheet, katahimoIdColumn, payload.reportId);
    if (existingRow > 0) {
      sheet.getRange(existingRow, 1, 1, rowValues.length).setValues([rowValues]);
    } else {
      sheet.appendRow(rowValues);
    }
    return { success: true };
  } catch (e) {
    return { success: false, message: e.message };
  } finally {
    lock.releaseLock();
  }
}

/** GAS版Main.js saveAccidentReportと同じ「事故報告」シートに、KatahimoReportId列を追加した形で書き込む。 */
function bridgeWriteAccidentReport_(payload) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return { success: false, message: 'サーバーが混み合っています。しばらくしてから再試行してください。' };
  }
  try {
    const ss = getSpreadsheet();
    let sheet = ss.getSheetByName(ACCIDENT_SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(ACCIDENT_SHEET_NAME);
      sheet.appendRow([
        'Timestamp', 'Reporter', 'CustomerId', 'CustomerName',
        'OccurrenceTime', 'Location', 'AccidentContent',
        'Situation', 'ImmediateResponse', 'ParentCorrespondence',
        'DiagnosisTreatment', 'Prevention', 'OriginalInput', 'ReportType',
        'KatahimoReportId',
      ]);
    }
    const katahimoIdColumn = 15;
    const rowValues = [
      payload.timestampJst || '',
      payload.staffName || '',
      payload.customerId || '',
      payload.customerName || '',
      payload.occurrenceTime || '',
      payload.location || '',
      payload.accidentContent || '',
      payload.situation || '',
      payload.immediateResponse || '',
      payload.parentCorrespondence || '',
      payload.diagnosisTreatment || '',
      payload.prevention || '',
      payload.inputText || '',
      payload.reportType || '事故報告',
      payload.reportId || '',
    ];
    const existingRow = bridgeFindRowByKatahimoId_(sheet, katahimoIdColumn, payload.reportId);
    if (existingRow > 0) {
      sheet.getRange(existingRow, 1, 1, rowValues.length).setValues([rowValues]);
    } else {
      sheet.appendRow(rowValues);
    }
    return { success: true };
  } catch (e) {
    return { success: false, message: e.message };
  } finally {
    lock.releaseLock();
  }
}

/**
 * GAS版Main.js processReceiptImagesをそのまま1枚分呼ぶ(領収書ログシート+Driveアップロード+
 * 重複判定は全てGAS版と同じロジックに委ねる。outboxからの再送も同じ内容なら重複判定でスキップされる)。
 */
function bridgeWriteReceipt_(payload) {
  try {
    const result = processReceiptImages(
      [{ data: payload.imageDataUrl, amount: payload.amount || '', storeName: payload.storeName || '' }],
      payload.staffName || '',
      payload.customerId || '',
      payload.customerName || '',
      payload.receiptTimestampJst || '',
      payload.handoffText || '',
    );
    return { success: true, uploadedCount: result.uploadedCount, duplicateCount: result.duplicates.length };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

/**
 * PastSchedule.js updatePastScheduleと同じ書き込み先(個別出勤簿スプレッドシート)を
 * 直接上書きする。katahimo-app側のDBが既に正なので、GAS版の月ロック制限
 * (当月より前は修正不可)や手動編集のセル背景色ハイライトは適用しない
 * (自動ミラーであり、手入力の修正跡を示す必要が無いため)。
 */
function bridgeWriteAttendanceDay_(payload) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return { success: false, message: 'サーバーが混み合っています。しばらくしてから再試行してください。' };
  }
  try {
    const staffName = payload.staffName || '';
    const dateString = payload.businessDate;
    if (!staffName || !dateString) {
      return { success: false, message: 'staffName/businessDateが必要です。' };
    }
    const year = getFiscalYearForDate_(dateString);
    const spreadsheet = findPastScheduleSpreadsheet_(staffName, year);
    const target = findPastScheduleTargetRow_(spreadsheet, dateString);
    if (target.rowNumber === -1) {
      return { success: false, message: '指定日(' + dateString + ')の記録が出勤簿に見つかりません。' };
    }
    const values = payload.values || {};
    for (const colChar in PAST_SCHEDULE_INPUT_COLUMNS) {
      if (!(colChar in values)) continue;
      const colNum = pastScheduleColumnToNumber_(colChar);
      target.sheet.getRange(target.rowNumber, colNum).setValue(values[colChar]);
    }
    return { success: true };
  } catch (e) {
    return { success: false, message: e.message };
  } finally {
    lock.releaseLock();
  }
}

/**
 * ミラー書き込み用のリクエストハンドラ。doPost(e)から呼ばれる
 * (画像base64・自由記述テキストを本文JSONで受け取るため、読み取り側のGETとは分ける)。
 */
function handleBridgeWriteRequest_(e) {
  const params = (e && e.parameter) || {};

  if (!verifyBridgeSecret_(params.secret)) {
    return bridgeJsonResponse_({ success: false, message: '認証エラー' });
  }

  let payload;
  try {
    payload = JSON.parse((e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return bridgeJsonResponse_({ success: false, message: 'リクエストボディがJSONとして不正です' });
  }

  switch (params.action) {
    case 'writeDailyReport':
      return bridgeJsonResponse_(bridgeWriteDailyReport_(payload));
    case 'writeAccidentReport':
      return bridgeJsonResponse_(bridgeWriteAccidentReport_(payload));
    case 'writeReceipt':
      return bridgeJsonResponse_(bridgeWriteReceipt_(payload));
    case 'writeAttendanceDay':
      return bridgeJsonResponse_(bridgeWriteAttendanceDay_(payload));
    default:
      return bridgeJsonResponse_({ success: false, message: '不明なactionです: ' + params.action });
  }
}

/**
 * Web Appのdoポスト エントリポイント。katahimo-appのミラー書き込み(?api=1)以外のPOSTは
 * このアプリでは想定していないため、doGet同様?api=1判定だけ行う。
 */
function doPost(e) {
  const params = (e && e.parameter) || {};
  if (params.api === '1') {
    return handleBridgeWriteRequest_(e);
  }
  return bridgeJsonResponse_({ success: false, message: '不明なリクエストです' });
}
