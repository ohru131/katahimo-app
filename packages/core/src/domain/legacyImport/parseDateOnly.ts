/**
 * normalizeDateStr()の出力("YYYY/M/D"。和暦・元号略記は既に西暦へ変換済み)や、
 * "YYYY-MM-DD"(ISO。デモ投入データ等)を受け取り、年月日が全て揃った実在する暦日であれば
 * "YYYY-MM-DD"(dateカラムにそのまま渡せる形)を返す。
 *
 * doc/14 F項: 生年月日を日付型にする。normalizeDateStrは区切り文字を統一するだけで、
 * "1990.1"のような不完全な表記(日が無い)を補完はしない。そのため出力にも"1990/1"のような
 * 不完全な文字列が残りうる。ここで1月1日等を勝手に補うと、実際には分からない情報を
 * 「分かっている」ことにしてしまうため、年月日が3つとも揃っていない場合はnullを返す
 * (呼び出し側はdob_date/target_dob_dateに入れず、dob_raw/target_dob_rawにだけ元の文字列を残す)。
 *
 * "1990/13/45"のような範囲外の値も、Dateへの変換だけでは検出できない(JavaScriptのDateは
 * 月13・日45を「繰り上げ」て解釈してしまう。例: new Date(2021,1,30)は3/2になる)ため、
 * 変換結果を年月日それぞれ突き合わせて実在する日付かどうかを確認する。
 */
export function parseDateOnly(value: string): string | null {
  const trimmed = value.trim();
  const match = /^(\d{1,4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(trimmed);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const date = new Date(Date.UTC(year, month - 1, day));
  const isRealCalendarDate =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  if (!isRealCalendarDate) return null;

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
