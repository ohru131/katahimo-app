/**
 * 資格情報(app_settings の Gemini APIキー・Google Chat Webhook URL)を暗号化して保存するためのポート。
 *
 * アプリ層で暗号化するのはこの資格情報だけ。顧客・世帯構成員・日報・事故報告・勤怠・領収書の
 * 業務データは全て平文列で持ち、DB/バックアップの保存時暗号化(Cloud SQL 既定の保存時暗号化=
 * TDE相当。バックアップも暗号化される)+ TLS + Row Level Security + IAM/ロール分離 + argon2id で
 * 保護する。これは秘密保持契約 第6条「アクセス制限、通信および保存時の暗号化、パスワード管理等」が
 * 求める水準に対応するもので、フィールド単位の暗号化は要求されていない。
 *
 * 業務データを平文で持つ理由:
 * - 検索性。SQL での絞り込み・並び替え・全文検索を DB 側でそのまま行える。列を暗号化すると
 *   絞り込みのたびに全件復号することになり運用が成り立たない。
 * - 日報データの AI 活用。分析・要約・匿名化(第3条2/第4条の統計化・仮名化)は平文列に対して
 *   SQL で直接行える方が実現しやすい。
 *
 * 資格情報だけは暗号化する理由: DB ダンプが流出したときに、外部サービスの API キーや Webhook URL が
 * 平文で漏れないようにするため(個人情報ではなく、検索や AI 活用の対象でもない)。
 *
 * 設計方針:
 * - 実データは常に CryptoPort でランダム化暗号化(AES-256-GCM)して保存する。同じ平文でも
 *   暗号文が毎回変わるため、鍵を持たない攻撃者は暗号文の一致パターンから何も読み取れない。
 * - 鍵(DEK)はテナントごとにランダム生成し、KeyManagementPort(./kms.ts)でKEKラップした状態で
 *   保存する(エンベロープ暗号化。packages/db/src/schema/tenantKeys.ts参照)。旧実装(マスターキー
 *   1本からSHA256でテナント鍵を決定的に導出)は、マスターキーが漏れれば全テナントの鍵を
 *   誰でも計算できてしまい、鍵を1本共有しているのと実質同じだったため廃止した。
 * - DEKは世代(keyVersion)を並存させる。暗号化は最新世代で行い、復号は暗号文に記録された
 *   世代の鍵で行うため、ローテーションしても既存の値はそのまま読める。
 * - tenant_keys の revoke による暗号学的削除(バックアップに残った暗号文も含めて復号不能にする)が
 *   及ぶのは資格情報のみ。顧客データの削除(第7条 返還・廃棄)はテナント単位の DELETE と
 *   バックアップ保持期間で担保する。
 *
 * このポートの実装は @katahimo/integrations に置く。ローカル開発・PoCは環境変数1本のKEKで
 * DEKをラップする `LocalKmsPort`、本番はCloud KMSでラップする実装に差し替える(Phase 5、
 * 実際のGCPプロジェクト・KMSキーリングが用意でき次第。KeyManagementPortのインターフェースは
 * 変えずに済む設計にしてある)。
 */

export interface EncryptedValue {
  /** Base64エンコードされた暗号文(nonce・authタグ込み)。 */
  ciphertext: string;
  /** 復号に使うDEKの世代。ローテーション後も、この世代の鍵を引いて復号する。 */
  keyVersion: number;
}

export interface CryptoPort {
  encrypt(tenantId: string, plaintext: string): Promise<EncryptedValue>;
  decrypt(tenantId: string, value: EncryptedValue): Promise<string>;
}
