import { DEMO_STAFF, DEMO_TENANT, startDemo } from '@katahimo/demo';
import { setDemoRuntime } from './demoRuntime';
import type { ProgressOverlay } from './progressOverlay';

/**
 * デモを起動して、`/api/**` へのfetchをブラウザ内のAPIへ向ける。
 * 進捗表示は呼び出し側(main.tsx)が先に出しているものを受け取る。
 * このモジュールの読み込み自体が重いので、ここで進捗画面を作ってはいけない。
 */
export async function bootDemo(progress: ProgressOverlay): Promise<boolean> {
  try {
    const handle = await startDemo(({ message, ratio }) => progress.update(message, ratio));
    setDemoRuntime({
      handle,
      tenantSlug: DEMO_TENANT.slug,
      credentials: DEMO_STAFF.map((staff) => ({
        label: staff.isAdmin ? '管理者' : 'スタッフ',
        name: staff.name,
        email: staff.email,
        password: staff.password,
      })),
    });
    progress.remove();
    return true;
  } catch (error) {
    console.error('[demo] 起動に失敗しました', error);
    progress.fail(error);
    return false;
  }
}
