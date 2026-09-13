/**
 * 画面共通の部品。
 *
 * 新しいボタン・お知らせ・読み込み表示・空の状態は、必ずここから使うこと
 * (色・大きさ・言いかたの決めごとを1か所に集めるため)。
 * 決めごとの出どころは doc/16_UIUX改善提案_2026-09-03.html。
 */
export { Button, ButtonRow, type ButtonSize, type ButtonVariant, StickyActionBar } from './Button';
export { GENERIC_ERROR_MESSAGE, toFriendlyMessage } from './errors';
export { FeedbackProvider, useFeedback } from './Feedback';
export { EmptyState, ErrorNotice, LoadingBlock } from './Status';
