/**
 * ReportAiAdminModal配下の各タブで使う共通のTailwindクラス・小さな見た目部品。
 * 既存の管理モーダル(PromptTemplateAdminModal・CouponAdminModal)と見た目を揃えるためのもの。
 */
import { REPORT_LEVEL_MAX, REPORT_LEVEL_MIN } from '@katahimo/shared';

/** 教育関心度★・ストレス度(PSI)が取りうるレベル一覧(REPORT_LEVEL_MIN〜REPORT_LEVEL_MAX)。 */
export const REPORT_LEVELS: number[] = Array.from(
  { length: REPORT_LEVEL_MAX - REPORT_LEVEL_MIN + 1 },
  (_, i) => REPORT_LEVEL_MIN + i,
);

export const INPUT_CLASS = 'w-full p-2 border border-gray-300 rounded text-xs';
export const TEXTAREA_CLASS = `${INPUT_CLASS} resize-y`;
export const BUTTON_PRIMARY_CLASS =
  'px-3 py-1.5 text-xs font-bold rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60';
export const BUTTON_SECONDARY_CLASS =
  'px-3 py-1.5 text-xs font-bold rounded border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-60';
export const BUTTON_DANGER_CLASS =
  'px-3 py-1.5 text-xs font-bold rounded border border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-60';

/** 失敗の理由を赤字で出す。null のときは何も描かない。 */
export function ErrorText({ children }: { children: string | null }) {
  if (!children) return null;
  return <p className="text-red-500 text-xs">{children}</p>;
}

/** 保存できた等の知らせを緑字で出す。null のときは何も描かない。 */
export function NoticeText({ children }: { children: string | null }) {
  if (!children) return null;
  return <p className="text-green-600 text-xs">{children}</p>;
}
