import { cn } from '@/lib/utils'

/** 最大幅 1200px。左右パディングはモバイル16px / デスクトップ24px */
export function Container({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn('mx-auto w-full max-w-[1200px] px-4 lg:px-6', className)}>{children}</div>
  )
}
