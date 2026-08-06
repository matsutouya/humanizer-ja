/**
 * 複式簿記の台帳。
 *
 * ★ 4ファイルの中で、最も「後付けが効かない」もの。
 *   残高だけ持っていると「Stripe と ¥1,240 ズレている。どこで？」に答えられず、
 *   後から台帳を足しても過去の取引を再構成できない。最初から入れる。
 *
 * 不変条件（絶対に破らない）:
 *   1. 1つの仕訳（Journal）に含まれる明細の合計は必ず 0
 *   2. 明細は append-only。UPDATE / DELETE をしない
 *   3. 間違えたら訂正仕訳を切る。過去のレコードは書き換えない
 *
 * 詳細: docs/11-payment-hardening.md §1
 */

import type { Prisma, JournalType } from '@prisma/client'
import { calcFees } from './fees'

// ══════════════════════════════════════════════════
//  勘定科目
// ══════════════════════════════════════════════════

export const ACCOUNT = {
  /** 決済事業者上のプラットフォーム残高（資産） */
  PLATFORM_CASH: 'PLATFORM_CASH',
  /** 出品者への未払金（負債）。subjectId に creatorProfileId を入れる */
  CREATOR_PAYABLE: 'CREATOR_PAYABLE',
  /** サービス利用料収益（収益） */
  PLATFORM_REVENUE: 'PLATFORM_REVENUE',
  /** 決済手数料の未払（負債） */
  PSP_FEE_PAYABLE: 'PSP_FEE_PAYABLE',
  /** 決済手数料（費用） */
  PSP_FEE_EXPENSE: 'PSP_FEE_EXPENSE',
  /** 返金で回収できなかった決済手数料（費用） */
  REFUND_EXPENSE: 'REFUND_EXPENSE',
  /** チャージバックによる損失（費用） */
  DISPUTE_LOSS: 'DISPUTE_LOSS',
  /** チャージバック係争中の保留（資産のマイナス） */
  DISPUTE_HOLD: 'DISPUTE_HOLD',
} as const

export type AccountCode = (typeof ACCOUNT)[keyof typeof ACCOUNT]

export type EntryInput = {
  account: AccountCode
  /** 勘定の内訳キー。CREATOR_PAYABLE では creatorProfileId */
  subjectId?: string
  /** 符号付き（円）。プラス = 借方、マイナス = 貸方 */
  amount: number
}

export type JournalInput = {
  type: JournalType
  /**
   * 冪等キー。事象から一意に決まる文字列にする。
   * 例: `stripe_evt_xxx` / `pledge-capture-<pledgeId>` / `payout-<projectId>`
   * ★ Date.now() や乱数を混ぜない。混ぜた瞬間に冪等性が消える。
   */
  externalRef: string
  /** 経済事象が発生した時刻（決済事業者側の時刻を使う） */
  occurredAt: Date
  entries: EntryInput[]
  pledgeId?: string
  projectId?: string
  memo?: string
  /** MANUAL_ADJUSTMENT では必須 */
  operatorId?: string
}

export class UnbalancedJournalError extends Error {}

// ══════════════════════════════════════════════════
//  記帳
// ══════════════════════════════════════════════════

/**
 * 仕訳を記帳する。台帳への書き込みは必ずこの関数を経由する。
 *
 * @returns 記帳した場合は journal、既に記帳済み（冪等）の場合は null
 */
