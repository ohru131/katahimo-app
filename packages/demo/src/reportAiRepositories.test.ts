import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import type { ReportAgeBandInput, ReportKeywordInput, ReportPhraseInput } from '@katahimo/core/ports';
import {
  DrizzleCustomerReportProfileRepository,
  DrizzleReportAiConfigRepository,
  DrizzleReportAiGenerationRepository,
} from '@katahimo/db/repositories';
import * as schema from '@katahimo/db/schema';
import type { Database } from '@katahimo/db/tenant-scope';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import type { DemoMigration } from './database';
import { applyPendingMigrations } from './database';

/**
 * 日報AIの設定6表・家庭ごとの★・生成の記録のリポジトリ実装を、本番と同じマイグレーションを
 * 当てた本物のPostgres(PGlite/WASM)で動かす。
 *
 * 【ここに置く理由】promptTemplateRepository.test.ts と同じで、PGliteに依存できるのが
 * このパッケージだけのため(packages/db はブラウザからも使うのでDBドライバを持ち込まない)。
 *
 * 【インメモリのフェイクでは足りない理由】要点がSQLそのものにある操作を確かめる:
 * `ON CONFLICT (tenant_id, code)` の upsert、対応表(report_age_band_keywords)の入れ替えと
 * 年齢帯を消したときの連動、そして「どの日報からも参照されていない古い生成だけを消す」
 * (NOT EXISTS + 複合FKの順序)。フェイクでは何も確かめられない。
 */

const DRIZZLE_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../db/drizzle');

function loadMigrations(): DemoMigration[] {
  return readdirSync(DRIZZLE_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => ({ tag: name.replace(/\.sql$/, ''), sql: readFileSync(join(DRIZZLE_DIR, name), 'utf8') }));
}

/** 年齢帯1件。テストで変えたいところだけ上書きする。 */
function ageBand(overrides: Partial<ReportAgeBandInput> = {}): ReportAgeBandInput {
  return {
    code: 'm0_6',
    label: '0〜6ヶ月',
    ageFromMonths: 0,
    ageToMonths: 6,
    behaviorWords: 'ずり這い',
    developmentTopics: '首すわり',
    sceneExamples: '授乳',
    sortOrder: 1,
    ...overrides,
  };
}

function keyword(overrides: Partial<ReportKeywordInput> = {}): ReportKeywordInput {
  return {
    code: 'K01',
    category: '非認知能力',
    name: '敏感期',
    subConcept: '',
    ageFromMonths: 0,
    ageToMonths: 36,
    educationLevelMin: 2,
    educationLevelMax: 5,
    stressLevelMin: 3,
    tone: '意味づけ',
    parentExplanation: '今だけ夢中になる時期',
    phraseExamples: '',
    usageScene: '',
    ngExample: '',
    sortOrder: 1,
    active: true,
    ageBandCodes: [],
    ...overrides,
  };
}

function phrase(overrides: Partial<ReportPhraseInput> = {}): ReportPhraseInput {
  return {
    kind: 'encourage',
    body: 'いつもよく見ていらっしゃいますね',
    intent: 'ねぎらい',
    stressLevelMin: 1,
    stressLevelMax: 3,
    placement: 'closing',
    sortOrder: 1,
    active: true,
    ...overrides,
  };
}

