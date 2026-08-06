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

```bash
npx create-next-app@latest fundbeat \
  --typescript --tailwind --app --src-dir=false --eslint --import-alias "@/*"
cd fundbeat
```

```bash
# 主要パッケージ
npm i @prisma/client next-auth@beta @auth/prisma-adapter stripe zod resend \
      date-fns clsx tailwind-merge lucide-react react-markdown rehype-sanitize \
      @aws-sdk/client-s3 @aws-sdk/s3-request-presigner

npm i -D prisma vitest @playwright/test tsx
```

```bash
# shadcn/ui
npx shadcn@latest init
npx shadcn@latest add button card input textarea label badge dialog \
      dropdown-menu select tabs avatar separator sonner skeleton
```

---

## 2. Prisma セットアップ

```bash
npx prisma init --datasource-provider postgresql
```

`prisma/schema.prisma` を [03-db-schema.md](03-db-schema.md) の内容で置き換えてから:

```bash
npx prisma migrate dev --name init
npx prisma generate
```

`package.json` に追加:

```jsonc
{
  "prisma": { "seed": "tsx prisma/seed.ts" },
  "scripts": {
    "dev": "next dev",
    "build": "prisma generate && next build",
    "db:push": "prisma db push",
    "db:migrate": "prisma migrate dev",
    "db:studio": "prisma studio",
    "db:seed": "prisma db seed",
    "stripe:listen": "stripe listen --forward-to localhost:3000/api/webhooks/stripe",
    "test": "vitest",
    "test:e2e": "playwright test"
  }
}
```

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

`schema.prisma` の datasource は両方指定する:

```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}
```

`.env.example` には**同じキーを値を空にして**コミットしておく。

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
| Prisma が接続エラー | Pooled URL(`-pooler`) を使っていない / `sslmode=require` がない |
| マイグレーションが失敗 | `directUrl` に `-pooler` なしの URL を設定する |
| Auth.js のリダイレクトループ | `AUTH_URL` と実際の URL が不一致 |
| ビルドは通るのに本番で 500 | 環境変数が Vercel 側に入っていない |
| Connect の onboarding が完了しない | `return_url` に戻っただけでは完了ではない。`accounts.retrieve` で確認する |
| 支援が二重に計上される | Webhook の冪等性がない。`WebhookEvent` の unique 制約を入れる |