export async function postJournal(tx: Prisma.TransactionClient, input: JournalInput) {
  const { entries } = input

  // ── 不変条件の検証 ──────────────────────────
  // 型では防げない。実行時に必ず検証し、破れていたらトランザクションごと巻き戻す。
  if (entries.length < 2) {
    throw new UnbalancedJournalError(
      `Journal requires at least 2 entries: ref=${input.externalRef}`,
    )
  }
  const sum = entries.reduce((acc, e) => acc + e.amount, 0)
  if (sum !== 0) {
    throw new UnbalancedJournalError(
      `Unbalanced journal: sum=${sum} ref=${input.externalRef} ` +
        `entries=${JSON.stringify(entries)}`,
    )
  }
  for (const e of entries) {
    if (!Number.isInteger(e.amount)) {
      throw new UnbalancedJournalError(`Entry amount must be an integer: ${e.amount}`)
    }
    if (e.amount === 0) {
      throw new UnbalancedJournalError(`Entry amount must not be zero: ${e.account}`)
    }
  }
  if (input.type === 'MANUAL_ADJUSTMENT' && !input.operatorId) {
    throw new UnbalancedJournalError('MANUAL_ADJUSTMENT requires operatorId')
  }

  try {
    return await tx.ledgerJournal.create({
      data: {
        type: input.type,
        externalRef: input.externalRef,
        occurredAt: input.occurredAt,
        pledgeId: input.pledgeId,
        projectId: input.projectId,
        memo: input.memo,
        operatorId: input.operatorId,
        entries: {
          create: entries.map((e) => ({
            account: e.account,
            subjectId: e.subjectId,
            amount: e.amount,
          })),
        },
      },
    })
  } catch (e) {
    // externalRef の unique 違反 = 記帳済み。冪等に成功扱いとする
    if (isUniqueViolation(e, 'externalRef')) return null
    throw e
  }
}

function isUniqueViolation(e: unknown, field: string): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as { code?: string }).code === 'P2002' &&
    JSON.stringify((e as { meta?: unknown }).meta ?? '').includes(field)
  )
}

// ══════════════════════════════════════════════════
//  仕訳のテンプレート
// ══════════════════════════════════════════════════

/**
 * 支援の決済が完了した。
 *
 *   PLATFORM_CASH     +10,000   決済事業者の残高に入った
 *   CREATOR_PAYABLE    −8,640   出品者への未払が増えた
 *   PLATFORM_REVENUE   −1,000   サービス利用料
 *   PSP_FEE_PAYABLE      −360   決済事業者に払う分
 *                      ───────
 *                          0
 */
export async function journalPledgeCapture(
  tx: Prisma.TransactionClient,
  input: {
    pledgeId: string
    projectId: string
    creatorProfileId: string
    totalAmount: number
    platformFeeRateBp: number
    occurredAt: Date
    externalRef?: string
  },
) {
  const fees = calcFees(input.totalAmount, input.platformFeeRateBp)

  return postJournal(tx, {
    type: 'PLEDGE_CAPTURE',
    externalRef: input.externalRef ?? `pledge-capture-${input.pledgeId}`,
    occurredAt: input.occurredAt,
    pledgeId: input.pledgeId,
    projectId: input.projectId,
    entries: [
      { account: ACCOUNT.PLATFORM_CASH, amount: fees.totalAmount },
      {
        account: ACCOUNT.CREATOR_PAYABLE,
        subjectId: input.creatorProfileId,
        amount: -fees.creatorPayout,
      },
      { account: ACCOUNT.PLATFORM_REVENUE, amount: -fees.platformFee },
      { account: ACCOUNT.PSP_FEE_PAYABLE, amount: -fees.paymentFee },
    ],
  })
}

/**
 * 決済手数料の実額が確定した（balance_transaction から取得）。
 *
 * 見込額と実額の差は必ず記帳する。無視して上書きすると台帳が壊れる。
 */
export async function journalPspFeeSettle(
  tx: Prisma.TransactionClient,
  input: {
    pledgeId: string
    estimatedFee: number
    actualFee: number
    occurredAt: Date
  },
) {
  const entries: EntryInput[] = [
    { account: ACCOUNT.PSP_FEE_PAYABLE, amount: input.estimatedFee },
    { account: ACCOUNT.PSP_FEE_EXPENSE, amount: -input.estimatedFee },
  ]

  // 見込と実額の差額を調整
  const diff = input.actualFee - input.estimatedFee
  if (diff !== 0) {
    entries.push(
      { account: ACCOUNT.PSP_FEE_EXPENSE, amount: -diff },
      { account: ACCOUNT.PLATFORM_REVENUE, amount: diff },
    )
  }

  return postJournal(tx, {
    type: diff === 0 ? 'PSP_FEE_SETTLE' : 'FEE_ADJUSTMENT',
    externalRef: `psp-fee-${input.pledgeId}`,
    occurredAt: input.occurredAt,
    pledgeId: input.pledgeId,
    entries,
  })
}

/**
 * 出品者へ送金した（募集終了 + 7日）。
 *
 *   CREATOR_PAYABLE  +8,640   未払金が消えた
 *   PLATFORM_CASH    −8,640   残高から出ていった
 */
