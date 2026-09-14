/**
 * 自動生成するリファレンス(doc/16)で、ER図を分割する単位。
 *
 * 34テーブルを1枚の図に収めると読めない大きさになるため、業務ドメインごとに分ける。
 * 区切り方は doc/09_データベース構造解説.md の第2章(レビュー用の手書き図)と揃えてある。
 * 図を見比べる人が同じ切り口で読めるようにするため。
 *
 * ここに挙げるのは「そのドメインで新しく出てくる」テーブルだけ。親として参照されるだけの
 * テーブル(customers・staff など)は、図を組み立てるときに外部キーから自動で補われる。
 *
 * 並び順はそのまま図とテーブル定義の並び順になる。どこにも属さないテーブルが増えたら
 * schemaReference.test.ts が落ちる。一覧をここに書き写す形にしているのは、
 * 「テーブルを足したがドキュメントの区分を決めていない」状態を、生成物が黙って
 * 不完全になるのではなくテストの失敗として気付けるようにするため。
 */
export interface SchemaDomain {
  /** 見出しに出す名前。 */
  readonly title: string;
  /** 補足。図の読み方がドメイン固有の事情に依存する場合に書く。 */
  readonly note?: string;
  /** このドメインで新しく出てくるテーブル(DB上の名前)。 */
  readonly tables: readonly string[];
}

export const SCHEMA_DOMAINS: readonly SchemaDomain[] = [
  {
    title: '既存の業務データ',
    note: 'GAS版から移行した範囲。認証・日報・勤怠・領収書・クーポンまで。',
    tables: [
      'tenants',
      'tenant_keys',
      'staff',
      'customers',
      'family_members',
      'daily_reports',
      'accident_reports',
      'receipts',
      'attendance_days',
      'sessions',
      'password_reset_codes',
      'outbox_jobs',
      'app_settings',
      'coupons',
      'customer_coupons',
      'coupon_redemptions',
    ],
  },
  {
    title: '顧客カルテ',
    note: '顧客の家に関する運用情報(鍵の位置・ガレージ場所・注意点等)。',
    tables: ['customer_notes', 'customer_note_photos'],
  },
  {
    title: '予約',
    tables: ['service_menus', 'reservations', 'reservation_assignments', 'staff_availabilities'],
  },
  {
    title: '請求・決済',
    tables: ['customer_payment_profiles', 'invoices', 'invoice_lines', 'payments', 'stripe_webhook_events'],
  },
  {
    title: '訪問割当の最適化と移動手当',
    tables: [
      'trait_definitions',
      'customer_traits',
      'staff_traits',
      'staff_customer_compatibilities',
      'staff_customer_travel_estimates',
      'transport_allowance_rules',
      'travel_legs',
    ],
  },
];
