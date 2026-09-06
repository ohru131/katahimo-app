import type {
  AppSettingsPatchInput,
  AppSettingsRecord,
  AppSettingsRepositoryPort,
} from '@katahimo/core/ports';

/** 訪問者本人の秘密であり、デモのDBに書いてはいけない項目。 */
type SecretFields = Pick<
  AppSettingsRecord,
  'geminiApiKey' | 'gchatReportWebhookUrl' | 'gchatReceiptWebhookUrl'
>;

const EMPTY_SECRETS: SecretFields = {
  geminiApiKey: null,
  gchatReportWebhookUrl: null,
  gchatReceiptWebhookUrl: null,
};

/**
 * 管理者設定のうち、訪問者が入力した秘密(Gemini APIキー・Google Chat Webhook URL)だけを
 * メモリに留め、DBへ永続化しないようにするデコレータ。
 *
 * デモの暗号鍵(DEMO_KEK)は公開ビルドに含まれており、誰でも読める。にもかかわらず本番と
 * 同じ経路で暗号化して保存すると、訪問者の**本物の**APIキーが「公開された鍵で暗号化された
 * だけの状態」でIndexedDBに残る。共用PC・ブラウザ拡張・端末の復旧データなどから取り出されれば
 * 平文と変わらない。「暗号化しているから安全」という誤った保証を与えないため、
 * デモでは秘密項目をそもそも永続化しない。
 *
 * 副作用として、タブを閉じるとキーの再入力が必要になる。デモの体験としては許容できる
 * (むしろ端末に残らないことを明示できる)ので、こちらを選んだ。
 * モデル名など秘密でない設定は従来どおりDBに保存され、リロード後も保たれる。
 */
export class DemoAppSettingsRepository implements AppSettingsRepositoryPort {
  private readonly secretsByTenant = new Map<string, SecretFields>();

  constructor(private readonly persistent: AppSettingsRepositoryPort) {}

  async find(tenantId: string): Promise<AppSettingsRecord | null> {
    const stored = await this.persistent.find(tenantId);
    const secrets = this.secretsByTenant.get(tenantId);
    if (!stored && !secrets) return null;
    return {
      tenantId,
      geminiReportModel: stored?.geminiReportModel ?? null,
      geminiOcrModel: stored?.geminiOcrModel ?? null,
      ...EMPTY_SECRETS,
      ...secrets,
    };
  }

  async upsert(tenantId: string, patch: AppSettingsPatchInput): Promise<AppSettingsRecord> {
    const { geminiApiKey, gchatReportWebhookUrl, gchatReceiptWebhookUrl, ...persistable } = patch;

    // patchはPATCH方式(渡されたキーだけ上書き)なので、undefinedと明示的なnullを区別する。
    const current = this.secretsByTenant.get(tenantId) ?? EMPTY_SECRETS;
    this.secretsByTenant.set(tenantId, {
      geminiApiKey: geminiApiKey !== undefined ? geminiApiKey : current.geminiApiKey,
      gchatReportWebhookUrl:
        gchatReportWebhookUrl !== undefined ? gchatReportWebhookUrl : current.gchatReportWebhookUrl,
      gchatReceiptWebhookUrl:
        gchatReceiptWebhookUrl !== undefined ? gchatReceiptWebhookUrl : current.gchatReceiptWebhookUrl,
    });

    const stored = await this.persistent.upsert(tenantId, persistable);
    return {
      tenantId,
      geminiReportModel: stored.geminiReportModel,
      geminiOcrModel: stored.geminiOcrModel,
      ...(this.secretsByTenant.get(tenantId) ?? EMPTY_SECRETS),
    };
  }
}
