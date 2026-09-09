/**
 * Tailwind CSS の設定。
 *
 * 以前は index.html から Tailwind Play CDN(https://cdn.tailwindcss.com)を読み込んでいたが、
 * (1) Tailwind 公式が本番利用を非推奨としている
 * (2) 現場スタッフ向けPWA(オフライン前提)で外部スクリプトに依存したくない
 * の2点からビルド時生成に切り替えた。
 *
 * v3系を選んでいる。Play CDN が配信していたのが v3 で、v4 では border の既定色や
 * shadow-sm / rounded / flex-grow などのユーティリティの意味が変わる。
 * 既存のマークアップのクラス名を変えずに同じ見た目を保つことを最優先した。
 *
 * CDN版は tailwind.config のインライン設定を持っていなかったため、テーマ拡張・プラグインは無し
 * (= 既定のテーマそのまま)にしてある。フォントは body に直接指定する形(src/index.css)を
 * CDN版から引き継いでいるので、theme.fontFamily は既定のままにすること
 * (font-sans クラスを既定のスタックとして使っている箇所がある)。
 *
 * @type {import('tailwindcss').Config}
 */
export default {
  // JSで組み立てるクラス(src/demo/progressOverlay.ts など)も拾うため .ts も走査対象に含める。
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
};
