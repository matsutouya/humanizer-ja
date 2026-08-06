/**
 * 支援（Pledge）とプロジェクトの状態機械。
 *
 * ★ この設計の目的は「二重計上を構造的に不可能にする」こと。
 *
 * 状態変更を必ず条件付き UPDATE で行い、更新できたときだけ金額を動かす。
 * これにより、Webhook の重複配信・Cron の二重起動・リトライが、
 * すべて「何もしないで正常終了」に落ちる。
 *
 * 詳細: docs/11-payment-hardening.md §2
 */

import type { Prisma, PledgeStatus, ProjectStatus } from '@prisma/client'

// ══════════════════════════════════════════════════
//  遷移表
// ══════════════════════════════════════════════════

/**
 * 許容される Pledge の状態遷移。
 * ここに書かれていない遷移は、実装ミスとして例外を投げる。
 */
export const PLEDGE_TRANSITIONS: Record<PledgeStatus, readonly PledgeStatus[]> = {
  PENDING: ['AUTHORIZED', 'CAPTURED', 'CANCELED', 'EXPIRED'],
  AUTHORIZED: ['CAPTURED', 'PAYMENT_FAILED', 'CANCELED', 'EXPIRED'],
  PAYMENT_FAILED: ['CAPTURED', 'EXPIRED', 'CANCELED'],
  // ★ 決済済みからは、返金以外の遷移を許さない
  CAPTURED: ['REFUNDED'],
  CANCELED: [],
  EXPIRED: [],
  REFUNDED: [],
} as const

export const PROJECT_TRANSITIONS: Record<ProjectStatus, readonly ProjectStatus[]> = {
  DRAFT: ['IN_REVIEW'],
  IN_REVIEW: ['SCHEDULED', 'LIVE', 'REJECTED'],
  REJECTED: ['DRAFT', 'IN_REVIEW'],
  SCHEDULED: ['LIVE', 'SUSPENDED'],
  LIVE: ['SUCCEEDED', 'FAILED', 'SUSPENDED'],
  SUCCEEDED: ['FULFILLING', 'SUSPENDED'],
  FAILED: [],
  FULFILLING: ['COMPLETED', 'SUSPENDED'],
  COMPLETED: [],
  SUSPENDED: [],
} as const

/** 支援を受け付けてよい状態か */
export function canAcceptPledge(status: ProjectStatus): boolean {
  return status === 'LIVE'
}

/** 一般に公開してよい状態か */
export function isPubliclyVisible(status: ProjectStatus): boolean {
  return (['LIVE', 'SUCCEEDED', 'FAILED', 'FULFILLING', 'COMPLETED'] as ProjectStatus[]).includes(
    status,
  )
}

/** 支援額として集計に含める状態か */
export function countsTowardTotal(status: PledgeStatus): boolean {
  return status === 'AUTHORIZED' || status === 'CAPTURED'
}

/** 在庫を占有している状態か */
export function holdsInventory(status: PledgeStatus): boolean {
  return status === 'PENDING' || status === 'AUTHORIZED' || status === 'CAPTURED'
}

export class IllegalTransitionError extends Error {}

// ══════════════════════════════════════════════════
//  遷移の実行
// ══════════════════════════════════════════════════

/**
 * Pledge の状態を遷移させる。
 *
 * @returns true  = このリクエストが遷移を行った（→ 続けて金額を動かしてよい）
 *          false = すでに他の処理が遷移済み、または想定外の状態（→ 何もしない）
 *
 * ★ 呼び出し側は false を「エラー」ではなく「冪等に成功」として扱う。
 *
 * @example
 *   const moved = await transitionPledge(tx, id, ['PENDING'], 'CAPTURED', {
 *     capturedAt: new Date(),
 *   })
 *   if (!moved) return          // 処理済み。二重計上しない
 *   await postJournal(tx, ...)  // ★ 金額の操作は必ずこの後ろ
 */
