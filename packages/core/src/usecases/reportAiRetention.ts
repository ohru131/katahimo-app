import type { ReportAiGenerationRepositoryPort } from '../ports/reportAiRepositories';

/**
 * AI生成の記録(report_ai_generations)の保持期間。
 *
 * 【保存されなかった下書きだけを消す理由】
 * 生成のたびに1行増えるので、「試しに生成したが結局書き直した」ぶんが際限なく溜まる。
 * 一方で、保存された日報が参照している行は「その文面がどのモデル・どの版の文面・どの候補語から
 * 生まれたか」の唯一の手掛かりなので、期間が過ぎても残す(消す対象は
 * purgeUnreferencedOlderThan が日報からの参照で絞る)。
 *
 * 設計の背景は doc/db/new-domains.md 第6章。
 */

export interface ReportAiRetentionDeps {
  reportAiGenerations: ReportAiGenerationRepositoryPort;
}

/**
 * 既定の保持期間(日)。1年あれば「去年の同じ時期はどう書いていたか」を見返せて、
 * それより古い「保存しなかった下書き」を読み返す用事は運用上出てこない。
 */
export const DEFAULT_AI_GENERATION_RETENTION_DAYS = 365;

export interface PurgeStaleAiGenerationsOptions {
  /** 保持期間(日)。省略時は DEFAULT_AI_GENERATION_RETENTION_DAYS。 */
  retentionDays?: number;
  /** 基準時刻。省略時は現在時刻(テストで固定できるようにするため引数にしている)。 */
  now?: Date;
}

/**
 * 保持期間を過ぎた「どの日報からも参照されていない」生成を消す。消した件数を返す。
 * ワーカー(packages/worker)がテナントごとに日次で呼ぶ。
 */
export async function purgeStaleAiGenerations(
  deps: ReportAiRetentionDeps,
  tenantId: string,
  options: PurgeStaleAiGenerationsOptions = {},
): Promise<number> {
  const retentionDays = options.retentionDays ?? DEFAULT_AI_GENERATION_RETENTION_DAYS;
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  return deps.reportAiGenerations.purgeUnreferencedOlderThan(tenantId, cutoff);
}
