import { installBufferPolyfill } from './bufferPolyfill';
import { createDemoContainer, type DemoContainer } from './container';
import { CookieJar } from './cookieJar';
import { destroyDemoDatabase, flushDemoDatabase, openDemoDatabase } from './database';
import { createDemoApiHandler } from './demoApi';
import { installFetchShim } from './fetchShim';
import { destroyBrowserStorage } from './ports/browserStoragePort';
import type { DemoMail } from './ports/demoMailerPort';
import type { DemoNotification } from './ports/demoNotifierPort';
import { DEMO_FIGURES, DEMO_OFFICE, DEMO_STAFF, DEMO_TENANT } from './seed/figures';
import { type SeedProgress, seedDemoData } from './seed/seedDemoData';

export type { DemoMail } from './ports/demoMailerPort';
export type { DemoNotification } from './ports/demoNotifierPort';
export { DEMO_STAFF, DEMO_TENANT } from './seed/figures';
export type { SeedProgress } from './seed/seedDemoData';

export interface DemoHandle {
  /** Google Chat通知の代わりに画面へ出すための購読。 */
  onNotification(listener: (notification: DemoNotification) => void): () => void;
  /**
   * デモの継続には支障しないが利用者に伝える必要がある事象(いまのところ
   * IndexedDBへの書き出し失敗だけ)の購読。
   */
  onWarning(listener: (message: string) => void): () => void;
  /**
   * 送信したメールの購読。デモの宛先は架空なので実際には届かない。
   * 画面に出して、認証コードや初期パスワードを読めるようにするためのもの。
   */
  onMail(listener: (mail: DemoMail) => void): () => void;
  /** データを全消しして、次回読み込み時にシードからやり直す。失敗時は DemoResetError を投げる。 */
  reset(): Promise<void>;
}

/**
 * IndexedDBへの書き出しに失敗したときに画面へ出す文面。
 *
 * 「保存できませんでした」とは書かない。DBへのコミットは済んでいて、この画面で
 * 見えている状態は正しいので、やり直すと日報が二重に登録される。失われるのは
 * リロードをまたいだときだけなので、そのとおりに伝える。
 */
const PERSIST_FAILURE_MESSAGE =
  'この操作はデモ内には反映されていますが、端末に保存できませんでした。' +
  'ページを再読み込みすると失われます(保存し直す必要はありません)。' +
  'ブラウザの空き容量やプライベートブラウジングの設定をご確認ください。';

/**
 * リセットの失敗。`runtimeUsable` が false の場合はPGliteの接続が閉じた後の失敗で、
 * 画面をリロードしないとデモを操作できない。true ならまだそのまま使い続けられる。
 */
export class DemoResetError extends Error {
  readonly runtimeUsable: boolean;

