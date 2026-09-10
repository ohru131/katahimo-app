import type {
  AccidentReportMirrorPayload,
  AttendanceAggregateMirrorPayload,
  AttendanceDayMirrorPayload,
  DailyReportMirrorPayload,
  MirrorSenderPort,
  ReceiptMirrorPayload,
} from '@katahimo/core/ports';
import type { GasBridgeOptions } from './gasBridgeClient';
import { GasBridgeClient } from './gasBridgeClient';

interface BridgeWriteResult {
  success: boolean;
  message?: string;
}

/**
 * outboxから取り出したミラージョブを、GAS版(gas-childcare-visit-app)のWeb Appデプロイ(Bridge.js)
 * 経由でGoogleスプレッドシート/Driveへ書き込む。読み取り側(GasBridgeSchedulePort/
 * GasBridgeMapsPort)と同じく、実際にどの列に書くかのロジックはBridge.js側(GAS版本番のシート
 * 構造をそのまま知っている)に置き、こちらはペイロードを渡すだけにする。
 *
 * Bridge.js側の書き込みaction(writeDailyReport/writeAccidentReport/writeReceipt/
 * writeAttendanceDay/writeAttendanceAggregate)は、読み取り側のaction追加時と同じく
 * デプロイ承認待ち(CLAUDE.mdの運用ルール、doc/README参照)。
 */
export class GasBridgeMirrorSenderPort implements MirrorSenderPort {
  private readonly client: GasBridgeClient;

  constructor(options: GasBridgeOptions) {
    this.client = new GasBridgeClient(options);
  }

  private async post(action: string, body: unknown): Promise<void> {
    const result = await this.client.postJson<BridgeWriteResult>(action, body);
    if (!result.success) {
      throw new Error(result.message || `Bridge書き込みに失敗しました(action=${action})`);
    }
  }

  async sendDailyReport(payload: DailyReportMirrorPayload): Promise<void> {
    await this.post('writeDailyReport', payload);
  }

  async sendAccidentReport(payload: AccidentReportMirrorPayload): Promise<void> {
    await this.post('writeAccidentReport', payload);
  }

  async sendReceipt(payload: ReceiptMirrorPayload): Promise<void> {
    await this.post('writeReceipt', payload);
  }

  async sendAttendanceDay(payload: AttendanceDayMirrorPayload): Promise<void> {
    await this.post('writeAttendanceDay', payload);
  }

  /**
   * 勤怠集計シートの再計算。GAS側がカレンダー取得+Mapsのルート計算+シート書き込みまで行うため
   * 他のactionより時間がかかる(予定件数に比例してMaps呼び出しが増える)。ブリッジ共通の
   * タイムアウト(既定20秒)で足りない場合はワーカーの GAS_BRIDGE_TIMEOUT_MS を延ばす
   * (打ち切られてもジョブは再試行待ちに戻るだけで、GAS側の書き込み自体は完了しうる。
   * 勤怠集計の書き込みは該当スタッフ・該当日の行を消してから書き直す形なので、
   * 再試行で二重に増えることはない)。
   */
  async sendAttendanceAggregate(payload: AttendanceAggregateMirrorPayload): Promise<void> {
    await this.post('writeAttendanceAggregate', payload);
  }
}

/** GAS_BRIDGE_URL/SECRET未設定時のフォールバック。何もせず成功扱いにする(ミラーはスキップ)。 */
export class NoopMirrorSenderPort implements MirrorSenderPort {
  async sendDailyReport(): Promise<void> {}
  async sendAccidentReport(): Promise<void> {}
  async sendReceipt(): Promise<void> {}
  async sendAttendanceDay(): Promise<void> {}
  async sendAttendanceAggregate(): Promise<void> {}
}
