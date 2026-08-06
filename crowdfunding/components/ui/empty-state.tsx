import Link from 'next/link'

/**
 * 0件のときに白紙を見せない。必ず次の行動を置く（docs/07-design.md）。
 */
export function EmptyState({
  icon = '🔍',
  title,
  description,
  actions,
}: {
  icon?: string
  title: string
  description?: string
  actions?: { href: string; label: string; primary?: boolean }[]
}) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-bg-subtle px-6 py-14 text-center">
      <div className="text-4xl" aria-hidden>
        {icon}
      </div>
      <p className="mt-4 text-base font-semibold text-fg">{title}</p>
      {description && (
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-fg-muted">{description}</p>
      )}
      {actions && actions.length > 0 && (
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          {actions.map((a) =>
            a.primary ? (
              <Link
                key={a.href}
                href={a.href}
                className="rounded-md bg-accent px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-accent-hover active:bg-accent-active"
              >
                {a.label}
              </Link>
            ) : (
              <Link
                key={a.href}
                href={a.href}
                className="rounded-md border border-border-strong px-5 py-2.5 text-sm font-medium text-fg transition-colors hover:bg-bg-muted"
              >
                {a.label}
              </Link>
            ),
          )}
        </div>
      )}
    </div>
  )
}