  constructor(message: string, options: { runtimeUsable: boolean }) {
    super(message);
    this.name = 'DemoResetError';
    this.runtimeUsable = options.runtimeUsable;
  }
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 住所→緯度経度の対応表。DEMO_FIGURESから導出できるので、DBを読む必要はない。 */
function buildAddressLatLng(): Map<string, { lat: number; lng: number }> {
  const map = new Map<string, { lat: number; lng: number }>();
  map.set(DEMO_OFFICE.address, { lat: DEMO_OFFICE.lat, lng: DEMO_OFFICE.lng });
  for (const figure of DEMO_FIGURES) {
    map.set(`${figure.prefecture}${figure.city}${figure.addressDetail}`, {
      lat: figure.lat,
      lng: figure.lng,
    });
  }
  return map;
}

/** 2回目以降の起動では、シードせずにDBから顧客名→IDを引き直す。 */
async function loadCustomerIds(container: DemoContainer, into: Map<string, string>): Promise<void> {
  const tenant = await container.tenants.findBySlug(DEMO_TENANT.slug);
  if (!tenant) throw new Error('デモ事業所が見つかりません。データをリセットしてください。');
  for (const customer of await container.customers.listActive(tenant.id)) {
    into.set(customer.name, customer.id);
  }
}

/**
 * 公開デモを起動する。
 *
 * ブラウザ内にPostgreSQL(PGlite)を立て、本番と同じスキーマ・同じusecases・同じHonoルートを
 * 組み立てたうえで、`/api/**` へのfetchをそこに向ける。packages/web のコードは
 * 「APIサーバーと話している」つもりのまま動く。
 */
export async function startDemo(onProgress: (progress: SeedProgress) => void): Promise<DemoHandle> {
  // 暗号まわりがBufferを前提にしているため、他の何よりも先に入れる。
  installBufferPolyfill();

  onProgress({ message: 'デモ用データベースを起動しています…', ratio: 0 });
  const { db, client, isFresh } = await openDemoDatabase();

  // 予定タブが使う顧客名→IDは、シード(初回)またはDB読み込み(2回目以降)で後から埋める。
  // DemoSchedulePortはリクエストのたびに参照するため、参照を共有しておけば足りる。
  const customerIdByName = new Map<string, string>();
  const container = createDemoContainer({ db, customerIdByName, addressLatLng: buildAddressLatLng() });

  if (isFresh) {
    const seeded = await seedDemoData(container, onProgress);
    for (const [name, id] of seeded.customerIdByName) customerIdByName.set(name, id);
    // シードはrelaxedDurabilityのまま流しているので、ここで確実に書き出す。
    // 書き出す前にタブを閉じられると、次回起動時に中途半端なデータで立ち上がる。
    await flushDemoDatabase(client);
  } else {
    onProgress({ message: '保存済みのデモデータを読み込んでいます…', ratio: 0.8 });
    await loadCustomerIds(container, customerIdByName);
  }

  const jar = new CookieJar();
  const warningListeners = new Set<(message: string) => void>();
  const shim = installFetchShim(
    createDemoApiHandler(container, jar, {
      flush: () => flushDemoDatabase(client),
      onFailure: () => {
        for (const listener of warningListeners) listener(PERSIST_FAILURE_MESSAGE);
      },
    }),
  );

  onProgress({ message: '準備ができました', ratio: 1 });

  return {
    onNotification: (listener) => container.notifier.subscribe(listener),
    onMail: (listener) => container.mailer.subscribe(listener),
    onWarning: (listener) => {
      warningListeners.add(listener);
      return () => warningListeners.delete(listener);
    },
    /**
     * デモデータを削除する。削除できなかった場合は DemoResetError を投げる
     * (他タブがIndexedDBを開いているとブロックされる)。
     *
     * 順序が重要:
     * 1. 領収書画像(IndexedDB)を先に消す。ここで失敗しても、まだPGliteの接続は
     *    生きているのでデモはそのまま使い続けられる(`runtimeUsable: true`)。
     * 2. そのあとPGliteを閉じてDBを消す。`destroyDemoDatabase()` は削除の前に
     *    `client.close()` するため、ここで失敗したらもうAPIは応答できない
     *    (`runtimeUsable: false` → 呼び出し側はリロードするしかない)。
     *
     * 並列(Promise.all)にすると、画像の削除に失敗しただけでPGliteが閉じられ、
     * 「何も消えていないのにデモが動かない」状態になるため直列にしている。
     *
     * 削除が終わるまでfetchの差し替えは外さない。先に外すと、失敗して画面が残ったときに
     * `/api/**` が本物のネットワークへ飛んで404になる。
     */
    async reset() {
      try {
        await destroyBrowserStorage();
      } catch (error) {
        throw new DemoResetError(toMessage(error), { runtimeUsable: true });
      }
      try {
        await destroyDemoDatabase(client);
      } catch (error) {
        throw new DemoResetError(toMessage(error), { runtimeUsable: false });
      }
      jar.clear();
      shim.uninstall();
    },
  };
}
