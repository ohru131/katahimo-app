const JST_OFFSET_MINUTES = 9 * 60;

/**
 * 'YYYY-MM-DD'の日付と'HH:mm'の時刻(JST・24時間表記)を、対応する絶対時刻(UTC基準のDate)に変換する。
 * GAS版saveReportの `new Date(`${datePart} ${timePart}`)` はサーバーのローカルタイムゾーンで解釈されるため
 * 環境依存だったが、こちらはJSTの壁時計時刻であることを明示して変換する。
 */
export function parseJstDateTime(dateStr: string, timeStr: string | undefined): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, minute] = (timeStr || '00:00').split(':').map(Number);
  const utcMs =
    Date.UTC(year || 1970, (month || 1) - 1, day || 1, hour || 0, minute || 0) - JST_OFFSET_MINUTES * 60_000;
  return new Date(utcMs);
}

/** Date を GAS版 Utilities.formatDate(d, "Asia/Tokyo", "yyyy/MM/dd HH:mm:ss") と同じ書式の文字列にする。 */
export function formatJstDateTime(date: Date): string {
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}/${get('month')}/${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

/** GAS版getCustomerReportsのfmt()と同じ 'yyyy/MM/dd HH:mm' 書式。 */
export function formatJstDateTimeShort(date: Date): string {
  return formatJstDateTime(date).slice(0, -3);
}

export function formatJstDateOnly(date: Date): string {
  return formatJstDateTime(date).split(' ')[0] ?? '';
}

/**
 * 'YYYY-MM-DD'(JST)。parseJstDateTimeが受け付ける区切り("-")に合わせた日付キー。
 * Web側のformatDateKey(toLocaleDateString('sv-SE'))と同じ基準日をバックエンドでも
 * 作れるようにする(doc/14 §6。reportDate省略時のフォールバック等に使う)。
 */
export function formatJstDateKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * 'HH:mm'(JST)。daily_reports.started_at/ended_at(timestamptz)を、GAS側スプレッドシートの
 * "HH:mm"表記へ戻すためのミラー送信専用フォーマッタ(doc/14 §6。保存時は"HH:mm"へ整形し直さない)。
 * 未入力(null)の場合は呼び出し側で空文字にフォールバックすること。
 */
export function formatJstTimeOnly(date: Date): string {
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('hour')}:${get('minute')}`;
}

/**
 * 'YYYY-MM'(JST)の月を、絶対時刻の半開区間 [from, to) に変換する。
 *
 * 上限を含めないのは、月末の23:59:59.999のような端の値を「その月に入れるか」で悩まずに済み、
 * 月を並べたときに重複も隙間も出ないため。JSTは夏時間が無く常にUTC+9なので、
 * 壁時計の月初からオフセットを引くだけで境界が決まる。
 *
 * 形式が想定外の場合はnullを返す(呼び出し側が400で弾く)。
 */
export function jstMonthRange(yearMonth: string): { from: Date; to: Date } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(yearMonth.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  const offsetMs = JST_OFFSET_MINUTES * 60_000;
  return {
    from: new Date(Date.UTC(year, month - 1, 1) - offsetMs),
    // Date.UTCは月が12を超えると翌年に繰り上がるため、12月でも分岐は要らない。
    to: new Date(Date.UTC(year, month, 1) - offsetMs),
  };
}

/**
 * 'yyyy/MM/dd HH:mm[:ss]' 形式(JST壁時計時刻)の文字列をDateに変換する。
 * 領収書日時(OCR抽出値・保存時刻フォールバック)のパース専用。形式が想定外の場合は
 * 現在時刻にフォールバックする(領収書登録そのものを失敗させないため)。
 */
export function parseJstTimestampString(value: string): Date {
  const match = /^(\d{4})\/(\d{2})\/(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) return new Date();
  const [, year, month, day, hour, minute, second] = match;
  const utcMs =
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second || '0'),
    ) -
    JST_OFFSET_MINUTES * 60_000;
  return new Date(utcMs);
}
