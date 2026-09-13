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
 * theme.extend の色・角丸は doc/16_UIUX改善提案_2026-09-03.html のデザイントークン。
 * 「色は役割で決める」方針のため、`app-*` 以外の色(紫・エメラルド・琥珀・インディゴ・
 * ティール)をボタンや見出しに使わないこと。フォントは body に直接指定する形(src/index.css)を
 * CDN版から引き継いでいるので、theme.fontFamily は既定のままにすること
 * (font-sans クラスを既定のスタックとして使っている箇所がある)。
 *
 * @type {import('tailwindcss').Config}
 */
export default {
  // JSで組み立てるクラス(src/demo/progressOverlay.ts など)も拾うため .ts も走査対象に含める。
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        app: {
          /** 進む・保存(1画面に1つだけ) */
          primary: '#2F6FE4',
          'primary-active': '#245AB8',
          'primary-bg': '#EAF1FD',
          /** 完了・送った */
          done: '#2E8B57',
          'done-active': '#236B43',
          'done-bg': '#E8F4ED',
          /** 削除・事故 */
          danger: '#D64545',
          'danger-active': '#B23636',
          'danger-bg': '#FBEBEB',
          /** 戻る・補助 */
          subtle: '#E9E7EA',
          'subtle-active': '#D6D3D8',
          /** 本文の文字 */
          text: '#1F2933',
          /** 補足の文字(白地でコントラスト4.5:1以上) */
          muted: '#5F6B7A',
        },
      },
      borderRadius: {
        /** カード */
        card: '14px',
        /** ボタン・入力欄 */
        btn: '12px',
      },
    },
  },
  plugins: [],
};
