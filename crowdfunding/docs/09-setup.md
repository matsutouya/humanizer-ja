# 09. ローカル環境構築手順（PC での作業開始用）

このドキュメントどおりに進めれば、PC で開発を始められる。

---

## 0. 必要なもの

| ツール | バージョン | 備考 |
|---|---|---|
| Node.js | 20 以上（22 推奨） | `node -v` で確認 |
| npm または pnpm | — | pnpm 推奨（速い） |
| Git | — | |
| Stripe CLI | 最新 | Webhook のローカル転送に必須 |

### 作るアカウント（全部無料枠で始められる）

1. **Stripe** — https://dashboard.stripe.com/register
   登録後、左上が「テスト環境」になっていることを確認。Connect を有効化する。
2. **Neon**（Postgres） — https://neon.tech
   プロジェクト作成 → 接続文字列をコピー（**`-pooler` 付きの Pooled connection**）
3. **Resend**（メール） — https://resend.com
   API キー取得。ドメイン認証は後回しで、開発中は `onboarding@resend.dev` から送れる
4. **Cloudflare R2**（画像） — https://dash.cloudflare.com
   バケット作成 + API トークン。※ Supabase Storage で代替してもよい
5. **Vercel** — https://vercel.com
   GitHub 連携

---

## 1. プロジェクト作成

> ✅ **Phase 0 実施済み。** リポジトリの `crowdfunding/` がそのまま動くプロジェクトになっている。
> `git clone` して `npm install` すれば、この章はスキップできる。以下は再現手順の記録。

```bash
npx create-next-app@latest fundbeat \
  --typescript --tailwind --app --no-src-dir --eslint --import-alias "@/*" \
  --use-npm --turbopack
cd fundbeat
```

```bash
# 主要パッケージ
npm i @prisma/client @prisma/adapter-pg pg stripe zod \
      date-fns clsx tailwind-merge lucide-react \
      react-markdown remark-gfm rehype-sanitize

npm i -D prisma tsx vitest dotenv @types/pg
```

**フェーズごとに追加するもの**（いまは入れない）:

| パッケージ | フェーズ |
|---|---|
| `next-auth@beta` `@auth/prisma-adapter` `resend` | Phase 1 |
| `@aws-sdk/client-s3` `@aws-sdk/s3-request-presigner` | Phase 2 |
| `@playwright/test` | Phase 5 |

shadcn/ui は Phase 0 では導入していない（[02-architecture.md](02-architecture.md) 参照）。
必要になったら `npx shadcn@latest init` から始める。

---

## 2. Prisma セットアップ（⚠️ Prisma 7 で手順が変わっている）

**Prisma 7 から、接続 URL を `schema.prisma` に書けない。** `prisma.config.ts` に書く。
さらに `PrismaClient` にドライバアダプタを渡すことが必須になった。

### 2.1 スキーマ

`prisma/schema.prisma` の datasource は **provider だけ**にする。

```prisma
datasource db {
  provider = "postgresql"
}
```

`url` や `directUrl` を書くとエラー（P1012）になる。
モデル定義は [03-db-schema.md](03-db-schema.md) を参照。

### 2.2 prisma.config.ts

プロジェクト直下に置く。**ここの url は CLI 専用**（migrate / studio / seed）。

```ts
import 'dotenv/config'
import { defineConfig, env } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { seed: 'tsx prisma/seed.ts' },
  datasource: {
    // ★ pooler を経由しない直接接続を指定する。
    //   pooled URL を渡すとマイグレーションが正しく動かない
    url: env('DIRECT_URL'),
  },
})
```

`directUrl` というキーは Prisma 7 では受け付けない。**CLI が使う URL は1つだけ。**

### 2.3 アプリからの接続（lib/db.ts）

アプリ実行時は **pooled の `DATABASE_URL`** をアダプタに渡す。

```ts
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
export const db = new PrismaClient({ adapter })
```

```
prisma.config.ts  →  DIRECT_URL（直接接続）  … CLI
lib/db.ts         →  DATABASE_URL（pooled） … アプリ
```

**この2つを取り違えると、本番で接続数が枯渇するか、マイグレーションが失敗する。**

### 2.4 マイグレーション

```bash
npx prisma validate          # DB なしで検証できる
npx prisma generate          # DB なしで実行できる
npx prisma migrate dev --name init   # ★ DB が必要
```

`package.json` の scripts:

```jsonc
{
  "scripts": {
    "dev": "next dev",
    "build": "prisma generate && next build",
    "start": "next start",
    "lint": "eslint",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "db:migrate": "prisma migrate dev",
    "db:push": "prisma db push",
    "db:studio": "prisma studio",
    "db:seed": "prisma db seed",
    "db:generate": "prisma generate",
    "stripe:listen": "stripe listen --forward-to localhost:3000/api/webhooks/stripe"
  }
}
```

seed の指定は `package.json` の `"prisma"` フィールドではなく、
**`prisma.config.ts` の `migrations.seed`** に書く（Prisma 7 での変更）。

```bash
npm run db:seed
npm run db:studio   # ブラウザで DB の中身を確認できる
```

---

## 3. 環境変数

`.env.local` を作る。**`.env.local` は絶対に Git にコミットしない**（`.gitignore` に入っているか確認）。

