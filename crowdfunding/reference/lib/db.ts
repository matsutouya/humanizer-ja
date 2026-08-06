import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

/**
 * Prisma クライアントのシングルトン。
 *
 * サーバーレス環境では実行のたびにモジュールが評価されうるため、
 * globalThis にぶら下げて接続の作りすぎを防ぐ。
 *
 * Prisma 7 からはドライバアダプタが必須。接続文字列は prisma.config.ts ではなく
 * ここで PrismaClient に渡す（config は CLI 用）。
 *
 * ⚠️ Neon を使う場合、DATABASE_URL は pooled（`-pooler` 付き）を指定すること。
 *    直接接続を使うとサーバーレスで接続数が枯渇する。
 */

const createClient = () => {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set')
  }
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  })
}

const globalForPrisma = globalThis as unknown as {
  prisma?: ReturnType<typeof createClient>
}

export const db = globalForPrisma.prisma ?? createClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db
}
