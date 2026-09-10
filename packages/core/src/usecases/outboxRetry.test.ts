import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_OUTBOX_ATTEMPTS } from '../domain/mirror/retry';
import type { MirrorKind } from '../ports/mirror';
import type { MirrorWorkerDeps } from './mirrorWorker';
import { runOutboxBatch } from './mirrorWorker';
import {
  FakeAccidentReportRepository,
  FakeAttendanceDayRepository,
  FakeCustomerRepository,
  FakeDailyReportRepository,
  FakeMirrorSenderPort,
  FakeOutboxRepository,
  FakeReceiptRepository,
  FakeStaffRepository,
  FakeStoragePort,
} from './testDoubles';

/**
 * ミラーの送信先(GAS Web App)は実行時間制限やクォータを持つ外部サービスで、失敗が
 * そのまま「恒久的な誤り」を意味しない。一度の失敗で終端状態にすると、一時的な不調の
 * たびに、そのレコードは人手の介入なしには二度とスプレッドシートへ反映されなくなる。
 * バックオフ付きで再試行し、上限に達したものだけを止めることを固定する。
 */

const tenantId = 'tenant-1';

describe('ミラージョブの再試行', () => {
  let outbox: FakeOutboxRepository;
  let sender: FakeMirrorSenderPort;
  let dailyReports: FakeDailyReportRepository;
  let deps: MirrorWorkerDeps;
  /** 待ち時間の検証のため、ワーカーもoutboxも同じ仮想時計を見る。 */
  let clock: Date;
  const now = () => clock;

  beforeEach(async () => {
    clock = new Date('2026-08-30T02:00:00.000Z');
    outbox = new FakeOutboxRepository(now);
    sender = new FakeMirrorSenderPort();
    dailyReports = new FakeDailyReportRepository();
    const report = await dailyReports.create({
      tenantId,
      staffId: 'staff-1',
      customerId: 'customer-1',
      occurredAt: new Date('2026-08-30T01:00:00.000Z'),
      riskRating: null,
      esRating: null,
      content: { startTime: '09:00', endTime: '', inputText: '', internalText: '', customerText: '' },
    });
    await outbox.enqueue({
      tenantId,
      kind: 'daily_report',
      targetId: report.id,
      idempotencyKey: `daily_report:${report.id}:1`,
    });

    deps = {
      outbox,
      dailyReports,
      accidentReports: new FakeAccidentReportRepository(),
      receipts: new FakeReceiptRepository(),
      attendanceDays: new FakeAttendanceDayRepository(),
      staff: new FakeStaffRepository(),
      customers: new FakeCustomerRepository(),
      storage: new FakeStoragePort(),
      sender,
    };
  });

  function failSending(): void {
    sender.sendDailyReport = async () => {
      throw new Error('GAS Bridge がタイムアウトしました');
    };
  }

  it('送信に失敗したジョブは終端させず、待ち時間を置いて再試行する', async () => {
    failSending();
    const first = await runOutboxBatch(deps, tenantId, 10, now);
    expect(first).toEqual({ processed: 0, failed: 1, deadLettered: 0 });

    const row = outbox.listAllForTest()[0];
    expect(row?.status).toBe('pending');
    expect(row?.nextAttemptAt?.getTime()).toBeGreaterThan(clock.getTime());
  });

  it('待ち時間が明ける前は取り出さない(失敗したジョブを掴み続けない)', async () => {
    failSending();
    await runOutboxBatch(deps, tenantId, 10, now);

    // nextAttemptAt はまだ未来なので、時計を進めない限り対象にならない。
    const immediate = await runOutboxBatch(deps, tenantId, 10, now);
    expect(immediate).toEqual({ processed: 0, failed: 0, deadLettered: 0 });
    expect(outbox.listAllForTest()[0]?.attempts).toBe(1);
  });

  it('待ち時間が明ければ再び取り出され、送信が回復すれば完了する', async () => {
    failSending();
    await runOutboxBatch(deps, tenantId, 10, now);

    // 待ち時間を過ぎるまで時計を進め、送信側は回復させる。
    clock = new Date('2026-08-30T03:00:00.000Z');
    sender = new FakeMirrorSenderPort();
    deps.sender = sender;
    const recovered = await runOutboxBatch(deps, tenantId, 10, now);

    expect(recovered).toEqual({ processed: 1, failed: 0, deadLettered: 0 });
    expect(sender.dailyReports).toHaveLength(1);
    expect(outbox.listAllForTest()[0]?.status).toBe('done');
  });

  it('再試行の上限に達したらデッドレターに落とし、以後は取り出さない', async () => {
    failSending();
    for (let i = 0; i < MAX_OUTBOX_ATTEMPTS; i++) {
      // 毎回、待ち時間が明けるところまで時計を進める。
      clock = new Date(clock.getTime() + 2 * 60 * 60 * 1000);
      await runOutboxBatch(deps, tenantId, 10, now);
    }

    const row = outbox.listAllForTest()[0];
    expect(row?.attempts).toBe(MAX_OUTBOX_ATTEMPTS);
    expect(row?.status).toBe('failed');
    expect(row?.lastError).toContain('GAS Bridge');

    // 終端したジョブは、待ち時間に関係なくもう拾わない。
    clock = new Date('2026-09-30T00:00:00.000Z');
    const after = await runOutboxBatch(deps, tenantId, 10, now);
    expect(after).toEqual({ processed: 0, failed: 0, deadLettered: 0 });
  });

  it('未対応の種別は再試行せず、その場でデッドレターに落とす', async () => {
    // outbox_jobs.kindはDBではtext列で、DrizzleOutboxRepositoryがMirrorKindへ無検査で
    // キャストしている。廃止した種別の積み残しや手で入れた行など、MirrorKindに無い値が
    // ワーカーに届くことは実際に起こりうるため、その経路を固定する。
    await outbox.enqueue({
      tenantId,
      kind: 'legacy_unknown_kind' as MirrorKind,
      targetId: 'target-1',
      idempotencyKey: 'legacy_unknown_kind:target-1:1',
    });

    const result = await runOutboxBatch(deps, tenantId, 10, now);

    expect(result.deadLettered).toBe(1);
    const row = outbox.listAllForTest().find((r) => (r.kind as string) === 'legacy_unknown_kind');
    expect(row?.status).toBe('failed');
    expect(row?.lastError).toContain('未対応のミラー種別です');
    expect(row?.attempts).toBe(1);
  });
});
