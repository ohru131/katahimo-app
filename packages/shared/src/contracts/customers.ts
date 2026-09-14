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

/**
 * 世帯構成員のアレルギーの確認状態。
 *
 * 【「なし」と「未確認」を分ける理由】
 * GAS版は家族DBに「アレルギー情報」列を1つ持ち、空欄の構成員を画面に「アレルギー: なし」と
 * 表示していた。未記入なのか、確認したうえで無かったのかが区別できず、
 * 「まだ聞いていない」を「無い」と読み違える形になっている。アレルギーは取り違えると
 * 命に関わるため、確認できていない状態を 'unknown' として別に持つ。
 *
 * - 'unknown' : 未確認(既定)。画面には「未確認」と出し、「なし」とは言わない
 * - 'none'    : 確認したうえで無し
 * - 'present' : あり。内容(allergyNote)が必ず入る
 */
export const familyAllergyStatusSchema = z.enum(['unknown', 'none', 'present']);
export const FAMILY_ALLERGY_STATUSES = familyAllergyStatusSchema.options;
export type FamilyAllergyStatus = z.infer<typeof familyAllergyStatusSchema>;

/** 画面表示用の日本語名。DBには入れない(表示の都合でDBを書き換えることになるため)。 */
export const FAMILY_ALLERGY_STATUS_LABELS: Record<FamilyAllergyStatus, string> = {
  unknown: '未確認',
  none: 'なし',
  present: 'あり',
};

/**
 * 世帯構成員のアレルギーの更新リクエスト。
 *
 * 顧客本体と同じ理由(CSV取込が正なので画面から直すと次の取込で消える)で、
 * 世帯構成員も氏名・生年月日は画面から編集できない。アレルギーだけはCSVに元となる列が無く、
 * 現場で聞き取って入れる情報なので、ここから入れられるようにする。
 * 取込で消えないようにする仕組みは packages/core/src/usecases/customers.ts の
 * buildFamilyMemberInputs(既存行からの引き継ぎ)にある。
 */
export const familyMemberAllergyUpdateRequestSchema = z
  .object({
    status: familyAllergyStatusSchema,
    /** アレルギーの内容(品目・症状・対応)。status='present' のときは必須。 */
    note: z.string().trim(),
  })
  .refine((v) => v.status !== 'present' || v.note.length > 0, {
    message: 'アレルギーありのときは内容を入力してください',
    path: ['note'],
  });
export type FamilyMemberAllergyUpdateRequest = z.infer<typeof familyMemberAllergyUpdateRequestSchema>;
