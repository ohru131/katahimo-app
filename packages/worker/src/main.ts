import { formatJstDateKey, purgeStaleAiGenerations, runOutboxBatch } from '@katahimo/core';
import { closeDatabase, getDatabase } from '@katahimo/db';
import { createWorkerContainer } from './container';
import { loadWorkerEnv } from './env';
import { loadDotenv } from './loadDotenv';

// outboxミラー(Sheets/Drive)と、AI生成の記録の保持期間の掃除を実行するワーカー。
// 夜間同期・CSV取込ポーリングは別Phaseで追加する。
// Cloud Run Jobs / 常駐プロセスのどちらでも動くよう、単純なポーリングループにしてある。

loadDotenv();
const env = loadWorkerEnv();
const db = getDatabase();
const container = createWorkerContainer(env, db);

let stopping = false;
process.on('SIGTERM', () => {
  stopping = true;
});
process.on('SIGINT', () => {
  stopping = true;
});

/**
 * テナントID → 最後にAI生成の掃除を走らせたJSTの日付('YYYY-MM-DD')。
 *
 * 【メモリで持つ理由】掃除は「消し漏らしても次の日にまた消える」だけの後始末で、
 * ワーカーが再起動した日に2回走っても害が無い(消す対象が同じなら2回目は0件)。
 * そのためだけに実行済みを記録する表を足さない。
 */
const lastPurgedDateByTenant = new Map<string, string>();

/** その日ぶんのAI生成の掃除がまだなら実行する。失敗してもミラーの処理は止めない。 */
async function purgeAiGenerationsOncePerDay(tenantId: string, tenantSlug: string): Promise<void> {
  const today = formatJstDateKey(new Date());
  if (lastPurgedDateByTenant.get(tenantId) === today) return;

  try {
    const purged = await purgeStaleAiGenerations(container, tenantId, {
      retentionDays: env.AI_GENERATION_RETENTION_DAYS,
    });
    lastPurgedDateByTenant.set(tenantId, today);
    console.log(
      `[ai-generations] tenant=${tenantSlug} purged=${purged}` +
        `(保持期間 ${env.AI_GENERATION_RETENTION_DAYS}日。日報が参照している記録は残す)`,
    );
  } catch (e) {
    // 次のポーリングでまた試す(日付を記録しないので同じ日のうちに再挑戦する)。
    console.error(`[ai-generations] tenant=${tenantSlug} 古いAI生成の削除に失敗しました`, e);
  }
}

async function pollOnce(): Promise<void> {
  const tenants = await container.tenants.listAll();
  for (const tenant of tenants) {
    await purgeAiGenerationsOncePerDay(tenant.id, tenant.slug);
    const { processed, failed, deadLettered } = await runOutboxBatch(
      container,
      tenant.id,
      env.OUTBOX_BATCH_SIZE,
    );
    if (processed > 0 || failed > 0) {
      console.log(
        `[mirror] tenant=${tenant.slug} processed=${processed} failed=${failed} deadLettered=${deadLettered}`,
      );
    }
    // デッドレターに落ちた分は自動では復旧しない。運用が気づけるよう、通常のログとは
    // 別にerrorで出す(Cloud Loggingのseverityで拾えるようにするため)。
    // 内訳は「再試行の上限に達したもの」と「再試行しても変わらない失敗(未対応の種別など)」。
    if (deadLettered > 0) {
      console.error(
        `[mirror] tenant=${tenant.slug} 打ち切ったミラージョブが${deadLettered}件あります(status=failed)。` +
          '再試行の上限に達したか、再試行しても解消しない失敗です。last_errorを確認してください。',
      );
    }
  }
}

async function mainLoop(): Promise<void> {
  console.log(`katahimo worker を起動しました(ポーリング間隔: ${env.OUTBOX_POLL_INTERVAL_MS}ms)`);
  while (!stopping) {
    try {
      await pollOnce();
    } catch (e) {
      console.error('[mirror] ポーリング中にエラーが発生しました', e);
    }
    await new Promise((resolve) => setTimeout(resolve, env.OUTBOX_POLL_INTERVAL_MS));
  }
  console.log('katahimo worker を停止しました');
  await closeDatabase();
  process.exit(0);
}

mainLoop();
