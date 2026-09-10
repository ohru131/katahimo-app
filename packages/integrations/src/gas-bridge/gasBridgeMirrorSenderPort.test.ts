import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GasBridgeMirrorSenderPort } from './gasBridgeMirrorSenderPort';

/**
 * ミラー送信のワイヤーフォーマットを固定する。
 *
 * Bridge.js側は`payload.staffName`/`payload.businessDate`のようにフィールド名で値を読むため、
 * こちらのペイロード型を変えてもTypeScriptは何も言わないままGAS側が空値を受け取る
 * (シートに空行が書かれる、あるいはどのスタッフの行を書き直すか決まらない)。GAS版は
 * このリポジトリの外(gas-childcare-visit-app)にあり型で繋がらないので、実際にHTTPで
 * 飛ぶ内容をテストで押さえておく。
 */
describe('GasBridgeMirrorSenderPort', () => {
  interface Received {
    method: string;
    url: string;
    contentType: string | undefined;
    body: unknown;
  }

  let server: Server;
  let baseUrl: string;
  let received: Received[];
  /** ダミーのBridge.jsが返す応答。actionごとの成否を差し替えるために使う。 */
  let reply: unknown;

  beforeEach(async () => {
    received = [];
    reply = { success: true };
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        received.push({
          method: req.method ?? '',
          url: req.url ?? '',
          contentType: req.headers['content-type'],
          body: raw ? JSON.parse(raw) : null,
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(reply));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string')
      throw new Error('ダミーサーバーの起動に失敗しました');
    baseUrl = `http://127.0.0.1:${address.port}/exec`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function createSender(): GasBridgeMirrorSenderPort {
    return new GasBridgeMirrorSenderPort({ baseUrl, secret: 'test-secret', timeoutMs: 5000 });
  }

  it('勤怠集計はスタッフ名と日付だけをPOSTする(シートの値はGAS側が再計算する)', async () => {
    await createSender().sendAttendanceAggregate({ staffName: '佐藤 花子', businessDate: '2026-08-30' });

    expect(received).toHaveLength(1);
    const sent = received[0];
    if (!sent) throw new Error('リクエストが届いていません');
    expect(sent.method).toBe('POST');
    expect(sent.contentType).toBe('application/json');

    // secret/actionはURLクエリ側(GAS Web Appはe.parameterでしか読めない)。
    const url = new URL(sent.url, 'http://placeholder');
    expect(url.searchParams.get('api')).toBe('1');
    expect(url.searchParams.get('action')).toBe('writeAttendanceAggregate');
    expect(url.searchParams.get('secret')).toBe('test-secret');

    // 勤怠集計シートはカレンダー+Maps由来の派生データなので、rowDataの値は一切送らない。
    expect(sent.body).toEqual({ staffName: '佐藤 花子', businessDate: '2026-08-30' });
  });

  it('出勤簿のミラーは列記号をキーにした入力値をそのままPOSTする', async () => {
    await createSender().sendAttendanceDay({
      staffName: '佐藤 花子',
      businessDate: '2026-08-30',
      values: { C: '訪問先A', D: '09:00', E: '10:00' },
    });

    const sent = received[0];
    if (!sent) throw new Error('リクエストが届いていません');
    expect(new URL(sent.url, 'http://placeholder').searchParams.get('action')).toBe('writeAttendanceDay');
    expect(sent.body).toEqual({
      staffName: '佐藤 花子',
      businessDate: '2026-08-30',
      values: { C: '訪問先A', D: '09:00', E: '10:00' },
    });
  });

  it('GAS側がsuccess:falseを返したら例外にする(ジョブを成功扱いで捨てない)', async () => {
    // 例: 出勤簿に該当日の行が無い。ワーカーはこれを受けて再試行待ちに戻す。
    reply = { success: false, message: '指定日(2026-08-31)の記録が出勤簿に見つかりません。' };

    await expect(
      createSender().sendAttendanceAggregate({ staffName: '佐藤 花子', businessDate: '2026-08-31' }),
    ).rejects.toThrow('指定日(2026-08-31)の記録が出勤簿に見つかりません。');
  });

  it('messageが無いsuccess:falseでも、どのactionで失敗したか分かる例外にする', async () => {
    reply = { success: false };

    await expect(
      createSender().sendAttendanceAggregate({ staffName: '佐藤 花子', businessDate: '2026-08-30' }),
    ).rejects.toThrow('writeAttendanceAggregate');
  });
});
