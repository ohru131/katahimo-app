import type {
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

function isUniqueViolation(e: unknown): boolean {
  if (e !== null && typeof e === 'object' && (e as { code?: unknown }).code === UNIQUE_VIOLATION) {
    return true;
  }
  // ドライバによってはcodeを持たない形で来る(PGlite経由等)ので、制約名でも判定する。
  return (e instanceof Error ? e.message : String(e)).includes('prompt_templates_tenant_key_version_uk');
}

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
   * 版番号の採番をINSERTの中(副問い合わせ)で行う。先にSELECTしてから+1すると、
   * 2人の管理者が同時に保存したときに同じ版番号を採ってしまう。同時に通ってしまった場合は
   * (tenant_id, key, version)の一意制約で片方が落ちるので、それを分かる言葉にして返す。
   */
  async append(tenantId: string, input: NewPromptTemplateInput): Promise<PromptTemplateRecord> {
    return withTenant(this.db, tenantId, async (tx) => {
      try {
        const rows = await tx
          .insert(promptTemplates)
          .values({
            tenantId,
            key: input.key,
            version: sql<number>`(
              SELECT COALESCE(MAX(${promptTemplates.version}), 0) + 1
              FROM ${promptTemplates}
              WHERE ${promptTemplates.tenantId} = ${tenantId} AND ${promptTemplates.key} = ${input.key}
            )`,
            body: input.body,
            note: input.note,
            createdByStaffId: input.createdByStaffId,
          })
          .returning();
        const row = rows[0];
        if (!row) throw new Error('プロンプト文面の保存に失敗しました');
        return toRecord(row);
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
