import type { StoragePort, StoredFile } from '@katahimo/core/ports';
import { deleteIndexedDatabase } from '../deleteIndexedDatabase';

const DB_NAME = 'katahimo-demo-storage';
const STORE_NAME = 'files';

interface StoredEntry {
  contentType: string;
  body: Uint8Array;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDBを開けませんでした'));
  });
}

function runRequest<T>(store: IDBObjectStore, request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDBの操作に失敗しました'));
    // トランザクションが中断された場合もハングしないように拾う。
    store.transaction.onabort = () =>
      reject(store.transaction.error ?? new Error('IndexedDBが中断されました'));
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => Promise<T>): Promise<T> {
  const db = await openDb();
  try {
    return await fn(db.transaction(STORE_NAME, mode).objectStore(STORE_NAME));
  } finally {
    db.close();
  }
}

/**
 * StoragePortのブラウザ実装。領収書画像の実体をIndexedDBに置く。
 * 本番のGCS・ローカル開発のファイルシステムに相当する層で、公開デモでは
 * 画像が訪問者のブラウザから一歩も外に出ないという性質も兼ねる。
 */
export class BrowserStoragePort implements StoragePort {
  async put(key: string, contentType: string, body: Uint8Array): Promise<StoredFile> {
    await withStore('readwrite', (store) =>
      runRequest(store, store.put({ contentType, body } satisfies StoredEntry, key)),
    );
    return { key, contentType, byteSize: body.byteLength };
  }

  async get(key: string): Promise<Uint8Array | null> {
    const entry = await withStore('readonly', (store) =>
      runRequest<StoredEntry | undefined>(store, store.get(key)),
    );
    return entry?.body ?? null;
  }

  async delete(key: string): Promise<void> {
    await withStore('readwrite', (store) => runRequest(store, store.delete(key)));
  }

  /**
   * デモではAPIサーバーが存在しない(ブラウザ内でHonoを動かしている)ため、
   * 配信URLの代わりにその場でblob URLを作って返す。期限の概念はない。
   */
  async signedUrl(key: string): Promise<string> {
    const entry = await withStore('readonly', (store) =>
      runRequest<StoredEntry | undefined>(store, store.get(key)),
    );
    if (!entry) throw new Error(`ファイルが見つかりません: ${key}`);
    // IndexedDBから戻るUint8ArrayのバッファはSharedArrayBufferの可能性がある型になっており、
    // そのままではBlobに渡せない。実体をコピーして通常のArrayBufferにする。
    const buffer = new ArrayBuffer(entry.body.byteLength);
    new Uint8Array(buffer).set(entry.body);
    return URL.createObjectURL(new Blob([buffer], { type: entry.contentType }));
  }
}

/**
 * 「デモデータをリセット」時に画像も一緒に消す。
 * 削除できなかった場合は必ず失敗させる(消えていないのに成功扱いにすると、
 * リロード後も残っている領収書画像を見てユーザーが混乱する)。
 */
export function destroyBrowserStorage(): Promise<void> {
  return deleteIndexedDatabase(DB_NAME, '領収書画像');
}
