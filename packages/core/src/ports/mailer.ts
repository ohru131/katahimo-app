/**
 * メール送信のポート。GAS版 Auth.js が `MailApp.sendEmail` で送っていた
 * パスワード再設定コード・初期パスワードの通知に対応する。
 *
 * 送信先はスタッフ本人のメールアドレスのみで、宛先を呼び出し側が自由に指定できる
 * 汎用メール送信基盤にはしない(踏み台にされないよう、usecase側で宛先を
 * スタッフ台帳から引いた値に限定している)。
 */
export interface MailMessage {
  to: string;
  subject: string;
  /** プレーンテキスト本文。HTMLメールは必要になるまで持たない。 */
  body: string;
}

export interface MailerPort {
  send(message: MailMessage): Promise<void>;
}
