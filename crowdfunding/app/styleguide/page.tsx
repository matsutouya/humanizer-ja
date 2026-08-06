import type { Metadata } from 'next'
import { Container } from '@/components/layout/container'
import { ProgressBar } from '@/components/project/progress-bar'
import { ProjectCard, type ProjectCardData } from '@/components/project/project-card'
import { EmptyState } from '@/components/ui/empty-state'
import { calcFees, describeFeeRate, formatJpy, DEFAULT_PLATFORM_FEE_RATE_BP } from '@/lib/fees'

/**
 * デザイン確認用のページ。DB なしでコンポーネントの見た目を検証できる。
 * 本番では公開しない（Phase 8 でルートごと除外するか、認証で保護する）。
 */
export const metadata: Metadata = {
  title: 'スタイルガイド',
  robots: { index: false, follow: false },
}

const SAMPLE_PROJECTS: ProjectCardData[] = [
  { rate: 0, backers: 0 },
  { rate: 34, backers: 27 },
  { rate: 82, backers: 143 },
  { rate: 100, backers: 210 },
  { rate: 254, backers: 688 },
].map((s, i) => ({
  slug: `sample-${i}`,
  title:
    i === 0
      ? 'まだ支援がないプロジェクト（タイトルが長い場合に2行でクランプされることを確認するためのサンプルテキスト）'
      : `サンプルプロジェクト ${i}：1stアルバムをつくりたい`,
  coverImageUrl: null,
  categoryName: '音楽',
  categoryEmoji: '🎵',
  creatorName: 'サンプル出品者',
  goalAmount: 1_000_000,
  currentAmount: Math.round(1_000_000 * (s.rate / 100)),
  backerCount: s.backers,
  endAt: new Date(Date.now() + (i === 0 ? 2 : 12) * 24 * 60 * 60 * 1000),
  fundingType: 'ALL_IN',
}))

const COLORS = [
  ['--bg', 'ベース背景'],
  ['--bg-subtle', 'セクション背景'],
  ['--bg-muted', 'バーの溝'],
  ['--border', '枠線'],
  ['--fg', '見出し・金額'],
  ['--fg-secondary', '本文'],
  ['--fg-muted', '補助'],
  ['--accent', 'CTA・進捗バー'],
  ['--brand-deep', 'ロゴ・見出し'],
  ['--success', '達成'],
  ['--warning', '締切間近'],
  ['--danger', 'エラー'],
  ['--info', 'リンク'],
]

const FEE_SAMPLES = [500, 3_000, 3_333, 10_000, 99_999]

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border py-10">
      <h2 className="text-xl font-bold text-fg">{title}</h2>
      <div className="mt-6">{children}</div>
    </section>
  )
}

