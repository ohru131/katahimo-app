import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * ボタンの役割。色は役割で決める(doc/16_UIUX改善提案_2026-09-03.html「文字・色・大きさのきまり」)。
 *
 * - `primary` 進む・保存。**1画面(1モーダル)に1つだけ**。
 * - `done`    完了・送った(事務局へ通知が飛ぶ操作など)。
 * - `danger`  削除・事故。
 * - `subtle`  戻る・補助。取り消し系は必ずこれ。
 * - `outline` 補助のうち、白地に枠線で置きたいもの(一覧の末尾に置く控えめな入口など)。
 */
export type ButtonVariant = 'primary' | 'done' | 'danger' | 'subtle' | 'outline';

/**
 * ボタンの大きさ。
 * - `main` 高さ48px。押してほしいもの。
 * - `sub`  高さ44px。補助。これより小さいボタンは作らない。
 */
export type ButtonSize = 'main' | 'sub';

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'bg-app-primary text-white border border-app-primary active:bg-app-primary-active',
  done: 'bg-app-done text-white border border-app-done active:bg-app-done-active',
  danger: 'bg-app-danger text-white border border-app-danger active:bg-app-danger-active',
  subtle: 'bg-app-subtle text-app-text border border-app-subtle active:bg-app-subtle-active',
  outline: 'bg-white text-app-text border border-gray-300 active:bg-gray-100',
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  main: 'min-h-[48px] px-4 py-3 text-base',
  sub: 'min-h-[44px] px-4 py-2.5 text-base',
};

/**
 * アプリ共通のボタン。
 *
 * 守っていること(提案書の「絶対に守ること」6・7):
 * - 高さ48px以上(補助でも44px)。指で押せる大きさにする。
 * - `hover:` を使わず `active:` にする(スマホにマウスオーバーは無い)。
 * - 文字のないボタンを作らない。絵文字だけのラベルを渡さないこと(「⚙️」ではなく「⚙️ 設定」)。
 *
 * 並べるときは ButtonRow を使い、取り消しを左・進むを右に固定する。
 */
export function Button({
  variant = 'subtle',
  size = 'main',
  fullWidth = false,
  className = '',
  children,
  ...rest
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  children: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className={`inline-flex items-center justify-center gap-1.5 rounded-btn font-bold transition-colors disabled:opacity-60 ${
        VARIANT_CLASS[variant]
      } ${SIZE_CLASS[size]} ${fullWidth ? 'w-full' : ''} ${className}`}
    >
      {children}
    </button>
  );
}

/**
 * ボタンを横に並べる。取り消し系は左・グレー、進む系は右・青、の並びを全画面で固定するための箱
 * (提案書の「絶対に守ること」7)。間隔はgap-3(12px)以上にする。
 */
export function ButtonRow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`flex items-center gap-3 ${className}`}>{children}</div>;
}

/**
 * モーダル下部に固定する主ボタンのバー。スクロールして主ボタンを探す必要をなくす
 * (提案書「主ボタンを画面下に固定し、1画面に1つ」)。影はここだけに使う。
 */
export function StickyActionBar({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-0 z-10 border-t border-gray-200 bg-white px-4 py-3 shadow-[0_-2px_10px_rgba(0,0,0,0.08)]">
      {children}
    </div>
  );
}
