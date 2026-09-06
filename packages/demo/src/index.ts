import { installBufferPolyfill } from './bufferPolyfill';
import { createDemoContainer, type DemoContainer } from './container';
import { CookieJar } from './cookieJar';
import { destroyDemoDatabase, openDemoDatabase } from './database';
import { createDemoApiHandler } from './demoApi';
import { installFetchShim } from './fetchShim';
import { destroyBrowserStorage } from './ports/browserStoragePort';
import type { DemoNotification } from './ports/demoNotifierPort';
import { DEMO_FIGURES, DEMO_OFFICE, DEMO_STAFF, DEMO_TENANT } from './seed/figures';
import { type SeedProgress, seedDemoData } from './seed/seedDemoData';

export type { DemoNotification } from './ports/demoNotifierPort';
export { DEMO_STAFF, DEMO_TENANT } from './seed/figures';
export type { SeedProgress } from './seed/seedDemoData';

export interface DemoHandle {
  /** Google Chat通知の代わりに画面へ出すための購読。 */
  onNotification(listener: (notification: DemoNotification) => void): () => void;
  /** データを全消しして、次回読み込み時にシードからやり直す。 */
  reset(): Promise<void>;
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
  } else {
    onProgress({ message: '保存済みのデモデータを読み込んでいます…', ratio: 0.8 });
    await loadCustomerIds(container, customerIdByName);
  }

  const jar = new CookieJar();
  const shim = installFetchShim(createDemoApiHandler(container, jar));

  onProgress({ message: '準備ができました', ratio: 1 });

  return {
    onNotification: (listener) => container.notifier.subscribe(listener),
    async reset() {
      jar.clear();
      shim.uninstall();
      await Promise.all([destroyDemoDatabase(client), destroyBrowserStorage()]);
    },
  };
}
