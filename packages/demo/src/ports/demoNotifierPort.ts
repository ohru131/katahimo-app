import type { NotificationChannel, NotifierPort } from '@katahimo/core/ports';

export interface DemoNotification {
  channel: NotificationChannel;
  text: string;
  at: Date;
}

/**
 * NotifierPortのデモ実装。本番はGoogle ChatのIncoming Webhookへ投げるが、デモでは
 * 送信先が無いので画面内に出す。「送ったつもりで何も起きない」より、
 * 実際に飛ぶはずだった文面を見せたほうがデモとして価値がある。
 */
export class DemoNotifierPort implements NotifierPort {
  private readonly listeners = new Set<(notification: DemoNotification) => void>();
  readonly history: DemoNotification[] = [];

  async notify(_tenantId: string, channel: NotificationChannel, text: string): Promise<void> {
    const notification: DemoNotification = { channel, text, at: new Date() };
    this.history.push(notification);
    for (const listener of this.listeners) listener(notification);
  }

  /** 画面側で通知トーストを出すための購読。戻り値を呼ぶと解除。 */
  subscribe(listener: (notification: DemoNotification) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
