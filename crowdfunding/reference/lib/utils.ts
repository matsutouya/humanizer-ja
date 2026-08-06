import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * 残り日数。24時間未満は時間で返す（docs/05-screens.md）。
 *
 * 日数は切り上げる。切り捨てると、締切まで47時間ある状態が「残り1日」になり、
 * 実際より短く見えてしまう。支援者を急かす方向の誤表示は避ける。
 */
export function formatTimeLeft(endAt: Date, now: Date = new Date()): string {
  const ms = endAt.getTime() - now.getTime()
  if (ms <= 0) return '募集終了'

  const hours = ms / (1000 * 60 * 60)
  if (hours < 24) return `残り${Math.max(1, Math.ceil(hours))}時間`

  return `残り${Math.ceil(hours / 24)}日`
}

/** 達成率（%）。小数は切り捨て */
export function progressRate(current: number, goal: number): number {
  if (goal <= 0) return 0
  return Math.floor((current / goal) * 100)
}
