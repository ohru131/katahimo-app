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

  // セッションCookieに署名鍵は要らない。Cookieに入るのは32バイトの乱数トークンで、
  // 検証はDB側のハッシュ照合で行うため、値を偽造しても既存セッションには当たらない
  // (packages/core/src/usecases/auth.ts の hashSessionToken 参照)。
  // 以前ここに SESSION_SECRET を必須で置いていたが、どこからも参照していなかった。
  // 「必須なのに使われていない設定」は、署名しているかのような誤解を招くので置かない。

  // CryptoPortが使うテナントDEK(tenant_keys)をラップするKEK(KeyManagementPortの開発用実装
  // LocalKmsPortが使う)。32バイト(64桁hex)。暗号化の対象は app_settings の資格情報
  // (Gemini APIキー・Google Chat Webhook URL)だけで、顧客・日報等の業務データは平文列
  // (packages/core/src/ports/crypto.ts参照)。本番はCloud KMSに置き換える(Phase 5)。
  LOCAL_DEV_KEK: z.string().regex(/^[0-9a-f]{64}$/i, 'LOCAL_DEV_KEK は32バイト(64桁の16進数)にしてください'),

  // パスワード再設定コード(6桁)の検証子を計算する鍵。32バイト(64桁hex)。
  // DBには検証子(HMAC)だけを保存し、この鍵はDBに置かない。単純なハッシュだと
  // 6桁=100万通りしか無いためDBが漏れた時点で有効なコードを復元できてしまう、
  // というのを防ぐためのもの。LOCAL_DEV_KEKとは別の値にする
  // (一方が漏れても他方に影響しない権限分離)。
  PASSWORD_RESET_PEPPER: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, 'PASSWORD_RESET_PEPPER は32バイト(64桁の16進数)にしてください'),

  // 移行期のみ必要: GAS版 Script Properties の AUTH_SALT と同じ値。
  // 未設定でも起動はできるが、既存パスワードでのログインは失敗する。
  LEGACY_AUTH_SALT: z.string().optional(),

  // Google OAuth(GOOGLE_OAUTH_*)と Google Maps Platform(GOOGLE_MAPS_API_KEY)の設定は
  // 置いていない。前者は未着手、後者は下のGASブリッジ経由で代替しており、どちらも
  // コードから参照する箇所が無いため。実装するときに、使う場所と一緒に足す。

  // katahimo-app単体ではAPIキー不要のMapsサービス(Maps.newGeocoder/newDirectionFinder)を
  // 直接呼べない(Apps Script実行環境の外からは使えないため)。稼働中のgas-childcare-visit-app
  // のWeb Appデプロイを軽量なプロキシとして使うことで、Google Maps Platformの新規契約
  // (APIキー・課金設定)を避けられる。GAS_BRIDGE_URLはそのWeb Appの/execエンドポイント、
  // GAS_BRIDGE_SECRETはGAS側Bridge.jsのBRIDGE_API_SECRET(Script Properties)と同じ値。
  // 未設定の場合はNoopMapsPort(常にnullを返す)にフォールバックする。
  GAS_BRIDGE_URL: z.string().optional(),
  GAS_BRIDGE_SECRET: z.string().optional(),

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

  // スプレッドシート脱却時はここを false にするだけでミラーが止まる。
  // Googleカレンダーへのミラーは対象外(GAS版がカレンダーへ一度も書き込んでいないため
  // 書き戻し先が無い。packages/core/src/ports/mirror.ts の MirrorKind 参照)。
  MIRROR_TO_GOOGLE_SHEETS: z.coerce.boolean().default(false),

  /**
   * 勤怠の保存時に「勤怠集計」シートの再計算(MirrorKind の attendance_aggregate)も積むか。
   * MIRROR_TO_GOOGLE_SHEETS が true のときだけ意味を持つ。
   *
   * 既定で false にしてあるのは、このジョブ1件ごとにGAS側でMapsのルート計算が走るため
   * (GAS版は「この日をカレンダーから反映」ボタンと夜間トリガーだけで再計算しており、
   * 勤怠の保存ごとには走らせていない)。勤怠集計シートを新システム側から更新する運用に
   * 切り替えるときだけ有効にする。
   */
  MIRROR_ATTENDANCE_AGGREGATE: z.coerce.boolean().default(false),

  /**
   * 書き込み系APIを別オリジンから叩くことを許可するオリジン(カンマ区切り)。
   * 通常は空でよい(同一オリジンのみ許可)。管理画面を別ドメインに置く場合だけ設定する。
   */
  ALLOWED_ORIGINS: z
    .string()
    .optional()
    .transform((v) =>
      (v ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    ),
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
