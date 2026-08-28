/**
 * ブラインドインデックス計算前の正規化。
 * 同じ人物・同じ値が表記ゆれ(全角/半角・大文字小文字・空白の入り方)で別のインデックス値に
 * なってしまうと、ブラインドインデックスによる等値検索がヒットしなくなる。
 * 正規化はここに集約し、実データの暗号化(CryptoPort)には一切関与しない
 * (正規化した値はインデックス計算にのみ使い、保存する実値は元の表記のまま暗号化する)。
 */

/** メールアドレス。大文字小文字を無視して同一人物とみなす(RFC上は大文字小文字区別だが実運用上は無視するのが一般的)。 */
export function normalizeEmailForIndex(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase();
}

/** 電話番号。全角数字・ハイフン・空白を無視し、半角数字だけの列に揃える。 */
export function normalizePhoneForIndex(value: string): string {
  return value.normalize('NFKC').replace(/[^0-9]/g, '');
}

/** 市区町村など低カーディナリティな住所コンポーネント。前後の空白のみ除去する。 */
export function normalizeAddressComponentForIndex(value: string): string {
  return value.normalize('NFKC').trim();
}