export async function transitionPledge(
  tx: Prisma.TransactionClient,
  pledgeId: string,
  from: readonly PledgeStatus[],
  to: PledgeStatus,
  data: Omit<Prisma.PledgeUpdateManyMutationInput, 'status'> = {},
): Promise<boolean> {
  assertLegalPledgeTransition(from, to)

  const res = await tx.pledge.updateMany({
    // ★ 遷移元を where に含めることが本質。
    //   同時に2つのリクエストが来ても、更新できるのは片方だけになる。
    where: { id: pledgeId, status: { in: [...from] } },
    data: { ...data, status: to },
  })

  return res.count === 1
}

export async function transitionProject(
  tx: Prisma.TransactionClient,
  projectId: string,
  from: readonly ProjectStatus[],
  to: ProjectStatus,
  data: Omit<Prisma.ProjectUpdateManyMutationInput, 'status'> = {},
): Promise<boolean> {
  for (const f of from) {
    if (!PROJECT_TRANSITIONS[f].includes(to)) {
      throw new IllegalTransitionError(`Illegal project transition: ${f} -> ${to}`)
    }
  }

  const res = await tx.project.updateMany({
    where: { id: projectId, status: { in: [...from] } },
    data: { ...data, status: to },
  })

  return res.count === 1
}

/** 遷移表に反する呼び出しを、開発時点で落とす */
function assertLegalPledgeTransition(from: readonly PledgeStatus[], to: PledgeStatus): void {
  if (from.length === 0) {
    throw new IllegalTransitionError('`from` must not be empty')
  }
  for (const f of from) {
    if (!PLEDGE_TRANSITIONS[f].includes(to)) {
      throw new IllegalTransitionError(`Illegal pledge transition: ${f} -> ${to}`)
    }
  }
}

// ══════════════════════════════════════════════════
//  集計キャッシュの更新
// ══════════════════════════════════════════════════

/**
 * Project の集計キャッシュを更新する。
 *
 * ★ 必ず transitionPledge が true を返した後、同じトランザクション内で呼ぶ。
 *   単独で呼べる形にしてあるが、単独で呼んではいけない。
 */
export async function bumpProjectAggregate(
  tx: Prisma.TransactionClient,
  projectId: string,
  delta: { amount: number; backers: number },
): Promise<void> {
  await tx.project.update({
    where: { id: projectId },
    data: {
      currentAmount: { increment: delta.amount },
      backerCount: { increment: delta.backers },
    },
  })
}

// ══════════════════════════════════════════════════
//  在庫
// ══════════════════════════════════════════════════

export class SoldOutError extends Error {}

/**
 * リターンの在庫を確保する。
 *
 * ★ 「SELECT して比較してから UPDATE」を絶対にやらない。
 *   同時アクセスで上限を超える。条件付き UPDATE の1文で完結させる。
 */
export async function claimRewardStock(
  tx: Prisma.TransactionClient,
  rewardId: string,
  quantity: number,
): Promise<void> {
  const updated = await tx.$executeRaw`
    UPDATE "Reward"
    SET "quantityClaimed" = "quantityClaimed" + ${quantity}
    WHERE id = ${rewardId}
      AND "deletedAt" IS NULL
      AND (
        "quantityLimit" IS NULL
        OR "quantityClaimed" + ${quantity} <= "quantityLimit"
      )
  `

  if (updated === 0) {
    throw new SoldOutError('このリターンは売り切れました')
  }
}

/** 在庫を戻す（Checkout の期限切れ・キャンセル時） */
export async function releaseRewardStock(
  tx: Prisma.TransactionClient,
  rewardId: string,
  quantity: number,
): Promise<void> {
  await tx.$executeRaw`
    UPDATE "Reward"
    SET "quantityClaimed" = GREATEST(0, "quantityClaimed" - ${quantity})
    WHERE id = ${rewardId}
  `
}
