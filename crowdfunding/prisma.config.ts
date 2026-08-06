import 'dotenv/config'
import { defineConfig, env } from 'prisma/config'

/**
 * Prisma 7 では接続 URL を schema.prisma ではなくここに書く。
 *
 * ★ ここの url は **CLI（migrate / studio / db push）専用**。
 *   Neon の pooler 経由ではマイグレーションが正しく動かないため、
 *   pooler を経由しない直接接続（DIRECT_URL）を指定する。
 *
 * アプリ実行時の接続は lib/db.ts が DATABASE_URL（pooled）を
 * ドライバアダプタに渡す。両者は別物なので取り違えないこと。
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DIRECT_URL'),
  },
})
