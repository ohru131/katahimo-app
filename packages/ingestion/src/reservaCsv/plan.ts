import type { CustomerRepositoryPort } from '@katahimo/core/ports';
import type { CustomerDeps } from '@katahimo/core/usecases';
import { createCustomer, deactivateCustomer, updateCustomer } from '@katahimo/core/usecases';
import { mapReservaRowToCustomerInput, RESERVA_EXTERNAL_SOURCE } from './mapToCustomerInput';
import type { ReservaCsvRow } from './types';

/** 既存件数のこの割合を超える変更(更新+消失)があれば、自動適用せず人手のレビューを求める。 */
const DEFAULT_REVIEW_THRESHOLD = 0.2;

export interface ReservaImportPlan {
  toCreate: ReservaCsvRow[];
  toUpdate: ReservaCsvRow[];
  /** 取込データに存在しなくなった顧客の外部ID。適用時にソフトデリートする。 */
  toDeactivateExternalIds: string[];
  stats: {
    existingActiveCount: number;
    incomingCount: number;
    createCount: number;
    updateCount: number;
    deactivateCount: number;
    /** (更新+消失) / 既存件数。ゼロ除算回避のため既存0件なら0。 */
    changedRatio: number;
  };
  /** trueの場合、applyReservaImportPlanは例外を投げて適用を拒否する(人手のレビューが必要)。 */
  requiresReview: boolean;
}

/**
 * RESERVA CSVの取込差分を計算する(DBへの書き込みは一切行わない、読み取り専用の計画)。
 *
 * 氏名の文字列一致ではなく、外部ID(RESERVAの顧客ID)による突き合わせで
 * 作成/更新/消失(ソフトデリート対象)を判定する(doc/07 第5章・第8章の方針)。
 * 「取込データで既存データを丸ごと置き換える」旧GAS版の危険な挙動(CsvImport.jsの
 * updateDatabaseFromLinesV2)は踏襲せず、差分適用+安全装置付きにする。
 */
export async function planReservaImport(
  customers: CustomerRepositoryPort,
  tenantId: string,
  rows: ReservaCsvRow[],
  reviewThreshold: number = DEFAULT_REVIEW_THRESHOLD,
): Promise<ReservaImportPlan> {
  const existingIds = new Set(await customers.listActiveExternalIds(tenantId, RESERVA_EXTERNAL_SOURCE));
  const incomingIds = new Set(rows.map((r) => r.customerId));

  const toCreate = rows.filter((r) => !existingIds.has(r.customerId));
  const toUpdate = rows.filter((r) => existingIds.has(r.customerId));
  const toDeactivateExternalIds = [...existingIds].filter((id) => !incomingIds.has(id));

  const existingActiveCount = existingIds.size;
  // 閾値の対象は「消失(取込データに存在しなくなった=データ損失リスク)」の割合のみとする。
  // 「更新」は安定した顧客基盤で日次取込するだけでもほぼ毎回大量に発生する正常な挙動であり、
  // これを閾値に含めると通常運用のたびに毎回レビュー待ちになってしまい安全装置として機能しない。
  const changedRatio = existingActiveCount > 0 ? toDeactivateExternalIds.length / existingActiveCount : 0;

  return {
    toCreate,
    toUpdate,
    toDeactivateExternalIds,
    stats: {
      existingActiveCount,
      incomingCount: rows.length,
      createCount: toCreate.length,
      updateCount: toUpdate.length,
      deactivateCount: toDeactivateExternalIds.length,
      changedRatio,
    },
    requiresReview: existingActiveCount > 0 && changedRatio > reviewThreshold,
  };
}

export interface ApplyReservaImportFailure {
  stage: 'create' | 'update' | 'deactivate';
  /** RESERVA顧客ID(externalId)。 */
  customerId: string;
  error: string;
}

export interface ApplyReservaImportResult {
  created: number;
  updated: number;
  deactivated: number;
  /**
   * 行単位で発生した失敗。1件のDB制約違反等でバッチ全体を中断しないよう、
   * 失敗した行は記録した上で残りの行の処理を継続する。空でない場合、
   * 呼び出し側は内容を確認し、必要ならCSVを修正して該当行だけ再実行すべき。
   */
  failures: ApplyReservaImportFailure[];
}

/**
 * 取込計画をDBに適用する。requiresReview=trueの計画は明示的にforce=trueを渡さない限り拒否する
 * (安全装置。想定外に欠損したCSVを誤って適用しないため)。
 */
export async function applyReservaImportPlan(
  deps: CustomerDeps,
  tenantId: string,
  plan: ReservaImportPlan,
  options: { force?: boolean } = {},
): Promise<ApplyReservaImportResult> {
  if (plan.requiresReview && !options.force) {
    throw new Error(
      `取込データから消失した顧客の割合が閾値を超えています(消失率 ${(plan.stats.changedRatio * 100).toFixed(1)}%: ` +
        `消失${plan.stats.deactivateCount}件 / 既存${plan.stats.existingActiveCount}件)。` +
        'CSVの欠損等が無いか内容を確認し、問題なければ { force: true } を指定して再実行してください。',
    );
  }

  const failures: ApplyReservaImportFailure[] = [];
  let created = 0;
  let updated = 0;
  let deactivated = 0;

  for (const row of plan.toCreate) {
    try {
      await createCustomer(deps, mapReservaRowToCustomerInput(tenantId, row));
      created++;
    } catch (e) {
      failures.push({
        stage: 'create',
        customerId: row.customerId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  for (const row of plan.toUpdate) {
    try {
      const existing = await deps.customers.findByExternalId(
        tenantId,
        RESERVA_EXTERNAL_SOURCE,
        row.customerId,
      );
      if (!existing) {
        failures.push({
          stage: 'update',
          customerId: row.customerId,
          error: '計画時には存在した顧客が適用時には見つかりませんでした',
        });
        continue;
      }
      await updateCustomer(deps, tenantId, existing.id, mapReservaRowToCustomerInput(tenantId, row));
      updated++;
    } catch (e) {
      failures.push({
        stage: 'update',
        customerId: row.customerId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  for (const externalId of plan.toDeactivateExternalIds) {
    try {
      const existing = await deps.customers.findByExternalId(tenantId, RESERVA_EXTERNAL_SOURCE, externalId);
      if (existing) {
        await deactivateCustomer(deps, tenantId, existing.id);
        deactivated++;
      }
    } catch (e) {
      failures.push({
        stage: 'deactivate',
        customerId: externalId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return { created, updated, deactivated, failures };
}