export async function journalTransferToCreator(
  tx: Prisma.TransactionClient,
  input: {
    projectId: string
    creatorProfileId: string
    netAmount: number
    occurredAt: Date
    externalRef?: string
  },
) {
  return postJournal(tx, {
    type: 'TRANSFER_TO_CREATOR',
    externalRef: input.externalRef ?? `payout-${input.projectId}`,
    occurredAt: input.occurredAt,
    projectId: input.projectId,
    entries: [
      {
        account: ACCOUNT.CREATOR_PAYABLE,
        subjectId: input.creatorProfileId,
        amount: input.netAmount,
      },
      { account: ACCOUNT.PLATFORM_CASH, amount: -input.netAmount },
    ],
  })
}

/**
 * 返金した。
 *
 * ★ 決済手数料は返ってこない。その分が REFUND_EXPENSE（実損）になる。
 *   この行があるから「返金するほど赤字が積もる」ことが数字で見える。
 */
export async function journalRefund(
  tx: Prisma.TransactionClient,
  input: {
    pledgeId: string
    projectId: string
    creatorProfileId: string
    totalAmount: number
    platformFeeRateBp: number
    /** 手数料も返すか（運営都合の返金では true） */
    refundApplicationFee: boolean
    occurredAt: Date
  },
) {
  const fees = calcFees(input.totalAmount, input.platformFeeRateBp)

  const entries: EntryInput[] = [
    { account: ACCOUNT.PLATFORM_CASH, amount: -fees.totalAmount },
    {
      account: ACCOUNT.CREATOR_PAYABLE,
      subjectId: input.creatorProfileId,
      amount: fees.creatorPayout,
    },
  ]

  if (input.refundApplicationFee) {
    // サービス利用料は取り消す。決済手数料は戻らないので実損になる
    entries.push(
      { account: ACCOUNT.PLATFORM_REVENUE, amount: fees.platformFee },
      { account: ACCOUNT.REFUND_EXPENSE, amount: -fees.paymentFee },
    )
  } else {
    // 手数料は返さない（出品者都合の返金など）
    entries.push({ account: ACCOUNT.PLATFORM_REVENUE, amount: fees.platformFee })
    entries.push({ account: ACCOUNT.PSP_FEE_PAYABLE, amount: fees.paymentFee })
  }

  return postJournal(tx, {
    type: 'REFUND',
    externalRef: `refund-${input.pledgeId}`,
    occurredAt: input.occurredAt,
    pledgeId: input.pledgeId,
    projectId: input.projectId,
    entries,
  })
}

/** チャージバックの申立てを受けた。該当分を保留に振り替える */
export async function journalDisputeOpen(
  tx: Prisma.TransactionClient,
  input: { pledgeId: string; projectId: string; amount: number; occurredAt: Date },
) {
  return postJournal(tx, {
    type: 'DISPUTE_OPEN',
    externalRef: `dispute-open-${input.pledgeId}`,
    occurredAt: input.occurredAt,
    pledgeId: input.pledgeId,
    projectId: input.projectId,
    entries: [
      { account: ACCOUNT.PLATFORM_CASH, amount: -input.amount },
      { account: ACCOUNT.DISPUTE_HOLD, amount: input.amount },
    ],
  })
}

// ══════════════════════════════════════════════════
//  残高の取得
// ══════════════════════════════════════════════════

/** 勘定の残高を台帳から算出する（キャッシュではなく真の値） */
export async function getAccountBalance(
  db: Prisma.TransactionClient,
  account: AccountCode,
  subjectId?: string,
): Promise<number> {
  const result = await db.ledgerEntry.aggregate({
    where: { account, ...(subjectId ? { subjectId } : {}) },
    _sum: { amount: true },
  })
  return result._sum.amount ?? 0
}

/** 出品者への未払残高（正の数で返す） */
export async function getCreatorPayableBalance(
  db: Prisma.TransactionClient,
  creatorProfileId: string,
): Promise<number> {
  // CREATOR_PAYABLE は負債なので台帳上はマイナス。符号を反転して返す
  return -(await getAccountBalance(db, ACCOUNT.CREATOR_PAYABLE, creatorProfileId))
}
