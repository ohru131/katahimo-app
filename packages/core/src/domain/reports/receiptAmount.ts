import { normalizeAmount, normalizeText } from './receiptDedupe';

/**
 * 領収書の金額(集計用整数amountYen + OCRの生文字列amountRaw)。
 * doc/14 §1の変換規則。normalizeAmount()(dedupeKeyの材料と同じ正規化)を経由して数値化するが、
 * この結果をdedupeKeyの材料に使い替えることはしない(dedupeKeyは従来どおり正規化済み文字列から作る)。
 */
export interface ReceiptAmount {
  /** 集計・請求用の整数(円)。数値化できなければnull。 */
  amountYen: number | null;
  /** OCRが返した金額の生文字列。人が後から直すときの参照用。未入力ならnull。 */
  amountRaw: string | null;
}

/**
 * "1,000" → amountYen=1000、"1000円" → amountYen=null(数値化できないためamountRawだけ残す)、
 * 小数は四捨五入してamountYenに入れる(円未満の端数は業務上発生しない想定だが、OCRの誤読で
 * 発生しうるため落とさない。元の表記はamountRawに残る)。空文字・null・undefinedは両方null。
 */
export function computeReceiptAmount(amount: string | number | null | undefined): ReceiptAmount {
  if (amount === undefined || amount === null || amount === '') {
    return { amountYen: null, amountRaw: null };
  }
  // 空白だけの文字列("   "など)は未入力として扱う。normalizeAmount()は空文字ではなく
  // Number('')===0由来の"0"を返してしまうため、ここで先に弾かないとamountYenが0になり、
  // 「0円の領収書」と「金額未入力」が区別できなくなる(dedupeKeyの材料であるnormalizeAmount
  // 自体はGAS版と一致させる必要があるため変更しない。ここはamountYen算出側だけの対処)。
  if (typeof amount === 'string' && amount.trim() === '') {
    return { amountYen: null, amountRaw: null };
  }
  const normalized = normalizeAmount(amount);
  const n = Number(normalized);
  const amountYen = Number.isFinite(n) ? Math.round(n) : null;
  const amountRaw = normalizeText(String(amount)) || null;
  return { amountYen, amountRaw };
}
