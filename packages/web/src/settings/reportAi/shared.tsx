/**
 * ReportAiAdminModal配下の各タブで使う共通のTailwindクラス・小さな見た目部品。
 * 既存の管理モーダル(PromptTemplateAdminModal・CouponAdminModal)と見た目を揃えるためのもの。
 */

export const INPUT_CLASS = 'w-full p-2 border border-gray-300 rounded text-xs';
export const TEXTAREA_CLASS = `${INPUT_CLASS} resize-y`;
export const SELECT_CLASS = `${INPUT_CLASS} bg-white`;
export const BUTTON_PRIMARY_CLASS =
  'px-3 py-1.5 text-xs font-bold rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60';
export const BUTTON_SECONDARY_CLASS =
  'px-3 py-1.5 text-xs font-bold rounded border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-60';
export const BUTTON_DANGER_CLASS =
  'px-3 py-1.5 text-xs font-bold rounded border border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-60';

export function ErrorText({ children }: { children: string | null }) {
  if (!children) return null;
  return <p className="text-red-500 text-xs">{children}</p>;
}

export function NoticeText({ children }: { children: string | null }) {
  if (!children) return null;
  return <p className="text-green-600 text-xs">{children}</p>;
}

/** 数値入力欄の値をnumberにする。空欄・不正な入力はnull(呼び出し側で検証エラーにする)。 */
export function parseIntOrNull(value: string): number | null {
  if (value.trim() === '') return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}
