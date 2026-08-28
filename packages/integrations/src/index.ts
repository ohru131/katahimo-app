// @katahimo/core の ports インターフェースの具体実装を置く層。
// このパッケージだけが googleapis / Google Maps Platform / Gemini に依存する。
// Phase 5 で google-sheets / google-drive / google-calendar / google-chat / google-maps / gemini を追加する。
export * from './gemini';
export * from './google-chat';
export * from './local-crypto';
export * from './local-storage';
