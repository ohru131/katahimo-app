import type { MailerPort, MailMessage } from '@katahimo/core/ports';

export interface DemoMail extends MailMessage {
  at: Date;
}

/**
 * MailerPortのデモ実装。
 *
 * デモの宛先は `@demo.example.com` の架空アドレスなので、本当に送っても誰にも届かず、
 * パスワード再設定を最後まで試せない。そこで送信内容を画面に出し、届いたメールを
 * 読むのと同じように認証コードや初期パスワードを拾えるようにする
 * (通知トースト(DemoNotifierPort)と同じ考え方)。
 */
export class DemoMailerPort implements MailerPort {
  private readonly listeners = new Set<(mail: DemoMail) => void>();
  readonly history: DemoMail[] = [];

  async send(message: MailMessage): Promise<void> {
    const mail: DemoMail = { ...message, at: new Date() };
    this.history.push(mail);
    for (const listener of this.listeners) listener(mail);
  }

  /** 画面に「受信箱」を出すための購読。戻り値を呼ぶと解除。 */
  subscribe(listener: (mail: DemoMail) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