export default function StyleguidePage() {
  return (
    <Container className="py-10">
      <h1 className="text-3xl font-bold tracking-tight text-fg">スタイルガイド</h1>
      <p className="mt-2 text-sm text-fg-muted">
        docs/07-design.md のトークンとコンポーネントの確認用。本番では公開しない。
      </p>

      <Section title="カラートークン">
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {COLORS.map(([token, label]) => (
            <li key={token} className="rounded-lg border border-border p-3">
              <div
                className="h-12 w-full rounded-md border border-border"
                style={{ background: `var(${token})` }}
              />
              <p className="mt-2 font-mono text-xs text-fg">{token}</p>
              <p className="text-xs text-fg-muted">{label}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="タイポグラフィ">
        <div className="space-y-3">
          <p className="text-3xl font-bold lg:text-4xl">ページ見出し（h1）</p>
          <p className="text-xl font-bold lg:text-2xl">セクション見出し（h2）</p>
          <p className="text-base font-semibold">カードタイトル</p>
          <p className="max-w-2xl text-base text-fg-secondary">
            本文。日本語は行間を広めに取る。つくりたいものを持つ人と、それを応援したい人をつなぐ場として、
            読みやすさを最優先にしている。
          </p>
          <p className="tabular text-3xl font-bold">{formatJpy(1_234_567)}</p>
          <p className="text-[13px] text-fg-muted">補助テキスト・キャプション</p>
        </div>
      </Section>

      <Section title="ボタン">
        <div className="flex flex-wrap items-center gap-3">
          <button className="rounded-md bg-accent px-6 py-3 text-base font-bold text-white transition-colors hover:bg-accent-hover active:bg-accent-active">
            このプロジェクトを支援する
          </button>
          <button className="rounded-md border border-border-strong bg-bg px-6 py-3 text-base font-medium text-fg transition-colors hover:bg-bg-muted">
            セカンダリ
          </button>
          <button
            disabled
            className="cursor-not-allowed rounded-md bg-bg-muted px-6 py-3 text-base font-bold text-fg-muted"
          >
            売り切れました
          </button>
        </div>
      </Section>

      <Section title="バッジ">
        <div className="flex flex-wrap gap-2 text-xs font-medium">
          <span className="rounded-full bg-bg-subtle px-2.5 py-1 text-fg-secondary">音楽</span>
          <span className="rounded-full bg-warning-subtle px-2.5 py-1 text-warning">残り3個</span>
          <span className="rounded-full bg-danger-subtle px-2.5 py-1 text-danger">残り2日</span>
          <span className="rounded-full bg-success-subtle px-2.5 py-1 text-success">目標達成</span>
          <span className="rounded-full bg-info-subtle px-2.5 py-1 text-info">
            目標達成でプロジェクト成立
          </span>
        </div>
      </Section>

      <Section title="進捗バー">
        <div className="max-w-md space-y-4">
          {[0, 34, 82, 100, 254].map((r) => (
            <div key={r}>
              <ProgressBar rate={r} />
              <p className="tabular mt-1 text-sm text-fg-muted">{r}%</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="ProjectCard">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {SAMPLE_PROJECTS.map((p) => (
            <ProjectCard key={p.slug} project={p} />
          ))}
        </div>
      </Section>

      <Section title="EmptyState">
        <EmptyState
          title="検索条件に合うプロジェクトが見つかりませんでした"
          description="条件を変えるか、すべてのプロジェクトから探してみてください。"
          actions={[
            { href: '/projects', label: 'すべてのプロジェクトを見る', primary: true },
            { href: '/projects', label: '条件をリセット' },
          ]}
        />
      </Section>

      <Section title={`手数料計算（${describeFeeRate(DEFAULT_PLATFORM_FEE_RATE_BP)}）`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-fg-muted">
                <th className="py-2 font-medium">支援額</th>
                <th className="py-2 font-medium">サービス利用料</th>
                <th className="py-2 font-medium">決済手数料</th>
                <th className="py-2 font-medium">出品者受取</th>
                <th className="py-2 font-medium">検算</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {FEE_SAMPLES.map((amount) => {
                const f = calcFees(amount, DEFAULT_PLATFORM_FEE_RATE_BP)
                const ok = f.platformFee + f.paymentFee + f.creatorPayout === f.totalAmount
                return (
                  <tr key={amount} className="border-b border-border">
                    <td className="py-2 font-semibold">{formatJpy(f.totalAmount)}</td>
                    <td className="py-2 text-fg-secondary">{formatJpy(f.platformFee)}</td>
                    <td className="py-2 text-fg-secondary">{formatJpy(f.paymentFee)}</td>
                    <td className="py-2 font-semibold">{formatJpy(f.creatorPayout)}</td>
                    <td className={`py-2 ${ok ? 'text-success' : 'text-danger'}`}>
                      {ok ? '一致' : '不一致'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[13px] text-fg-muted">
          出品者受取額は引き算で求めている。各項目を独立に丸めると1円ズレて台帳の突合が合わなくなる。
        </p>
      </Section>
    </Container>
  )
}
