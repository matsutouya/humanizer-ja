import { describe, expect, it } from 'vitest'
import {
  buildPledgeAmount,
  calcFees,
  describeFeeRate,
  DEFAULT_PLATFORM_FEE_RATE_BP,
  FeeCalculationError,
  formatJpy,
  formatRate,
  PAYMENT_FEE_RATE_BP,
} from '../fees'

const RATE = DEFAULT_PLATFORM_FEE_RATE_BP // 10.00%

describe('calcFees', () => {
  // 端数が出るケースを必ず含める。丸め方を変えたらここで落ちる
  it.each([
    // [支援額, サービス利用料, 決済手数料, 出品者受取]
    [500, 50, 18, 432],
    [1_000, 100, 36, 864],
    [3_333, 333, 120, 2_880],
    [10_000, 1_000, 360, 8_640],
    [99_999, 10_000, 3_600, 86_399],
    [1_000_000, 100_000, 36_000, 864_000],
  ])('calcFees(%i)', (total, platformFee, paymentFee, creatorPayout) => {
    const f = calcFees(total, RATE)
    expect(f.platformFee).toBe(platformFee)
    expect(f.paymentFee).toBe(paymentFee)
    expect(f.creatorPayout).toBe(creatorPayout)
    expect(f.applicationFee).toBe(platformFee + paymentFee)
  })

  it('内訳の合計は必ず支援総額に一致する（端数のズレを許さない）', () => {
    for (let amount = 500; amount <= 20_000; amount += 7) {
      const f = calcFees(amount, RATE)
      expect(f.platformFee + f.paymentFee + f.creatorPayout).toBe(amount)
      expect(f.applicationFee + f.creatorPayout).toBe(amount)
    }
  })

  it('出品者受取額は常に正', () => {
    for (let amount = 500; amount <= 5_000; amount += 1) {
      expect(calcFees(amount, RATE).creatorPayout).toBeGreaterThan(0)
    }
  })

  it('料率0%ならサービス利用料は0（キャンペーン適用時）', () => {
    const f = calcFees(10_000, 0)
    expect(f.platformFee).toBe(0)
    expect(f.paymentFee).toBe(360)
    expect(f.creatorPayout).toBe(9_640)
  })

  it('不正な入力を弾く', () => {
    expect(() => calcFees(0, RATE)).toThrow(FeeCalculationError)
    expect(() => calcFees(-1, RATE)).toThrow(FeeCalculationError)
    expect(() => calcFees(100.5, RATE)).toThrow(FeeCalculationError)
    expect(() => calcFees(1_000, -1)).toThrow(FeeCalculationError)
    expect(() => calcFees(1_000, 10_001)).toThrow(FeeCalculationError)
  })

  it('料率が高すぎて受取額が0以下になる場合は例外', () => {
    // 利用料100% + 決済手数料3.6% → 受取額がマイナス
    expect(() => calcFees(1_000, 10_000)).toThrow(FeeCalculationError)
  })
})

describe('buildPledgeAmount', () => {
  it('数量と上乗せ支援を合算する', () => {
    expect(buildPledgeAmount({ rewardAmount: 3_000, quantity: 2, additionalTip: 1_500 })).toEqual({
      rewardAmount: 6_000,
      additionalTip: 1_500,
      totalAmount: 7_500,
    })
  })

  it('数量0以下・負の上乗せを弾く', () => {
    expect(() => buildPledgeAmount({ rewardAmount: 1_000, quantity: 0, additionalTip: 0 })).toThrow(
      FeeCalculationError,
    )
    expect(() =>
      buildPledgeAmount({ rewardAmount: 1_000, quantity: 1, additionalTip: -1 }),
    ).toThrow(FeeCalculationError)
  })
})

describe('表示', () => {
  it('formatJpy', () => {
    expect(formatJpy(1_234_567)).toBe('¥1,234,567')
    expect(formatJpy(0)).toBe('¥0')
  })

  it('formatRate', () => {
    expect(formatRate(1_000)).toBe('10%')
    expect(formatRate(PAYMENT_FEE_RATE_BP)).toBe('3.6%')
  })

  it('describeFeeRate は内訳を分けて示す', () => {
    expect(describeFeeRate(RATE)).toBe('13.6%（サービス利用料 10% + 決済手数料 3.6%）')
  })
})
