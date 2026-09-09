/**
 * 要配慮性の高い項目の暗号化と、暗号化したままの等値検索のためのポート。
 *
 * 暗号化の対象は「漏れたときの影響が特に大きい項目」に絞ってある(2026-08 データベース構造
 * レビューを踏まえた方針変更。doc/09 1.3節)。緊急連絡先・避難場所・自由記述メモ・緯度経度、
 * 家族構成員の氏名と生年月日、日報と事故報告の本文、領収書の明細、テナントのAPIキーなど。
 *
 * 逆に、氏名・かな・メール・電話・住所は平文の列で持つ。検索と表示に常時使う項目を全部
 * 暗号化すると、絞り込みのたびに全件復号することになり運用が成り立たない。これらは
 * DB/バックアップの透過的暗号化(TDE)+ Row Level Security + IAM に委ねる。
 *
 * 設計方針:
 * - 実データは常に CryptoPort でランダム化暗号化(AES-256-GCM)して保存する。同じ平文でも
 *   暗号文が毎回変わるため、鍵を持たない攻撃者は暗号文の一致パターンから何も読み取れない。
 *   決定的暗号化(同じ平文→同じ暗号文)を実値にそのまま使うと、日本の姓のように偏りの大きい
 *   データでは出現頻度からの統計的な逆引きが可能になってしまうため、実値には使わない。
 * - BlindIndexPort(決定的なHMAC)は、暗号化したままで等値の一致だけを見たい場所に使う。
 *   現在の用途は領収書の重複検出(receipts.dedupe_blind_index)ひとつだけ。苗字での顧客検索は
 *   平文列 customers.family_name と通常のインデックスで行うため、ここは経由しない。
 * - CryptoPort と BlindIndexPort は鍵を分ける(暗号化鍵の漏洩だけではブラインドインデックスから
 *   平文を復元できず、逆にインデックス鍵の漏洩だけでは実値を復号できない、という権限分離)。
 * - 鍵(DEK)はテナントごとにランダム生成し、KeyManagementPort(./kms.ts)でKEKラップした状態で
 *   保存する(エンベロープ暗号化。packages/db/src/schema/tenantKeys.ts参照)。旧実装(マスターキー
 *   1本からSHA256でテナント鍵を決定的に導出)は、マスターキーが漏れれば全テナントの鍵を
 *   誰でも計算できてしまい、鍵を1本共有しているのと実質同じだったため廃止した。
 *   テナント解約時はDEKを失効させるだけで、バックアップに残った暗号文も含めて復号不能に
 *   できる(暗号学的削除)。
 * - DEKは世代(keyVersion)を並存させる。暗号化は最新世代で行い、復号は暗号文に記録された
 *   世代の鍵で行うため、ローテーションしても既存の値はそのまま読める。
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

export interface BlindIndexPort {
  /**
   * 正規化済みの値から検索用ブラインドインデックスを計算する。
   * 呼び出し側は必ず domain/pii/normalize.ts 等で正規化してから渡すこと
   * (正規化がずれると同一人物なのにインデックスが一致しなくなる)。
   */
  compute(tenantId: string, normalizedValue: string): Promise<string>;
}
