// Phase 5 読み取り側の実機確認。ポート実装(GasBridgeMapsPort/GasBridgeSchedulePort)を
// そのまま使い、本番のBridge.jsデプロイへ実際にHTTPで問い合わせる。副作用は無い。
import { readFileSync } from 'node:fs';
import { GasBridgeMapsPort, GasBridgeSchedulePort } from '@katahimo/integrations';

const env = new Map(
  readFileSync(new URL('../../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1).trim()] as [string, string];
    }),
);

const options = {
  baseUrl: env.get('GAS_BRIDGE_URL') ?? '',
  secret: env.get('GAS_BRIDGE_SECRET') ?? '',
  timeoutMs: 90_000,
};

const maps = new GasBridgeMapsPort(options);
const schedule = new GasBridgeSchedulePort(options);

async function show(label: string, run: () => Promise<unknown>): Promise<void> {
  try {
    const r = await run();
    console.log(`OK    ${label}\n        ${JSON.stringify(r)}`);
  } catch (e) {
    console.log(`ERR   ${label}\n        ${e instanceof Error ? e.message : String(e)}`);
    if (e instanceof Error && e.cause) console.log('        cause:', e.cause);
  }
}

// 1. 日本語住所のジオコーディング。curl(Git Bash)ではマルチバイトが壊れて失敗したので、
//    Nodeのfetch+URLSearchParams経由なら正しく通ることを確認する。
await show('geocode 宮城県仙台市青葉区一番町1-1-1', () =>
  maps.geocode('宮城県仙台市青葉区一番町1-1-1'),
);
await show('geocode 仙台市青葉区二日町', () => maps.geocode('仙台市青葉区二日町'));

// 2. ルート計算(GAS版getRouteDetailsと同じ)
await show('route 仙台駅→県庁付近', () =>
  maps.route({ lat: 38.2601, lng: 140.8823 }, { lat: 38.2688, lng: 140.8721 }),
);

// 3. 予定取得。存在しない日本語スタッフ名を渡し、staffNameがそのまま返るかで
//    マルチバイトの往復を確認する(GAS側は見つからない場合その名前をそのまま返す)。
await show('schedule 存在しない日本語スタッフ名', () =>
  schedule.getSchedule('架空 太郎', '2026-09-10'),
);

const staffName = process.argv[2];
if (staffName) {
  const date = process.argv[3] ?? new Date().toISOString().slice(0, 10);
  await show(`schedule 実在スタッフ ${staffName} ${date}`, () => schedule.getSchedule(staffName, date));
  // forceRefresh=false。Maps呼び出しを伴うため、実在スタッフ・予定がある日でのみ意味がある。
  await show(`scheduleWithRoute 実在スタッフ ${staffName} ${date}`, () =>
    schedule.getScheduleWithRoute(staffName, date, false),
  );
} else {
  console.log('\n(実在スタッフ名を引数に渡すと schedule/scheduleWithRoute も確認する)');
}
