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
 * 例外にはせず、メールを送っていないことをサーバーログに出す。パスワード再設定は
 * 「メールが届かない」以外の壊れ方をしないほうが運用しやすい。
 *
 * 本文をログに出すのは開発環境だけにする。本文には再設定コードと初期パスワードが
 * 含まれており、ブリッジの設定漏れひとつで認証情報がログに溜まり続ける状態になるため
 * (本番でこの実装が選ばれているのは設定漏れだが、そのときの被害を最小にしておく)。
 * 開発環境では、ここに出た本文からコードを拾って動作確認できる。
 */
export class LoggingMailerPort implements MailerPort {
  /** 本文までログに出すか。呼び出し側(nodeContainer)が検証済みのNODE_ENVから渡す。 */
  constructor(private readonly logBody: boolean) {}

  async send(message: MailMessage): Promise<void> {
    const detail = this.logBody ? `\n${message.body}` : ' (本文は開発環境でのみログに出します)';
    console.warn(
      `[mailer] GASブリッジが未設定のためメールを送信していません。subject=${message.subject}${detail}`,
    );
  }
}
