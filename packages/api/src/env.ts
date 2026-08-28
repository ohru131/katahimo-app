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

  // CryptoPort/BlindIndexPortの開発用実装(LocalCryptoPort)が使うマスターキー。
  // 32バイト(64桁hex)。本番はここではなくCloud KMSに置き換える(Phase 5)。
  LOCAL_DEV_MASTER_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, 'LOCAL_DEV_MASTER_KEY は32バイト(64桁の16進数)にしてください'),

  // 移行期のみ必要: GAS版 Script Properties の AUTH_SALT と同じ値。
  // 未設定でも起動はできるが、既存パスワードでのログインは失敗する。
  LEGACY_AUTH_SALT: z.string().optional(),

  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  GOOGLE_OAUTH_REDIRECT_URI: z.string().optional(),

  GOOGLE_MAPS_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  // 日報/事故報告生成・領収書OCRに使うモデル名(未設定時はGAS版と同じデフォルトを使う)。
  GEMINI_MODEL_REPORT: z.string().optional(),
  GEMINI_MODEL_OCR: z.string().optional(),

  // Google Chat Incoming Webhook。GAS版GoogleChat.jsのScript Propertiesと同じ役割。
  // 未設定の場合は通知を送らずスキップする(GAS版と同じフォールバック)。
  GCHAT_REPORT_WEBHOOK_URL: z.string().optional(),
  GCHAT_RECEIPT_WEBHOOK_URL: z.string().optional(),

  // 領収書画像の保存先(ローカル開発用ファイルシステムパス)。本番はGCS(Phase 5)に置き換える。
  LOCAL_RECEIPT_STORAGE_DIR: z.string().default('./data/receipts'),

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
