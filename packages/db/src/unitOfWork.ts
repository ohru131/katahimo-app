import type { TransactionScope, UnitOfWorkPort } from '@katahimo/core/ports';
import type { Database } from './tenantScope';
import { createTransactionScope, withTenant } from './tenantScope';

/**
 * UnitOfWorkPortのDrizzle実装。テナントスコープのトランザクションを1つ開き、
 * その中で呼ばれたリポジトリメソッド(scopeを渡したもの)を同じトランザクションに乗せる。
 *
 * コールバックが例外を投げるとトランザクションごとロールバックされるので、
 * 「日報だけ保存されてoutboxに積まれていない」といった中途半端な状態が残らない。
 */
export class DrizzleUnitOfWork implements UnitOfWorkPort {
  constructor(private readonly db: Database) {}

  async run<T>(tenantId: string, fn: (scope: TransactionScope) => Promise<T>): Promise<T> {
    return withTenant(this.db, tenantId, (tx) => fn(createTransactionScope(this.db, tenantId, tx)));
  }
}
