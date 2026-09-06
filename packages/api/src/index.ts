// ブラウザ(packages/demo)からもimportされる入口。Node専用の実体(argon2・postgres-js)を
// 引きずり込まないよう、ここからは createContainer を再エクスポートしない。
// Node向けの組み立ては `@katahimo/api/node` から取ること。
export type { CreateAppOptions } from './app';
export { createApp } from './app';
export type { Container, GeminiModelInfo } from './container';
export type { Env } from './env';
export { loadEnv } from './env';
export { SESSION_COOKIE_NAME } from './session';
