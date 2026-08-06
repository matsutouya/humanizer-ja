/**
 * 手数料計算 — 金額に関する計算は、必ずこのファイルだけに置く。
 *
 * ここ以外に手数料の計算式や料率のリテラルを書かないこと。
 * 散らばった瞬間に、表示額・請求額・台帳の3者がズレ始める。
 *
 * 前提:
 *   - 通貨は日本円のみ。すべて整数（円）で扱う。
 *   - destination charge / separate transfer のいずれでも、
 *     決済手数料はプラットフォーム側の残高から引かれる。
 *     そのため出品者から徴収する額に決済手数料を含める必要がある。
 *
 * 詳細: docs/06-stripe.md §2, docs/13-payment-cost.md
 */

/** ベーシスポイント（1bp = 0.01%）。10_000bp = 100% */
const BP = 10_000

/**
 * 決済手数料率（bp）。
 * ⚠️ 決済事業者の最新の料金表で必ず確認すること。改定される。
 * 決定事項シート B-2 に対応。
 */
export const PAYMENT_FEE_RATE_BP = 360 // 3.60%

/**
 * サービス利用料のデフォルト（bp）。
 * プロジェクト作成時に Project.platformFeeRate へスナップショットする。
 * 料率を変更しても、募集中の既存プロジェクトの条件は変わらない。
 * 決定事項シート B-1 に対応。
 */
export const DEFAULT_PLATFORM_FEE_RATE_BP = 1_000 // 10.00%

export type FeeBreakdown = {
  /** 支援総額（リターン価格 × 数量 + 上乗せ支援） */
  totalAmount: number
  /** サービス利用料（プラットフォームの取り分） */
  platformFee: number
  /** 決済手数料（外部コストの転嫁分） */
  paymentFee: number
  /** 決済事業者に application_fee_amount として渡す額 = platformFee + paymentFee */
  applicationFee: number
  /** 出品者の受取額 */
  creatorPayout: number
}

export class FeeCalculationError extends Error {}

/**
 * 手数料の内訳を計算する。
 *
 * @param totalAmount      支援総額（円・整数）
 * @param platformFeeRateBp サービス利用料率（bp）。Project.platformFeeRate を渡す
 */
export function calcFees(totalAmount: number, platformFeeRateBp: number): FeeBreakdown {
  if (!Number.isInteger(totalAmount)) {
    throw new FeeCalculationError(`totalAmount must be an integer: ${totalAmount}`)
  }
  if (totalAmount <= 0) {
    throw new FeeCalculationError(`totalAmount must be positive: ${totalAmount}`)
  }
  if (!Number.isInteger(platformFeeRateBp) || platformFeeRateBp < 0 || platformFeeRateBp > BP) {
    throw new FeeCalculationError(`invalid platformFeeRateBp: ${platformFeeRateBp}`)
  }

  const platformFee = Math.round((totalAmount * platformFeeRateBp) / BP)
  const paymentFee = Math.round((totalAmount * PAYMENT_FEE_RATE_BP) / BP)
  const applicationFee = platformFee + paymentFee

  // ★ 引き算で求める。
  //   それぞれを独立に丸めると 1 円ズレて、台帳の突合が合わなくなる。
  const creatorPayout = totalAmount - applicationFee

  if (creatorPayout <= 0) {
    // 料率の設定ミス、または極端に少額な支援。設定を見直すべき状態。
    throw new FeeCalculationError(
      `creatorPayout would be non-positive: total=${totalAmount} fee=${applicationFee}`,
    )
  }

  return { totalAmount, platformFee, paymentFee, applicationFee, creatorPayout }
}

/**
 * 支援金額を組み立てる。
 *
 * ★ 金額は必ずサーバー側で、リターン ID から引いた価格を使って計算する。
 *   クライアントから送られてきた金額を信用してはならない。
 *   （開発者ツールで 10,000 円のリターンを 1 円で買われる）
 */
export function buildPledgeAmount(input: {
  rewardAmount: number // Reward.amount（DB から取得した値）
  quantity: number
  additionalTip: number
}): { rewardAmount: number; additionalTip: number; totalAmount: number } {
  const { rewardAmount, quantity, additionalTip } = input

  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new FeeCalculationError(`invalid quantity: ${quantity}`)
  }
  if (!Number.isInteger(additionalTip) || additionalTip < 0) {
    throw new FeeCalculationError(`invalid additionalTip: ${additionalTip}`)
  }

  const subtotal = rewardAmount * quantity
  return {
    rewardAmount: subtotal,
    additionalTip,
    totalAmount: subtotal + additionalTip,
  }
}

/** 表示用。¥1,234,567 形式。金額の表示は必ずこれを通す */
export function formatJpy(amount: number): string {
  return `¥${amount.toLocaleString('ja-JP')}`
}

/** 料率の表示用。1000bp → "10%" / 1360bp → "13.6%" */
export function formatRate(bp: number): string {
  const pct = bp / 100
  return `${Number.isInteger(pct) ? pct : pct.toFixed(1)}%`
}

/** 出品者向けの手数料表示。「13.6%（サービス利用料10% + 決済手数料3.6%）」 */
export function describeFeeRate(platformFeeRateBp: number): string {
  const total = platformFeeRateBp + PAYMENT_FEE_RATE_BP
  return (
    `${formatRate(total)}` +
    `（サービス利用料 ${formatRate(platformFeeRateBp)}` +
    ` + 決済手数料 ${formatRate(PAYMENT_FEE_RATE_BP)}）`
  )
}