```bash
# ─── アプリ ────────────────────────────────
NEXT_PUBLIC_BASE_URL="http://localhost:3000"

# ─── データベース ──────────────────────────
# Neon の Pooled connection（-pooler 付き）を使う
DATABASE_URL="postgresql://user:pass@ep-xxx-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require"
# マイグレーション用の直接接続（-pooler なし）
DIRECT_URL="postgresql://user:pass@ep-xxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require"

# ─── 認証 ──────────────────────────────────
# openssl rand -base64 32 で生成
AUTH_SECRET="..."
AUTH_URL="http://localhost:3000"
AUTH_GOOGLE_ID=""
AUTH_GOOGLE_SECRET=""

# ─── Stripe（テストキー）────────────────────
STRIPE_SECRET_KEY="sk_test_..."
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY="pk_test_..."
# stripe listen の出力に表示される値
STRIPE_WEBHOOK_SECRET="whsec_..."

# ─── メール ────────────────────────────────
RESEND_API_KEY="re_..."
MAIL_FROM="FUNDBEAT <onboarding@resend.dev>"

# ─── 画像ストレージ（Cloudflare R2）──────────
R2_ACCOUNT_ID=""
R2_ACCESS_KEY_ID=""
R2_SECRET_ACCESS_KEY=""
R2_BUCKET_NAME="fundbeat-uploads"
R2_PUBLIC_URL="https://cdn.example.com"

# ─── Cron 保護 ─────────────────────────────
CRON_SECRET="..."   # openssl rand -hex 32
```

**`DATABASE_URL` と `DIRECT_URL` の使い分けは §2 のとおり。**
`schema.prisma` にはどちらも書かない（Prisma 7 では書けない）。

`.env.example` には**同じキーを値を空にして**コミットしておく（リポジトリに用意済み）。

---

## 4. 起動

ターミナルを2つ使う。

```bash
# ターミナル1
npm run dev

# ターミナル2（Webhook 転送。Stripe を触るとき必須）
npm run stripe:listen
```

`stripe listen` が出力する `whsec_...` を `.env.local` の `STRIPE_WEBHOOK_SECRET` に入れて、`npm run dev` を再起動する。

http://localhost:3000

---

## 5. Vercel へのデプロイ

```bash
git init && git add -A && git commit -m "init"
gh repo create fundbeat --private --source=. --push   # または GitHub の Web から
```

Vercel で Import → 環境変数を設定（`.env.local` の内容を、`NEXT_PUBLIC_BASE_URL` と `AUTH_URL` だけ本番 URL に変えて）。

### Vercel Cron の設定

`vercel.json`:

```json
{
  "crons": [
    { "path": "/api/cron/close-projects",       "schedule": "0 * * * *"  },
    { "path": "/api/cron/retry-payments",       "schedule": "0 3 * * *"  },
    { "path": "/api/cron/release-stale-pledges", "schedule": "*/15 * * * *" }
  ]
}
```

Vercel の Cron は `Authorization: Bearer $CRON_SECRET` を自動で付けてくれる。Route 側で必ず検証する:

```ts
if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
  return new Response('Unauthorized', { status: 401 })
}
```

**注意:** Vercel の無料プランは Cron が1日1回までなど制限がある。締切処理を毎時回すなら Pro プランが要る。無料で粘るなら GitHub Actions のスケジュール実行から HTTP を叩く方法もある。

### 本番用の Stripe Webhook

Stripe ダッシュボード → 開発者 → Webhook → エンドポイント追加:

```
URL:  https://yourdomain.com/api/webhooks/stripe
イベント:
  checkout.session.completed
  checkout.session.expired
  payment_intent.succeeded
  payment_intent.payment_failed
  charge.refunded
  charge.dispute.created
  account.updated
  transfer.created
  payout.paid
  payout.failed
```

表示される署名シークレット（`whsec_...`）を Vercel の環境変数に設定する。**ローカルの `stripe listen` のものとは別物。**

---

## 6. 動作確認チェックリスト

環境構築が終わったら、この順で確認する。

- [ ] `npm run dev` でトップページが表示される
- [ ] `npm run db:studio` で seed データが見える
- [ ] メールリンクでログインできる
- [ ] `/admin` に一般ユーザーでアクセスすると弾かれる
- [ ] 出品者としてプロジェクトを作成し、下書き保存できる
- [ ] 運営として承認すると一覧に出る
- [ ] Connect のオンボーディングがテストモードで完了する
- [ ] `4242 4242 4242 4242` で支援でき、進捗バーが動く
- [ ] `stripe listen` のターミナルに `checkout.session.completed` が流れる
- [ ] Stripe ダッシュボードで application fee と transfer が確認できる
- [ ] メールが届く

---

## 7. よくあるハマりどころ

| 症状 | 原因と対処 |
|---|---|
| Webhook が 400（署名エラー） | `req.json()` を使っている。**`await req.text()` で生ボディを取る** |
| Webhook が届かない | `stripe listen` を起動していない / `whsec` が古い |
| 請求額が100倍 | JPY に 100 を掛けている。**JPY は倍率不要** |
| Prisma が接続エラー | `lib/db.ts` に pooled URL(`-pooler`) を渡していない / `sslmode=require` がない |
| マイグレーションが失敗 | `prisma.config.ts` の url に `-pooler` **なし**の `DIRECT_URL` を設定する |
| Auth.js のリダイレクトループ | `AUTH_URL` と実際の URL が不一致 |
| ビルドは通るのに本番で 500 | 環境変数が Vercel 側に入っていない |
| `P1012` datasource property `url` is no longer supported | Prisma 7。URL は `prisma.config.ts` に書く（§2） |
| `PrismaClient` の初期化で adapter を要求される | Prisma 7 ではドライバアダプタが必須。`@prisma/adapter-pg` を渡す |
| Connect の onboarding が完了しない | `return_url` に戻っただけでは完了ではない。`accounts.retrieve` で確認する |
| 支援が二重に計上される | Webhook の冪等性がない。`WebhookEvent` の unique 制約を入れる |
