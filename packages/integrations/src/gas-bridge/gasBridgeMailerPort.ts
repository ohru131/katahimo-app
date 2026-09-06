import type { MailerPort, MailMessage } from '@katahimo/core/ports';
import type { GasBridgeOptions } from './gasBridgeClient';
import { GasBridgeClient } from './gasBridgeClient';

/**
 * メール送信をGAS版Web App(Bridge.js)経由で行う実装。
 *
 * doc/10「新規GCP APIより既存GASブリッジを優先」の方針どおり、SendGrid等の新規契約や
 * SMTPアカウントの用意をせず、GAS版が既に使っている `MailApp.sendEmail`
 * (Google Workspaceの無料枠)をそのまま使う。送信元アドレスもGAS版のときと変わらない。
 *
 * 宛先・件名・本文はURLクエリに載せるには長くなりうるのでPOST本体で送る。
 */
export class GasBridgeMailerPort implements MailerPort {
  private readonly client: GasBridgeClient;

  constructor(options: GasBridgeOptions) {
    this.client = new GasBridgeClient(options);
  }

  async send(message: MailMessage): Promise<void> {
    const body = await this.client.postJson<{ success: boolean; message?: string }>('sendEmail', message);
    if (!body.success) throw new Error(body.message || 'メール送信に失敗しました(GASブリッジ)');
  }
}

/**
 * GAS_BRIDGE_URL/GAS_BRIDGE_SECRET未設定時のフォールバック。
 *
 * 例外にはせず、送るはずだった内容をサーバーログに出す。パスワード再設定は
 * 「メールが届かない」以外の壊れ方をしないほうが運用しやすく、ブリッジ未設定の
 * 開発環境でも再設定コードをログから拾って動作確認できる。
 * 本文には再設定コードや初期パスワードが含まれるため、本番でこの実装が
 * 使われている状態は設定漏れとして扱うこと。
 */
export class LoggingMailerPort implements MailerPort {
  async send(message: MailMessage): Promise<void> {
    console.warn(
      `[mailer] GASブリッジが未設定のためメールを送信していません。to=${message.to} subject=${message.subject}\n${message.body}`,
    );
  }
}
