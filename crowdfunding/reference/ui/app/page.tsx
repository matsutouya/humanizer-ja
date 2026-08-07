import Link from 'next/link'
import { Container } from '@/components/layout/container'
import { EmptyState } from '@/components/ui/empty-state'
import { SITE } from '@/lib/site'

/**
 * トップページ。
 *
 * TODO(Phase 3): 注目・新着・締切間近のプロジェクトを DB から取得して並べる。
 * 現時点ではプロジェクトが存在しないため、枠と空状態のみ。
 */

const CATEGORIES = [
  { slug: 'music', name: '音楽', emoji: '🎵' },
  { slug: 'art', name: 'アート', emoji: '🎨' },
  { slug: 'game', name: 'ゲーム', emoji: '🎮' },
  { slug: 'tech', name: 'テクノロジー', emoji: '⚙️' },
  { slug: 'food', name: 'フード', emoji: '🍳' },
  { slug: 'publishing', name: '出版', emoji: '📖' },
  { slug: 'film', name: '映像', emoji: '🎬' },
  { slug: 'community', name: '地域', emoji: '🏡' },
]

const STEPS = [
  {
    n: 1,
    title: 'プロジェクトをつくる',
    body: 'つくりたいものと、必要な金額、リターンを決めます。',
  },
  { n: 2, title: '審査を受けて公開する', body: '運営が内容を確認し、承認されたら公開されます。' },
  { n: 3, title: '応援を受け取る', body: '募集が終わったら、手数料を引いた金額をお届けします。' },
]

export default function HomePage() {
  return (
    <>
      {/* ヒーロー */}
      <section className="border-b border-border bg-bg-subtle">
        <Container className="py-16 lg:py-24">
          <div className="max-w-2xl">
            <h1 className="text-3xl font-bold leading-tight tracking-tight text-fg lg:text-5xl">
              {SITE.tagline}
            </h1>
            <p className="mt-4 text-base leading-relaxed text-fg-secondary lg:text-lg">
              {SITE.description}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/projects"
                className="rounded-md bg-accent px-6 py-3 text-base font-bold text-white transition-colors hover:bg-accent-hover active:bg-accent-active"
              >
                プロジェクトを探す
              </Link>
              <Link
                href="/creator/apply"
                className="rounded-md border border-border-strong bg-bg px-6 py-3 text-base font-medium text-fg transition-colors hover:bg-bg-muted"
              >
                プロジェクトを始める
              </Link>
            </div>
          </div>
        </Container>
      </section>

      {/* 注目のプロジェクト */}
      <Container className="py-14">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xl font-bold text-fg lg:text-2xl">注目のプロジェクト</h2>
          <Link href="/projects" className="text-sm text-info hover:underline">
            すべて見る
          </Link>
        </div>

        <div className="mt-6">
          <EmptyState
            icon="🎵"
            title="まもなく、最初のプロジェクトが公開されます"
            description="いま準備中です。公開されたらこちらに並びます。"
            actions={[{ href: '/creator/apply', label: 'プロジェクトを始める', primary: true }]}
          />
        </div>
      </Container>

      {/* カテゴリ */}
      <Container className="pb-14">
        <h2 className="text-xl font-bold text-fg lg:text-2xl">カテゴリから探す</h2>
        <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {CATEGORIES.map((c) => (
            <li key={c.slug}>
              <Link
                href={`/categories/${c.slug}`}
                className="flex items-center gap-3 rounded-lg border border-border bg-bg px-4 py-3.5 transition-colors hover:bg-bg-subtle"
              >
                <span className="text-xl" aria-hidden>
                  {c.emoji}
                </span>
                <span className="text-sm font-medium text-fg">{c.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Container>

      {/* 出品導線 */}
      <section className="border-t border-border bg-bg-subtle">
        <Container className="py-14">
          <h2 className="text-xl font-bold text-fg lg:text-2xl">3ステップで始められます</h2>
          <ol className="mt-8 grid gap-6 sm:grid-cols-3">
            {STEPS.map((s) => (
              <li key={s.n} className="rounded-lg border border-border bg-bg p-6">
                <span className="inline-flex size-8 items-center justify-center rounded-full bg-accent-subtle text-sm font-bold text-accent-active">
                  {s.n}
                </span>
                <h3 className="mt-4 text-base font-semibold text-fg">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-fg-secondary">{s.body}</p>
              </li>
            ))}
          </ol>
        </Container>
      </section>
    </>
  )
}
