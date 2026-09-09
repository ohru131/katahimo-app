import type { MirrorKind } from '../../ports/mirror';

/**
 * ミラージョブの冪等キーを組み立てる。
 *
 * 「どのレコードの、どの版を書き戻すか」をキーにする。ランダムなUUIDにすると
 * outbox_jobsのUNIQUE(tenant_id, idempotency_key)が実質的に効かず、同じ保存操作が
 * 何かの拍子に二度enqueueされても二重に積まれてしまう。
 *
 * revisionにはレコードの更新時刻(挿入しかしないレコードは作成時刻)を渡す。
 * 編集して保存し直した場合はrevisionが進むため、別のジョブとして改めて積まれる
 * (編集内容をスプレッドシートへ反映するには、それが必要)。
 */
export function buildMirrorIdempotencyKey(kind: MirrorKind, targetId: string, revision: Date): string {
  return `${kind}:${targetId}:${revision.toISOString()}`;
}
