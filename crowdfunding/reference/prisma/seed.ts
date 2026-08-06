import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import 'dotenv/config'

/**
 * 開発用の初期データ。
 *
 * Phase 0 ではカテゴリのみ。
 * TODO(Phase 1): ADMIN ユーザー
 * TODO(Phase 3): 達成率 0 / 30 / 80 / 100 / 250% の見本プロジェクトと支援
 *   （進捗バーの見え方を確認するため、この5パターンは必ず用意する）
 */

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL
if (!connectionString) throw new Error('DIRECT_URL / DATABASE_URL is not set')

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })

const CATEGORIES = [
  { slug: 'music', name: '音楽', emoji: '🎵', sortOrder: 1 },
  { slug: 'art', name: 'アート', emoji: '🎨', sortOrder: 2 },
  { slug: 'game', name: 'ゲーム', emoji: '🎮', sortOrder: 3 },
  { slug: 'tech', name: 'テクノロジー', emoji: '⚙️', sortOrder: 4 },
  { slug: 'food', name: 'フード', emoji: '🍳', sortOrder: 5 },
  { slug: 'publishing', name: '出版', emoji: '📖', sortOrder: 6 },
  { slug: 'film', name: '映像', emoji: '🎬', sortOrder: 7 },
  { slug: 'community', name: '地域', emoji: '🏡', sortOrder: 8 },
]

/** キルスイッチの初期値（docs/11-payment-hardening.md §10） */
const SYSTEM_FLAGS = [
  { key: 'pledges.enabled', value: true, reason: '新規支援の受付' },
  { key: 'payouts.enabled', value: true, reason: '出品者への送金バッチ' },
  { key: 'signups.enabled', value: true, reason: '新規会員登録' },
]

async function main() {
  for (const c of CATEGORIES) {
    await db.category.upsert({ where: { slug: c.slug }, create: c, update: c })
  }
  console.log(`categories: ${CATEGORIES.length}`)

  for (const f of SYSTEM_FLAGS) {
    await db.systemFlag.upsert({
      where: { key: f.key },
      create: f,
      // 既存の値は上書きしない。運用中に落としたフラグを seed で戻さないため
      update: {},
    })
  }
  console.log(`system flags: ${SYSTEM_FLAGS.length}`)
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e)
    await db.$disconnect()
    process.exit(1)
  })