describe('日報AIのリポジトリ(PGlite)', () => {
  let client: PGlite;
  let config: DrizzleReportAiConfigRepository;
  let profiles: DrizzleCustomerReportProfileRepository;
  let generations: DrizzleReportAiGenerationRepository;
  let tenantId: string;
  let otherTenantId: string;
  let staffId: string;
  let customerId: string;
  let familyMemberId: string;

  beforeAll(async () => {
    client = new PGlite();
    await client.waitReady;
    await applyPendingMigrations(client, loadMigrations());

    const { rows: tenants } = await client.query<{ id: string }>(
      `INSERT INTO tenants (name, slug) VALUES ('テスト法人', 'report-ai'), ('別法人', 'report-ai-other')
       RETURNING id;`,
    );
    tenantId = tenants[0]?.id ?? '';
    otherTenantId = tenants[1]?.id ?? '';

    const {
      rows: [staff],
    } = await client.query<{ id: string }>(
      "INSERT INTO staff (tenant_id, name, email) VALUES ($1, 'テスト管理者', 'admin@example.test') RETURNING id;",
      [tenantId],
    );
    staffId = staff?.id ?? '';

    const {
      rows: [customer],
    } = await client.query<{ id: string }>(
      "INSERT INTO customers (tenant_id, name, family_name, given_name) VALUES ($1, 'テスト利用者', 'テスト', '太郎') RETURNING id;",
      [tenantId],
    );
    customerId = customer?.id ?? '';

    const {
      rows: [familyMember],
    } = await client.query<{ id: string }>(
      `INSERT INTO family_members (tenant_id, customer_id, name, dob_date, dob_raw)
       VALUES ($1, $2, 'テスト花子', '2025-03-01', '2025-03-01') RETURNING id;`,
      [tenantId, customerId],
    );
    familyMemberId = familyMember?.id ?? '';

    const db = drizzle(client, { schema, casing: 'snake_case' }) as unknown as Database;
    config = new DrizzleReportAiConfigRepository(db);
    profiles = new DrizzleCustomerReportProfileRepository(db);
    generations = new DrizzleReportAiGenerationRepository(db);
  });

  it('設定が1行も無いテナントは空の一式が返る', async () => {
    const snapshot = await config.loadAll(otherTenantId);
    expect(snapshot).toEqual({
      ageBands: [],
      keywords: [],
      ageBandKeywordIds: {},
      educationLevels: [],
      stressLevels: [],
      phrases: [],
    });
  });

  it('年齢帯・キーワード・レベル定義はコード/レベルで upsert される(行は増えない)', async () => {
    const created = await config.upsertAgeBand(tenantId, ageBand());
    const updated = await config.upsertAgeBand(tenantId, ageBand({ label: '0〜6ヶ月(改)' }));
    expect(updated.id).toBe(created.id);
    expect(updated.label).toBe('0〜6ヶ月(改)');

    await config.upsertAgeBand(
      tenantId,
      ageBand({ code: 'y1', label: '1歳', ageFromMonths: 12, ageToMonths: 24, sortOrder: 2 }),
    );
    await config.upsertKeyword(tenantId, keyword());
    await config.upsertKeyword(tenantId, keyword({ name: '敏感期(改)' }));
    await config.upsertEducationLevel(tenantId, {
      level: 2,
      label: '標準',
      description: '',
      promptInstruction: '',
      maxKeywords: 1,
      allowTermNames: false,
    });
    await config.upsertStressLevel(tenantId, {
      level: 1,
      label: '危険・緊急',
      criteria: '表情が乏しい',
      promptInstruction: '',
      educationLevelShift: -4,
      keywordsEnabled: false,
      escalationRequired: true,
    });

    const snapshot = await config.loadAll(tenantId);
    expect(snapshot.ageBands.map((band) => band.code)).toEqual(['m0_6', 'y1']);
    expect(snapshot.keywords).toHaveLength(1);
    expect(snapshot.keywords[0]?.name).toBe('敏感期(改)');
    expect(snapshot.educationLevels).toHaveLength(1);
    expect(snapshot.stressLevels[0]).toMatchObject({
      level: 1,
      keywordsEnabled: false,
      escalationRequired: true,
    });
  });

  it('loadLevels はレベルの2表だけを返す', async () => {
    const levels = await config.loadLevels(tenantId);
    expect(levels.educationLevels.map((row) => row.level)).toEqual([2]);
    expect(levels.stressLevels.map((row) => row.level)).toEqual([1]);
    expect(await config.loadLevels(otherTenantId)).toEqual({ educationLevels: [], stressLevels: [] });
  });

  it('キーワードを保存するたびに、相性の良い年齢帯の対応行が入れ替わる', async () => {
    await config.upsertKeyword(tenantId, keyword({ ageBandCodes: ['m0_6', 'y1'] }));
    const bandIds = (await config.loadAll(tenantId)).ageBands.map((band) => band.id);
    const both = (await config.loadAll(tenantId)).ageBandKeywordIds;
    expect(bandIds.filter((id) => both[id]?.length === 1)).toHaveLength(2);

    await config.upsertKeyword(tenantId, keyword({ ageBandCodes: ['y1'] }));
    const snapshot = await config.loadAll(tenantId);
    const y1 = snapshot.ageBands.find((band) => band.code === 'y1');
    const m0 = snapshot.ageBands.find((band) => band.code === 'm0_6');
    expect(snapshot.ageBandKeywordIds[y1?.id ?? '']).toEqual([snapshot.keywords[0]?.id]);
    expect(snapshot.ageBandKeywordIds[m0?.id ?? '']).toBeUndefined();
  });

  it('登録の無い年齢帯コードを指定した保存はエラーになる', async () => {
    await expect(config.upsertKeyword(tenantId, keyword({ ageBandCodes: ['y9'] }))).rejects.toThrow(
      /年齢帯コード y9 は登録されていません/,
    );
  });

  it('年齢帯を消すと対応表の行も消える。無いコードは false', async () => {
    await config.upsertKeyword(tenantId, keyword({ ageBandCodes: ['y1'] }));
    expect(await config.deleteAgeBand(tenantId, 'y1')).toBe(true);
    expect(await config.deleteAgeBand(tenantId, 'y1')).toBe(false);

    const snapshot = await config.loadAll(tenantId);
    expect(snapshot.ageBands.map((band) => band.code)).toEqual(['m0_6']);
    expect(snapshot.ageBandKeywordIds).toEqual({});
    // 語そのものは残る(生成の記録が参照するため)。
    expect(snapshot.keywords).toHaveLength(1);
  });

  it('表現は全件入れ替えと、kind+body での更新(取込)を使い分けられる', async () => {
    await config.replacePhrases(tenantId, [
      phrase(),
      phrase({ kind: 'avoid', body: '〜してあげてください' }),
    ]);
    expect((await config.loadAll(tenantId)).phrases).toHaveLength(2);

    await config.replacePhrases(tenantId, [phrase()]);
    expect((await config.loadAll(tenantId)).phrases).toHaveLength(1);

    await config.upsertPhrasesByBody(tenantId, [
      phrase({ intent: '更新後の意図' }),
      phrase({ kind: 'avoid', body: '他のお子さんと比べて' }),
    ]);
    const phrases = (await config.loadAll(tenantId)).phrases;
    expect(phrases).toHaveLength(2);
    expect(phrases.find((row) => row.kind === 'encourage')?.intent).toBe('更新後の意図');
  });

  it('別テナントからは見えない', async () => {
    await config.upsertAgeBand(otherTenantId, ageBand({ code: 'm0_6', label: 'よその帯' }));
    const mine = await config.loadAll(tenantId);
    const theirs = await config.loadAll(otherTenantId);
    expect(mine.ageBands.find((band) => band.code === 'm0_6')?.label).toBe('0〜6ヶ月(改)');
    expect(theirs.ageBands).toHaveLength(1);
    expect(theirs.keywords).toHaveLength(0);
  });

  it('家庭ごとの★は1顧客1行で upsert される', async () => {
    expect(await profiles.find(tenantId, customerId)).toBeNull();

    await profiles.upsert(tenantId, customerId, {
      educationLevel: 4,
      note: 'モンテッソーリに関心',
      updatedByStaffId: staffId,
    });
    const updated = await profiles.upsert(tenantId, customerId, {
      educationLevel: null,
      note: '専門用語は控えてほしい',
      updatedByStaffId: null,
    });
    expect(updated.educationLevel).toBeNull();
    expect(updated.updatedByStaffId).toBeNull();

    expect((await profiles.find(tenantId, customerId))?.note).toBe('専門用語は控えてほしい');
    expect(await profiles.find(otherTenantId, customerId)).toBeNull();
  });

  it('生成の記録は候補語と使用語を同じ行から辿れる', async () => {
    const keywordId = (await config.loadAll(tenantId)).keywords[0]?.id ?? '';
    const created = await generations.create({
      tenantId,
      staffId,
      customerId,
      targetFamilyMemberId: familyMemberId,
      promptTemplateId: null,
      promptText: '組み立て済みのプロンプト全文',
      model: 'gemini-2.5-flash',
      childAgeMonths: 6,
      educationLevel: 4,
      effectiveEducationLevel: 3,
      stressLevel: 3,
      escalationRequired: false,
      inputText: 'よく遊んでいました',
      timeInfo: '10:00〜13:00',
      outputJson: { customer: '本文', usedKeywords: ['K01'] },
      errorMessage: null,
      // 同じ語が候補と使用の両方に入る(主キーに role が入っているので両方残る)。
      candidateKeywordIds: [keywordId],
      usedKeywordIds: [keywordId],
    });

    const found = await generations.findById(tenantId, created.id);
    expect(found?.candidateKeywordIds).toEqual([keywordId]);
    expect(found?.usedKeywordIds).toEqual([keywordId]);
    expect(found?.outputJson).toEqual({ customer: '本文', usedKeywords: ['K01'] });
    expect(await generations.findById(otherTenantId, created.id)).toBeNull();
  });

  it('保持期間の削除は、日報から参照されている生成を残す', async () => {
    const keywordId = (await config.loadAll(tenantId)).keywords[0]?.id ?? '';
    const base = {
      tenantId,
      staffId,
      customerId,
      targetFamilyMemberId: null,
      promptTemplateId: null,
      promptText: 'プロンプト',
      model: 'gemini-2.5-flash',
      childAgeMonths: null,
      educationLevel: null,
      effectiveEducationLevel: null,
      stressLevel: null,
      escalationRequired: false,
      inputText: 'メモ',
      timeInfo: '',
      outputJson: null,
      errorMessage: 'APIエラー',
      candidateKeywordIds: [keywordId],
      usedKeywordIds: [],
    };
    const saved = await generations.create(base);
    const draft = await generations.create(base);
    const recent = await generations.create(base);

    // 保存に使われた生成を日報が指している状態にする。
    await client.query(
      `INSERT INTO daily_reports (tenant_id, staff_id, customer_id, occurred_at, ai_generation_id)
       VALUES ($1, $2, $3, now(), $4);`,
      [tenantId, staffId, customerId, saved.id],
    );
    // 保持期間を跨いだ古い行にする(recent は新しいままにして、期限内の下書きが残ることも見る)。
    await client.query(
      "UPDATE report_ai_generations SET created_at = now() - interval '400 days' WHERE id = ANY($1);",
      [[saved.id, draft.id]],
    );

    const cutoff = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    expect(await generations.purgeUnreferencedOlderThan(tenantId, cutoff)).toBe(1);
    expect(await generations.findById(tenantId, draft.id)).toBeNull();
    expect(await generations.findById(tenantId, saved.id)).not.toBeNull();
    expect(await generations.findById(tenantId, recent.id)).not.toBeNull();
    // 消えた生成のキーワードの行も一緒に消えている(複合FKが残っていれば消せない)。
    const { rows } = await client.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM report_ai_generation_keywords WHERE generation_id = $1;',
      [draft.id],
    );
    expect(rows[0]?.count).toBe('0');
  });
});
