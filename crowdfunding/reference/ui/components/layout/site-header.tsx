import Link from 'next/link'
import { Search } from 'lucide-react'
import { Container } from './container'
import { NAV_LINKS, SITE } from '@/lib/site'

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/95 backdrop-blur">
      <Container>
        <div className="flex h-16 items-center gap-6">
          <Link href="/" className="shrink-0 text-lg font-bold tracking-tight text-brand-deep">
            {SITE.name}
          </Link>

          <nav className="hidden items-center gap-5 md:flex">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm text-fg-secondary transition-colors hover:text-fg"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <Link
              href="/projects"
              aria-label="プロジェクトを検索"
              className="rounded-md p-2 text-fg-secondary transition-colors hover:bg-bg-subtle hover:text-fg md:hidden"
            >
              <Search className="size-5" aria-hidden />
            </Link>
            <Link
              href="/login"
              className="rounded-md px-3 py-2 text-sm font-medium text-fg-secondary transition-colors hover:bg-bg-subtle hover:text-fg"
            >
              ログイン
            </Link>
            <Link
              href="/creator/apply"
              className="rounded-md bg-accent px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-accent-hover active:bg-accent-active"
            >
              プロジェクトを始める
            </Link>
          </div>
        </div>
      </Container>
    </header>
  )
}
