/**
 * サイト共通の設定値。
 *
 * ⚠️ ここの値は decisions.md の未決定項目に対応する仮値。
 *    サービス名（A-1）とドメイン（A-2）が決まったら差し替える。
 */
export const SITE = {
  /** decisions.md A-1（仮） */
  name: 'FUNDBEAT',
  tagline: 'つくりたいものを、みんなの力で。',
  description:
    '音楽、アート、ものづくり。つくりたいものを持つ人と、応援したい人をつなぐクラウドファンディング。',
  /** decisions.md A-2（仮） */
  url: process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000',
  /** decisions.md A-8（仮） */
  contactEmail: 'support@example.com',
} as const

export const NAV_LINKS = [
  { href: '/projects', label: 'プロジェクトを探す' },
  { href: '/how-it-works', label: 'はじめての方へ' },
] as const

export const FOOTER_LINKS = [
  {
    heading: 'サービス',
    links: [
      { href: '/about', label: 'FUNDBEAT について' },
      { href: '/how-it-works', label: 'はじめての方へ' },
      { href: '/faq', label: 'よくある質問' },
    ],
  },
  {
    heading: 'プロジェクトを始める',
    links: [
      { href: '/creator/apply', label: '出品者になる' },
      { href: '/guidelines', label: 'プロジェクトガイドライン' },
    ],
  },
  {
    heading: '規約',
    links: [
      { href: '/terms', label: '利用規約' },
      { href: '/privacy', label: 'プライバシーポリシー' },
      { href: '/tokushoho', label: '特定商取引法に基づく表記' },
    ],
  },
] as const
