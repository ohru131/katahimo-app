/**
 * ユースケースが「入力が正しくない」と判断して投げるエラー。
 *
 * APIルートはこれだけを400(利用者に見せてよい日本語のメッセージ付き)で返し、
 * それ以外の例外は握り潰さずに投げ直して500にする。全部を400にまとめてしまうと、
 * DBが落ちている・実装のバグで落ちたといった障害まで「入力が悪い」という顔で返ってしまい、
 * 画面にも監視にも本当の失敗が出てこない。
 */
export class UsecaseValidationError extends Error {
  /**
   * パッケージが二重に読み込まれた場合でも判定できるようにする目印。
   * `instanceof` はクラスの実体が1つであることに依存するため、判定にはこの値を使う。
   */
  readonly kind = 'UsecaseValidationError' as const;

  constructor(message: string) {
    super(message);
    this.name = 'UsecaseValidationError';
  }
}

/** 例外がユースケースの検証エラーか(=400で返してよいか)を判定する。 */
export function isUsecaseValidationError(e: unknown): e is UsecaseValidationError {
  return e instanceof Error && (e as { kind?: unknown }).kind === 'UsecaseValidationError';
}
