import type {
  AppendPromptTemplateResult,
  NewPromptTemplateInput,
  PromptTemplateKey,
  PromptTemplateRecord,
  PromptTemplateRepositoryPort,
} from '@katahimo/core/ports';
import { and, desc, eq, sql } from 'drizzle-orm';
import { promptTemplates } from '../schema';
import type { Database } from '../tenantScope';
import { withTenant } from '../tenantScope';

type PromptTemplateRow = typeof promptTemplates.$inferSelect;

/**
 * key列はDBではtext(CHECK制約で@katahimo/sharedのPROMPT_TEMPLATE_KEYSに縛っている)なので、
 * 読み出しでドメインの型に戻す。CHECK制約を通った値しか入らないため、ここでの再検証はしない。
 */
function toRecord(row: PromptTemplateRow): PromptTemplateRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    key: row.key as PromptTemplateKey,
    version: row.version,
    body: row.body,
    note: row.note,
    createdByStaffId: row.createdByStaffId,
    createdAt: row.createdAt,
  };
}

/** 同じ(tenant_id, key, version)を同時に作りにいった場合のPostgresのエラーコード。 */
const UNIQUE_VIOLATION = '23505';
const VERSION_CONSTRAINT = 'prompt_templates_tenant_key_version_uk';

/**
 * 一意制約違反(23505)かどうか。drizzleはドライバのエラーを `cause` に包んで投げ直すので、
 * 投げられたエラー自体と `cause` の両方を、エラーコードと制約名の2通りで見る
 * (PGlite経由では code を持たない形で来ることがある)。
 */
function isUniqueViolation(e: unknown): boolean {
  const candidates = [e, (e as { cause?: unknown } | null)?.cause];
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined) continue;
    if (typeof candidate === 'object') {
      const { code, constraint } = candidate as { code?: unknown; constraint?: unknown };
      if (code === UNIQUE_VIOLATION || constraint === VERSION_CONSTRAINT) return true;
    }
    const message = candidate instanceof Error ? candidate.message : String(candidate);
    if (message.includes(VERSION_CONSTRAINT)) return true;
  }
  return false;
}

/** prompt_templates(テナントが編集したプロンプト文面の版)のリポジトリ実装。 */
export class DrizzlePromptTemplateRepository implements PromptTemplateRepositoryPort {
  constructor(private readonly db: Database) {}

  /**
   * キーごとの最新版。「(tenant_id, key)ごとの最大version」を副問い合わせで求めて突き合わせる。
   * DISTINCT ONでも書けるが、生SQLの戻り値の形がドライバ(postgres-js / PGlite)で違うため、
   * どちらでも同じに動くクエリビルダの形にしてある。
   */
  async findLatestAll(tenantId: string): Promise<PromptTemplateRecord[]> {
    return withTenant(this.db, tenantId, async (tx) => {
      const latest = tx
        .select({
          key: promptTemplates.key,
          // 別名を version にすると、JOIN条件で本体の version 列と区別が付かない
          // (PostgreSQLが「column reference version is ambiguous」で落ちる)。
          maxVersion: sql<number>`max(${promptTemplates.version})`.as('max_version'),
        })
        .from(promptTemplates)
        .where(eq(promptTemplates.tenantId, tenantId))
        .groupBy(promptTemplates.key)
        .as('latest');

      const rows = await tx
        .select({
          id: promptTemplates.id,
          tenantId: promptTemplates.tenantId,
          key: promptTemplates.key,
          version: promptTemplates.version,
          body: promptTemplates.body,
          note: promptTemplates.note,
          createdByStaffId: promptTemplates.createdByStaffId,
          createdAt: promptTemplates.createdAt,
        })
        .from(promptTemplates)
        .innerJoin(
          latest,
          and(eq(promptTemplates.key, latest.key), eq(promptTemplates.version, latest.maxVersion)),
        )
        .where(eq(promptTemplates.tenantId, tenantId));

      return rows.map(toRecord);
    });
  }

  /** 1キーの有効な版(最大 version)。テナントが1版も積んでいなければ null。 */
  async findLatest(tenantId: string, key: PromptTemplateKey): Promise<PromptTemplateRecord | null> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(promptTemplates)
        .where(and(eq(promptTemplates.tenantId, tenantId), eq(promptTemplates.key, key)))
        .orderBy(desc(promptTemplates.version))
        .limit(1);
      const row = rows[0];
      return row ? toRecord(row) : null;
    });
  }

  /** 1キーの版の履歴を新しい順に返す(管理画面で前の版の中身を読むため)。 */
  async listVersions(tenantId: string, key: PromptTemplateKey): Promise<PromptTemplateRecord[]> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(promptTemplates)
        .where(and(eq(promptTemplates.tenantId, tenantId), eq(promptTemplates.key, key)))
        .orderBy(desc(promptTemplates.version));
      return rows.map(toRecord);
    });
  }

  /**
   * 「いま有効な文面と違うときだけ積む」の判定と書き込みを1つのトランザクションで行う。
   *
   * 有効版を `FOR UPDATE` で読んで施錠してから比べる。呼び出し側で読んでから書く形にすると、
   * 読みと書きの間に別の管理者が保存した版を見落とし、同じ文面の版が2つ積まれる。
   * 版番号もこの読み取り結果(最大版+1)から決めるので、同じ版番号を2つ採ることもない。
   *
   * ただし「まだ1版も無い」状態だけは施錠する行が無く、2人が同時に最初の版を作りにいける。
   * その場合は (tenant_id, key, version) の一意制約で片方が落ちるので、分かる言葉にして返す。
   */
  async appendIfChanged(
    tenantId: string,
    input: NewPromptTemplateInput,
    currentBodyFallback: string,
  ): Promise<AppendPromptTemplateResult> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(promptTemplates)
        .where(and(eq(promptTemplates.tenantId, tenantId), eq(promptTemplates.key, input.key)))
        .orderBy(desc(promptTemplates.version))
        .limit(1)
        .for('update');
      const current = rows[0] ?? null;
      // テナントの版が1つも無いときは、呼び出し側が持つ既定文面がいま有効な文面。
      const currentBody = current ? current.body : currentBodyFallback;
      if (input.body === currentBody) {
        return { appended: false, current: current ? toRecord(current) : null };
      }

      try {
        const inserted = await tx
          .insert(promptTemplates)
          .values({
            tenantId,
            key: input.key,
            version: (current?.version ?? 0) + 1,
            body: input.body,
            note: input.note,
            createdByStaffId: input.createdByStaffId,
          })
          .returning();
        const row = inserted[0];
        if (!row) throw new Error('プロンプト文面の保存に失敗しました');
        return { appended: true, record: toRecord(row) };
      } catch (e) {
        if (isUniqueViolation(e)) {
          throw new Error(
            'プロンプト文面が同時に更新されました。画面を読み込み直してから、もう一度保存してください。',
          );
        }
        throw e;
      }
    });
  }
}
