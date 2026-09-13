import type { ReactNode } from 'react';

/**
 * 読み込み中の表示。
 *
 * くるくる(スピナー)だけにしない。待っているのか壊れたのかが分からないため、必ず文字を添える
 * (提案書「絶対に守ること」10)。時間のかかる処理は目安の秒数も書く。
 */
export function LoadingBlock({
  text = '読み込んでいます…',
  note,
  className = '',
}: {
  text?: string;
  /** 「1分ほどかかることがあります」など、待ち時間の目安。 */
  note?: string;
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 py-8 ${className}`}>
      <div className="loading-spinner h-8 w-8 rounded-full border-4 border-gray-200" />
      <p className="text-center text-base font-bold text-app-muted">{text}</p>
      {note && <p className="text-center text-sm text-app-muted">{note}</p>}
    </div>
  );
}

/**
 * 何も無いときの表示。
 *
 * 「ありません」で終わらせず、次にできることを1文添える(提案書「空の状態に『次にすること』を書く」)。
 * 絵は線画1点にとどめ、写真やカラフルなイラストは使わない。
 */
export function EmptyState({
  icon = '📭',
  title,
  nextStep,
  children,
}: {
  icon?: string;
  title: string;
  /** 「あすの予定は上の『🌙 あす』で見られます」のような次の一手。 */
  nextStep?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-card border border-dashed border-gray-300 bg-white px-4 py-8 text-center">
      <span className="text-3xl leading-none" aria-hidden="true">
        {icon}
      </span>
      <p className="text-base font-bold text-app-text">{title}</p>
      {nextStep && <p className="text-sm leading-relaxed text-app-muted">{nextStep}</p>}
      {children}
    </div>
  );
}

/**
 * 画面に出したまま残す失敗メッセージ(トーストではなく、その場に置くもの)。
 * 文面は errors.ts の toFriendlyMessage を通したものを渡すこと。
 */
export function ErrorNotice({ text, children }: { text: string; children?: ReactNode }) {
  return (
    <div className="rounded-card border border-app-danger bg-app-danger-bg p-4 text-base leading-relaxed text-app-text">
      <p className="whitespace-pre-wrap">{text}</p>
      {children}
    </div>
  );
}
