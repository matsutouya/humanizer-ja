import { describe, expect, it } from 'vitest'
import { formatTimeLeft, progressRate } from '../utils'

const NOW = new Date('2026-04-01T00:00:00Z')
const after = (hours: number) => new Date(NOW.getTime() + hours * 60 * 60 * 1000)

describe('formatTimeLeft', () => {
  it('締切を過ぎていれば募集終了', () => {
    expect(formatTimeLeft(after(0), NOW)).toBe('募集終了')
    expect(formatTimeLeft(after(-1), NOW)).toBe('募集終了')
  })

  it('24時間未満は時間で表示する', () => {
    expect(formatTimeLeft(after(23), NOW)).toBe('残り23時間')
    expect(formatTimeLeft(after(1), NOW)).toBe('残り1時間')
    // 1時間未満でも「残り0時間」にはしない
    expect(formatTimeLeft(after(0.2), NOW)).toBe('残り1時間')
  })

  it('日数は切り上げる（47時間を「残り1日」と表示しない）', () => {
    expect(formatTimeLeft(after(24), NOW)).toBe('残り1日')
    expect(formatTimeLeft(after(47), NOW)).toBe('残り2日')
    expect(formatTimeLeft(after(48), NOW)).toBe('残り2日')
    // 12日ちょうどから数ミリ秒欠けても 12日 と出る
    expect(formatTimeLeft(new Date(NOW.getTime() + 12 * 86_400_000 - 5), NOW)).toBe('残り12日')
  })
})

describe('progressRate', () => {
  it.each([
    [0, 1_000_000, 0],
    [340_000, 1_000_000, 34],
    [1_000_000, 1_000_000, 100],
    [2_540_000, 1_000_000, 254],
    // 端数は切り捨て。99.9% を 100% と表示しない
    [999_999, 1_000_000, 99],
  ])('progressRate(%i, %i) === %i', (current, goal, expected) => {
    expect(progressRate(current, goal)).toBe(expected)
  })

  it('目標金額が0でも壊れない', () => {
    expect(progressRate(1_000, 0)).toBe(0)
  })
})
