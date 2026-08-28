import { z } from 'zod';

/**
 * 環境変数の検証。起動時に一度だけ実行し、足りない設定は起動前に落とす。
 * GAS版は Script Properties の未設定に実行時まで気づけなかった(AUTH_SALT等)ため、
 * 新実装では起動時に明示的に検証する。
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL が必要です'),
  SESSION_SECRET: z.string().min(16, 'SESSION_SECRET は16文字以上にしてください'),

  // 移行期のみ必要: GAS版 Script Properties の AUTH_SALT と同じ値。
  // 未設定でも起動はできるが、既存パスワードでのログインは失敗する。
  LEGACY_AUTH_SALT: z.string().optional(),

  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  GOOGLE_OAUTH_REDIRECT_URI: z.string().optional(),

  GOOGLE_MAPS_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),

  // スプレッドシート脱却時はここを false にするだけでミラーが止まる
  MIRROR_TO_GOOGLE_SHEETS: z.coerce.boolean().default(false),
  MIRROR_TO_GOOGLE_CALENDAR: z.coerce.boolean().default(false),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`環境変数の設定に問題があります:\n${detail}`);
  }
  return parsed.data;
}
