/**
 * `onblocked` の後、削除が完了するのを待つ上限。
 *
 * 他タブが本当に開いたままなら待っても終わらないので、ここで打ち切って
 * 「他のタブを閉じてください」と案内する。逆に、自タブの接続が閉じ切る直前だっただけなら
 * この待ち時間のうちに完了する。
 */
const BLOCKED_TIMEOUT_MS = 3000;

/**
 * IndexedDBのデータベースを削除する。削除しきれなければ必ず reject する。
 *
 * `onblocked` は「他の接続がまだ開いている」という**進行中**の通知であって、失敗ではない。
 * 仕様上、その接続が閉じれば削除は続行され `onsuccess` が来る。実際、PGliteは
 * relaxedDurability で書き出しを非同期に行うため、`close()` 直後は一瞬だけ接続が
 * 残っていて `onblocked` が飛ぶことがある(これを即エラーにすると、リセットが
 * ときどき失敗する挙動になっていた)。
 *
 * そこで `onblocked` では諦めず、完了を待ってから判定する。
 */
export function deleteIndexedDatabase(name: string, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    let timer: ReturnType<typeof setTimeout> | undefined;

    const settle = (error?: Error) => {
      if (timer !== undefined) clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };

    request.onsuccess = () => settle();
    request.onerror = () => settle(request.error ?? new Error(`${label}を削除できませんでした。`));
    request.onblocked = () => {
      timer = setTimeout(
        () =>
          settle(
            new Error(
              `デモを開いている他のタブがあるため、${label}を削除できませんでした。` +
                '他のタブを閉じてからもう一度お試しください。',
            ),
          ),
        BLOCKED_TIMEOUT_MS,
      );
    };
  });
}
