import type { Database } from './tenantScope';

/**
 * トランザクションを1本ずつ順番に実行させるラッパー。
 *
 * postgres-jsは接続プールを持つので、usecasesが `Promise.all([repoA.find(), repoB.find()])` の
 * ように並列でリポジトリを呼んでも、それぞれ別の接続でトランザクションが張られて問題ない。
 * 一方PGlite(ブラウザ公開デモ)は接続が1本しかないため、同じことをすると2つのBEGINが
 * 同一セッション上で入れ子になり壊れる。そこで単一接続ドライバではこのラッパーを噛ませ、
 * withTenant()由来のトランザクションを直列化する。
 *
 * デモのデータ量ではキュー待ちは体感できない。なお `db.select()` のようなトランザクション外の
 * 単発クエリは対象外(RLS対象外のtenantsテーブルへの問い合わせなど、ごく一部でしか使われず、
 * 並列に投げている箇所もないため)。
 */
export function serializeTransactions<T extends Database>(db: T): T {
  let tail: Promise<unknown> = Promise.resolve();

  const transaction = (...args: unknown[]) => {
    const run = tail.then(() => (db.transaction as (...a: unknown[]) => Promise<unknown>)(...args));
    // 失敗を後続に伝播させないためのcatch。呼び出し元にはrunをそのまま返すのでエラーは失われない。
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  return new Proxy(db, {
    get(target, prop) {
      if (prop === 'transaction') return transaction;
      // receiverにProxyを渡すとdrizzle内部のプライベートフィールドアクセスが壊れるため、
      // 必ず実体(target)をthisにして取り出す。
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
