/**
 * 画面に出す失敗メッセージ。
 *
 * 提案書(doc/16_UIUX改善提案_2026-09-03.html)の決めごと:
 * スタッフに英語の技術メッセージ(`Error: Failed to fetch` など)を見せない。
 * 画面には「次に何をすればよいか」だけを書き、原因は console へ出して開発側が追う。
 */

/** 原因が分からない失敗の言いかた。ここを起点に、分かっている失敗だけ個別の文にする。 */
export const GENERIC_ERROR_MESSAGE = 'うまくいきませんでした。電波を確認して、もう一度押してください';

/**
 * 例外・エラー応答を、スタッフが読める1文に変える。
 *
 * @param error   catch した値
 * @param context console に出すときの目印(どの操作で起きたか)
 * @param fallback この操作専用の言いかたがあれば渡す(例:「予定を読み込めませんでした。…」)
 */
export function toFriendlyMessage(error: unknown, context: string, fallback?: string): string {
  console.error(`[${context}]`, error);
  return fallback ?? GENERIC_ERROR_MESSAGE;
}
