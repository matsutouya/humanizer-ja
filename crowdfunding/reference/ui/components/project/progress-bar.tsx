import { cn } from '@/lib/utils'

/**
 * 達成率の進捗バー。100% を超えたら色を変える（docs/07-design.md）。
 * スクリーンリーダー向けに role と aria 属性を必ず付ける。
 */
export function ProgressBar({
  rate,
  className,
  size = 'md',
}: {
  /** 達成率（%）。100 を超える値もそのまま渡してよい */
  rate: number
  className?: string
  size?: 'sm' | 'md'
}) {
  const achieved = rate >= 100

  return (
    <div
      role="progressbar"
      aria-valuenow={Math.min(rate, 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`達成率 ${rate}%`}
      className={cn(
        'w-full overflow-hidden rounded-full bg-bg-muted',
        size === 'sm' ? 'h-1' : 'h-1.5',
        className,
      )}
    >
      <div
        className={cn(
          'h-full rounded-full transition-[width] duration-500',
          achieved ? 'bg-success' : 'bg-accent',
        )}
        style={{ width: `${Math.min(Math.max(rate, 0), 100)}%` }}
      />
    </div>
  )
}
