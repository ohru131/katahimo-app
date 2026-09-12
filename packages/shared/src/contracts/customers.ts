import { z } from 'zod';

/**
 * 顧客の更新リクエスト。今のところ生年月日だけを受け付ける。
 *
 * 【顧客の他の項目を編集できるようにしない理由】
 * 顧客マスタ(氏名・住所・連絡先・会員情報)はRESERVA CSVの取込が正で、
 * `packages/ingestion` が再取込のたびに上書きする。画面から直せるようにすると、
 * 直した内容が次の取込で静かに消える(直した人にはそれが分からない)。
 * 生年月日だけはCSVに列が無く取込が触らないため、ここから入れられるようにしてある
 * (usecases/customers.ts の buildCustomerRecordFields のコメント参照)。
 *
 * 空文字は「消す」を意味する(dobRaw/dobDateをnullに戻す)。
 */
export const customerUpdateRequestSchema = z.object({
  /** 生年月日。'YYYY/M/D' 等の自由記述でよい(日付型への分解はusecase側が行う)。 */
  dob: z.string().trim(),
});
export type CustomerUpdateRequest = z.infer<typeof customerUpdateRequestSchema>;
