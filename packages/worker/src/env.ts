import { DEFAULT_AI_GENERATION_RETENTION_DAYS } from '@katahimo/core';
import { z } from 'zod';

/**
 * ワーカー(outboxミラー・夜間同期・CSV取込ポーリング)用の環境変数検証。
 * APIサーバー(packages/api/src/env.ts)と役割が異なるため、必要な変数だけを最小限持つ
 * (認証関連や、app_settingsの資格情報を復号するためのLOCAL_DEV_KEKはワーカーには不要。
 * ミラー対象の日報・領収書・勤怠は平文列なので、ワーカーは復号を一切行わない)。
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL が必要です'),

  // 領収書画像の保存先。packages/api/src/env.tsのLOCAL_RECEIPT_STORAGE_DIRと同じ値にすること
  // (ワーカーはAPIサーバーが保存したファイルを読み直してGAS版Driveへミラーする)。
  LOCAL_RECEIPT_STORAGE_DIR: z.string().default('./data/receipts'),

  // 未設定の場合はNoopMirrorSenderPort(何もせず成功扱い)にフォールバックする。
  GAS_BRIDGE_URL: z.string().optional(),
  GAS_BRIDGE_SECRET: z.string().optional(),
  // ブリッジ1回あたりのタイムアウト(ミリ秒)。既定はGasBridgeClientの20秒。
  // 勤怠集計の再計算(writeAttendanceAggregate)はGAS側でカレンダー取得+予定件数分の
  // Mapsルート計算まで走るため、他のactionより時間がかかる。足りずに打ち切られるようなら
  // ここを延ばす(打ち切られてもジョブは再試行待ちに戻るだけで、失われはしない)。
  GAS_BRIDGE_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),

  // ポーリング間隔(ミリ秒)。
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  // 1テナント・1ポーリングあたりの最大処理件数。
  OUTBOX_BATCH_SIZE: z.coerce.number().int().positive().default(10),

  // AI生成の記録(report_ai_generations)のうち、どの日報からも参照されていない下書きを
  // 何日で消すか。日報が参照している行は期間を過ぎても残る
  // (packages/core/src/usecases/reportAiRetention.ts、doc/db/new-domains.md 第6章)。
  AI_GENERATION_RETENTION_DAYS: z.coerce
    .number()
    .int()
    .positive()
    .default(DEFAULT_AI_GENERATION_RETENTION_DAYS),
});

export type WorkerEnv = z.infer<typeof envSchema>;

export function loadWorkerEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`環境変数の設定に問題があります:\n${detail}`);
  }
  return parsed.data;
}
