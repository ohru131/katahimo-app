import type { DemoHandle } from '@katahimo/demo';

/**
 * デモモードかどうか。`import.meta.env.VITE_DEMO` を直接見ずに必ずここを経由すること。
 *
 * viteは `import.meta.env.VITE_DEMO` をビルド時に定数へ置換するため、本番ビルドでは
 * この値が `false` に畳まれ、デモ関連の動的importごと成果物から消える。
 * (消えていることは scripts/assertNoDemoInBuild.mjs で検証している)
 */
export const IS_DEMO_MODE = import.meta.env.VITE_DEMO === '1';

export interface DemoCredential {
  label: string;
  name: string;
  email: string;
  password: string;
}

export interface DemoRuntime {
  handle: DemoHandle;
  tenantSlug: string;
  credentials: DemoCredential[];
}

let runtime: DemoRuntime | null = null;

export function setDemoRuntime(next: DemoRuntime): void {
  runtime = next;
}

export function getDemoRuntime(): DemoRuntime | null {
  return runtime;
}
