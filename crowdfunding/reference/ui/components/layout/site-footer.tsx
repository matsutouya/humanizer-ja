import Link from 'next/link'
import { Container } from './container'
import { FOOTER_LINKS, SITE } from '@/lib/site'

export function SiteFooter() {
  return (
    <footer className="mt-20 border-t border-border bg-bg-subtle">
      <Container className="py-12">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="text-lg font-bold tracking-tight text-brand-deep">{SITE.name}</div>
            <p className="mt-2 text-sm leading-relaxed text-fg-muted">{SITE.tagline}</p>
          </div>

          {FOOTER_LINKS.map((group) => (
            <div key={group.heading}>
              <h2 className="text-sm font-bold text-fg">{group.heading}</h2>
              <ul className="mt-3 space-y-2">
                {group.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-fg-secondary transition-colors hover:text-fg"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 border-t border-border pt-6 text-xs text-fg-muted">
          © {new Date().getFullYear()} {SITE.name}
        </div>
      </Container>
    </footer>
  )
}
