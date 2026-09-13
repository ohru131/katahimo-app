/**
 * 文字の大きさの設定。
 *
 * 画面に出す呼び名と本文の大きさ(src/index.css の html[data-text-size] を参照):
 *   'small'  = ふつう        16px
 *   'medium' = 大きい        18px  ← 初期値
 *   'large'  = とても大きい  20px
 *
 * localStorage のキー('app_text_size')と保存する値はGAS版から変えていない。
 * 既に設定しているスタッフの選択をそのまま引き継ぐため、値の名前ではなく
 * 「その値が何pxか」を index.css 側で1段ずつ引き上げている
 * (提案書:一番小さいものを既定にしない。現「中」相当を新しい既定にする)。
 */
export type TextSize = 'small' | 'medium' | 'large';

const STORAGE_KEY = 'app_text_size';

/** 画面に出す呼び名。設定画面とヘッダーの「Aa」で使う。 */
export const TEXT_SIZE_LABEL: Record<TextSize, string> = {
  small: 'ふつう',
  medium: '大きい',
  large: 'とても大きい',
};

/** 「Aa」ボタンで順送りする並び。 */
export const TEXT_SIZE_ORDER = ['small', 'medium', 'large'] as const satisfies readonly TextSize[];

/** 初期値は「大きい」。50〜60代の利用者が多く、一番小さいものを既定にしない。 */
export const DEFAULT_TEXT_SIZE: TextSize = 'medium';

export function getStoredTextSize(): TextSize {
  const value = localStorage.getItem(STORAGE_KEY);
  return value === 'small' || value === 'medium' || value === 'large' ? value : DEFAULT_TEXT_SIZE;
}

/** 次の大きさ(一番大きい次は一番小さいものへ戻る)。ヘッダーの「Aa」で使う。 */
export function nextTextSize(current: TextSize): TextSize {
  const index = TEXT_SIZE_ORDER.indexOf(current);
  return TEXT_SIZE_ORDER[(index + 1) % TEXT_SIZE_ORDER.length] ?? DEFAULT_TEXT_SIZE;
}

/** GAS版index.htmlのapplyTextSizeと同じ(html[data-text-size]属性+localStorage)。 */
export function applyTextSize(size: TextSize): void {
  document.documentElement.setAttribute('data-text-size', size);
  localStorage.setItem(STORAGE_KEY, size);
}
