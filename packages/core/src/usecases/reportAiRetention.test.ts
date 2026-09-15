import { describe, expect, it } from 'vitest';
import type { NewReportAiGenerationInput } from '../ports/reportAiRepositories';
import { DEFAULT_AI_GENERATION_RETENTION_DAYS, purgeStaleAiGenerations } from './reportAiRetention';
import { FakeReportAiGenerationRepository } from './reportAiTestDoubles';

const tenantId = 'tenant-1';
const now = new Date('2026-09-15T00:00:00.000Z');

function generationInput(): NewReportAiGenerationInput {
  return {
    tenantId,
    staffId: 'staff-1',
    customerId: 'customer-1',
    targetFamilyMemberId: null,
    promptTemplateId: null,
    promptText: 'prompt',
    model: 'test-model',
    childAgeMonths: null,
    educationLevel: null,
    effectiveEducationLevel: 2,
    stressLevel: null,
    escalationRequired: false,
    inputText: 'メモ',
    timeInfo: '時間指定なし',
    outputJson: { warnings: [], internal: '', customer: '' },
    errorMessage: null,
    candidateKeywordIds: [],
    usedKeywordIds: [],
  };
}

/** `createdAt` が `daysAgo` 日前の生成を1件作る。 */
async function createAged(repo: FakeReportAiGenerationRepository, daysAgo: number): Promise<string> {
  const record = await repo.create(generationInput());
  repo.setCreatedAtForTest(record.id, new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000));
  return record.id;
}

describe('purgeStaleAiGenerations', () => {
  it('保持期間を過ぎた未参照の下書きだけを消す', async () => {
    const repo = new FakeReportAiGenerationRepository();
    const stale = await createAged(repo, DEFAULT_AI_GENERATION_RETENTION_DAYS + 1);
    const fresh = await createAged(repo, 10);

    const purged = await purgeStaleAiGenerations({ reportAiGenerations: repo }, tenantId, { now });

    expect(purged).toBe(1);
    const remaining = repo.listForTest(tenantId).map((r) => r.id);
    expect(remaining).toEqual([fresh]);
    expect(remaining).not.toContain(stale);
  });

  it('日報から参照されている行は期間を過ぎても残す', async () => {
    const repo = new FakeReportAiGenerationRepository();
    const referenced = await createAged(repo, DEFAULT_AI_GENERATION_RETENTION_DAYS + 100);
    repo.markReferencedForTest(referenced);

    const purged = await purgeStaleAiGenerations({ reportAiGenerations: repo }, tenantId, { now });

    expect(purged).toBe(0);
    expect(repo.listForTest(tenantId).map((r) => r.id)).toEqual([referenced]);
  });

  it('保持期間は呼び出し側が短くできる', async () => {
    const repo = new FakeReportAiGenerationRepository();
    await createAged(repo, 10);

    const purged = await purgeStaleAiGenerations({ reportAiGenerations: repo }, tenantId, {
      retentionDays: 7,
      now,
    });

    expect(purged).toBe(1);
    expect(repo.listForTest(tenantId)).toEqual([]);
  });
});
